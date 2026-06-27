#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ALLOWED_ROOT_FILES = new Set([
  "README.md",
  "METHOD.md",
  "EVIDENCE.md",
  "SCOPE.md",
  "QUICKSTART.md",
  "CHANGELOG.md",
  "ARTIFACT_CONTRACT.md",
  "manifest.json",
  "package.json",
  ".gitignore",
  "LICENSE",
]);
const ALLOWED_ROOT_DIRS = new Set(["bin", "design", "docs", "en", "scripts", "zh", "recipes"]);
const IGNORED_DEV_DIRS = new Set([".git", ".meta", "node_modules"]);
const FORBIDDEN_NAMES = new Set([
  ".claude",
  ".codex",
  ".vscode",
  ".idea",
  "node_modules",
  "__pycache__",
  ".DS_Store",
  "CLAUDE.md",
  "MEMORY.md",
]);

const REQUIRED_ROOT_FILES = [
  "README.md",
  "METHOD.md",
  "EVIDENCE.md",
  "SCOPE.md",
  "QUICKSTART.md",
  "CHANGELOG.md",
  "ARTIFACT_CONTRACT.md",
  "manifest.json",
  "package.json",
  ".gitignore",
  "LICENSE",
];

const CJK_REGEX = /[一-鿿　-〿＀-￯]/;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) walk(full, out);
  }
  return out;
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
}

function frontmatter(file) {
  const text = readText(file);
  if (!/^---\r?\n/.test(text)) fail(`${file} missing YAML frontmatter`);
  const end = text.search(/\r?\n---/);
  if (end === -1 || end < 4) fail(`${file} has unterminated YAML frontmatter`);
  return text.slice(4, end);
}

function frontmatterName(file) {
  const match = frontmatter(file).match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function validateSkillFrontmatter(file, root) {
  const yaml = frontmatter(file);
  if (!/^name:\s*.+$/m.test(yaml)) fail(`${rel(root, file)} missing name`);
  if (!/^description:\s*.+$/m.test(yaml)) fail(`${rel(root, file)} missing description`);
}

// Rule 1: CJK ban in en/
function checkCjkBan(root) {
  const enRoot = path.join(root, "en");
  if (!fs.existsSync(enRoot)) return;
  for (const file of walk(enRoot)) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    if (!/\.(md|yaml|yml)$/i.test(file)) continue;
    const text = readText(file);
    if (CJK_REGEX.test(text)) {
      fail(`CJK character found in ${rel(root, file)} — en/ tree must be English only`);
    }
  }
}

// Rule 2: required root files
function checkRequiredRootFiles(root) {
  for (const name of REQUIRED_ROOT_FILES) {
    if (!fs.existsSync(path.join(root, name))) {
      fail(`required root file missing: ${name}`);
    }
  }
}

// Rule 3: each verb-flow SKILL must reference at least one primitive name
function checkFlowsReferencePrimitives(root, manifest) {
  const flows = manifest.flows || [];
  if (!Array.isArray(flows) || !flows.length) return;
  const primitiveNames = (manifest.skills || [])
    .map((p) => path.basename(p))
    .filter((name) => name !== "steadyspec-workflow" && name !== "steadyspec-adopt");
  for (const flowDir of flows) {
    const skillPath = path.join(root, "en", flowDir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      fail(`missing flow SKILL: en/${flowDir}/SKILL.md`);
    }
    validateSkillFrontmatter(skillPath, root);
    const text = readText(skillPath);
    const referenced = primitiveNames.filter((name) => text.includes(name));
    if (referenced.length === 0) {
      fail(
        `flow ${flowDir} references no primitives — verb-flow must orchestrate at least one primitive`,
      );
    }
  }
}

