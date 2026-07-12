#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { runDocsCheckCommand } = require("./docs-check");

const DEFAULT_CROSS_REVIEW_RISKY_PATH_PATTERNS = [
  "^bin/",
  "^en/flows/",
  "^en/runtime/",
  "^ARTIFACT_CONTRACT\\.md$",
  "^README\\.md$",
  "^QUICKSTART\\.md$",
  "^CHANGELOG\\.md$",
  "^manifest\\.json$",
  "^package\\.json$",
];
const DEFAULT_GATED_SCOPE_IGNORE_PATTERNS = [
  "^\\.DS_Store$",
  "^Thumbs\\.db$",
  "^\\..*\\.swp$",
  "^\\..*\\.swo$",
  "~$",
  "\\.tmp$",
];

function parseArgs(argv) {
  const args = {
    command: "init",
    checkTarget: null,
    runtime: null,
    substrate: null,
    phase: null,
    crossReview: null,
    crossReviewReviewer: null,
    crossReviewPassEnv: [],
    crossReviewMinSignals: null,
    crossReviewPacketOnly: false,
    crossReviewHooks: null,
    project: process.cwd(),
    force: false,
    dryRun: false,
    json: false,
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "init" || arg === "--here") {
      args.command = "init";
      continue;
    }
    if (arg === "check") {
      args.command = "check";
      const maybeTarget = argv[i + 1];
      if (maybeTarget && !maybeTarget.startsWith("-")) {
        args.checkTarget = maybeTarget;
        i += 1;
      }
      continue;
    }
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--phase") {
      const value = argv[i + 1];
      if (!value) throw new Error("--phase requires a value");
      args.phase = value;
      i += 1;
    } else if (arg === "--runtime") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runtime requires a value");
      args.runtime = value;
      i += 1;
    } else if (arg === "--substrate") {
      const value = argv[i + 1];
      if (!value) throw new Error("--substrate requires a value");
      args.substrate = value;
      i += 1;
    } else if (arg === "--cross-review") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cross-review requires a value");
      args.crossReview = value;
      i += 1;
    } else if (arg === "--cross-review-reviewer") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cross-review-reviewer requires a value");
      args.crossReviewReviewer = value;
      i += 1;
    } else if (arg === "--cross-review-pass-env") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cross-review-pass-env requires a value");
      args.crossReviewPassEnv.push(...value.split(",").map((name) => name.trim()).filter(Boolean));
      i += 1;
    } else if (arg === "--cross-review-min-signals") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cross-review-min-signals requires a value");
      args.crossReviewMinSignals = Number(value);
      if (!Number.isInteger(args.crossReviewMinSignals) || args.crossReviewMinSignals <= 0) {
        throw new Error("--cross-review-min-signals must be a positive integer");
      }
      i += 1;
    } else if (arg === "--cross-review-packet-only") {
      args.crossReviewPacketOnly = true;
    } else if (arg === "--cross-review-hooks") {
      const value = argv[i + 1];
      if (!value) throw new Error("--cross-review-hooks requires a value");
      args.crossReviewHooks = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.runtime && !["claude", "codex"].includes(args.runtime)) {
    throw new Error("--runtime must be claude or codex");
  }
  if (args.substrate && !["openspec", "docs"].includes(args.substrate)) {
    throw new Error("--substrate must be openspec or docs");
  }
  if (args.phase && !["proposal", "apply", "verify", "archive"].includes(args.phase)) {
    throw new Error("--phase must be proposal, apply, verify, or archive");
  }
  if (args.crossReview && !["off", "manual", "advisory", "gated"].includes(args.crossReview)) {
    throw new Error("--cross-review must be off, manual, advisory, or gated");
  }
  if (args.crossReviewReviewer && !["claude", "codex"].includes(args.crossReviewReviewer)) {
    throw new Error("--cross-review-reviewer must be claude or codex");
  }
  if (args.crossReviewHooks && !["off", "ask", "auto"].includes(args.crossReviewHooks)) {
    throw new Error("--cross-review-hooks must be off, ask, or auto");
  }
  if (args.crossReviewHooks && !args.crossReview) {
    throw new Error("--cross-review-hooks requires --cross-review off|manual|advisory|gated");
  }
  if (args.crossReview === "off" && args.crossReviewHooks && args.crossReviewHooks !== "off") {
    throw new Error("--cross-review off only supports --cross-review-hooks off");
  }
  if (args.crossReviewHooks === "auto" && args.crossReview !== "gated") {
    throw new Error("--cross-review-hooks auto requires --cross-review gated; use hooks ask with manual/advisory mode");
  }
  if (!args.crossReview && (args.crossReviewReviewer || args.crossReviewPassEnv.length || args.crossReviewMinSignals !== null || args.crossReviewPacketOnly)) {
    throw new Error("--cross-review-reviewer, --cross-review-pass-env, --cross-review-min-signals, and --cross-review-packet-only require --cross-review off|manual|advisory|gated");
  }
  return args;
}

