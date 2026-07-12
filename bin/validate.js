#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, spawnSync } = require("child_process");

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
const IGNORED_ROOT_DEV_DIRS = new Set([".git", ".meta", "node_modules", ".agents", ".codex", ".claude", ".steadyspec"]);
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

function walk(dir, out = [], root = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    if (path.resolve(dir) === path.resolve(root) && IGNORED_ROOT_DEV_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) walk(full, out, root);
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
    fail(`${file} missing v0.5 release surface: ${label}`);
  }
}

function requirePattern(root, file, pattern, label) {
  const content = readText(path.join(root, file));
  if (!pattern.test(content)) {
    fail(`${file} missing v0.5 release surface: ${label}`);
  }
}

function checkV05ReleaseSurface(root, manifest, pkg) {
  if (pkg.version !== "0.5.0" || manifest.version !== "0.5.0") {
    fail("v0.5 release surface requires package.json and manifest.json version 0.5.0");
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

function checkV05CrossReview(root) {
  if (!fs.existsSync(path.join(root, "bin/cross-review.js"))) {
    fail("v0.5 cross-review docs require bin/cross-review.js");
  }
  const initText = readText(path.join(root, "bin/init.js"));
  const runnerText = readText(path.join(root, "bin/cross-review.js"));
  checkWarningMapCoverage(runnerText);
  for (const expected of ["cross-review", "advisory", "gated", "--cross-review-min-signals", "--cross-review-packet-only", "packetOnly", "riskyPathPatterns", "scopeIgnorePatterns", "DEFAULT_GATED_SCOPE_IGNORE_PATTERNS", "**/cross-agent/"]) {
    if (!initText.includes(expected)) {
      fail(`bin/init.js missing v0.5 cross-review surface: ${expected}`);
    }
  }
  for (const expected of ["cross-review", "advisory", "gated", "--advice", "--calibrate-dir", "--gate", "--run-if-needed", "--experimental-debate", "--experimental-posix", "--packet-only", "--verbose", "--max-output-bytes", "DEFAULT_MAX_OUTPUT_BYTES", "OUTPUT_TRUNCATED_WARNING", "stdoutTruncated", "stderrTruncated", "utf8PrefixWithinBytes", "randomBytes", "packetOnly", "scopeFingerprint", "gitStatusSnapshot", "scopeFingerprintMismatchDetail", "git status delta", "Scope Ignore Patterns", "Scope Transparency", "renderScopeTransparency", "untrackedOmissionCounts", "scopeIgnorePatterns", "filterGitStatusForScope", "diffCoherent", "gitStatusStable", "non-coherent diff evidence", "diffCoherenceDrift", "diffSectionStatus", "per-section-status-and-content-recheck", "re-render-git-section-command", "diffBaseStable", "diffBaseShaEnd", "reviewerOutputDiagnostic", "Output Diagnostic", "runArtifactHashes", "runArtifactHashesNote", "RAW_OUTPUT_MISSING_WARNING", "rawOutputMissingWarning", "diffAtomicity", "diffCoherenceBasis", "git-status-short-before-after", "adviceActive", "gateActive", "minSignals", "signalCount", "signalDetails", "pathSignalsAvailable", "pathSignalsAvailableCount", "pathSignalStatusLineCount", "observedReasons", "wouldRecommend", "resolutionHint", "Packet Generation Warnings", "This packet only", "riskyPathPatterns", "calibrationChangeDirs", "nestedCalibrationHint", "buildCalibration", "WARNING_CLASSIFICATION_MAP", "GATE_PASSABLE_WARNING_PATTERNS", "GATE_BLOCKING_WARNING_PATTERNS", "gateWarningDecision", "{0,200}", "loadedText", "directoryLooksLikePublicDocs", "POSIX support is implemented but smoke-untested", "POSIX_TIMEOUT_ORPHAN_WARNING", "TIMEOUT_WITH_OUTPUT_WARNING", "OUTPUT_TRUNCATED_WARNING", "reviewer_timeout_with_output", "EXTERNAL_OUTPUT_DIR_WARNING", "DANGEROUS_INHERIT_ENV_WARNING", "REVIEWER_VERSION_UNSUPPORTED", "moderationP12RejectedWeakReasonIds", "strongModerationCrossReference", "moderationNoFindingsConflict", "identity-unverified implementation evidence", "unreadableRunDirWarnings", "npmrc", "terraform", "POSIX process-group", "taskkill /F /PID", "falling back to direct child kill", "(cmd|bat)", "isBoundaryRestatementLine", "isBoundaryViolationReportLine", "removeBoundaryDisclosureSections", "Boundary Disclosure", "packet-generation snapshot", "Use finding IDs", "unstructured", "exit 3", "stdinBytes", "auditBytes", "direct child change dir"]) {
    if (!runnerText.includes(expected)) {
      fail(`bin/cross-review.js missing v0.5 cross-review surface: ${expected}`);
    }
  }
  if (!runnerText.includes("--allowedTools") || !runnerText.includes("Read,Grep,Glob")) {
    fail("bin/cross-review.js must keep Claude reviewer tools read-only");
  }
  if (!runnerText.includes("--disallowedTools") || !runnerText.includes("Bash,Edit,Write")) {
    fail("bin/cross-review.js must keep Claude reviewer defense-in-depth disallowed tools");
  }
  if (!runnerText.includes("taskkill") || !runnerText.includes('"/T"')) {
    fail("bin/cross-review.js must use Windows process-tree termination for reviewer timeouts");
  }
  if (!runnerText.includes("timeout: 30000")) {
    fail("bin/cross-review.js must bound Windows taskkill cleanup timeouts");
  }
  if (!runnerText.includes("process.kill(-child.pid")) {
    fail("bin/cross-review.js must attempt POSIX process-group termination for reviewer timeouts");
  }
  if (!runnerText.includes("originHead.stdout")) {
    fail("bin/cross-review.js must resolve origin/HEAD from git stdout, not combined stderr output");
  }
  if (runnerText.includes("verify their SHA-256 hashes against the manifest")) {
    fail("bin/cross-review.js reviewer prompt must not ask read-only reviewers to compute SHA-256 hashes");
  }
  if (runnerText.includes("(replace-or-delete) | P1/P2/P3")) {
    fail("bin/cross-review.js moderation template must not use the ambiguous multi-value placeholder row");
  }
  if (!runnerText.includes("moderationMissingFindingIds")) {
    fail("bin/cross-review.js must expose missing moderation finding diagnostics");
  }
  if (!runnerText.includes("Codex reviewer version check is not implemented")) {
    fail("bin/cross-review.js must warn that Codex reviewer version checks are experimental");
  }
  if (!runnerText.includes("no Codex CLI version-safety check is enforced yet")) {
    fail("bin/cross-review.js help must disclose experimental Codex version-safety boundary");
  }
  if (!runnerText.includes("declined") || !runnerText.includes("will not fix")) {
    fail("cross-review weak moderation reason patterns must cover common placeholder rejections");
  }
  if (runnerText.includes('  "workflow",')) {
    fail("bin/cross-review.js must not use broad SteadySpec term 'workflow' as a default high-risk term");
  }
  if (!runnerText.includes("(args.run || args.runIfNeeded) && process.platform")) {
    fail("cross-review POSIX opt-in must be limited to reviewer execution paths");
  }
  for (const expected of ["avoid(?:s|ed|ing)?", "Windows AppData user profile path", "Implementation reference not bundled: package.json could not be parsed", "Implementation reference not bundled: package.json not found", "canonical Windows or Unix path form"]) {
    if (!runnerText.includes(expected)) {
      fail(`bin/cross-review.js missing hardening contract: ${expected}`);
    }
  }
  for (const expected of ["DIFF_NON_ATOMIC_WARNING", "EXTERNAL_OUTPUT_DIR_WARNING", "POSIX_TIMEOUT_ORPHAN_WARNING", "DANGEROUS_INHERIT_ENV_WARNING"]) {
    if (!runnerText.includes(`source: "${expected}"`)) {
      fail(`bin/cross-review.js warning classification map missing ${expected}`);
    }
  }
  requireText(root, "README.md", "## v0.5 Cross-Agent Review Lane");
  requireText(root, "README.md", "single-user Windows");
  requireText(root, "README.md", "Agent Collaboration Mode");
  requireText(root, "README.md", "two-agent consensus");
  requireText(root, "QUICKSTART.md", "--advice");
  requireText(root, "QUICKSTART.md", "--verbose");
  requireText(root, "QUICKSTART.md", "Agent Collaboration Mode");
  requireText(root, "QUICKSTART.md", "Scope Transparency");
  requireText(root, "README.md", "riskyPathPatterns");
  requireText(root, "README.md", "scopeIgnorePatterns");
  requireText(root, "README.md", "Scope Transparency");
  requireText(root, "README.md", "swp$");
  requireText(root, "README.md", "tracked staged/unstaged/branch diff path");
  requireText(root, "ARTIFACT_CONTRACT.md", "advisory");
  requireText(root, "ARTIFACT_CONTRACT.md", "packetOnly");
  requireText(root, "ARTIFACT_CONTRACT.md", "`stdinBytes`");
  requireText(root, "ARTIFACT_CONTRACT.md", "`auditBytes`");
  requireText(root, "ARTIFACT_CONTRACT.md", "deprecated");
  requireText(root, "ARTIFACT_CONTRACT.md", "compatibility alias");
  requireText(root, "ARTIFACT_CONTRACT.md", "_deprecatedInputBytes");
  requireText(root, "ARTIFACT_CONTRACT.md", "bounded clause window");
  requireText(root, "ARTIFACT_CONTRACT.md", "Bare references such as `Per D99` are not sufficient");
  requireText(root, "ARTIFACT_CONTRACT.md", "structured warning to `run.json`");
  requireText(root, "ARTIFACT_CONTRACT.md", "denied-path");
  requireText(root, "ARTIFACT_CONTRACT.md", "possible access");
  requireText(root, "ARTIFACT_CONTRACT.md", "may return `0`, `1`, or `3`");
  requireText(root, "ARTIFACT_CONTRACT.md", "branch-diff base-ref drift");
  requireText(root, "ARTIFACT_CONTRACT.md", "may still lose findings on timeout");
  requireText(root, "ARTIFACT_CONTRACT.md", "reviewer_timeout_with_output");
  requireText(root, "ARTIFACT_CONTRACT.md", "filter tracked diff content");
  requireText(root, "ARTIFACT_CONTRACT.md", "Scope Transparency");
  requireText(root, "ARTIFACT_CONTRACT.md", "depends on working-tree stability");
  requireText(root, "ARTIFACT_CONTRACT.md", "diffSectionStatus");
  requireText(root, "ARTIFACT_CONTRACT.md", "no detected disclosure");
  requireText(root, "ARTIFACT_CONTRACT.md", "tracked sensitive files can still be embedded");
  requireText(root, "ARTIFACT_CONTRACT.md", "api-tokens.json");
  requireText(root, "ARTIFACT_CONTRACT.md", "model's real context window");
  requireText(root, "ARTIFACT_CONTRACT.md", "SteadySpec-default vocabulary");
  requireText(root, "ARTIFACT_CONTRACT.md", "runArtifactHashes");
  requireText(root, "ARTIFACT_CONTRACT.md", "runArtifactHashesNote");
  requireText(root, "ARTIFACT_CONTRACT.md", "Cross-fork");
  requireText(root, "ARTIFACT_CONTRACT.md", "single-user Windows lane");
  requireText(root, "ARTIFACT_CONTRACT.md", "Agent Trace Record requirement");
  requireText(root, "ARTIFACT_CONTRACT.md", "two-agent consensus");
  if (readText(path.join(root, "ARTIFACT_CONTRACT.md")).includes("may return `0`, `1`, `3`, or `4`")) {
    fail("ARTIFACT_CONTRACT.md must not document unsupported --run-if-needed exit code 4");
  }
  requireText(root, "README.md", "--packet-only");
  requireText(root, "README.md", "--calibrate-dir");
  requireText(root, "README.md", "API budget");
  requireText(root, "README.md", "Sensitive-file omission applies only to untracked file rendering");
  requireText(root, "README.md", "api-tokens.json");
  requireText(root, "README.md", "reviewer model");
  requireText(root, "README.md", "SteadySpec-default vocabulary");
  requireText(root, "README.md", "children are change directories");
  requireText(root, "README.md", "steadyspec hooks install");
  requireText(root, "README.md", "Unrelated conversations");
  requireText(root, "QUICKSTART.md", "--calibrate-dir");
  requireText(root, "QUICKSTART.md", "API budget");
  requireText(root, "QUICKSTART.md", "Sensitive-file omission applies only to untracked file rendering");
  requireText(root, "QUICKSTART.md", "api-tokens.json");
  requireText(root, "QUICKSTART.md", "reviewer model");
  requireText(root, "QUICKSTART.md", "SteadySpec-default vocabulary");
  requireText(root, "QUICKSTART.md", "children are change directories");
  requireText(root, "QUICKSTART.md", "live working-tree signal");
  requireText(root, "QUICKSTART.md", "--cross-review-hooks auto");
  requireText(root, "bin/cross-review-hook.js", "STEADYSPEC_CROSS_REVIEW_CHILD");
  requireText(root, "bin/cross-review-hook.js", "peerForHost");
  requireText(root, "bin/cross-review-hook.js", "Hooks do not run long model processes");
  requireText(root, "bin/cross-review-hook.js", "checkCrossReview");
  requireText(root, "bin/cross-review-hook.js", "entry.isSymbolicLink()");
  requireText(root, "bin/cross-review-hook.js", "validateHooksShape");
  requireText(root, "bin/cross-review-hook.js", "buildRunnerEnv");
  requireText(root, "bin/cross-review-hook.js", "peer-run-required");
  requireText(root, "ARTIFACT_CONTRACT.md", "signalCountSummary");
  requireText(root, "ARTIFACT_CONTRACT.md", "children are change directories");
  requireText(root, "ARTIFACT_CONTRACT.md", "dry-run-only");
  requireText(root, "CHANGELOG.md", "## 0.5.0 (Windows single-user)");
  requireText(root, "CHANGELOG.md", "opposite-family peer routing");
  requireText(root, "CHANGELOG.md", "Agent Collaboration Mode selection");
  requireText(root, "CHANGELOG.md", "no third-party arbitration");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "Do not reuse the `--check-latest` exit-code table for `--run-if-needed`");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "do not use gated mode as a release or merge gate by itself");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "do not reuse the `--check-latest` exit-code table");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "do not use gated mode as a release or merge gate by itself");
  const v05DesignPath = path.join(root, ".meta", "changes", "005-v0.5-cross-agent-runtime", "design.md");
  if (fs.existsSync(v05DesignPath)) {
    const v05Design = readText(v05DesignPath);
    if (!v05Design.includes("may return `0`, `1`, or `3`")) {
      fail("v0.5 design.md must document --run-if-needed exit codes as 0, 1, or 3");
    }
    if (v05Design.includes("may return `0`, `1`, `3`, or `4`")) {
      fail("v0.5 design.md must not document unsupported --run-if-needed exit code 4");
    }
  }
  requireText(root, "CHANGELOG.md", "advisory");
  requireText(root, "CHANGELOG.md", "packet-only");
  requireText(root, "en/flows/steadyspec-propose-flow/SKILL.md", "cross-review");
  requireText(root, "en/flows/steadyspec-propose-flow/SKILL.md", "Agent Collaboration Mode");
  requireText(root, "en/flows/steadyspec-propose-flow/SKILL.md", "two-agent consensus");
  requireText(root, "en/flows/steadyspec-propose-flow/SKILL.md", "WINDOWS V0.5");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "--check-latest --json");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "third-party arbitration");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "Interpret gate JSON by status");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "moderation rejected every finding");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "POSIX UNTESTED / CALIBRATION REQUIRED");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "PLATFORM BRANCH");
  requireText(root, "en/flows/steadyspec-verify-flow/SKILL.md", "`not-enforced`");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "--check-latest --json");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "Interpret gate JSON by status");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "all-rejected moderation warnings");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "POSIX UNTESTED / CALIBRATION REQUIRED");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "PLATFORM BRANCH");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "`not-required`");
  requireText(root, "en/flows/steadyspec-archive-flow/SKILL.md", "manifest SHA-256 hash");
  const initRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-init-cross-review-"));
  const initResult = spawnSync(process.execPath, [
    path.join(root, "bin", "init.js"),
    "--runtime", "codex",
    "--substrate", "docs",
    "--cross-review", "gated",
    "--cross-review-hooks", "auto",
    "--force",
  ], { cwd: initRepo, encoding: "utf8", timeout: 30000 });
  if (initResult.status !== 0) {
    fail(`steadyspec init gated cross-review fixture failed: ${initResult.stderr || initResult.stdout}`);
  }
  const gatedState = readJson(path.join(initRepo, ".steadyspec", "cross-review.json"));
  if (gatedState.minSignals !== 2
    || gatedState.packetOnly !== true
    || gatedState.mode !== "gated"
    || gatedState.hooks?.mode !== "auto"
    || gatedState.hooks?.reviewer !== "auto"
    || gatedState.hooks?.activation !== "explicit-steadyspec-or-cross-agent-prompt"
    || gatedState.hooks?.allowExperimentalDebate !== false
    || Object.prototype.hasOwnProperty.call(gatedState.hooks || {}, "hookTimeoutSeconds")
    || !Array.isArray(gatedState.scopeIgnorePatterns)
    || !gatedState.scopeIgnorePatterns.includes("^\\.DS_Store$")
    || !gatedState.scopeIgnorePatterns.includes("^\\..*\\.swp$")) {
    fail("steadyspec init --cross-review gated hooks fixture must preserve gated defaults and explicit hook activation policy");
  }
  const initGitignore = readText(path.join(initRepo, ".gitignore"));
  if (!initGitignore.includes("**/cross-agent/") || !initGitignore.includes(".steadyspec/runtime/")) {
    fail("steadyspec hook-enabled init must ignore reviewer artifacts and hook runtime state");
  }
  fs.rmSync(initRepo, { recursive: true, force: true });

  const incompatibleHookRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-hook-incompatible-"));
  const incompatibleHookResult = spawnSync(process.execPath, [path.join(root, "bin", "init.js"), "--runtime", "codex", "--substrate", "docs", "--cross-review", "advisory", "--cross-review-hooks", "auto", "--dry-run"], {
    cwd: incompatibleHookRepo, encoding: "utf8", timeout: 30000,
  });
  if (incompatibleHookResult.status === 0 || !incompatibleHookResult.stderr.includes("requires --cross-review gated")) {
    fail("steadyspec hooks.auto must require gated cross-review mode");
  }
  fs.rmSync(incompatibleHookRepo, { recursive: true, force: true });

  const hookHome = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-hook-home-"));
  const hookRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-hook-repo-"));
  fs.mkdirSync(path.join(hookHome, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(hookHome, ".claude", "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "third-party hook", timeout: 3 }] }] } }), "utf8");
  let hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "install", "--target", "both", "--json"], {
    cwd: hookRepo, env: { ...process.env, STEADYSPEC_HOME: hookHome, CODEX_HOME: path.join(hookHome, ".codex") }, encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0) fail(`steadyspec hook adapter install fixture failed: ${hookResult.stderr || hookResult.stdout}`);
  const installedClaude = readJson(path.join(hookHome, ".claude", "settings.json"));
  if (installedClaude.theme !== "dark" || !installedClaude.hooks.Stop.some((entry) => entry.hooks.some((hook) => hook.command === "third-party hook"))) {
    fail("steadyspec hook adapter install must preserve sibling Claude settings and hooks");
  }
  spawnSync("git", ["init"], { cwd: hookRepo, encoding: "utf8" });
  fs.mkdirSync(path.join(hookRepo, ".steadyspec"), { recursive: true });
  fs.mkdirSync(path.join(hookRepo, "docs", "changes", "001-hook-fixture"), { recursive: true });
  fs.writeFileSync(path.join(hookRepo, "docs", "changes", "001-hook-fixture", "proposal.md"), "# Hook fixture\n", "utf8");
  fs.writeFileSync(path.join(hookRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude", hooks: { mode: "ask" } }), "utf8");
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "codex"], {
    cwd: hookRepo, input: JSON.stringify({ prompt: "Can you explain how to use cross-review in this project? This is only a discussion." }), encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0 || hookResult.stdout.trim() || fs.existsSync(path.join(hookRepo, ".steadyspec", "runtime"))) {
    fail("steadyspec hook adapter must silently ignore unrelated conversations");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "codex"], {
    cwd: hookRepo,
    env: { ...process.env, STEADYSPEC_CROSS_REVIEW_CHILD: "1" },
    input: JSON.stringify({ prompt: "Use steadyspec:propose with cross-review for 001-hook-fixture" }),
    encoding: "utf8",
    timeout: 30000,
  });
  if (hookResult.status !== 0 || hookResult.stdout.trim() || fs.existsSync(path.join(hookRepo, ".steadyspec", "runtime"))) {
    fail("steadyspec reviewer child processes must suppress host-hook activation");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "codex"], {
    cwd: hookRepo, input: JSON.stringify({ prompt: "Use steadyspec:propose with cross-review for 001-hook-fixture" }), encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0 || !hookResult.stdout.includes("Ask the user to choose solo, grill, cross-review, or debate") || !hookResult.stdout.includes("codex -> claude")) {
    fail("steadyspec hook adapter must activate an explicit SteadySpec cross-agent turn");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "codex"], {
    cwd: hookRepo, input: JSON.stringify({ prompt: "Continue with an unrelated ordinary question." }), encoding: "utf8", timeout: 30000,
  });
  const hookStateRoot = path.join(hookRepo, ".steadyspec", "runtime", "cross-review-hook-state");
  if (hookResult.status !== 0 || hookResult.stdout.trim() || (fs.existsSync(hookStateRoot) && fs.readdirSync(hookStateRoot).length > 0)) {
    fail("steadyspec hook adapter must clear an older activation when a new unrelated prompt begins");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "codex"], {
    cwd: hookRepo, input: JSON.stringify({ prompt: "Use steadyspec:propose with cross-review for 001-hook-fixture" }), encoding: "utf8", timeout: 30000,
  });
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "Stop", "--host", "codex"], {
    cwd: hookRepo, input: JSON.stringify({ stop_hook_active: false }), encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0 || !hookResult.stdout.includes('"decision":"block"') || (fs.existsSync(hookStateRoot) && fs.readdirSync(hookStateRoot).length > 0)) {
    fail("steadyspec Codex ask-mode Stop hook must request continuation and clear its activation");
  }
  fs.writeFileSync(path.join(hookRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "gated", reviewer: "claude", packetOnly: true, hooks: { mode: "auto", reviewer: "auto" } }), "utf8");
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "claude"], {
    cwd: hookRepo, input: JSON.stringify({ session_id: "host-route", prompt: "Use steadyspec:verify with cross-review for 001-hook-fixture" }), encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0 || !hookResult.stdout.includes("primary host=claude; independent peer=codex") || !hookResult.stdout.includes("--experimental-codex") || hookResult.stdout.includes("run the reviewer from the Stop hook")) {
    fail("steadyspec auto hook must route Claude to Codex without launching a long Stop task");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "Stop", "--host", "claude"], {
    cwd: hookRepo, input: JSON.stringify({ session_id: "host-route", stop_hook_active: false }), encoding: "utf8", timeout: 30000,
  });
  const claudePendingFile = fs.readdirSync(hookStateRoot).map((name) => path.join(hookStateRoot, name)).find((file) => readJson(file).scope === "host-route");
  if (hookResult.status !== 0 || !hookResult.stdout.includes('"decision":"block"') || !claudePendingFile || readJson(claudePendingFile).pendingStatus !== "peer-run-required") {
    fail("steadyspec Claude Stop hook must block and preserve durable pending state");
  }
  fs.writeFileSync(path.join(hookRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "gated", reviewer: "claude", packetOnly: true, hooks: { mode: "auto", reviewer: "claude" } }), "utf8");
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "hook-event", "UserPromptSubmit", "--host", "claude"], {
    cwd: hookRepo, input: JSON.stringify({ session_id: "same-family", prompt: "Use steadyspec:verify with cross-review for 001-hook-fixture" }), encoding: "utf8", timeout: 30000,
  });
  if (hookResult.status !== 0 || !hookResult.stdout.includes('"decision":"block"') || !hookResult.stdout.includes("Invalid cross-agent route")) {
    fail("steadyspec hook adapter must reject same-family reviewer configuration");
  }
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "uninstall", "--target", "both", "--json"], {
    cwd: hookRepo, env: { ...process.env, STEADYSPEC_HOME: hookHome, CODEX_HOME: path.join(hookHome, ".codex") }, encoding: "utf8", timeout: 30000,
  });
  const uninstalledClaude = readJson(path.join(hookHome, ".claude", "settings.json"));
  if (hookResult.status !== 0 || uninstalledClaude.theme !== "dark" || !uninstalledClaude.hooks.Stop.some((entry) => entry.hooks.some((hook) => hook.command === "third-party hook"))) {
    fail("steadyspec hook adapter uninstall must preserve sibling Claude settings and hooks");
  }
  fs.rmSync(hookHome, { recursive: true, force: true });
  fs.rmSync(hookRepo, { recursive: true, force: true });
}