// Rule 4: primitive SKILLs must be byte-equivalent to git HEAD
// (any uncommitted edit to primitives / router / adoption is a boundary violation
//  per CON-7. Commit the change to make validator pass.)
function checkPrimitiveByteEquivalence(root) {
  // Skip in non-git environments (e.g. shipped tarball)
  if (!fs.existsSync(path.join(root, ".git"))) return;
  try {
    execSync(
      "git diff --quiet HEAD -- en/primitives/ en/router/ en/adoption/",
      { cwd: root, stdio: "ignore" },
    );
  } catch {
    fail(
      "primitive / router / adoption SKILLs have uncommitted edits — " +
        "primitive/router/adoption SKILLs are protected from uncommitted edits. " +
        "Commit the change first if it is intentional, or revert.",
    );
  }
}

function checkV03ResponsibilityModel(root, manifest) {
  const contractPath = path.join(root, "ARTIFACT_CONTRACT.md");
  const contract = readText(contractPath);
  const requiredContractAnchors = [
    "## v0.3 Responsibility Model",
    "### Decision Ownership Ledger",
    "### Risk Routing",
    "### Attention Report",
    "### Apply Re-slice Event",
    "### Trust Checkpoint",
    "### Handoff Snapshot",
    "### Durable Truth Gates",
  ];
  for (const anchor of requiredContractAnchors) {
    if (!contract.includes(anchor)) {
      fail(`ARTIFACT_CONTRACT.md missing v0.3 anchor: ${anchor}`);
    }
  }

  const requiredFlow = "flows/steadyspec-verify-flow";
  if (!(manifest.flows || []).includes(requiredFlow)) {
    fail(`manifest.flows missing ${requiredFlow}`);
  }

  const verifyFlow = path.join(root, "en", requiredFlow, "SKILL.md");
  if (!fs.existsSync(verifyFlow)) {
    fail(`missing flow SKILL: en/${requiredFlow}/SKILL.md`);
  }

  const verifyCommand = path.join(root, "en", "runtime", "claude", "commands", "steadyspec", "verify.md");
  if (!fs.existsSync(verifyCommand)) {
    fail("missing Claude verify command: en/runtime/claude/commands/steadyspec/verify.md");
  }

  const verifyAgent = path.join(root, "en", "runtime", "codex", "agents", "steadyspec-verify-flow.yaml");
  if (!fs.existsSync(verifyAgent)) {
    fail("missing Codex verify descriptor: en/runtime/codex/agents/steadyspec-verify-flow.yaml");
  }

  const verifyWorkflow = "runtime/claude/workflows/steadyspec-verify.js";
  if (!(manifest.workflows || []).includes(verifyWorkflow)) {
    fail(`manifest.workflows missing ${verifyWorkflow}`);
  }
  if (!fs.existsSync(path.join(root, "en", verifyWorkflow))) {
    fail(`missing Claude verify workflow: en/${verifyWorkflow}`);
  }
}

function checkActiveVerbSurface(root) {
  const files = [
    "README.md",
    "QUICKSTART.md",
    "SCOPE.md",
    "METHOD.md",
    "ARTIFACT_CONTRACT.md",
    ...walk(path.join(root, "en"))
      .filter((file) => fs.statSync(file).isFile())
      .filter((file) => /\.(md|yaml|yml)$/i.test(file))
      .map((file) => rel(root, file)),
  ];
  const forbidden = [
    /The (first|second|third|fourth) of the four SteadySpec verbs/,
    /\bfour outward verbs\b/i,
    /\bfour SteadySpec verbs\b/i,
  ];
  for (const name of files) {
    const text = readText(path.join(root, name));
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        fail(`${name} contains stale active four-verb wording; active surface must describe five outward verbs`);
      }
    }
  }
}