function printHelp() {
  console.log(`steadyspec

Install SteadySpec into a project or run deterministic support checks.

Usage:
  steadyspec init [options]
  steadyspec check <change-id-or-path> --phase <proposal|apply|verify|archive> [--substrate docs] [--json]
  steadyspec cross-review --change <change-id-or-path> [--reviewer claude] [--mode design|review|debate] [--run|--run-if-needed]
  steadyspec hooks <install|uninstall|status> [--target claude|codex|both]

Options:
  --runtime <claude|codex>  Override runtime auto-detection.
  --substrate <openspec|docs>
                            Override substrate auto-detection (skips conflict prompt
                            when both openspec/ and docs/changes/ are present).
  --here                    Install into the current directory. This is the default.
  --force                   Replace existing installed SteadySpec skill directories.
  --dry-run                 Print actions without writing files.
  --phase <phase>           Check phase for docs-mode artifacts.
  --json                    Print machine-readable check results.
  --cross-review <off|manual|advisory|gated>
                            Write .steadyspec/cross-review.json for the v0.5
                            Windows cross-agent lane. advisory emits lightweight
                            recommendations; gated enforces --gate checks but
                            reviewer execution remains explicit.
  --cross-review-reviewer <claude|codex>
                            Default reviewer for cross-review config.
  --cross-review-pass-env <names>
                            Comma-separated env var names to pass to reviewer.
  --cross-review-min-signals <n>
                            Minimum recommendation signals required before
                            advisory/gated mode recommends review. Default: 1,
                            or 2 for gated mode.
  --cross-review-packet-only
                            Inline packet content into reviewer prompts and do
                            not grant file-read tools. Default for gated mode.
  --cross-review-hooks <off|ask|auto>
                            Project-scoped host-hook policy. Default: off. ask
                            pauses eligible SteadySpec turns for a mode choice;
                            auto routes explicitly activated turns to the
                            opposite peer CLI; hooks never run long model tasks.
  --help                    Show this help.

To remove SteadySpec, see QUICKSTART.md "Uninstall" section. There is no
project-level uninstall command — removal is by manual checklist + npm uninstall -g.
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
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
      commandsDir: path.join(project, ".claude", "commands", "steadyspec"),
      instructionFile: path.join(project, "CLAUDE.md"),
    };
  }
  return {
    skillsDir: path.join(project, ".codex", "skills"),
    commandsDir: null,
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

// docs/changes/ counts as substrate-present only if it has at least one NNN-* subdirectory.
// Empty docs/changes/ does NOT count (avoids treating init's own scaffolding as user content).
function docsChangesIsPopulated(project) {
  const dcPath = path.join(project, "docs", "changes");
  if (!fs.existsSync(dcPath)) return false;
  if (!fs.statSync(dcPath).isDirectory()) return false;
  for (const entry of fs.readdirSync(dcPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (/^\d+-/.test(entry.name) || entry.name === "archive") return true;
  }
  return false;
}

function detectSubstrateRaw(project) {
  const detected = [];
  if (fs.existsSync(path.join(project, "openspec")) || fs.existsSync(path.join(project, ".openspec"))) {
    detected.push("openspec");
  }
  if (docsChangesIsPopulated(project)) {
    detected.push("docs");
  }
  if (fs.existsSync(path.join(project, ".github", "ISSUE_TEMPLATE")) || fs.existsSync(path.join(project, ".gitlab", "issue_templates"))) {
    detected.push("issue-tracker");
  }
  return detected;
}

async function resolveSubstrate(project, args) {
  const detected = detectSubstrateRaw(project);

  // --substrate flag bypasses everything; warn if chosen substrate doesn't exist
  if (args.substrate) {
    const targetDir = args.substrate === "openspec" ? "openspec" : "docs/changes";
    const targetPath = path.join(project, ...targetDir.split("/"));
    if (!fs.existsSync(targetPath)) {
      console.warn(`WARN: --substrate ${args.substrate} but ${targetDir}/ does not exist. Will create on first use.`);
    }
    return {
      primary: args.substrate === "openspec" ? "openspec" : "docs",
      detected,
      note: `Substrate forced to ${args.substrate} via --substrate flag.`,
      source: "flag",
    };
  }

  const hasOpenspec = detected.includes("openspec");
  const hasDocs = detected.includes("docs");

  // Conflict: both substrates present + populated. Prompt user.
  if (hasOpenspec && hasDocs) {
    const choice = await promptYesNo(
      "Both `openspec/` and `docs/changes/` substrates detected. Use openspec? [y/n] (n = use docs/changes)",
    );
    return {
      primary: choice ? "openspec" : "docs",
      detected,
      note: `Substrate chosen interactively: ${choice ? "openspec" : "docs/changes"}.`,
      source: "prompt",
    };
  }

  if (hasOpenspec) {
    return {
      primary: "openspec",
      detected,
      note: "openspec substrate detected; SteadySpec will write change records under openspec/changes/.",
      source: "auto",
    };
  }
  if (hasDocs) {
    return {
      primary: "docs",
      detected,
      note: "docs/changes/ substrate detected; SteadySpec will write change records there.",
      source: "auto",
    };
  }
  if (detected.includes("issue-tracker")) {
    // Issue trackers remain experimental and fall back to docs.
    return {
      primary: "docs",
      detected,
      note: "Issue-tracker detected but not used as primary substrate in v0.4-alpha. Will create docs/changes/ as fallback.",
      source: "auto-fallback",
    };
  }
  return {
    primary: "docs",
    detected: [],
    note: "No existing substrate detected. Will create docs/changes/ on first use.",
    source: "auto-default",
  };
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, (answer) => {
      rl.close();
      const a = (answer || "").trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

function substrateStatePath(project) {
  return path.join(project, ".steadyspec", "substrate.json");
}

function crossReviewStatePath(project) {
  return path.join(project, ".steadyspec", "cross-review.json");
}

function ensureSubstrateDir(project, substrate, dryRun) {
  if (substrate.primary === "docs") {
    const dcPath = path.join(project, "docs", "changes");
    if (!fs.existsSync(dcPath)) {
      console.log(`create dir: docs/changes/`);
      if (!dryRun) fs.mkdirSync(dcPath, { recursive: true });
    }
  }
}

function installDocsSubstrateContract(project, root, substrate, dryRun) {
  if (substrate.primary !== "docs") return;
  const source = path.join(root, "en", "substrates", "docs");
  const target = path.join(project, ".steadyspec", "substrates", "docs");
  if (!fs.existsSync(source)) {
    throw new Error(`Missing docs substrate contract source: ${source}`);
  }
  console.log(`install docs contract: en/substrates/docs/ -> .steadyspec/substrates/docs/`);
  if (dryRun) return;
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  copyDir(source, target);
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
  const { skillsDir, commandsDir, instructionFile } = runtimePaths(project, runtime);
  const skills = manifest.skills.map((sourceRel) => skillPlan(source, skillsDir, sourceRel));
  const flows = (manifest.flows || []).map((sourceRel) => skillPlan(source, skillsDir, sourceRel));
  for (const skill of [...skills, ...flows]) {
    if (!fs.existsSync(skill.sourceDir)) throw new Error(`Missing source skill: ${skill.sourceDir}`);
    if (fs.existsSync(skill.targetDir) && !force) {
      throw new Error(`${skill.targetDir} exists; pass --force to replace it`);
    }
  }
  return { runtime, skillsDir, commandsDir, instructionFile, skills, flows };
}

function installSkillsAndFlows(plan, root, source, manifest, dryRun) {
  for (const skill of [...plan.skills, ...plan.flows]) {
    console.log(`install: ${path.relative(root, skill.sourceDir).replace(/\\/g, "/")} -> ${path.relative(plan.targetDir || ".", skill.targetDir).replace(/\\/g, "/") || skill.targetDir}`);
    if (dryRun) continue;
    if (fs.existsSync(skill.targetDir)) fs.rmSync(skill.targetDir, { recursive: true, force: true });
    copyDir(skill.sourceDir, skill.targetDir);
    fs.mkdirSync(path.join(skill.targetDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skill.targetDir, "references", "METHOD.md"),
      rewriteInstalledText(fs.readFileSync(path.join(root, "METHOD.md"), "utf8"), "references/METHOD.md"),
      "utf8",
    );
  }

  // entry & router get phases.md
  const entrySkill = manifest.install.entrySkill;
  const routerSkill = manifest.install.routerSkill;
  for (const phaseTarget of [
    path.join(plan.skillsDir, entrySkill, "references", "phases.md"),
    path.join(plan.skillsDir, routerSkill, "references", "phases.md"),
  ]) {
    if (dryRun) continue;
    fs.mkdirSync(path.dirname(phaseTarget), { recursive: true });
    fs.writeFileSync(phaseTarget, rewriteInstalledText(fs.readFileSync(path.join(source, "phases.md"), "utf8"), "references/phases.md"), "utf8");
  }
}

function installClaudeCommands(plan, root, dryRun) {
  if (plan.runtime !== "claude" || !plan.commandsDir) return;
  const commandsSrc = path.join(root, "en", "runtime", "claude", "commands", "steadyspec");
  if (!fs.existsSync(commandsSrc)) {
    console.warn(`WARN: Claude commands source missing: ${commandsSrc}`);
    return;
  }
  console.log(`install commands: en/runtime/claude/commands/steadyspec/ -> ${path.relative(plan.skillsDir.split(path.sep).slice(0, -2).join(path.sep), plan.commandsDir).replace(/\\/g, "/")}`);
  if (dryRun) return;
  if (fs.existsSync(plan.commandsDir)) {
    fs.rmSync(plan.commandsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(plan.commandsDir, { recursive: true });
  for (const entry of fs.readdirSync(commandsSrc, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      fs.copyFileSync(path.join(commandsSrc, entry.name), path.join(plan.commandsDir, entry.name));
    }
  }
}

function installClaudeWorkflows(plan, root, manifest, dryRun) {
  if (plan.runtime !== "claude") return;

  const workflowsConfig = manifest.install.workflows;
  if (!workflowsConfig || !workflowsConfig.claude) {
    console.warn("WARN: No workflows config in manifest.install.workflows.claude");
    return;
  }

  const workflowsSrc = path.join(root, "en", workflowsConfig.claude.source);
  if (!fs.existsSync(workflowsSrc)) {
    console.warn(`WARN: Claude workflows source missing: ${workflowsSrc}`);
    return;
  }

  // skillsDir is <project>/.claude/skills; workflows go to <project>/.claude/workflows
  const projectDir = path.dirname(path.dirname(plan.skillsDir));
  const workflowsTarget = path.join(projectDir, workflowsConfig.claude.target);

  // Check if there are any .js files to install
  const jsFiles = fs.readdirSync(workflowsSrc, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".js"));
  if (jsFiles.length === 0) return;

  console.log(`install workflows: en/${workflowsConfig.claude.source}/ -> ${workflowsConfig.claude.target}/`);
  if (dryRun) return;

  fs.mkdirSync(workflowsTarget, { recursive: true });
  for (const entry of jsFiles) {
    const src = path.join(workflowsSrc, entry.name);
    const dest = path.join(workflowsTarget, entry.name);
    fs.copyFileSync(src, dest);
    console.log(`  ${entry.name}`);
  }
}

function installCodexAgents(plan, root, manifest, dryRun) {
  if (plan.runtime !== "codex") return;
  const agentsSrc = path.join(root, "en", "runtime", "codex", "agents");
  if (!fs.existsSync(agentsSrc)) {
    console.warn(`WARN: Codex agents source missing: ${agentsSrc}`);
    return;
  }
  for (const flow of plan.flows) {
    // Source yaml is `<flow-name>.yaml`; install as `<flow-target>/agents/openai.yaml`
    const yamlSrc = path.join(agentsSrc, `${flow.runtimeName}.yaml`);
    if (!fs.existsSync(yamlSrc)) {
      console.warn(`WARN: Codex yaml missing for ${flow.runtimeName}, skipping agent descriptor`);
      continue;
    }
    const agentsDir = path.join(flow.targetDir, "agents");
    const yamlDest = path.join(agentsDir, "openai.yaml");
    console.log(`install agent: en/runtime/codex/agents/${flow.runtimeName}.yaml -> ${path.relative(plan.skillsDir.split(path.sep).slice(0, -2).join(path.sep), yamlDest).replace(/\\/g, "/")}`);
    if (dryRun) continue;
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.copyFileSync(yamlSrc, yamlDest);
  }
}

function injectInstructionBlock(plan, project, manifest, substrate, substrateFile, dryRun) {
  const entrySkill = manifest.install.entrySkill;
  const routerSkill = manifest.install.routerSkill;
  const snippet = `
This project uses SteadySpec - anti-drift methodology with five outward verbs (\`/steadyspec:explore\` / \`:propose\` / \`:apply\` / \`:verify\` / \`:archive\`).

Quick start:
- \`/steadyspec:explore\` (no topic) — status report; \`/steadyspec:explore <topic>\` — topical exploration.
- \`/steadyspec:propose <intent>\` — write a proposal with grill + (optional) debate.
- \`/steadyspec:apply <change-id>\` — implement slice-by-slice with drift gates.
- \`/steadyspec:verify <change-id>\` - run a trust checkpoint before archive or handoff.
- \`/steadyspec:archive <change-id>\` - close with review + doc-sync + confirmed_by + durable truth gates.

Internal: skills under \`${path.relative(project, plan.skillsDir).replace(/\\/g, "/")}\` (verb-flows: \`steadyspec-<verb>-flow\`; primitives: \`steadyspec-<name>\`).
Substrate state: \`${path.relative(project, substrateFile).replace(/\\/g, "/")}\` (${substrate.note}).
Adoption guidance: \`${entrySkill}\`. Workflow router: \`${routerSkill}\`.
`;

  if (fs.existsSync(plan.instructionFile)) {
    console.log(`notice: will append SteadySpec instructions to existing ${path.basename(plan.instructionFile)} (${fs.statSync(plan.instructionFile).size} bytes).`);
  } else {
    console.log(`notice: will create ${path.basename(plan.instructionFile)} with SteadySpec instructions.`);
  }
  if (dryRun) return;
  const changed = appendSnippet(plan.instructionFile, snippet);
  console.log(changed ? `Injected instructions: ${path.basename(plan.instructionFile)}` : `Instructions already present in ${path.basename(plan.instructionFile)}`);
}

function writeSubstrateState(substrateFile, substrate, dryRun) {
  console.log(`state: ${substrateFile}`);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(substrateFile), { recursive: true });
  const state = {
    schemaVersion: 1,
    primary: substrate.primary,
    detected: substrate.detected,
    note: substrate.note,
    source: substrate.source,
    createdAt: new Date().toISOString(),
  };
  if (substrate.primary === "docs") {
    state.contract = {
      name: "steadyspec-docs",
      version: 1,
      path: ".steadyspec/substrates/docs/contract.json",
      templates: ".steadyspec/substrates/docs/templates",
    };
  }
  fs.writeFileSync(substrateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function writeCrossReviewState(project, args) {
  if (!args.crossReview) return;
  const file = crossReviewStatePath(project);
  const reviewer = args.crossReviewReviewer || "claude";
  const passEnv = [...new Set(args.crossReviewPassEnv)];
  const packetOnly = args.crossReviewPacketOnly || args.crossReview === "gated";
  const minSignals = args.crossReviewMinSignals || (args.crossReview === "gated" ? 2 : 1);
  console.log(`cross-review state: ${file}`);
  if (args.dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const state = {
    schemaVersion: 1,
    mode: args.crossReview,
    reviewer,
    passEnv,
    minSignals,
    packetOnly,
    hooks: {
      mode: args.crossReviewHooks || "off",
      reviewer: "auto",
      activation: "explicit-steadyspec-or-cross-agent-prompt",
      events: ["UserPromptSubmit", "Stop"],
      allowExperimentalDebate: false,
      activationTtlMs: 21600000,
      // Any future hook-launched model process must add an explicit per-turn spend/loop limit.
    },
    riskyPathPatterns: DEFAULT_CROSS_REVIEW_RISKY_PATH_PATTERNS,
    scopeIgnorePatterns: args.crossReview === "gated" ? DEFAULT_GATED_SCOPE_IGNORE_PATTERNS : [],
    boundary: args.crossReview === "advisory"
      ? `Level 2 advisory; emits recommendations only; hooks.mode:auto requires gated mode; no sandbox or automatic moderation.${packetOnly ? " Packet-only reviewer prompts are enabled." : ""}`
      : args.crossReview === "gated"
        ? "Level 3 gated; --gate can block flow claims until review is moderated; an activated hooks.mode:auto turn routes the primary host to the opposite peer CLI, but hooks never launch long reviewer processes; packet-only reviewer prompts are enabled by default; no automatic moderation."
        : `Level 1 manual; advisory context restrictions; no sandbox or automatic gate.${packetOnly ? " Packet-only reviewer prompts are enabled." : ""}`,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function writeCrossReviewGitignore(project, args) {
  if (!args.crossReview || args.crossReview === "off") return;
  const file = path.join(project, ".gitignore");
  console.log(`cross-review gitignore: ${file}`);
  if (args.dryRun) return;
  const marker = "# SteadySpec local cross-agent run artifacts";
  const patterns = ["**/cross-agent/"];
  patterns.push(".steadyspec/runtime/");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const missing = patterns.filter((pattern) => !existing.includes(pattern));
  if (!missing.length) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const block = `${prefix}${existing ? "\n" : ""}${marker}\n${missing.join("\n")}\n`;
  fs.appendFileSync(file, block, "utf8");
}

function printQuickStart(project, plans, substrate) {
  const verbsPath = plans[0].runtime === "claude" ? "/steadyspec:explore" : "(invoke `steadyspec-explore-flow` skill)";
  console.log("");
  console.log("Done.");
  console.log("");
  console.log("Next steps:");
  console.log(`  - Try \`${verbsPath}\` to see the project status.`);
  console.log(`  - Or \`${plans[0].runtime === "claude" ? "/steadyspec:propose" : "(invoke `steadyspec-propose-flow`)"} <intent>\` to record new work.`);
  console.log(`  - Run \`${plans[0].runtime === "claude" ? "/steadyspec:verify" : "(invoke `steadyspec-verify-flow`)"} <change-id>\` for a trust checkpoint before archive or handoff.`);
  console.log(`  - Substrate: ${substrate.primary === "openspec" ? "openspec/" : "docs/changes/"}.`);
  console.log(`  - To remove SteadySpec from this project, see QUICKSTART.md "Uninstall" section.`);
}

async function main() {
  if (process.argv[2] === "hooks" || process.argv[2] === "hook-event") {
    const script = path.join(__dirname, "cross-review-hook.js");
    if (!fs.existsSync(script)) {
      console.error("[steadyspec] cross-review-hook.js is not installed; host hook support is unavailable in this build.");
      process.exitCode = 1;
      return;
    }
    const forwarded = process.argv[2] === "hooks" ? process.argv.slice(3) : ["hook-event", ...process.argv.slice(3)];
    const result = spawnSync(process.execPath, [script, ...forwarded], { cwd: process.cwd(), stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
    return;
  }
  if (process.argv[2] === "cross-review") {
    const script = path.join(__dirname, "cross-review.js");
    if (!fs.existsSync(script)) {
      console.error("[steadyspec] cross-review runner is not installed. Expected: " + script);
      console.error("[steadyspec] Reinstall or update SteadySpec before using `steadyspec cross-review`.");
      process.exitCode = 1;
      return;
    }
    const result = spawnSync(process.execPath, [script, ...process.argv.slice(3)], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
    return;
  }

  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, "..");
  const manifest = readJson(path.join(root, "manifest.json"));
  const project = path.resolve(args.project);

  if (args.command === "check") {
    if (args.substrate && args.substrate !== "docs") {
      throw new Error("steadyspec check currently supports --substrate docs only");
    }
    process.exitCode = runDocsCheckCommand({
      target: args.checkTarget,
      phase: args.phase || "proposal",
      json: args.json,
      project,
    });
    return;
  }

  const source = path.join(root, "en");

  if (!fs.existsSync(source)) throw new Error(`Missing language tree: ${source}`);

  const runtimes = args.runtime ? [args.runtime] : detectRuntime(project);
  if (!runtimes.length) {
    throw new Error("Could not detect runtime. Pass --runtime claude or --runtime codex.");
  }

  const substrate = await resolveSubstrate(project, args);
  const substrateFile = substrateStatePath(project);

  console.log(`runtime: ${runtimes.join(", ")}`);
  console.log(`substrate: ${substrate.note}`);

  const plans = runtimes.map((runtime) => preflight(runtime, project, source, manifest, args.force));

  ensureSubstrateDir(project, substrate, args.dryRun);
  installDocsSubstrateContract(project, root, substrate, args.dryRun);

  for (const plan of plans) {
    console.log("");
    console.log(`--- ${plan.runtime} install ---`);
    installSkillsAndFlows(plan, root, source, manifest, args.dryRun);
    installClaudeCommands(plan, root, args.dryRun);
    installClaudeWorkflows(plan, root, manifest, args.dryRun);
    installCodexAgents(plan, root, manifest, args.dryRun);
    injectInstructionBlock(plan, project, manifest, substrate, substrateFile, args.dryRun);
  }

  writeSubstrateState(substrateFile, substrate, args.dryRun);
  writeCrossReviewState(project, args);
  writeCrossReviewGitignore(project, args);

  if (!args.dryRun) {
    printQuickStart(project, plans, substrate);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
