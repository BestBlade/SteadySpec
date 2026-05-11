#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    runtime: null,
    project: process.cwd(),
    force: false,
    dryRun: false,
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "init" || arg === "--here") {
      continue;
    }
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--runtime") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runtime requires a value");
      args.runtime = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.runtime && !["claude", "codex"].includes(args.runtime)) {
    throw new Error("--runtime must be claude or codex");
  }
  return args;
}

function printHelp() {
  console.log(`steadyspec init

Install substrate-agnostic SDD anti-drift skills into a project.

Usage:
  steadyspec init [options]

Options:
  --runtime <claude|codex>  Override runtime auto-detection.
  --here                    Install into the current directory. This is the default.
  --force                   Replace existing installed SteadySpec skill directories.
  --dry-run                 Print actions without writing files.
  --help                    Show this help.

V1 scope:
  See README.md for command scope. This CLI currently ships init only.
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function rewriteInstalledText(text, relativeFile = "") {
  const phasePath = relativeFile.startsWith("references/") ? "phases.md" : "references/phases.md";
  return text
    .replace(/\.\.\/\.\.\/\.\.\/METHOD\.md/g, "references/METHOD.md")
    .replace(/\.\.\/\.\.\/METHOD\.md/g, "references/METHOD.md")
    .replace(/\.\.\/\.\.\/adoption\/steadyspec-adopt/g, "../steadyspec-adopt")
    .replace(/\.\.\/\.\.\/router\/steadyspec-workflow/g, "../steadyspec-workflow")
    .replace(/\.\.\/\.\.\/phases\.md/g, phasePath)
    .replace(/\badoption\/steadyspec-adopt\b/g, "steadyspec-adopt")
    .replace(/\brouter\/steadyspec-workflow\b/g, "steadyspec-workflow");
}

function copyDir(src, dest, base = src) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, base);
    } else if (entry.isFile()) {
      if (/\.(md|txt|json|yaml|yml)$/i.test(entry.name)) {
        const relativeFile = path.relative(base, srcPath).replace(/\\/g, "/");
        fs.writeFileSync(destPath, rewriteInstalledText(fs.readFileSync(srcPath, "utf8"), relativeFile), "utf8");
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

function appendSnippet(filePath, snippet) {
  const marker = "<!-- steadyspec -->";
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (existing.includes(marker)) return false;
  const next = `${existing.trimEnd()}\n\n${marker}\n${snippet.trim()}\n<!-- /steadyspec -->\n`;
  fs.writeFileSync(filePath, next, "utf8");
  return true;
}

function runtimePaths(project, runtime) {
  if (runtime === "claude") {
    return {
      skillsDir: path.join(project, ".claude", "skills"),
      instructionFile: path.join(project, "CLAUDE.md"),
    };
  }
  return {
    skillsDir: path.join(project, ".codex", "skills"),
    instructionFile: path.join(project, "AGENTS.md"),
  };
}

function detectRuntime(project) {
  const claude = fs.existsSync(path.join(project, ".claude")) || fs.existsSync(path.join(project, "CLAUDE.md"));
  const codex = fs.existsSync(path.join(project, ".codex")) || fs.existsSync(path.join(project, "AGENTS.md"));
  if (claude && codex) return ["claude", "codex"];
  if (claude) return ["claude"];
  if (codex) return ["codex"];
  return [];
}

function detectSubstrate(project) {
  const detected = [];
  if (fs.existsSync(path.join(project, "openspec")) || fs.existsSync(path.join(project, ".openspec"))) {
    detected.push("openspec");
  }
  if (fs.existsSync(path.join(project, "docs", "changes"))) {
    detected.push("plain-docs");
  }
  if (fs.existsSync(path.join(project, ".github", "ISSUE_TEMPLATE")) || fs.existsSync(path.join(project, ".gitlab", "issue_templates"))) {
    detected.push("issue-tracker");
  }
  if (detected.length === 0) {
    return {
      primary: "none",
      detected,
      note: "No existing SDD substrate detected; start with the adoption skill before creating records.",
    };
  }
  return {
    primary: detected[0],
    detected,
    note: detected.length > 1
      ? `Multiple substrates detected (${detected.join(", ")}); start with adoption to choose the source of truth.`
      : `${detected[0]} substrate detected; use it as one supported SDD substrate.`,
  };
}

function substrateStatePath(project, substrate) {
  return path.join(project, ".steadyspec", "substrate.json");
}

function skillPlan(source, skillsDir, sourceRel) {
  const runtimeName = path.basename(sourceRel);
  return {
    runtimeName,
    sourceDir: path.join(source, sourceRel),
    targetDir: path.join(skillsDir, runtimeName),
  };
}

function preflight(runtime, project, source, manifest, force) {
  const { skillsDir, instructionFile } = runtimePaths(project, runtime);
  const skills = manifest.skills.map((sourceRel) => skillPlan(source, skillsDir, sourceRel));
  for (const skill of skills) {
    if (!fs.existsSync(skill.sourceDir)) throw new Error(`Missing source skill: ${skill.sourceDir}`);
    if (fs.existsSync(skill.targetDir) && !force) {
      throw new Error(`${skill.targetDir} exists; pass --force to replace it`);
    }
  }
  return { runtime, skillsDir, instructionFile, skills };
}

function installRuntime(plan, project, root, source, manifest, substrate, substrateFile, dryRun) {
  const entrySkill = manifest.install.entrySkill;
  const routerSkill = manifest.install.routerSkill;
  const snippet = `
This project uses SteadySpec SDD anti-drift skills installed under \`${path.relative(project, plan.skillsDir).replace(/\\/g, "/")}\`.

Start with \`${entrySkill}\` to choose governance strength and substrate.
Use \`${routerSkill}\` when the next phase is unclear.
These skills install a substrate-agnostic SDD methodology built around drift defense; they do not replace the project substrate.
Substrate state: \`${path.relative(project, substrateFile).replace(/\\/g, "/")}\`.
Substrate note: ${substrate.note}
`;

  console.log(`runtime: ${plan.runtime}`);
  console.log(`substrate: ${substrate.note}`);
  for (const skill of plan.skills) {
    console.log(`install: ${path.relative(root, skill.sourceDir).replace(/\\/g, "/")} -> ${path.relative(project, skill.targetDir).replace(/\\/g, "/")}`);
  }
  console.log(`instructions: ${plan.instructionFile}`);
  console.log(`state: ${substrateFile}`);
  if (fs.existsSync(plan.instructionFile)) {
    console.log(`notice: will append SteadySpec instructions to existing ${path.basename(plan.instructionFile)} (${fs.statSync(plan.instructionFile).size} bytes).`);
  } else {
    console.log(`notice: will create ${path.basename(plan.instructionFile)} with SteadySpec instructions.`);
  }
  if (dryRun) return;

  fs.mkdirSync(plan.skillsDir, { recursive: true });
  for (const skill of plan.skills) {
    if (fs.existsSync(skill.targetDir)) fs.rmSync(skill.targetDir, { recursive: true, force: true });
    copyDir(skill.sourceDir, skill.targetDir);
    fs.mkdirSync(path.join(skill.targetDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skill.targetDir, "references", "METHOD.md"),
      rewriteInstalledText(fs.readFileSync(path.join(root, "METHOD.md"), "utf8"), "references/METHOD.md"),
      "utf8",
    );
  }

  for (const phaseTarget of [
    path.join(plan.skillsDir, entrySkill, "references", "phases.md"),
    path.join(plan.skillsDir, routerSkill, "references", "phases.md"),
  ]) {
    fs.mkdirSync(path.dirname(phaseTarget), { recursive: true });
    fs.writeFileSync(phaseTarget, rewriteInstalledText(fs.readFileSync(path.join(source, "phases.md"), "utf8"), "references/phases.md"), "utf8");
  }

  fs.mkdirSync(path.dirname(substrateFile), { recursive: true });
  fs.writeFileSync(substrateFile, `${JSON.stringify({
    schemaVersion: 1,
    primary: substrate.primary,
    detected: substrate.detected,
    note: substrate.note,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  const changed = appendSnippet(plan.instructionFile, snippet);
  console.log(changed ? "Injected project instructions." : "Project instructions already present.");
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, "..");
  const manifest = readJson(path.join(root, "manifest.json"));
  const project = path.resolve(args.project);
  const source = path.join(root, "en");
  const substrate = detectSubstrate(project);
  const substrateFile = substrateStatePath(project, substrate);

  if (!fs.existsSync(source)) throw new Error(`Missing language tree: ${source}`);

  const runtimes = args.runtime ? [args.runtime] : detectRuntime(project);
  if (!runtimes.length) {
    throw new Error("Could not detect runtime. Pass --runtime claude or --runtime codex.");
  }

  const plans = runtimes.map((runtime) => preflight(runtime, project, source, manifest, args.force));
  for (const plan of plans) {
    installRuntime(plan, project, root, source, manifest, substrate, substrateFile, args.dryRun);
  }
  if (!args.dryRun) console.log("Done.");
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