function checkDocsSubstrateContract(root) {
  const requiredFiles = [
    "bin/docs-check.js",
    "en/substrates/docs/contract.json",
    "en/substrates/docs/templates/proposal.md",
    "en/substrates/docs/templates/tasks.md",
    "en/substrates/docs/templates/evidence.md",
    "en/substrates/docs/templates/trust-checkpoint.md",
    "en/substrates/docs/templates/archive.md",
  ];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(root, file))) {
      fail(`docs substrate contract file missing: ${file}`);
    }
  }

  const contract = readJson(path.join(root, "en/substrates/docs/contract.json"));
  for (const phase of ["proposal", "apply", "verify", "archive"]) {
    if (!contract.phases || !contract.phases[phase]) {
      fail(`docs substrate contract missing phase: ${phase}`);
    }
  }

  const initText = readText(path.join(root, "bin/init.js"));
  if (!initText.includes("runDocsCheckCommand") || !initText.includes("steadyspec check")) {
    fail("bin/init.js must route the steadyspec check support command");
  }

  const docsCheckText = readText(path.join(root, "bin/docs-check.js"));
  for (const code of [
    "DOCS_PROPOSAL_MISSING_ANCHOR",
    "DOCS_EVIDENCE_MISSING_FIELD",
    "DOCS_TRUST_MISSING_RECOMMENDED_NEXT",
    "DOCS_ARCHIVE_DEBT_AS_PROOF",
  ]) {
    if (!docsCheckText.includes(code)) {
      fail(`bin/docs-check.js missing docs checker error code: ${code}`);
    }
  }

  const phaseToVerb = {
    proposal: "propose",
    apply: "apply",
    verify: "verify",
    archive: "archive",
  };
  for (const [phase, verb] of Object.entries(phaseToVerb)) {
    const surfaces = [
      `en/flows/steadyspec-${verb}-flow/SKILL.md`,
      `en/runtime/codex/agents/steadyspec-${verb}-flow.yaml`,
      `en/runtime/claude/commands/steadyspec/${verb}.md`,
      `en/runtime/claude/workflows/steadyspec-${verb}.js`,
    ];
    for (const file of surfaces) {
      const text = readText(path.join(root, file));
      if (!text.includes("steadyspec check") || !text.includes(`--phase ${phase}`)) {
        fail(`${file} must surface docs-mode check command for phase ${phase}`);
      }
    }
  }

  const exploreSurfaces = [
    "en/flows/steadyspec-explore-flow/SKILL.md",
    "en/runtime/codex/agents/steadyspec-explore-flow.yaml",
    "en/runtime/claude/commands/steadyspec/explore.md",
    "en/runtime/claude/workflows/steadyspec-explore.js",
  ];
  for (const file of exploreSurfaces) {
    if (!readText(path.join(root, file)).includes("contract")) {
      fail(`${file} must surface docs substrate contract health`);
    }
  }
}

function requireText(root, file, text, label = text) {
  const content = readText(path.join(root, file));
  if (!content.includes(text)) {
    fail(`${file} missing v0.4 release surface: ${label}`);
  }
}

function requirePattern(root, file, pattern, label) {
  const content = readText(path.join(root, file));
  if (!pattern.test(content)) {
    fail(`${file} missing v0.4 release surface: ${label}`);
  }
}