function checkWarningMapCoverage(runnerText) {
  const mapMatch = runnerText.match(/const WARNING_CLASSIFICATION_MAP = \[([\s\S]*?)\];/);
  if (!mapMatch) fail("bin/cross-review.js missing WARNING_CLASSIFICATION_MAP");
  const patterns = [...mapMatch[1].matchAll(/pattern:\s*\/((?:\\.|[^/])+)\/([a-z]*)/g)]
    .map((match) => new RegExp(match[1], match[2]));
  if (!patterns.length) fail("WARNING_CLASSIFICATION_MAP must contain regex patterns");
  const literalWarnings = [...runnerText.matchAll(/(?:^|[^.\w])warnings\.push\(\s*(["'])([\s\S]*?)\1\s*\)/g)]
    .map((match) => match[2])
    .filter((text) => !/[${}`]/.test(text));
  for (const warning of literalWarnings) {
    if (!patterns.some((pattern) => pattern.test(warning))) {
      fail(`WARNING_CLASSIFICATION_MAP missing policy for literal warning: ${warning}`);
    }
  }
  const templateWarnings = [...runnerText.matchAll(/(?:^|[^.\w])warnings\.push\(\s*`([\s\S]*?)`\s*\)/g)]
    .map((match) => match[1].replace(/\$\{[^}]*\}/g, "X"));
  for (const warning of templateWarnings) {
    if (!patterns.some((pattern) => pattern.test(warning))) {
      fail(`WARNING_CLASSIFICATION_MAP missing policy for template warning: ${warning}`);
    }
  }
}

function runCrossReview(root, repo, args, options = {}) {
  return spawnSync(process.execPath, [path.join(root, "bin", "cross-review.js"), "--repo", repo, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    timeout: 30000,
  });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${label} did not print valid JSON: ${error.message}`);
  }
}

function latestRunDirIn(parent) {
  const names = fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.length) fail("cross-review dry-run did not create a run directory");
  return path.join(parent, names[names.length - 1]);
}

function latestRunDir(changeDir) {
  return latestRunDirIn(path.join(changeDir, "cross-agent"));
}

function writeFixtureModeration(runDir, decision) {
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    `| F1 | P3 | Fixture finding | ${decision} | Fixture moderation. | Keep contract stable. | agent | fixture |`,
    "",
  ].join("\n"), "utf8");
}

function checkCrossReviewContracts(root) {
  // Fixture coverage only: this checks CLI/JSON contracts and parser behavior.
  // Real Claude/Codex integration evidence must come from dogfood runs.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-contracts-"));
  const changeDir = path.join(tmp, "docs", "changes", "001-contract");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "steadyspec-fixture", version: "0.0.0-fixture" }), "utf8");
  fs.writeFileSync(path.join(changeDir, "tasks.md"), [
    "schemaVersion: 1",
    "",
    "# Tasks",
    "",
    "- [ ] This is not an architecture change, but auth migration needs review.",
    "",
  ].join("\n"), "utf8");
  const fakeBin = path.join(tmp, "fake-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "fake-claude.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.1.999 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |');",
    "console.log('|------------|----------|--------------|----------|-------------------|-------------|--------------------|');",
    "console.log('| F1 | P3 | Forced fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |');",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(fakeBin, "claude.cmd"), [
    "@echo off",
    "node \"%~dp0fake-claude.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const fakeReviewerEnv = { Path: `${fakeBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  let result;
  let json;

  const timeoutBin = path.join(tmp, "timeout-bin");
  fs.mkdirSync(timeoutBin, { recursive: true });
  fs.writeFileSync(path.join(timeoutBin, "fake-claude-timeout.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.1.999 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |');",
    "console.log('|------------|----------|--------------|----------|-------------------|-------------|--------------------|');",
    "console.log('| F1 | P3 | Timeout fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |');",
    "setTimeout(() => {}, 5000);",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(timeoutBin, "claude.cmd"), [
    "@echo off",
    "node \"%~dp0fake-claude-timeout.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const timeoutReviewerEnv = { Path: `${timeoutBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  const timeoutWithOutputDir = path.join(changeDir, "timeout-with-output-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--timeout-ms", "100", "--output-dir", timeoutWithOutputDir], { env: timeoutReviewerEnv });
  if (result.status !== 0) fail(`cross-review timeout-with-output fixture failed: ${result.stderr || result.stdout}`);
  const timeoutWithOutputRunDir = latestRunDirIn(timeoutWithOutputDir);
  const timeoutWithOutputRunJson = readJson(path.join(timeoutWithOutputRunDir, "run.json"));
  if (timeoutWithOutputRunJson.reviewerStatus !== "success"
    || timeoutWithOutputRunJson.failureClass !== "reviewer_timeout_with_output"
    || !timeoutWithOutputRunJson.warnings.some((warning) => warning.includes("timed out after producing structured output"))) {
    fail("cross-review timeout-with-output run classification changed");
  }
  writeFixtureModeration(timeoutWithOutputRunDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", timeoutWithOutputDir, "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review timeout-with-output latest check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || !json.warnings.some((warning) => warning.includes("timed out after producing structured output"))) {
    fail("cross-review timeout-with-output latest check contract changed");
  }
  fs.mkdirSync(path.join(tmp, ".steadyspec"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "gated", reviewer: "claude" }), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", timeoutWithOutputDir, "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review timeout-with-output gate check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("blocking warnings")) || !json.warnings.some((warning) => warning.includes("timed out after producing structured output"))) {
    fail("cross-review timeout-with-output must not satisfy gated mode");
  }
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude" }), "utf8");

  const outputLimitBin = path.join(tmp, "output-limit-bin");
  fs.mkdirSync(outputLimitBin, { recursive: true });
  fs.writeFileSync(path.join(outputLimitBin, "fake-claude-large-output.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.1.999 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |');",
    "console.log('|------------|----------|--------------|----------|-------------------|-------------|--------------------|');",
    "console.log('| F1 | P3 | Output limit fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |');",
    "console.log('x'.repeat(2000));",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(outputLimitBin, "claude.bat"), [
    "@echo off",
    "node \"%~dp0fake-claude-large-output.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const outputLimitEnv = { Path: `${outputLimitBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  const outputLimitDir = path.join(changeDir, "output-limit-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--max-output-bytes", "500", "--output-dir", outputLimitDir], { env: outputLimitEnv });
  if (result.status !== 0) fail(`cross-review output-limit fixture failed: ${result.stderr || result.stdout}`);
  const outputLimitRunDir = latestRunDirIn(outputLimitDir);
  const outputLimitRunJson = readJson(path.join(outputLimitRunDir, "run.json"));
  const partialStdout = fs.readFileSync(path.join(outputLimitRunDir, "stdout.partial.txt"), "utf8");
  if (outputLimitRunJson.reviewerStatus !== "success"
    || outputLimitRunJson.failureClass !== "none"
    || outputLimitRunJson.maxOutputBytes !== 500
    || outputLimitRunJson.reviewerResult.stdoutTruncated !== true
    || outputLimitRunJson.reviewerResult.stdoutCapturedBytes > 500
    || partialStdout.length <= outputLimitRunJson.reviewerResult.stdoutCapturedBytes
    || !outputLimitRunJson.warnings.some((warning) => warning.includes("stdout exceeded --max-output-bytes"))) {
    fail("cross-review output-limit contract changed");
  }

  const utf8LimitBin = path.join(tmp, "utf8-limit-bin");
  fs.mkdirSync(utf8LimitBin, { recursive: true });
  fs.writeFileSync(path.join(utf8LimitBin, "fake-claude-utf8-output.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.1.999 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |');",
    "console.log('|------------|----------|--------------|----------|-------------------|-------------|--------------------|');",
    "console.log('| F1 | P3 | UTF8 limit fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |');",
    "console.log('🙂'.repeat(200));",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(utf8LimitBin, "claude.cmd"), [
    "@echo off",
    "node \"%~dp0fake-claude-utf8-output.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const utf8LimitEnv = { Path: `${utf8LimitBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  const utf8LimitDir = path.join(changeDir, "utf8-limit-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--max-output-bytes", "420", "--output-dir", utf8LimitDir], { env: utf8LimitEnv });
  if (result.status !== 0) fail(`cross-review utf8 output-limit fixture failed: ${result.stderr || result.stdout}`);
  const utf8LimitRunDir = latestRunDirIn(utf8LimitDir);
  const utf8LimitRaw = readText(path.join(utf8LimitRunDir, "raw.md"));
  if (utf8LimitRaw.includes("\uFFFD")) {
    fail("cross-review output truncation must not split UTF-8 code points");
  }

  const unstructuredBin = path.join(tmp, "unstructured-bin");
  fs.mkdirSync(unstructuredBin, { recursive: true });
  fs.writeFileSync(path.join(unstructuredBin, "fake-claude-unstructured.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.1.999 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Issue ID | Priority | Claim |');",
    "console.log('|----------|----------|-------|');",
    "console.log('| Alpha | High | Fixture format mismatch. |');",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(unstructuredBin, "claude.cmd"), [
    "@echo off",
    "node \"%~dp0fake-claude-unstructured.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const unstructuredEnv = { Path: `${unstructuredBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  const unstructuredDir = path.join(changeDir, "unstructured-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--output-dir", unstructuredDir], { env: unstructuredEnv });
  if (result.status !== 3) fail(`cross-review unstructured diagnostic fixture should exit 3: ${result.stderr || result.stdout}`);
  const unstructuredRunDir = latestRunDirIn(unstructuredDir);
  const unstructuredRunJson = readJson(path.join(unstructuredRunDir, "run.json"));
  const unstructuredRaw = readText(path.join(unstructuredRunDir, "raw.md"));
  if (unstructuredRunJson.outputFormat !== "unstructured"
    || !unstructuredRunJson.outputDiagnostic.includes("Issue ID")
    || !unstructuredRaw.includes("Output Diagnostic:")) {
    fail("cross-review unstructured output diagnostic contract changed");
  }

  const largeAuditRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-large-audit-"));
  const largeAuditChange = path.join(largeAuditRepo, "docs", "changes", "001-large-audit");
  fs.mkdirSync(largeAuditChange, { recursive: true });
  fs.writeFileSync(path.join(largeAuditChange, "tasks.md"), [
    "schemaVersion: 1",
    "",
    "# Tasks",
    "",
    "- [ ] Review large audit artifact.",
    "",
    "## Large Fixture",
    "",
    "x".repeat(20000),
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, largeAuditRepo, ["--change", "001-large-audit", "--reviewer", "claude", "--mode", "review", "--run", "--max-prompt-bytes", "12000"], { env: fakeReviewerEnv });
  if (result.status !== 0) {
    fail(`cross-review non-packet-only audit-size fixture failed: ${result.stderr || result.stdout}`);
  }
  const largeAuditRunJson = readJson(path.join(latestRunDir(largeAuditChange), "run.json"));
  if (!(largeAuditRunJson.auditBytes > largeAuditRunJson.stdinBytes)
    || largeAuditRunJson.inputBytes !== largeAuditRunJson.stdinBytes
    || !largeAuditRunJson.warnings.some((warning) => warning.includes("audit size") && warning.includes("was allowed"))) {
    fail("cross-review non-packet-only prompt-size/audit-size contract changed");
  }
  fs.rmSync(largeAuditRepo, { recursive: true, force: true });

  const scopeMismatchRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-scope-mismatch-"));
  const scopeMismatchChange = path.join(scopeMismatchRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(scopeMismatchChange, { recursive: true });
  fs.writeFileSync(path.join(scopeMismatchChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Fixture scope mismatch.\n", "utf8");
  spawnSync("git", ["init"], { cwd: scopeMismatchRepo, encoding: "utf8", timeout: 30000 });
  const scopeMismatchOutputDir = path.join(scopeMismatchChange, "cross-agent");
  result = runCrossReview(root, scopeMismatchRepo, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--output-dir", scopeMismatchOutputDir], { env: fakeReviewerEnv });
  if (result.status !== 0) fail(`cross-review scope mismatch fixture run failed: ${result.stderr || result.stdout}`);
  fs.writeFileSync(path.join(scopeMismatchRepo, "editor.swp"), "new noise\n", "utf8");
  result = runCrossReview(root, scopeMismatchRepo, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", scopeMismatchOutputDir, "--check-latest", "--json"], { env: fakeReviewerEnv });
  json = parseJsonOutput(result, "cross-review scope mismatch diagnostic check");
  if (result.status !== 3
    || !json.errors.some((error) => error.includes("scopeFingerprint does not match") && error.includes("git status delta") && error.includes("editor.swp"))) {
    fail("cross-review scope mismatch diagnostics changed");
  }
  fs.rmSync(scopeMismatchRepo, { recursive: true, force: true });

  const rawMissingRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-raw-missing-"));
  const rawMissingChange = path.join(rawMissingRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(rawMissingChange, { recursive: true });
  fs.writeFileSync(path.join(rawMissingChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Fixture raw missing.\n", "utf8");
  spawnSync("git", ["init"], { cwd: rawMissingRepo, encoding: "utf8", timeout: 30000 });
  const rawMissingOutputDir = path.join(rawMissingChange, "cross-agent");
  result = runCrossReview(root, rawMissingRepo, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--output-dir", rawMissingOutputDir], { env: fakeReviewerEnv });
  if (result.status !== 0) fail(`cross-review raw-missing fixture run failed: ${result.stderr || result.stdout}`);
  const rawMissingRunDir = latestRunDirIn(rawMissingOutputDir);
  writeFixtureModeration(rawMissingRunDir, "accepted");
  fs.rmSync(path.join(rawMissingRunDir, "raw.md"), { force: true });
  result = runCrossReview(root, rawMissingRepo, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", rawMissingOutputDir, "--check-latest", "--json"], { env: fakeReviewerEnv });
  json = parseJsonOutput(result, "cross-review raw-missing latest diagnostic check");
  if (result.status !== 3
    || !json.warnings.some((warning) => warning.includes("raw output file recorded in run.json is missing"))) {
    fail("cross-review raw-missing latest warning changed");
  }
  fs.rmSync(rawMissingRepo, { recursive: true, force: true });

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review no-run check");
  if (result.status !== 2 || json.status !== "no-run" || json.exitCode !== 2) {
    fail("cross-review --check-latest no-run contract changed");
  }
  if (!Array.isArray(json.warnings) || !json.warnings.some((warning) => warning.includes("defaulted review scope"))) {
    fail("cross-review --check-latest must warn when scope-affecting flags are defaulted");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--advice", "--json"]);
  json = parseJsonOutput(result, "cross-review advice check");
  if (result.status !== 0 || json.recommended !== true || !("adviceActive" in json) || !("gateActive" in json)) {
    fail("cross-review --advice JSON contract changed");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "review", "--include-diff", "--advice", "--json"]);
  json = parseJsonOutput(result, "cross-review review advice notes check");
  if (result.status !== 0 || !Array.isArray(json.suggestedCommandNotes) || !json.suggestedCommandNotes.some((note) => note.includes("diffCoherent"))) {
    fail("cross-review review advice suggestedCommandNotes contract changed");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review verbose advice check");
  const highRiskDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "artifacts.highRiskTerms");
  if (result.status !== 0 || !highRiskDetail || !highRiskDetail.fired || !highRiskDetail.terms.includes("auth") || !highRiskDetail.negatedTerms.includes("architecture")) {
    fail("cross-review --advice --verbose signalDetails contract changed");
  }
  const routineChangeDir = path.join(tmp, "docs", "changes", "002-routine");
  fs.mkdirSync(routineChangeDir, { recursive: true });
  fs.writeFileSync(path.join(routineChangeDir, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Routine copy edit.\n", "utf8");
  result = runCrossReview(root, tmp, ["--calibrate-dir", "docs/changes", "--mode", "review", "--include-diff", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review calibrate-dir check");
  if (result.status !== 0
    || json.status !== "calibrated"
    || json.changeCount !== 2
    || !json.signalCountSummary
    || !("histogram" in json.signalCountSummary)
    || !json.calibrationNote.includes("workingTree.publicSurface")
    || typeof json.pathSignalsAvailableCount !== "number"
    || !json.calibrationNote.includes("path signals")
    || !Array.isArray(json.changes)
    || !json.changes.some((entry) => entry.change.endsWith("001-contract") && Array.isArray(entry.signalDetails) && typeof entry.pathSignalsAvailable === "boolean" && typeof entry.pathSignalStatusLineCount === "number")
    || !json.changes.some((entry) => entry.change.endsWith("002-routine"))) {
    fail("cross-review --calibrate-dir JSON contract changed");
  }
  result = runCrossReview(root, tmp, ["--calibrate-dir", "docs", "--mode", "review", "--include-diff", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review calibrate-dir nesting hint check");
  if (result.status !== 0
    || json.status !== "no-changes"
    || !Array.isArray(json.warnings)
    || !json.warnings.some((warning) => warning.includes("expects direct children") && warning.includes("docs/changes"))) {
    fail("cross-review --calibrate-dir must explain one-level nesting mistakes");
  }
  const authorRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-author-advice-"));
  const authorChange = path.join(authorRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(authorRepo, ".steadyspec"), { recursive: true });
  fs.mkdirSync(authorChange, { recursive: true });
  fs.writeFileSync(path.join(authorRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude" }), "utf8");
  fs.writeFileSync(path.join(authorChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Improve author logging and archival indexing.\n", "utf8");
  result = runCrossReview(root, authorRepo, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review high-risk word boundary advice check");
  const authorHighRiskDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "artifacts.highRiskTerms");
  if (result.status !== 0 || !authorHighRiskDetail || authorHighRiskDetail.fired || authorHighRiskDetail.terms.includes("auth") || authorHighRiskDetail.terms.includes("archive")) {
    fail("cross-review high-risk terms must not match author/archival substrings");
  }
  const longNegationRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-long-negation-advice-"));
  const longNegationChange = path.join(longNegationRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(longNegationChange, { recursive: true });
  fs.writeFileSync(path.join(longNegationChange, "tasks.md"), [
    "schemaVersion: 1",
    "",
    "# Tasks",
    "",
    "- [ ] This does not introduce any change that would alter login paths data handling deployment storage user trust audit posture or operational control surfaces in a way that creates a security risk.",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, longNegationRepo, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review long negation advice check");
  const longNegationHighRiskDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "artifacts.highRiskTerms");
  if (result.status !== 0 || !longNegationHighRiskDetail || longNegationHighRiskDetail.fired || !longNegationHighRiskDetail.negatedTerms.includes("security")) {
    fail("cross-review long negation window contract changed");
  }
  fs.writeFileSync(path.join(longNegationChange, "tasks.md"), [
    "schemaVersion: 1",
    "",
    "# Tasks",
    "",
    "- [ ] This does not introduce security risk: auth remains under review.",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, longNegationRepo, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review negation clause-boundary advice check");
  const clauseBoundaryHighRiskDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "artifacts.highRiskTerms");
  if (result.status !== 0 || !clauseBoundaryHighRiskDetail || !clauseBoundaryHighRiskDetail.fired || !clauseBoundaryHighRiskDetail.terms.includes("auth")) {
    fail("cross-review negation handling must stop at colon clause boundaries");
  }
  fs.rmSync(longNegationRepo, { recursive: true, force: true });
  const riskyPathRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-risky-paths-"));
  fs.mkdirSync(path.join(riskyPathRepo, "docs", "changes", "001-contract"), { recursive: true });
  fs.mkdirSync(path.join(riskyPathRepo, ".steadyspec"), { recursive: true });
  fs.mkdirSync(path.join(riskyPathRepo, "src"), { recursive: true });
  fs.writeFileSync(path.join(riskyPathRepo, "docs", "changes", "001-contract", "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Fixture change.\n", "utf8");
  fs.writeFileSync(path.join(riskyPathRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude", riskyPathPatterns: ["^src/"] }), "utf8");
  fs.writeFileSync(path.join(riskyPathRepo, "src", "auth.js"), "module.exports = {};\n", "utf8");
  spawnSync("git", ["init"], { cwd: riskyPathRepo, encoding: "utf8", timeout: 30000 });
  result = runCrossReview(root, riskyPathRepo, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review configurable risky paths check");
  const pathDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "workingTree.publicSurface");
  if (result.status !== 0 || !pathDetail || !pathDetail.fired || !pathDetail.paths.includes("src/") || !pathDetail.patterns.includes("^src/")) {
    fail("cross-review configurable riskyPathPatterns contract changed");
  }
  fs.rmSync(riskyPathRepo, { recursive: true, force: true });
  const scopeIgnoreRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-scope-ignore-"));
  const scopeIgnoreChange = path.join(scopeIgnoreRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(scopeIgnoreRepo, ".steadyspec"), { recursive: true });
  fs.mkdirSync(path.join(scopeIgnoreRepo, "coverage"), { recursive: true });
  fs.mkdirSync(scopeIgnoreChange, { recursive: true });
  fs.writeFileSync(path.join(scopeIgnoreChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Fixture scope ignore.\n", "utf8");
  fs.writeFileSync(path.join(scopeIgnoreRepo, ".steadyspec", "cross-review.json"), JSON.stringify({
    schemaVersion: 1,
    mode: "advisory",
    reviewer: "claude",
    scopeIgnorePatterns: ["^coverage/", "^\\.DS_Store$"],
  }), "utf8");
  fs.writeFileSync(path.join(scopeIgnoreRepo, "coverage", "out.txt"), "ignored first\n", "utf8");
  fs.writeFileSync(path.join(scopeIgnoreRepo, ".DS_Store"), "ignored first\n", "utf8");
  fs.writeFileSync(path.join(scopeIgnoreRepo, "notes.txt"), "visible first\n", "utf8");
  spawnSync("git", ["init"], { cwd: scopeIgnoreRepo, encoding: "utf8", timeout: 30000 });
  const scopeIgnoreOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-scope-ignore-runs-"));
  result = runCrossReview(root, scopeIgnoreRepo, ["--change", "001-contract", "--mode", "review", "--include-diff", "--output-dir", scopeIgnoreOutputDir]);
  if (result.status !== 0) fail(`cross-review scopeIgnorePatterns first fixture failed: ${result.stderr || result.stdout}`);
  const scopeIgnoreRunA = latestRunDirIn(scopeIgnoreOutputDir);
  const scopeIgnoreRunJsonA = readJson(path.join(scopeIgnoreRunA, "run.json"));
  const scopeIgnorePacketA = readText(path.join(scopeIgnoreRunA, "packet.md"));
  if (!scopeIgnoreRunJsonA.config.scopeIgnorePatterns.includes("^coverage/")
    || !scopeIgnorePacketA.includes("Scope Ignore Patterns: `^coverage/`, `^\\.DS_Store$`.")
    || !scopeIgnorePacketA.includes("## Scope Transparency")
    || !scopeIgnorePacketA.includes("| `^coverage/` |")
    || !scopeIgnorePacketA.includes("| `^\\.DS_Store$` |")
    || !scopeIgnorePacketA.includes("| denied or sensitive path | 1 |")
    || scopeIgnorePacketA.includes("coverage/out.txt")
    || scopeIgnorePacketA.includes("?? .DS_Store")
    || scopeIgnorePacketA.includes("untracked file: .DS_Store")
    || !scopeIgnorePacketA.includes("notes.txt")) {
    fail("cross-review scopeIgnorePatterns packet filtering contract changed");
  }
  if (!scopeIgnoreRunJsonA.diffSectionStatus
    || scopeIgnoreRunJsonA.diffSectionStatus.basis !== "per-section-status-and-content-recheck"
    || scopeIgnoreRunJsonA.diffSectionStatus.verificationMethod !== "re-render-git-section-command"
    || typeof scopeIgnoreRunJsonA.diffSectionStatus.diffBaseStable !== "boolean"
    || !("diffBaseSha" in scopeIgnoreRunJsonA.diffSectionStatus)
    || !("diffBaseShaEnd" in scopeIgnoreRunJsonA.diffSectionStatus)
    || !Array.isArray(scopeIgnoreRunJsonA.diffSectionStatus.sections)
    || !scopeIgnoreRunJsonA.diffSectionStatus.sections.some((section) => section.id === "untracked" && typeof section.contentStable === "boolean")) {
    fail("cross-review include-diff section diagnostics contract changed");
  }
  fs.writeFileSync(path.join(scopeIgnoreRepo, "coverage", "out.txt"), "ignored second\n", "utf8");
  fs.writeFileSync(path.join(scopeIgnoreRepo, ".DS_Store"), "ignored second\n", "utf8");
  result = runCrossReview(root, scopeIgnoreRepo, ["--change", "001-contract", "--mode", "review", "--include-diff", "--output-dir", scopeIgnoreOutputDir]);
  if (result.status !== 0) fail(`cross-review scopeIgnorePatterns ignored-noise fixture failed: ${result.stderr || result.stdout}`);
  const scopeIgnoreRunB = latestRunDirIn(scopeIgnoreOutputDir);
  const scopeIgnoreRunJsonB = readJson(path.join(scopeIgnoreRunB, "run.json"));
  if (scopeIgnoreRunJsonB.scopeFingerprint !== scopeIgnoreRunJsonA.scopeFingerprint) {
    fail("cross-review scopeIgnorePatterns must keep scopeFingerprint stable for ignored working-tree noise");
  }
  fs.writeFileSync(path.join(scopeIgnoreRepo, "notes.txt"), "visible second\n", "utf8");
  result = runCrossReview(root, scopeIgnoreRepo, ["--change", "001-contract", "--mode", "review", "--include-diff", "--output-dir", scopeIgnoreOutputDir]);
  if (result.status !== 0) fail(`cross-review scopeIgnorePatterns visible-change fixture failed: ${result.stderr || result.stdout}`);
  const scopeIgnoreRunC = latestRunDirIn(scopeIgnoreOutputDir);
  const scopeIgnoreRunJsonC = readJson(path.join(scopeIgnoreRunC, "run.json"));
  if (scopeIgnoreRunJsonC.scopeFingerprint === scopeIgnoreRunJsonA.scopeFingerprint) {
    fail("cross-review scopeIgnorePatterns must not hide non-ignored working-tree changes");
  }
  fs.rmSync(scopeIgnoreOutputDir, { recursive: true, force: true });
  fs.rmSync(scopeIgnoreRepo, { recursive: true, force: true });
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "debate", "--advice", "--json"]);
  json = parseJsonOutput(result, "cross-review debate advice check");
  if (result.status !== 0 || json.recommended !== true || !json.suggestedCommand.includes("--experimental-debate")) {
    fail("cross-review debate advice must suggest an executable experimental command");
  }
  const debateOnlyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-debate-advice-"));
  const debateOnlyChange = path.join(debateOnlyRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(debateOnlyRepo, ".steadyspec"), { recursive: true });
  fs.mkdirSync(debateOnlyChange, { recursive: true });
  fs.writeFileSync(path.join(debateOnlyRepo, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude" }), "utf8");
  fs.writeFileSync(path.join(debateOnlyChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Routine copy edit.\n", "utf8");
  result = runCrossReview(root, debateOnlyRepo, ["--change", "001-contract", "--mode", "debate", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review non-experimental debate advice check");
  const debateDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "mode.debate");
  if (result.status !== 0 || json.recommended !== false || json.signalCount !== 0 || !debateDetail || debateDetail.fired !== false || debateDetail.reason !== "debate mode requested") {
    fail("cross-review non-experimental debate must not contribute recommendation signal");
  }
  result = runCrossReview(root, debateOnlyRepo, ["--change", "001-contract", "--mode", "debate", "--experimental-debate", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review experimental debate advice check");
  const experimentalDebateDetail = Array.isArray(json.signalDetails) && json.signalDetails.find((detail) => detail.id === "mode.debate");
  if (result.status !== 0 || json.recommended !== true || json.signalCount !== 1 || !experimentalDebateDetail || experimentalDebateDetail.fired !== true || !json.suggestedCommand.includes("--experimental-debate")) {
    fail("cross-review experimental debate must contribute recommendation signal");
  }

  fs.mkdirSync(path.join(tmp, ".steadyspec"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude", minSignals: 99 }), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--advice", "--json"]);
  json = parseJsonOutput(result, "cross-review minSignals advice check");
  if (result.status !== 0 || json.recommended !== false || json.minSignals !== 99 || json.signalCount >= json.minSignals) {
    fail("cross-review minSignals recommendation contract changed");
  }
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "gated", reviewer: "claude" }), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "review", "--include-diff", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated check");
  if (result.status !== 5 || json.status !== "blocked" || json.exitCode !== 5 || json.policyActive !== true) {
    fail("cross-review --gate blocked contract changed");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design"]);
  if (result.status !== 0) fail("cross-review dry-run fixture failed");
  let runDir = latestRunDir(changeDir);
  if (!readText(path.join(runDir, "moderation.md")).includes("DRY RUN")) {
    fail("cross-review dry-run moderation banner missing");
  }
  let runJsonFile = path.join(runDir, "run.json");
  const runJson = readJson(runJsonFile);
  if (runJson.containsAbsolutePaths !== true) {
    fail("cross-review run.json must expose containsAbsolutePaths");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review dry-run-only latest check");
  if (result.status !== 2 || json.status !== "dry-run-only" || !json.errors.some((error) => error.includes("only dry-run"))) {
    fail("cross-review --check-latest must distinguish dry-run-only artifacts from no-run");
  }
  if (runJson.gitStatusStable !== runJson.diffCoherent) {
    fail("cross-review run.json must expose gitStatusStable as the precise git-status stability field");
  }
  if (!runJson._deprecatedInputBytes || !runJson._deprecatedInputBytes.includes("stdinBytes")) {
    fail("cross-review run.json must mark inputBytes as deprecated");
  }
  if (!runJson.runArtifactHashes
    || !/^sha256:[a-f0-9]{64}$/.test(runJson.runArtifactHashes.packet || "")
    || !/^sha256:[a-f0-9]{64}$/.test(runJson.runArtifactHashes.raw || "")) {
    fail("cross-review run.json must record runArtifactHashes for generated artifacts");
  }
  if (!runJson.runArtifactHashesNote || !runJson.runArtifactHashesNote.includes("does not enforce")) {
    fail("cross-review run.json must explain runArtifactHashes are audit-only in v0.5");
  }
  const dryRunPacket = readText(path.join(runDir, "packet.md"));
  if (!dryRunPacket.includes("| Artifact | Status | SHA-256 |") || !/\| tasks\.md \| present \| sha256:[a-f0-9]{64} \|/.test(dryRunPacket)) {
    fail("cross-review artifact manifest hash contract changed");
  }
  const sensitiveRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-sensitive-untracked-"));
  spawnSync("git", ["init"], { cwd: sensitiveRepo, encoding: "utf8" });
  const sensitiveChange = path.join(sensitiveRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(sensitiveChange, { recursive: true });
  fs.writeFileSync(path.join(sensitiveChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Review packet safety.\n", "utf8");
  fs.writeFileSync(path.join(sensitiveRepo, ".npmrc"), "//registry.example/:_authToken=SECRET_TOKEN\n", "utf8");
  fs.writeFileSync(path.join(sensitiveRepo, "terraform.tfvars"), "client_secret = \"SECRET_TFVARS\"\n", "utf8");
  fs.mkdirSync(path.join(sensitiveRepo, "design"), { recursive: true });
  fs.writeFileSync(path.join(sensitiveRepo, "design", "auth-flow.md"), "AUTH_FLOW_DESIGN\n", "utf8");
  result = runCrossReview(root, sensitiveRepo, ["--change", "001-contract", "--mode", "review", "--include-diff"]);
  if (result.status !== 0) fail("cross-review sensitive untracked fixture failed");
  const sensitivePacket = readText(path.join(latestRunDir(sensitiveChange), "packet.md"));
  if (!sensitivePacket.includes("--- untracked file: .npmrc ---")
    || !sensitivePacket.includes("[omitted: path matches denied or sensitive pattern (.npmrc)]")
    || !sensitivePacket.includes("--- untracked file: terraform.tfvars ---")
    || !sensitivePacket.includes("[omitted: path matches denied or sensitive pattern (terraform.tfvars)]")
    || sensitivePacket.includes("SECRET_TOKEN")
    || sensitivePacket.includes("SECRET_TFVARS")
    || !sensitivePacket.includes("--- untracked file: design/auth-flow.md ---")
    || !sensitivePacket.includes("AUTH_FLOW_DESIGN")) {
    fail("cross-review sensitive untracked packet omission changed");
  }
  const docsRootRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-docs-root-"));
  const docsRootChange = path.join(docsRootRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(docsRootRepo, "en"), { recursive: true });
  fs.mkdirSync(docsRootChange, { recursive: true });
  fs.writeFileSync(path.join(docsRootRepo, "README.md"), "# Fixture README\n", "utf8");
  fs.writeFileSync(path.join(docsRootChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Check docs root.\n", "utf8");
  result = runCrossReview(root, docsRootRepo, ["--change", "001-contract", "--mode", "design"]);
  if (result.status !== 0) fail("cross-review docs root fixture failed");
  const docsRootRun = latestRunDir(docsRootChange);
  const docsRootRunJson = readJson(path.join(docsRootRun, "run.json"));
  const docsRootPacket = readText(path.join(docsRootRun, "packet.md"));
  if (!docsRootPacket.includes("Public docs root: `README.md`") || !docsRootRunJson.warnings.some((warning) => warning.includes("does not look like a SteadySpec docs surface"))) {
    fail("cross-review docs root fallback contract changed");
  }
  fs.rmSync(docsRootRepo, { recursive: true, force: true });
  const invalidIdentityRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-invalid-identity-"));
  const invalidChange = path.join(invalidIdentityRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(invalidIdentityRepo, "bin"), { recursive: true });
  fs.mkdirSync(invalidChange, { recursive: true });
  fs.writeFileSync(path.join(invalidIdentityRepo, "package.json"), "{ invalid json", "utf8");
  fs.writeFileSync(path.join(invalidIdentityRepo, "bin", "cross-review.js"), "SECRET_IMPL\n", "utf8");
  fs.writeFileSync(path.join(invalidChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Check invalid package identity.\n", "utf8");
  result = runCrossReview(root, invalidIdentityRepo, ["--change", "001-contract", "--mode", "review"]);
  if (result.status !== 0) fail("cross-review invalid package identity fixture failed");
  const invalidRun = latestRunDir(invalidChange);
  const invalidRunJson = readJson(path.join(invalidRun, "run.json"));
  const invalidPacket = readText(path.join(invalidRun, "packet.md"));
  if (!invalidRunJson.warnings.some((warning) => warning.includes("not bundled")) || invalidPacket.includes("SECRET_IMPL") || invalidPacket.includes("Implementation Reference:") || !invalidPacket.includes("Packet Generation Warnings") || !invalidPacket.includes("package.json could not be parsed")) {
    fail("cross-review invalid package identity must not bundle implementation reference");
  }
  const missingPackageRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-missing-package-"));
  const missingPackageChange = path.join(missingPackageRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(missingPackageRepo, "bin"), { recursive: true });
  fs.mkdirSync(missingPackageChange, { recursive: true });
  fs.writeFileSync(path.join(missingPackageRepo, "bin", "cross-review.js"), "MISSING_PACKAGE_IMPL\n", "utf8");
  fs.writeFileSync(path.join(missingPackageChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Check missing package identity.\n", "utf8");
  result = runCrossReview(root, missingPackageRepo, ["--change", "001-contract", "--mode", "review"]);
  if (result.status !== 0) fail("cross-review missing package identity fixture failed");
  const missingPackageRun = latestRunDir(missingPackageChange);
  const missingPackageRunJson = readJson(path.join(missingPackageRun, "run.json"));
  const missingPackagePacket = readText(path.join(missingPackageRun, "packet.md"));
  if (!missingPackageRunJson.warnings.some((warning) => warning.includes("package.json not found"))
    || missingPackagePacket.includes("MISSING_PACKAGE_IMPL")
    || missingPackagePacket.includes("Implementation Reference:")
    || !missingPackagePacket.includes("package.json not found")) {
    fail("cross-review missing package identity must warn and avoid bundling implementation reference");
  }
  fs.rmSync(missingPackageRepo, { recursive: true, force: true });
  const renamedIdentityRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-renamed-identity-"));
  const renamedChange = path.join(renamedIdentityRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(renamedIdentityRepo, "bin"), { recursive: true });
  fs.mkdirSync(renamedChange, { recursive: true });
  fs.writeFileSync(path.join(renamedIdentityRepo, "package.json"), JSON.stringify({ name: "steadyspec-custom" }), "utf8");
  fs.writeFileSync(path.join(renamedIdentityRepo, "bin", "cross-review.js"), "RENAMED_IMPL\n", "utf8");
  fs.writeFileSync(path.join(renamedChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Check renamed package identity.\n", "utf8");
  result = runCrossReview(root, renamedIdentityRepo, ["--change", "001-contract", "--mode", "review"]);
  if (result.status !== 0) fail("cross-review renamed package identity fixture failed");
  const renamedRun = latestRunDir(renamedChange);
  const renamedRunJson = readJson(path.join(renamedRun, "run.json"));
  const renamedPacket = readText(path.join(renamedRun, "packet.md"));
  if (!renamedRunJson.warnings.some((warning) => warning.includes("forked implementation evidence")) || !renamedPacket.includes("RENAMED_IMPL") || !renamedPacket.includes("Implementation Reference:")) {
    fail("cross-review renamed package identity must bundle implementation reference with a fork warning");
  }
  fs.rmSync(renamedIdentityRepo, { recursive: true, force: true });
  const unnamedIdentityRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-unnamed-identity-"));
  const unnamedChange = path.join(unnamedIdentityRepo, "docs", "changes", "001-contract");
  fs.mkdirSync(path.join(unnamedIdentityRepo, "bin"), { recursive: true });
  fs.mkdirSync(unnamedChange, { recursive: true });
  fs.writeFileSync(path.join(unnamedIdentityRepo, "package.json"), JSON.stringify({ version: "0.0.0-fixture" }), "utf8");
  fs.writeFileSync(path.join(unnamedIdentityRepo, "bin", "cross-review.js"), "UNNAMED_IMPL\n", "utf8");
  fs.writeFileSync(path.join(unnamedChange, "tasks.md"), "schemaVersion: 1\n\n# Tasks\n\n- [ ] Check unnamed package identity.\n", "utf8");
  result = runCrossReview(root, unnamedIdentityRepo, ["--change", "001-contract", "--mode", "review"]);
  if (result.status !== 0) fail("cross-review unnamed package identity fixture failed");
  const unnamedRun = latestRunDir(unnamedChange);
  const unnamedRunJson = readJson(path.join(unnamedRun, "run.json"));
  const unnamedPacket = readText(path.join(unnamedRun, "packet.md"));
  if (!unnamedRunJson.warnings.some((warning) => warning.includes("identity-unverified implementation evidence")) || !unnamedPacket.includes("UNNAMED_IMPL") || unnamedRunJson.warnings.some((warning) => warning.includes("forked implementation evidence"))) {
    fail("cross-review unnamed package identity must bundle implementation reference with an identity-unverified warning");
  }
  fs.rmSync(unnamedIdentityRepo, { recursive: true, force: true });
  for (const homeKey of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME"]) {
    if ((runJson.environment.keys || []).some((key) => key.toLowerCase() === homeKey.toLowerCase())) {
      fail(`cross-review scrubbed environment leaked ${homeKey}`);
    }
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--inherit-env"]);
  if (result.status === 0 || !result.stderr.includes("--dangerously-inherit-env")) {
    fail("cross-review --inherit-env compatibility guard changed");
  }
  const inheritEnvOutputDir = path.join(changeDir, "inherit-env-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--dangerously-inherit-env", "--run", "--output-dir", inheritEnvOutputDir], { env: fakeReviewerEnv });
  if (result.status !== 0) fail("cross-review dangerous inherit-env dry-run fixture failed");
  const inheritEnvRunDir = latestRunDirIn(inheritEnvOutputDir);
  const inheritEnvRunJsonFile = path.join(inheritEnvRunDir, "run.json");
  const inheritEnvRunJson = readJson(inheritEnvRunJsonFile);
  if (inheritEnvRunJson.environment.mode !== "inherit" || !inheritEnvRunJson.warnings.some((warning) => warning.includes("--dangerously-inherit-env was used"))) {
    fail("cross-review dangerous inherit-env warning contract changed");
  }
  inheritEnvRunJson.reviewerStatus = "success";
  inheritEnvRunJson.failureClass = "none";
  inheritEnvRunJson.outputFormat = "findings_table";
  fs.writeFileSync(inheritEnvRunJsonFile, JSON.stringify(inheritEnvRunJson, null, 2), "utf8");
  fs.writeFileSync(path.join(inheritEnvRunDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(inheritEnvRunDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--dangerously-inherit-env", "--output-dir", inheritEnvOutputDir, "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review dangerous inherit-env gated warning check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("blocking warnings")) || !json.warnings.some((warning) => warning.includes("--dangerously-inherit-env was used"))) {
    fail("cross-review dangerous inherit-env must not satisfy gated mode");
  }

  const packetOnlyOutputDir = path.join(changeDir, "packet-only-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--packet-only", "--output-dir", packetOnlyOutputDir]);
  if (result.status !== 0) fail("cross-review packet-only dry-run fixture failed");
  const packetOnlyRunDir = latestRunDirIn(packetOnlyOutputDir);
  const packetOnlyRunJson = readJson(path.join(packetOnlyRunDir, "run.json"));
  const packetOnlyPrompt = readText(path.join(packetOnlyRunDir, "prompt.md"));
  const packetOnlyPacket = readText(path.join(packetOnlyRunDir, "packet.md"));
  if (packetOnlyRunJson.packetOnly !== true
    || !packetOnlyPrompt.includes("## Inline Packet")
    || !packetOnlyPrompt.includes("Allowed context: this inline packet only")
    || packetOnlyPrompt.includes("Allowed context: the packet and files under")
    || packetOnlyPrompt.includes("Read the packet at:")) {
    fail("cross-review packet-only prompt contract changed");
  }
  if (!packetOnlyPacket.includes("Packet-only Reviewer: on.") || !packetOnlyPacket.includes("- This packet only.")) {
    fail("cross-review packet-only packet marker missing");
  }
  const externalOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-external-output-"));
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", externalOutputDir]);
  if (result.status !== 0) fail("cross-review external output-dir fixture failed");
  const externalOutputRunJson = readJson(path.join(latestRunDirIn(externalOutputDir), "run.json"));
  const externalOutputPrompt = readText(path.join(latestRunDirIn(externalOutputDir), "prompt.md"));
  if (!externalOutputRunJson.warnings.some((warning) => warning.includes("custom --output-dir is outside the repository"))) {
    fail("cross-review external output-dir warning contract changed");
  }
  if (!externalOutputPrompt.includes("Do not claim SHA-256 verification") || externalOutputPrompt.includes("verify their SHA-256 hashes against the manifest")) {
    fail("cross-review non-packet prompt must avoid uncomputable manifest hash claims");
  }
  fs.rmSync(externalOutputDir, { recursive: true, force: true });
  const oldClaudeBin = path.join(tmp, "old-claude-bin");
  fs.mkdirSync(oldClaudeBin, { recursive: true });
  fs.writeFileSync(path.join(oldClaudeBin, "fake-claude.js"), [
    "if (process.argv.includes('--version')) {",
    "  console.log('2.0.0 (Claude Code)');",
    "  process.exit(0);",
    "}",
    "console.log('| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |');",
    "console.log('|------------|----------|--------------|----------|-------------------|-------------|--------------------|');",
    "console.log('| F1 | P3 | Old version fixture | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |');",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(oldClaudeBin, "claude.cmd"), [
    "@echo off",
    "node \"%~dp0fake-claude.js\" %*",
    "",
  ].join("\r\n"), "utf8");
  const oldClaudeEnv = { Path: `${oldClaudeBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  const oldClaudeOutputDir = path.join(changeDir, "old-claude-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--packet-only", "--run", "--output-dir", oldClaudeOutputDir], { env: oldClaudeEnv });
  if (result.status !== 3) fail("cross-review packet-only old Claude version fixture should fail with unusable output");
  const oldVersionRunJson = readJson(path.join(latestRunDirIn(oldClaudeOutputDir), "run.json"));
  if (oldVersionRunJson.failureClass !== "reviewer_unsupported_version" || oldVersionRunJson.reviewerResult.errorCode !== "REVIEWER_VERSION_UNSUPPORTED") {
    fail("cross-review packet-only old Claude version refusal contract changed");
  }
  const oldClaudeNonPacketOutputDir = path.join(changeDir, "old-claude-non-packet-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--run", "--output-dir", oldClaudeNonPacketOutputDir], { env: oldClaudeEnv });
  if (result.status !== 3) fail("cross-review non-packet old Claude version fixture should fail with unusable output");
  const oldNonPacketRunJson = readJson(path.join(latestRunDirIn(oldClaudeNonPacketOutputDir), "run.json"));
  if (oldNonPacketRunJson.failureClass !== "reviewer_unsupported_version" || oldNonPacketRunJson.reviewerResult.errorCode !== "REVIEWER_VERSION_UNSUPPORTED") {
    fail("cross-review non-packet old Claude version refusal contract changed");
  }
  packetOnlyRunJson.reviewerStatus = "success";
  packetOnlyRunJson.failureClass = "none";
  packetOnlyRunJson.outputFormat = "findings_table";
  fs.writeFileSync(path.join(packetOnlyRunDir, "run.json"), JSON.stringify(packetOnlyRunJson, null, 2), "utf8");
  fs.writeFileSync(path.join(packetOnlyRunDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(packetOnlyRunDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", packetOnlyOutputDir, "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review packet-only scope mismatch check");
  if (result.status !== 3 || !json.errors.some((error) => error.includes("packetOnly true does not match requested false"))) {
    fail("cross-review packet-only scope mismatch contract changed");
  }

  runJson.reviewerStatus = "success";
  runJson.failureClass = "none";
  runJson.outputFormat = "numbered_findings";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: numbered_findings",
    "",
    "## STDOUT",
    "",
    "F1: Updated P2 migration scripts",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review raw-classifier check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("unstructured"))) {
    fail("cross-review raw classifier accepted a low-confidence numbered_findings fallback");
  }

  delete runJson.rawSchemaVersion;
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P2 | Header-only fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review raw marker fallback check");
  if (json.rawOutputFormat !== "findings_table" || !["pass", "pass-with-warning"].includes(json.status)) {
    fail("cross-review raw marker fallback contract changed");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    ...Array.from({ length: 20 }, (_, index) => `Reviewer prose line ${index + 1}`),
    "Output Format: findings_table",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P2 | Late legacy marker fixture | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review legacy raw header-only marker check");
  if (result.status !== 3 || !["empty", "unstructured"].includes(json.rawOutputFormat)) {
    fail("cross-review legacy raw Output Format fallback must be limited to the raw header");
  }

  runJson.rawSchemaVersion = 1;
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P2 | Versioned marker-missing fixture | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review versioned raw marker missing check");
  if (result.status !== 3 || json.rawOutputFormat !== "empty") {
    fail("cross-review versioned raw marker missing contract changed");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: numbered_findings",
    "",
    "## STDOUT",
    "",
    "F1: Severity: P2 Fixture numbered finding",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review numbered findings positive check");
  if (json.rawOutputFormat !== "numbered_findings" || !["pass", "pass-with-warning"].includes(json.status)) {
    fail("cross-review raw classifier rejected a numbered findings fixture");
  }

  runJson.outputFormat = "numbered_findings";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: numbered_findings",
    "",
    "## STDOUT",
    "",
    "### Finding F1 - Severity: **P1**",
    "",
    "Fixture heading-style finding.",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Fixture heading-style finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review heading severity findings check");
  if (json.rawOutputFormat !== "numbered_findings" || json.reviewerP12FindingRows !== 1 || !["pass", "pass-with-warning"].includes(json.status)) {
    fail("cross-review raw classifier rejected heading-style severity fixture");
  }

  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| **F1** | **P1** | Fixture emphasized finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review emphasized table findings positive check");
  if (json.rawOutputFormat !== "findings_table" || !["pass", "pass-with-warning"].includes(json.status)) {
    fail("cross-review raw classifier rejected an emphasized findings table fixture");
  }

  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Topic | Severity |",
    "|-------|----------|",
    "| Fixture methodology | P2 |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review loose table classifier check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("unstructured"))) {
    fail("cross-review raw classifier accepted a loose P2 table");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Ref | Priority |",
    "|-----|----------|",
    "| API-v2 | P2 |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review loose ref-priority table classifier check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("unstructured"))) {
    fail("cross-review raw classifier accepted a loose ref/priority table");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Claim / Risk | Evidence |",
    "|------------|--------------|----------|",
    "| Option | Fixture claim | Fixture evidence. |",
    "",
    "| Topic | Severity |",
    "|-------|----------|",
    "| Tuning | P2 |",
    "",
    "| Reference | Note |",
    "|-----------|------|",
    "| F1 | Fixture reference only. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review cross-table findings classifier check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("unstructured"))) {
    fail("cross-review raw classifier accepted cross-table findings fragments");
  }

  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "## Summary",
    "",
    "- No findings: confirmed",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review header-only table check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("unstructured"))) {
    fail("cross-review raw classifier accepted a header-only findings table");
  }

  runJson.outputFormat = "numbered_findings";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review raw-reclassification warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || !json.warnings.some((warning) => warning.includes("differs from raw reclassified output"))) {
    fail("cross-review raw reclassification warning contract changed");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "review", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review scope mismatch check");
  if (result.status !== 3 || json.status !== "failed" || !json.errors.some((error) => error.includes("does not match requested review scope"))) {
    fail("cross-review scope mismatch contract changed");
  }

  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "rejected");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated all-rejected check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("rejected every finding"))) {
    fail("cross-review --gate all-rejected moderation contract changed");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| **F1** | **P1** | Serious fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "| F2 | P3 | Trivial fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | rejected | Rejected with a sufficiently specific fixture reason for this contract path. | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated p12-rejected check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("no accepted or carried-forward P1/P2"))) {
    fail("cross-review --gate P1/P2 rejection contract changed");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | needs-user | Requires explicit user confirmation before readiness. | Ask user to confirm or revise. | user | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review needs-user latest check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || json.moderationP12NeedsUserRows !== 1 || json.reviewerP12NeedsUserRows !== 1 || !json.warnings.some((warning) => warning.includes("needs-user"))) {
    fail("cross-review needs-user latest warning contract changed");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated needs-user check");
  if (result.status !== 5 || json.status !== "needs-user" || json.action !== "user-confirmation-required" || !json.resolutionHint || !json.resolutionHint.includes("moderation") || !json.errors.some((error) => error.includes("user confirmation"))) {
    fail("cross-review --gate needs-user contract changed");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P3 | Serious fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated original-p12 downgrade check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("reviewer-original P1/P2"))) {
    fail("cross-review --gate reviewer-original P1/P2 contract changed");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Priority | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|----------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | High | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | Low | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review moderation header-column check");
  if (!["pass", "pass-with-warning"].includes(json.status) || json.moderationDecisionRows !== 2 || json.reviewerP12AcceptedOrCarriedRows !== 1) {
    fail("cross-review moderation parser must use header columns when available");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| F1 | P1 | Serious fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review moderation missing-header check");
  if (result.status !== 4 || json.status !== "failed" || json.moderationStatus !== "unreadable" || !json.moderationError.includes("header")) {
    fail("cross-review moderation missing-header contract changed");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | rejected | No. | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review weak rejected P1/P2 reason check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || !json.warnings.some((warning) => warning.includes("weak reasons")) || !json.moderationP12RejectedWeakReasonIds.includes("F1")) {
    fail("cross-review weak rejected P1/P2 moderation reason warning changed");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated weak rejected P1/P2 reason check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("weak reasons"))) {
    fail("cross-review --gate weak rejected P1/P2 moderation reason contract changed");
  }
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | rejected | Duplicate of F2 | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review cross-reference P1/P2 rejection reason check");
  if (json.moderationP12RejectedWeakReasonIds.includes("F1") || json.warnings.some((warning) => warning.includes("weak reasons"))) {
    fail("cross-review cross-reference P1/P2 rejection reason must not be weak");
  }
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Serious fixture finding | rejected | Per D99 | Keep contract stable. | agent | fixture |",
    "| F2 | P3 | Trivial fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review bare cross-reference weak reason check");
  if (result.status !== 1 || !json.moderationP12RejectedWeakReasonIds.includes("F1") || !json.warnings.some((warning) => warning.includes("weak reasons"))) {
    fail("cross-review bare cross-reference P1/P2 rejection reason must remain weak");
  }

  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | Omitted fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "| F2 | P3 | Moderated fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F2 | P3 | Moderated fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review missing moderation row warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || !json.warnings.some((warning) => warning.includes("missing decision rows")) || !json.moderationMissingFindingIds.includes("F1") || !json.moderationMissingP12FindingIds.includes("F1")) {
    fail("cross-review missing moderation row warning contract changed");
  }
  runJson.outputFormat = "numbered_findings";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: numbered_findings",
    "",
    "## STDOUT",
    "",
    "F1: Severity: P3 Fixture numbered finding",
    "",
    "| Option | Priority |",
    "|--------|----------|",
    "| API-V2 | P2 |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P3 | Fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review non-findings priority table check");
  if (![0, 1].includes(result.status) || !["pass", "pass-with-warning"].includes(json.status) || json.moderationMissingP12FindingIds.includes("API-V2")) {
    fail("cross-review reviewer severity extraction accepted a non-findings priority table");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated missing P1/P2 moderation row check");
  if (result.status !== 0 || json.status !== "satisfied") {
    fail("cross-review --gate should ignore non-findings priority table rows");
  }
  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| ID | Priority | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|----|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | Alias-header fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "| F2 | P3 | Moderated fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F2 | P3 | Moderated fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review alias findings table header check");
  if (result.status !== 1 || !json.moderationMissingP12FindingIds.includes("F1") || json.reviewerP12FindingRows !== 1) {
    fail("cross-review reviewer severity extraction must accept ID/Priority findings table aliases");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | First fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
    "| F2 | P2 | Blank-line fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | First fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review blank-line findings table check");
  if (result.status !== 1 || json.reviewerP12FindingRows !== 2 || !json.moderationMissingP12FindingIds.includes("F2")) {
    fail("cross-review reviewer severity extraction must preserve findings table columns across blank lines");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | First fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "Short explanatory prose between reviewer table rows.",
    "| F2 | P2 | Prose-interrupted fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | First fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review prose-interrupted findings table check");
  if (result.status !== 1 || json.reviewerP12FindingRows !== 2 || !json.moderationMissingP12FindingIds.includes("F2")) {
    fail("cross-review reviewer severity extraction must preserve findings table columns across short prose interruptions");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | Real fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
    "## Tradeoff Options",
    "",
    "| Ref | Priority | Notes |",
    "|-----|----------|-------|",
    "| API-v2 | P2 | Not a reviewer finding. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | Real fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review non-findings table isolation check");
  if (![0, 1].includes(result.status) || json.reviewerP12FindingRows !== 1 || json.moderationMissingP12FindingIds.length) {
    fail("cross-review reviewer severity extraction must not treat later non-findings tables as findings");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "## Critical Issues",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | First fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
    "## Should Address",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F2 | P2 | Second fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F1 | P1 | First fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review multiple canonical findings tables check");
  if (result.status !== 1 || json.reviewerP12FindingRows !== 2 || !json.moderationMissingP12FindingIds.includes("F2")) {
    fail("cross-review reviewer severity extraction must accumulate multiple canonical findings tables");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | Emphasized moderation fixture | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| **F1** | **P1** | Emphasized moderation fixture | **accepted** | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review emphasized moderation row check");
  if (![0, 1].includes(result.status) || json.moderationDecisionRows !== 1 || json.moderationMissingP12FindingIds.length) {
    fail("cross-review moderation parser must accept emphasized finding IDs and severities");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P1 | Omitted fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "| F2 | P3 | Moderated fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "| Finding ID | Severity | Claim / Risk | Moderator Decision | Reason | Action | Owner | Follow-up |",
    "|------------|----------|--------------|--------------------|--------|--------|-------|-----------|",
    "| F2 | P3 | Moderated fixture finding | accepted | Fixture moderation. | Keep contract stable. | agent | fixture |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated missing P1/P2 moderation row check");
  if (result.status !== 5 || json.status !== "needs-user" || json.action !== "user-confirmation-required" || !json.resolutionHint || !json.resolutionHint.includes("P1/P2") || !json.errors.some((error) => error.includes("omits P1/P2"))) {
    fail("cross-review --gate missing P1/P2 moderation row contract changed");
  }

  const includeDiffQualityDir = path.join(tmp, "cross-agent", "include-diff-quality-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--include-diff", "--output-dir", includeDiffQualityDir]);
  if (result.status !== 0) fail("cross-review include-diff quality dry-run fixture failed");
  const includeDiffRunDir = latestRunDirIn(includeDiffQualityDir);
  const includeDiffRunJsonFile = path.join(includeDiffRunDir, "run.json");
  const includeDiffRunJson = readJson(includeDiffRunJsonFile);
  if (includeDiffRunJson.diffCoherenceBasis !== "git-status-short-before-after") {
    fail("cross-review diff coherence basis contract changed");
  }
  includeDiffRunJson.reviewerStatus = "success";
  includeDiffRunJson.failureClass = "none";
  includeDiffRunJson.outputFormat = "findings_table";
  fs.writeFileSync(includeDiffRunJsonFile, JSON.stringify(includeDiffRunJson, null, 2), "utf8");
  fs.writeFileSync(path.join(includeDiffRunDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture include-diff finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(includeDiffRunDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--include-diff", "--output-dir", includeDiffQualityDir, "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review include-diff quality warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || json.diffAtomicity !== "multi-command-status-only" || !json.warnings.some((warning) => warning.includes("multi-command non-atomic capture"))) {
    fail("cross-review include-diff atomicity warning contract changed");
  }
  includeDiffRunJson.diffCoherent = false;
  includeDiffRunJson.gitStatusStable = false;
  includeDiffRunJson.diffCoherenceDrift = { added: ["?? temp-drift.txt"], removed: [" M old-drift.txt"], addedCount: 1, removedCount: 1 };
  fs.writeFileSync(includeDiffRunJsonFile, JSON.stringify(includeDiffRunJson, null, 2), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--include-diff", "--output-dir", includeDiffQualityDir, "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review diff coherent warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || json.diffCoherent !== false || json.gitStatusStable !== false || !json.diffCoherenceDrift || json.diffCoherenceDrift.addedCount !== 1 || !json.warnings.some((warning) => warning.includes("diff may be non-atomic"))) {
    fail("cross-review diffCoherent warning contract changed");
  }
  delete includeDiffRunJson.diffCoherent;
  delete includeDiffRunJson.gitStatusStable;
  delete includeDiffRunJson.diffCoherenceDrift;
  fs.writeFileSync(includeDiffRunJsonFile, JSON.stringify(includeDiffRunJson, null, 2), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--include-diff", "--output-dir", includeDiffQualityDir, "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review missing diffCoherent warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || json.diffCoherent !== false || !json.warnings.some((warning) => warning.includes("unknown coherence"))) {
    fail("cross-review missing diffCoherent warning contract changed");
  }
  includeDiffRunJson.diffCoherent = true;
  includeDiffRunJson.gitStatusStable = true;
  fs.writeFileSync(includeDiffRunJsonFile, JSON.stringify(includeDiffRunJson, null, 2), "utf8");

  runJson.outputFormat = "findings_table";
  fs.writeFileSync(runJsonFile, JSON.stringify(runJson, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | C:\\Users\\alice\\.claude | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(runDir, "accepted");
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
    "## Boundary Disclosure",
    "",
    "I will not access these denied paths:",
    "- C:\\Users\\alice\\.claude\\settings.json",
    "- cross-agent/prior-run",
    "",
    "## Independence Limit",
    "",
    "Fixture independence limit.",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review denied-context restatement check");
  if (![0, 1].includes(result.status) || !["pass", "pass-with-warning"].includes(json.status) || json.warnings.some((warning) => warning.includes("denied-context"))) {
    fail("cross-review denied-context restatement filter changed");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
    "## Boundary Disclosure",
    "",
    "The review environment exposed config under ~/.ssh/config during testing.",
    "",
    "## Independence Limit",
    "",
    "Fixture independence limit.",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review boundary-disclosure violation check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("denied-context warnings"))) {
    fail("cross-review boundary-disclosure violation must remain scannable");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | The .codex folder was outside scope for this review. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review denied-context scope-description check");
  if (![0, 1].includes(result.status) || !["pass", "pass-with-warning"].includes(json.status) || json.warnings.some((warning) => warning.includes("denied-context"))) {
    fail("cross-review denied-context scope-description filter changed");
  }
  fs.writeFileSync(path.join(runDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | C:\\Users\\alice\\AppData\\Roaming\\Claude\\settings.json | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated denied-context warning check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("denied-context warnings"))) {
    fail("cross-review --gate denied-context warning contract changed");
  }
  const unknownWarningDir = path.join(changeDir, "unknown-warning-tests");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--output-dir", unknownWarningDir]);
  if (result.status !== 0) fail("cross-review unknown-warning fixture dry-run failed");
  const unknownWarningRunDir = latestRunDirIn(unknownWarningDir);
  const unknownWarningRunJsonFile = path.join(unknownWarningRunDir, "run.json");
  const unknownWarningRunJson = readJson(unknownWarningRunJsonFile);
  unknownWarningRunJson.reviewerStatus = "success";
  unknownWarningRunJson.failureClass = "none";
  unknownWarningRunJson.outputFormat = "findings_table";
  unknownWarningRunJson.warnings = ["fixture unrecognized latest warning"];
  fs.writeFileSync(unknownWarningRunJsonFile, JSON.stringify(unknownWarningRunJson, null, 2), "utf8");
  fs.writeFileSync(path.join(unknownWarningRunDir, "raw.md"), [
    "# Raw claude Output",
    "Reviewer Status: success",
    "Reviewer Exit Code: 0",
    "Failure Class: none",
    "Output Format: findings_table",
    "",
    "## STDOUT",
    "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P3 | Fixture finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  writeFixtureModeration(unknownWarningRunDir, "accepted");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--output-dir", unknownWarningDir, "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated unrecognized warning check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("warnings without an explicit gate policy"))) {
    fail("cross-review --gate unrecognized warning contract changed");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--run-if-needed", "--json"]);
  json = parseJsonOutput(result, "cross-review run-if-needed warning check");
  if (result.status !== 1 || json.status !== "already-satisfied-with-warning" || json.action !== "warn") {
    fail("cross-review --run-if-needed warning contract changed");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--run-if-needed", "--force", "--json"], { env: fakeReviewerEnv });
  json = parseJsonOutput(result, "cross-review run-if-needed force check");
  if (result.status !== 0 || json.status !== "ran-reviewer-moderation-required" || json.action !== "run" || json.force !== true) {
    fail("cross-review --run-if-needed --force contract changed");
  }
  runDir = latestRunDir(changeDir);
  runJsonFile = path.join(runDir, "run.json");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated moderation-required action check");
  if (result.status !== 5 || json.status !== "blocked" || json.action !== "moderation-required" || !json.latest || json.latest.exitCode !== 4) {
    fail("cross-review --gate moderation-required action changed");
  }

  fs.writeFileSync(path.join(runDir, "moderation.md"), [
    "schemaVersion: 1",
    "status: complete",
    "",
    "## Summary",
    "",
    "- No findings: confirmed",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review zero-finding moderation check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || json.moderationDecisionRows !== 0 || !json.moderationNoFindingsConflict || !json.warnings.some((warning) => warning.includes("raw reviewer output contains structured findings"))) {
    fail("cross-review zero-finding moderation contract changed");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated no-findings conflict check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("moderation says no findings"))) {
    fail("cross-review --gate no-findings conflict contract changed");
  }

  const corruptRunDir = path.join(changeDir, "cross-agent", "99999999T999999999Z-corrupt-review");
  fs.mkdirSync(corruptRunDir, { recursive: true });
  fs.writeFileSync(path.join(corruptRunDir, "run.json"), "{ invalid json", "utf8");
  const orphanDir = path.join(changeDir, "cross-agent", "99999999T000000000Z-orphan-review");
  fs.mkdirSync(orphanDir, { recursive: true });
  fs.writeFileSync(path.join(orphanDir, "stdout.partial.txt"), [
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P2 | Fixture orphan finding | Fixture evidence. | Fixture scenario. | Fixture alternative. | Fixture action. |",
    "",
  ].join("\n"), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review orphan-run warning check");
  if (result.status !== 1 || json.status !== "pass-with-warning" || !json.warnings.some((warning) => warning.includes("orphan run directories") && warning.includes("findings_table")) || !json.warnings.some((warning) => warning.includes("unreadable run.json directories"))) {
    fail("cross-review orphan run warning contract changed");
  }

  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--skip-reason", "fixture skip"]);
  if (result.status !== 0) fail("cross-review skip fixture failed");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--reviewer", "claude", "--mode", "design", "--check-latest", "--json"]);
  json = parseJsonOutput(result, "cross-review skipped latest check");
  if (result.status !== 2 || json.status !== "skipped" || !json.errors.some((error) => error.includes("fixture skip"))) {
    fail("cross-review skipped latest contract changed");
  }

  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "off", reviewer: "claude" }), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--advice", "--verbose", "--json"]);
  json = parseJsonOutput(result, "cross-review off verbose advice check");
  if (result.status !== 0 || json.status !== "off" || json.recommended !== false || !Array.isArray(json.signalDetails) || json.signalDetails.length === 0 || !Array.isArray(json.observedReasons) || typeof json.signalCount !== "number" || typeof json.wouldRecommend !== "boolean") {
    fail("cross-review off-mode verbose advice must report observed signal details without recommending");
  }
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--run-if-needed", "--json"]);
  json = parseJsonOutput(result, "cross-review run-if-needed off check");
  if (result.status !== 0 || json.status !== "off" || json.action !== "none") {
    fail("cross-review --run-if-needed off contract changed");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
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
    if (IGNORED_ROOT_DEV_DIRS.has(entry.name)) continue;
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
  checkV05ReleaseSurface(root, manifest, pkg);
  checkV05CrossReview(root);
  checkCrossReviewContracts(root);

  warn("Cross-review JSON contracts are valid with fixture coverage only; real reviewer invocation and POSIX behavior are not validated by npm run validate.");
  console.log("Package is structurally valid (cross-review coverage: fixture-contracts only; no real reviewer or POSIX validation).");
}

main();