function checkV04ReleaseSurface(root, manifest, pkg) {
  if (pkg.version !== "0.4.0" || manifest.version !== "0.4.0") {
    fail("v0.4 release surface requires package.json and manifest.json version 0.4.0");
  }

  requireText(root, "CHANGELOG.md", "## 0.4.0 (alpha)");

  requireText(root, "ARTIFACT_CONTRACT.md", "## Native Docs Substrate Contract");
  requireText(root, "ARTIFACT_CONTRACT.md", "## v0.4 Capability Lane");
  for (const anchor of [
    "### direction-map.md",
    "### evidence-contract.md",
    "### Selection Findings",
    "### Mainline Decision",
  ]) {
    requireText(root, "ARTIFACT_CONTRACT.md", anchor);
  }

  requireText(root, "METHOD.md", "## Capability Without Drift");
  requireText(root, "README.md", "## v0.4 Docs Contract And Capability Lane");
  requireText(root, "QUICKSTART.md", "## Optional capability lane");
  requireText(root, "SCOPE.md", "## v0.4 capability lane boundary");

  const capabilityFlowChecks = {
    "en/flows/steadyspec-explore-flow/SKILL.md": ["direction-map.md"],
    "en/flows/steadyspec-propose-flow/SKILL.md": ["direction-map.md", "evidence-contract.md", "Mainline Decision"],
    "en/flows/steadyspec-apply-flow/SKILL.md": ["evidence-contract", "main path"],
    "en/flows/steadyspec-verify-flow/SKILL.md": ["mainline claim", "parked directions"],
    "en/flows/steadyspec-archive-flow/SKILL.md": ["Mainline Decision", "parked"],
  };
  for (const [file, anchors] of Object.entries(capabilityFlowChecks)) {
    requirePattern(root, file, /capability[- ]lane/i, "capability lane wording");
    for (const anchor of anchors) {
      requireText(root, file, anchor);
    }
  }
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const manifestPath = path.join(root, "manifest.json");
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath)) fail("manifest.json is missing");
  if (!fs.existsSync(packagePath)) fail("package.json is missing");

  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  if (manifest.description !== pkg.description) {
    fail("manifest description must match package.json description");
  }
  if (manifest.version !== pkg.version) {
    fail("manifest version must match package.json version");
  }
  if (!pkg.files || pkg.files.includes("scripts/")) {
    fail("scripts/ must not be published; use bin/validate.js");
  }
  if (pkg.name !== "steadyspec") fail("package name must be steadyspec");
  if (!pkg.bin || pkg.bin.steadyspec !== "bin/init.js") {
    fail("package bin must expose steadyspec -> bin/init.js");
  }

  // Existing root layout checks
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && !ALLOWED_ROOT_DIRS.has(entry.name)) {
      fail(`unexpected package root directory: ${entry.name}`);
    }
    if (entry.isFile() && !ALLOWED_ROOT_FILES.has(entry.name)) {
      fail(`unexpected package root file: ${entry.name}`);
    }
  }

  // Existing forbidden-name walk
  for (const file of walk(root)) {
    const parts = rel(root, file).split("/");
    if (parts.some((part) => FORBIDDEN_NAMES.has(part))) {
      fail(`forbidden dev/runtime artifact: ${rel(root, file)}`);
    }
  }

  const languages = manifest.languages || [];
  if (languages.join(",") !== "en") fail("manifest languages must be ['en']");

  const skillMappings = manifest.skills || [];
  if (!Array.isArray(skillMappings) || !skillMappings.length) {
    fail("manifest.skills must be a non-empty array");
  }

  // Existing per-skill checks (frontmatter name matches dir basename)
  for (const lang of languages) {
    for (const sourceDir of skillMappings) {
      const runtimeName = path.basename(sourceDir);
      const skillPath = path.join(root, lang, sourceDir, "SKILL.md");
      if (!fs.existsSync(skillPath)) fail(`missing skill: ${lang}/${sourceDir}/SKILL.md`);
      validateSkillFrontmatter(skillPath, root);
      if (frontmatterName(skillPath) !== runtimeName) {
        fail(`${lang}/${sourceDir}/SKILL.md name must be ${runtimeName}`);
      }
    }
    for (const file of walk(path.join(root, lang)).filter((item) => path.basename(item) === "SKILL.md")) {
      validateSkillFrontmatter(file, root);
    }
  }

  // Package integrity rules
  checkCjkBan(root);
  checkRequiredRootFiles(root);
  checkFlowsReferencePrimitives(root, manifest);
  checkPrimitiveByteEquivalence(root);
  checkV03ResponsibilityModel(root, manifest);
  checkActiveVerbSurface(root);
  checkDocsSubstrateContract(root);
  checkV04ReleaseSurface(root, manifest, pkg);

  console.log("Package is valid.");
}

main();
