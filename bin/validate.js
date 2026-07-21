#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const crypto = require("crypto");
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
  ".gitattributes",
  "LICENSE",
]);
const ALLOWED_ROOT_DIRS = new Set([".github", "bin", "design", "docs", "en", "protocol", "release-evidence", "scripts", "tests", "zh", "recipes", "schemas"]);
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
  ".gitattributes",
  "LICENSE",
];

const CJK_REGEX = /[一-鿿　-〿＀-￯]/;

let activeSuite = null;
let activeSuiteStartedAt = 0;

function githubAnnotationData(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

function fail(message) {
  const detail = String(message);
  if (activeSuite) {
    console.error(`[validate] FAIL suite=${activeSuite} duration_ms=${Date.now() - activeSuiteStartedAt} error=${detail.replace(/\s+/g, " ").trim()}`);
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    const title = activeSuite ? `SteadySpec ${activeSuite} validation` : "SteadySpec validation";
    console.error(`::error title=${title}::${githubAnnotationData(detail.slice(0, 8000))}`);
  }
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function validationProgress(detail) {
  console.log(`[validate] PROGRESS suite=${activeSuite || "startup"} detail=${detail}`);
}

async function runValidationSuite(name, action) {
  activeSuite = name;
  activeSuiteStartedAt = Date.now();
  console.log(`[validate] START suite=${name}`);
  try {
    await action();
  } catch (error) {
    fail(error && error.stack ? error.stack : error);
  }
  console.log(`[validate] PASS suite=${name} duration_ms=${Date.now() - activeSuiteStartedAt}`);
  activeSuite = null;
  activeSuiteStartedAt = 0;
}

function parseValidationArgs(argv) {
  const result = { root: path.join(__dirname, ".."), suite: "all" };
  let rootSeen = false;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--suite") {
      const value = argv[index + 1];
      if (!value) fail("--suite requires all, assurance, contract, cross-review, closure, install, or portability");
      result.suite = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      fail(`unknown validation option: ${arg}`);
    } else if (!rootSeen) {
      result.root = arg;
      rootSeen = true;
    } else {
      fail(`unexpected validation argument: ${arg}`);
    }
  }
  const allowed = new Set(["all", "assurance", "contract", "cross-review", "closure", "install", "portability"]);
  if (!allowed.has(result.suite)) fail(`unknown validation suite: ${result.suite}`);
  result.root = path.resolve(result.root);
  return result;
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

function normalizeTransportEol(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

function requirePureBlockEquivalent(left, right, label) {
  if (normalizeTransportEol(left) !== normalizeTransportEol(right)) {
    fail(`${label} must be content-equivalent after transport EOL normalization`);
  }
}

function checkTransportEolEquivalenceContract() {
  const lf = "alpha\nbeta\ngamma";
  requirePureBlockEquivalent(lf, lf.replace(/\n/g, "\r\n"), "transport EOL fixture");
  if (normalizeTransportEol(lf) === normalizeTransportEol("alpha\nbeta\ndelta")) {
    fail("transport EOL normalization masked a non-EOL content mutation");
  }
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
    fail(`${file} missing release surface: ${label}`);
  }
}

function requirePattern(root, file, pattern, label) {
  const content = readText(path.join(root, file));
  if (!pattern.test(content)) {
    fail(`${file} missing release surface: ${label}`);
  }
}

function checkReleaseSurface(root, manifest, pkg) {
  if (pkg.version !== "0.7.0" || manifest.version !== "0.7.0") {
    fail("v0.7.0 candidate surface requires package.json and manifest.json version 0.7.0");
  }

  requireText(root, "CHANGELOG.md", "## 0.7.0 (experimental assurance protocol candidate)");
  requireText(root, "CHANGELOG.md", "## 0.6.1 (source-only reliability correction)");
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

function checkSourceDistributionDocs(root, pkg) {
  if (pkg.private !== true) fail("source-only distribution must prevent npm publication with private=true");
  const docs = ["README.md", "QUICKSTART.md", "en/README.md", "zh/README.md", "zh/QUICKSTART.md"];
  for (const relative of docs) {
    const text = readText(path.join(root, relative));
    if (/^\s*npm\s+(?:install|i)\s+(?:--global|-g)\s+steadyspec\s*$/im.test(text)) fail(`${relative} still exposes an unsupported npm-registry install command`);
    if (/^\s*npx\s+steadyspec\b/im.test(text)) fail(`${relative} still exposes unsupported npx installation`);
    if (/DRAFT:\s*do not script this as stable API/i.test(text)) fail(`${relative} still contains a stale pre-v0.5 DRAFT marker`);
  }
  for (const [relative, anchors] of Object.entries({
    "README.md": ["published to the npm registry", "npm pack", "trusted-tag-or-commit", "git remote get-url origin", "git rev-parse HEAD", "cross-review-hook.js"],
    "QUICKSTART.md": ["## Source-only install", "Agent-assisted installation contract", "npm pack", "git remote get-url origin", "git rev-parse HEAD", "--include-v06-projection", ".claude\\workflows"],
    "en/README.md": ["source-distributed", "published to the npm registry"],
    "zh/README.md": ["没有发布到 npm registry", "npm pack", "git remote get-url origin", "git rev-parse HEAD", "cross-review-hook.js"],
    "zh/QUICKSTART.md": ["没有发布到 npm registry", "commit SHA", "npm pack", "git remote get-url origin", "git rev-parse HEAD", "--include-v06-projection", "## Cross-agent 审查通道（v0.5）", ".claude\\workflows"],
  })) {
    const text = readText(path.join(root, relative));
    for (const anchor of anchors) if (!text.includes(anchor)) fail(`${relative} missing source-distribution anchor: ${anchor}`);
  }
  const evidenceManifest = readJson(path.join(root, "release-evidence", "v0.6.1", "manifest.json"));
  if (evidenceManifest.version !== "0.6.1" || evidenceManifest.distribution && evidenceManifest.distribution.npmRegistryPublished !== false) {
    fail("historical v0.6.1 release evidence must preserve its version and no-registry boundary");
  }
  if (evidenceManifest.captureState !== "pre-release-candidate" || evidenceManifest.distribution && evidenceManifest.distribution.remoteReleaseState !== "external-to-capture") {
    fail("v0.6.1 release evidence must be a timeless pre-release capture whose remote release state stays external");
  }
  if (!evidenceManifest.capture || evidenceManifest.capture.sourceIdentity !== "uncommitted-working-tree" || evidenceManifest.capture.remoteResultsIncluded !== false) {
    fail("v0.6.1 pre-release evidence must disclose its uncommitted local identity and exclude unobserved remote results");
  }
  requireText(root, "release-evidence/v0.6.1/README.md", "Evidence capture: **pre-release candidate**.");
  const currentEvidenceManifest = readJson(path.join(root, "release-evidence", "v0.7.0", "manifest.json"));
  if (currentEvidenceManifest.version !== "0.7.0" || currentEvidenceManifest.protocolVersion !== "0.7") {
    fail("current v0.7.0 release evidence must bind the package and protocol candidate versions");
  }
  if (currentEvidenceManifest.captureState !== "pre-release-candidate" || currentEvidenceManifest.capture?.sourceIdentity !== "uncommitted-working-tree" || currentEvidenceManifest.capture?.remoteResultsIncluded !== false) {
    fail("v0.7.0 evidence must disclose a local uncommitted candidate and exclude unobserved remote results");
  }
  if (currentEvidenceManifest.distribution?.npmRegistryPublished !== false || currentEvidenceManifest.distribution?.npmPublicationBlocked !== true || currentEvidenceManifest.distribution?.remoteReleaseState !== "external-to-capture") {
    fail("v0.7.0 evidence must preserve source-only distribution and external release authority");
  }
  if (currentEvidenceManifest.authorityAtCapture?.humanAccepted !== false || currentEvidenceManifest.authorityAtCapture?.tagAuthorized !== false || currentEvidenceManifest.authorityAtCapture?.githubReleaseAuthorized !== false || currentEvidenceManifest.authorityAtCapture?.npmPublishAuthorized !== false) {
    fail("v0.7.0 evidence must not fabricate human acceptance or publication authority");
  }
  if (currentEvidenceManifest.evidence?.assuranceConformance !== "pass-local-53-total-51-core") fail("v0.7.0 evidence must report the current core/extension conformance split");
  requireText(root, "release-evidence/v0.7.0/README.md", "Evidence capture: **pre-release candidate**.");
  requireText(root, "release-evidence/v0.7.0/README.md", "No comparative effectiveness result exists");
  requireText(root, "SCOPE.md", "## v0.6 closure product boundary");
  const ci = readText(path.join(root, ".github", "workflows", "ci.yml"));
  for (const anchor of ["windows-latest", "ubuntu-latest", "node: [18, 22, 24]", "windows-autocrlf-v060-upgrade", "fetch-depth: 0", "25cc20eb3f8a77d6972ce04b949533c1925a81d6", "validate:assurance", "validate:portability", "validate:install", "core.autocrlf=true", "permissions:", "contents: read"]) {
    if (!ci.includes(anchor)) fail(`source CI missing required boundary: ${anchor}`);
  }
  const upgradeJobMatch = ci.match(/(?:^|\n)  windows-autocrlf-v060-upgrade:\r?\n([\s\S]*?)(?=\n  [A-Za-z0-9_-]+:\r?\n|$)/);
  if (!upgradeJobMatch) fail("source CI missing the v0.6.0 worktree-upgrade job block");
  for (const anchor of [
    "fetch-depth: 0",
    "git config core.autocrlf true",
    "git checkout --detach 25cc20eb3f8a77d6972ce04b949533c1925a81d6",
    "npm run validate:contract",
    "npm run validate:assurance",
    "npm run validate:cross-review",
    "npm run validate:closure",
    "git status --porcelain",
  ]) {
    if (!upgradeJobMatch[1].includes(anchor)) fail(`v0.6.0 worktree-upgrade CI job missing required step: ${anchor}`);
  }
  if (/npm\s+publish/i.test(ci) || /ANTHROPIC|OPENAI_API_KEY/.test(ci)) fail("source CI must not publish npm or load reviewer credentials");

  checkLocalMarkdownLinks(root, [
    "README.md",
    "QUICKSTART.md",
    "SCOPE.md",
    "EVIDENCE.md",
    "en/README.md",
    "zh/README.md",
    "zh/QUICKSTART.md",
    "zh/SCOPE.md",
    "zh/EVIDENCE.md",
    "release-evidence/v0.6.1/README.md",
    "release-evidence/v0.7.0/README.md",
  ]);
}

function checkLocalMarkdownLinks(root, relatives) {
  for (const relative of relatives) {
    const source = path.join(root, relative);
    const text = readText(source);
    const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = pattern.exec(text))) {
      let target = match[1].trim();
      if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(target)) continue;
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      target = target.split("#", 1)[0].split("?", 1)[0];
      if (!target) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(target);
      } catch (error) {
        fail(`${relative} contains an invalid encoded local link: ${target}`);
      }
      const resolved = path.resolve(path.dirname(source), decoded);
      const repositoryRelative = path.relative(root, resolved);
      if (repositoryRelative.startsWith("..") || path.isAbsolute(repositoryRelative)) {
        fail(`${relative} local link escapes the repository: ${target}`);
      }
      if (!fs.existsSync(resolved)) fail(`${relative} contains a broken local link: ${target}`);
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
  const managedStopHook = installedClaude.hooks.Stop
    .flatMap((entry) => entry.hooks)
    .find((hook) => typeof hook.command === "string" && hook.command.includes("steadyspec-cross-agent-hook-v1"));
  if (!managedStopHook) fail("steadyspec hook adapter install fixture did not create the managed Stop hook");
  installedClaude.hooks.Stop = [
    {
      matcher: "mixed-entry-fixture",
      fixtureMetadata: { owner: "third-party" },
      hooks: [
        { type: "command", command: "third-party hook", timeout: 3 },
        managedStopHook,
      ],
    },
    {
      matcher: "sibling-entry-fixture",
      fixtureMetadata: { owner: "sibling" },
      hooks: [{ type: "command", command: "sibling hook", timeout: 4 }],
    },
  ];
  fs.writeFileSync(path.join(hookHome, ".claude", "settings.json"), JSON.stringify(installedClaude, null, 2), "utf8");
  hookResult = spawnSync(process.execPath, [path.join(root, "bin", "cross-review-hook.js"), "install", "--target", "claude", "--json"], {
    cwd: hookRepo, env: { ...process.env, STEADYSPEC_HOME: hookHome, CODEX_HOME: path.join(hookHome, ".codex") }, encoding: "utf8", timeout: 30000,
  });
  const reinstalledMixedClaude = readJson(path.join(hookHome, ".claude", "settings.json"));
  const mixedStopEntries = reinstalledMixedClaude.hooks.Stop.filter((entry) => entry.matcher === "mixed-entry-fixture");
  const mixedThirdPartyCount = mixedStopEntries.flatMap((entry) => entry.hooks).filter((hook) => hook.command === "third-party hook").length;
  const managedStopCount = reinstalledMixedClaude.hooks.Stop.flatMap((entry) => entry.hooks).filter((hook) => typeof hook.command === "string" && hook.command.includes("steadyspec-cross-agent-hook-v1")).length;
  if (hookResult.status !== 0 || mixedStopEntries.length !== 1 || mixedThirdPartyCount !== 1 || managedStopCount !== 1 || mixedStopEntries[0].fixtureMetadata?.owner !== "third-party") {
    fail("steadyspec hook adapter reinstall must preserve non-managed hooks and metadata inside a mixed entry without duplicating the managed hook");
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
  const uninstalledMixedEntries = uninstalledClaude.hooks.Stop.filter((entry) => entry.matcher === "mixed-entry-fixture");
  const uninstalledSiblingEntries = uninstalledClaude.hooks.Stop.filter((entry) => entry.matcher === "sibling-entry-fixture");
  const uninstalledThirdPartyCount = uninstalledClaude.hooks.Stop.flatMap((entry) => entry.hooks).filter((hook) => hook.command === "third-party hook").length;
  const uninstalledSiblingCount = uninstalledClaude.hooks.Stop.flatMap((entry) => entry.hooks).filter((hook) => hook.command === "sibling hook").length;
  const uninstalledManagedCount = uninstalledClaude.hooks.Stop.flatMap((entry) => entry.hooks).filter((hook) => typeof hook.command === "string" && hook.command.includes("steadyspec-cross-agent-hook-v1")).length;
  if (hookResult.status !== 0
      || uninstalledClaude.theme !== "dark"
      || uninstalledMixedEntries.length !== 1
      || uninstalledMixedEntries[0].fixtureMetadata?.owner !== "third-party"
      || uninstalledThirdPartyCount !== 1
      || uninstalledSiblingEntries.length !== 1
      || uninstalledSiblingEntries[0].fixtureMetadata?.owner !== "sibling"
      || uninstalledSiblingCount !== 1
      || uninstalledManagedCount !== 0) {
    fail("steadyspec hook adapter uninstall must remove only managed hooks while preserving mixed-entry and sibling-entry hooks and metadata exactly once");
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
  const portableArgs = process.platform !== "win32"
    && (args.includes("--run") || args.includes("--run-if-needed"))
    && !args.includes("--experimental-posix")
    ? [...args, "--experimental-posix"]
    : args;
  const env = { ...process.env, ...(options.env || {}) };
  if (process.platform !== "win32" && options.env && options.env.Path && !Object.prototype.hasOwnProperty.call(options.env, "PATH")) {
    env.PATH = options.env.Path;
  }
  return spawnSync(process.execPath, [path.join(root, "bin", "cross-review.js"), "--repo", repo, ...portableArgs], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 30000,
  });
}

function writeFixtureReviewerShim(dir, scriptName, windowsExtension = "cmd") {
  fs.writeFileSync(path.join(dir, `claude.${windowsExtension}`), [
    "@echo off",
    `node "%~dp0${scriptName}" %*`,
    "",
  ].join("\r\n"), "utf8");
  const posixShim = path.join(dir, "claude");
  fs.writeFileSync(posixShim, [
    "#!/bin/sh",
    `exec node "$(dirname "$0")/${scriptName}" "$@"`,
    "",
  ].join("\n"), "utf8");
  fs.chmodSync(posixShim, 0o755);
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
  writeFixtureReviewerShim(fakeBin, "fake-claude.js");
  const fakeReviewerEnv = { Path: `${fakeBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}` };
  if (process.platform !== "win32") {
    const missingPosixOptIn = spawnSync(process.execPath, [
      path.join(root, "bin", "cross-review.js"),
      "--repo", tmp,
      "--change", "001-contract",
      "--reviewer", "claude",
      "--mode", "design",
      "--run",
    ], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || process.env.Path || ""}` },
      timeout: 30000,
    });
    if (missingPosixOptIn.status === 0 || !missingPosixOptIn.stderr.includes("pass --experimental-posix")) {
      fail("cross-review POSIX reviewer execution must fail closed without explicit --experimental-posix opt-in");
    }
  }
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
  writeFixtureReviewerShim(timeoutBin, "fake-claude-timeout.js");
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
  writeFixtureReviewerShim(outputLimitBin, "fake-claude-large-output.js", "bat");
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
  writeFixtureReviewerShim(utf8LimitBin, "fake-claude-utf8-output.js");
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
  writeFixtureReviewerShim(unstructuredBin, "fake-claude-unstructured.js");
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
  writeFixtureReviewerShim(oldClaudeBin, "fake-claude.js");
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
  unknownWarningRunJson.warnings = ["review scope may be non-atomic: working tree changed during diff capture across branch/staged/unstaged/untracked sections"];
  fs.writeFileSync(unknownWarningRunJsonFile, JSON.stringify(unknownWarningRunJson, null, 2), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--output-dir", unknownWarningDir, "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated exact diff-scope warning policy check");
  if (result.status !== 0 || json.status !== "satisfied-with-warning" || !json.warnings.some((warning) => warning.startsWith("review scope may be non-atomic"))) {
    fail("cross-review --gate must recognize the exact emitted diff-scope warning as an explicit passable debt while unknown warnings remain blocking");
  }
  unknownWarningRunJson.warnings = ["review scope may be non-atomic: working tree changed during diff capture across branch/staged/unstaged/untracked sections; credential exposure unknown"];
  fs.writeFileSync(unknownWarningRunJsonFile, JSON.stringify(unknownWarningRunJson, null, 2), "utf8");
  result = runCrossReview(root, tmp, ["--change", "001-contract", "--mode", "design", "--output-dir", unknownWarningDir, "--gate", "--json"]);
  json = parseJsonOutput(result, "cross-review gated diff-scope near-match warning check");
  if (result.status !== 5 || json.status !== "blocked" || !json.errors.some((error) => error.includes("warnings without an explicit gate policy"))) {
    fail("cross-review --gate must fail closed when an exact passable warning prefix carries an unknown suffix");
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

function checkV06ClosureContracts(root) {
  const required = [
    "bin/closure.js",
    "bin/closure-fixtures.js",
    "en/runtime/closure-env.js",
    "schemas/closure-state-v1.schema.json",
    "schemas/acceptance-profile-v1.schema.json",
    "schemas/closure-config-v1.schema.json",
  ];
  for (const relative of required) if (!fs.existsSync(path.join(root, relative))) fail(`v0.6 closure file missing: ${relative}`);
  for (const relative of required.filter((name) => name.endsWith(".json"))) {
    const schema = readJson(path.join(root, relative));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail(`${relative} must declare JSON Schema draft 2020-12`);
  }
  const publicSurfaces = {
    "README.md": ["## v0.6 Attention-Preserving Closure", "--evaluator-start", "evaluator-running", "not human acceptance"],
    "QUICKSTART.md": ["## Optional v0.6 closure under verify", "--evaluator-start", "evaluator-running", "expectedRunDir", "--decide reopen"],
    "ARTIFACT_CONTRACT.md": ["## v0.6 Closure Lane Artifact Contract", "reset-in-progress.json", "evaluator-invocation.json", "human-decision-<decision-id>.json", "not merge or release authority"],
    "zh/README.md": ["## v0.6 注意力保护型闭环", "--evaluator-start", "evaluator-running", "不是人的接受、合并或发布授权"],
    "zh/QUICKSTART.md": ["## 可选的 v0.6 verify 闭环", "--evaluator-start", "evaluator-running", "--decide approve", "--decide reopen"],
  };
  for (const [relative, anchors] of Object.entries(publicSurfaces)) {
    const text = readText(path.join(root, relative));
    for (const anchor of anchors) if (!text.includes(anchor)) fail(`${relative} missing v0.6 public closure surface: ${anchor}`);
  }
  const initText = readText(path.join(root, "bin/init.js"));
  for (const expected of ["--closure", "closure.js", "writeClosureState", "wallClockMs", "proofPolicies"]) {
    if (!initText.includes(expected)) fail(`bin/init.js missing v0.6 closure surface: ${expected}`);
  }
  const runnerText = readText(path.join(root, "bin/cross-review.js"));
  for (const expected of ["evaluate", "evaluator_json", "candidateFingerprint", "evidenceBundleFingerprint", "targetBaselineFingerprint", "--target-baseline-fingerprint", "parseEvaluatorOutput", "buildScrubbedEnv"]) {
    if (!runnerText.includes(expected)) fail(`bin/cross-review.js missing v0.6 evaluate surface: ${expected}`);
  }
  validationProgress("closure-synthetic-fixtures");
  const result = spawnSync(process.execPath, [path.join(root, "bin/closure-fixtures.js")], { cwd: root, encoding: "utf8", timeout: 120000, windowsHide: true });
  if (result.status !== 0) fail(`v0.6 closure fixtures failed: ${(result.stderr || result.stdout || "unknown failure").trim()}`);
  if (!/synthetic full-cycle fixture/i.test(result.stdout || "")) fail("v0.6 closure fixture coverage boundary output changed");
  if (process.platform === "win32") {
    validationProgress("closure-windows-real-interruption-smoke");
    const real = spawnSync(process.execPath, [path.join(root, "bin/closure-fixtures.js"), "--windows-real-smoke", "--json"], { cwd: root, encoding: "utf8", timeout: 120000, windowsHide: true });
    if (real.status !== 0) fail(`v0.6 Windows real interruption smoke failed: ${(real.stderr || real.stdout || "unknown failure").trim()}`);
    let observation;
    try { observation = JSON.parse(real.stdout); } catch (error) { fail(`v0.6 Windows real interruption smoke returned invalid JSON: ${error.message}`); }
    if (observation.status !== "passed"
      || !observation.observed
      || observation.observed.proofProcessDeath.taskkillTreeSucceeded !== true
      || observation.observed.proofProcessDeath.uncertainMarkerPreserved !== true
      || observation.observed.proofProcessDeath.automaticReplay !== false
      || observation.observed.resetRenameContention.sharingViolationObserved !== true
      || observation.observed.resetRenameContention.contentionPoint !== "journaled-staging-preservation-rename"
      || observation.observed.resetRenameContention.resetIdPreserved !== true
      || !(observation.observed.resetRenameContention.archiveFilesVerified > 0)
      || observation.observed.evaluatorTransportDeath.reopen.taskkillTreeSucceeded !== true
      || observation.observed.evaluatorTransportDeath.reopen.duplicateStartRejected !== true
      || observation.observed.evaluatorTransportDeath.reopen.completionInferred !== false
      || observation.observed.evaluatorTransportDeath.reopen.decisionBoundToInvocation !== true
      || observation.observed.evaluatorTransportDeath.reopen.terminalState !== "critic-required"
      || observation.observed.evaluatorTransportDeath.abandon.taskkillTreeSucceeded !== true
      || observation.observed.evaluatorTransportDeath.abandon.duplicateStartRejected !== true
      || observation.observed.evaluatorTransportDeath.abandon.completionInferred !== false
      || observation.observed.evaluatorTransportDeath.abandon.decisionBoundToInvocation !== true
      || observation.observed.evaluatorTransportDeath.abandon.terminalState !== "abandoned") {
      fail("v0.6 Windows real interruption observation contract changed");
    }
  } else {
    warn("v0.6 Windows real interruption smoke skipped on this platform; no POSIX or cross-platform readiness is inferred.");
  }

  const lifecycleSurfaces = {
    "en/flows/steadyspec-verify-flow/SKILL.md": ["steadyspec closure --change", "candidate-ready", "not acceptance"],
    "en/flows/steadyspec-archive-flow/SKILL.md": ["Gate 0: optional v0.6 closure pre-gate", "closure: not opted in", "STOP before writing or moving archive", "not acceptance"],
    "en/runtime/codex/agents/steadyspec-verify-flow.yaml": ["closure --change", "blocks an archive recommendation", "never acceptance"],
    "en/runtime/codex/agents/steadyspec-archive-flow.yaml": ["closure --change", "stop before writing or moving archive truth", "never human acceptance"],
    "en/runtime/claude/workflows/steadyspec-verify.js": ["closure-status", "bounded readiness only"],
    "en/runtime/claude/workflows/steadyspec-archive.js": ["closure-archive-gate", "not acceptance or release authority"],
  };
  for (const [relative, anchors] of Object.entries(lifecycleSurfaces)) {
    const text = readText(path.join(root, relative));
    for (const anchor of anchors) if (!text.includes(anchor)) fail(`${relative} missing v0.6 closure lifecycle surface: ${anchor}`);
  }

  const installRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-v06-codex-install-"));
  try {
    const install = spawnSync(process.execPath, [
      path.join(root, "bin", "init.js"),
      "--runtime", "codex",
      "--substrate", "docs",
      "--closure", "manual",
      "--force",
    ], { cwd: installRepo, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (install.status !== 0) fail(`v0.6 Codex lifecycle install fixture failed: ${install.stderr || install.stdout}`);
    const installedConfig = readJson(path.join(installRepo, ".steadyspec", "closure.json"));
    if (installedConfig.mode !== "manual" || !/not human acceptance/i.test(installedConfig.boundary || "")) fail("installed v0.6 closure config must preserve manual mode and human authority");
    const installedSurfaces = {
      ".codex/skills/steadyspec-verify-flow/agents/openai.yaml": ["closure --change", "never acceptance"],
      ".codex/skills/steadyspec-archive-flow/SKILL.md": ["Gate 0: optional v0.6 closure pre-gate", "STOP before writing or moving archive"],
      ".codex/skills/steadyspec-archive-flow/agents/openai.yaml": ["stop before writing or moving archive truth", "never human acceptance"],
    };
    for (const [relative, anchors] of Object.entries(installedSurfaces)) {
      const text = readText(path.join(installRepo, relative));
      for (const anchor of anchors) if (!text.includes(anchor)) fail(`installed ${relative} missing v0.6 closure lifecycle surface: ${anchor}`);
    }
  } finally {
    fs.rmSync(installRepo, { recursive: true, force: true });
  }
}

function checkActiveProductIdentity(root, pkg) {
  if (pkg.version !== "0.7.0") fail("active product identity check requires package version 0.7.0");
  const contracts = {
    "README.md": {
      current: "v0.7.0 remains pre-1.0.",
      stale: ["v0.4-alpha is alpha."],
      historical: "## v0.4 Docs Contract And Capability Lane",
    },
    "SCOPE.md": {
      current: "## v0.7 assurance protocol boundary",
      stale: ["the v0.4-alpha release defines", "Primary optimization target for v0.4-alpha", "SteadySpec v0.4-alpha is designed", "SteadySpec v0.4-alpha is not the right fit"],
      historical: "## v0.4 capability lane boundary",
    },
    "zh/README.md": {
      current: "v0.7.0 仍处于 1.0 之前。",
      stale: ["v0.4-alpha 是 alpha。"],
      historical: "## v0.4 文档合同与能力通道",
    },
    "zh/SCOPE.md": {
      current: "## v0.7 assurance protocol 边界",
      stale: ["v0.4-alpha 明确了具体的边界", "v0.4-alpha 主要优化目标", "SteadySpec v0.4-alpha 是为", "SteadySpec v0.4-alpha 就不是正确选择"],
      historical: "## v0.4 能力通道边界",
    },
  };
  for (const [relative, contract] of Object.entries(contracts)) {
    const text = readText(path.join(root, relative));
    if (!text.includes(contract.current)) fail(`${relative} must identify the active product boundary with its exact v0.7.0 anchor`);
    for (const stale of contract.stale) if (text.includes(stale)) fail(`${relative} still contains stale active identity: ${stale}`);
    if (!text.includes(contract.historical)) fail(`${relative} must preserve its legitimate v0.4 historical capability anchor`);
  }
}

function evidenceEntryFixture(overrides = {}) {
  return {
    sliceIndex: "2",
    behavior: "resumed behavior",
    proofCommand: "npm test -- resumed",
    result: "pass",
    outputSummary: "resumed proof passed",
    coverageLimit: "fixture only",
    linkedDecisionIds: "D2",
    fallback: "None",
    acceptedDebt: "None",
    ...overrides,
  };
}

function checkCrossReviewWorkflowPreflight(root) {
  const begin = "// BEGIN CROSS REVIEW PREFLIGHT PURE";
  const end = "// END CROSS REVIEW PREFLIGHT PURE";
  const verifyPath = path.join(root, "en/runtime/claude/workflows/steadyspec-verify.js");
  const archivePath = path.join(root, "en/runtime/claude/workflows/steadyspec-archive.js");
  const verifyText = readText(verifyPath);
  const archiveText = readText(archivePath);
  const extract = (text, relative) => {
    const start = text.indexOf(begin);
    const finish = text.indexOf(end);
    if (start < 0 || finish < 0 || finish <= start) fail(`${relative} missing the cross-review preflight pure helper block`);
    return text.slice(start + begin.length, finish).trim();
  };
  const verifyBlock = extract(verifyText, "steadyspec-verify.js");
  const archiveBlock = extract(archiveText, "steadyspec-archive.js");
  requirePureBlockEquivalent(verifyBlock, archiveBlock, "verify and archive cross-review preflight pure helper blocks");
  const archiveRenderBegin = "// BEGIN ARCHIVE RENDER PURE";
  const archiveRenderEnd = "// END ARCHIVE RENDER PURE";
  const archiveRenderStart = archiveText.indexOf(archiveRenderBegin);
  const archiveRenderFinish = archiveText.indexOf(archiveRenderEnd);
  if (archiveRenderStart < 0 || archiveRenderFinish < 0 || archiveRenderFinish <= archiveRenderStart) {
    fail("steadyspec-archive.js missing the deterministic archive render pure helper block");
  }
  const archiveRenderBlock = archiveText.slice(archiveRenderStart + archiveRenderBegin.length, archiveRenderFinish).trim();

  for (const [text, relative] of [[verifyText, "steadyspec-verify.js"], [archiveText, "steadyspec-archive.js"]]) {
    for (const anchor of [
      "crossReviewState: CROSS_REVIEW_STATE_SCHEMA",
      "buildCrossReviewCommandPlan(",
      "parseCrossReviewExecution(command, execution)",
      "combineCrossReviewObservations(crossReviewPlan, crossReviewParsed)",
      "Do not start a reviewer and do not write or edit moderation.",
    ]) {
      if (!text.includes(anchor)) fail(`${relative} missing cross-review preflight integration: ${anchor}`);
    }
    if (/label:\s*['\"]cross-review[^'\"]*(?:run|moderation|reviewer)/i.test(text)) {
      fail(`${relative} cross-review preflight must not expose a reviewer-launch or moderation-write agent label`);
    }
  }
  for (const anchor of ["crossReviewVerifyDecision(crossReviewPreflight, checkpoint.recommendedNext)", "| Cross-Review Readiness |", "crossReview: {"]) {
    if (!verifyText.includes(anchor)) fail(`verify cross-review code override/report missing: ${anchor}`);
  }
  for (const anchor of ["if (crossReviewPreflight.mustStopArchive)", "buildCrossReviewArchiveClaimBlock(", "ARCHIVE_COMPOSITION_SCHEMA", "renderArchiveDocument(", "status: 'ready-for-human-archive'", "requiredTransactionKind: 'archive-finalize'", "error: 'cross-review-archive-claim-invalid'"]) {
    if (!archiveText.includes(anchor)) fail(`archive cross-review guard/report missing: ${anchor}`);
  }
  const archivePreflightIndex = archiveText.indexOf("if (crossReviewPreflight.mustStopArchive)");
  const archiveGate1Index = archiveText.indexOf("phase('Gate1-Review')");
  const archiveClaimGuardIndex = archiveText.indexOf("const crossReviewArchiveGuard =");
  const archiveRenderIndex = archiveText.indexOf("const renderedArchive = renderArchiveDocument(");
  if (archivePreflightIndex < 0 || archiveGate1Index < 0 || archivePreflightIndex > archiveGate1Index) {
    fail("archive cross-review preflight stop must precede Gate 1");
  }
  if (archiveClaimGuardIndex < 0 || archiveRenderIndex < 0 || archiveClaimGuardIndex > archiveRenderIndex) {
    fail("archive cross-review claim guard must precede deterministic archive rendering");
  }
  if (archiveText.includes("label: 'write-archive-file'")) fail("archive workflow must not write archive bytes outside the bounded helper");
  for (const anchor of ["const archived = ['committed', 'already-committed'].includes(transaction.status)", "transaction.decisionBindingValid === true", "transaction.domainMutation === 'archive-finalized'", "post.activeSourceAbsent === true", "post.stagingAbsent === true", "post.retiredAbsent === true", "post.docsCheckPassed === true", "status: 'archived', filesystemState: 'archived'"]) {
    if (!archiveText.includes(anchor)) fail(`archive terminal transaction guard missing: ${anchor}`);
  }
  if (archiveText.includes("--mode docs") || !archiveText.includes("--substrate docs") || !archiveText.includes("deriveArchivePathPlan(") || archiveText.includes("context.archiveLocation")) {
    fail("archive workflow must derive its target in code and surface the executable docs-substrate check syntax");
  }

  const sandbox = { process: { platform: process.platform } };
  vm.runInNewContext(`${verifyBlock}\n${archiveRenderBlock}\nthis.crossReviewApi = { buildCrossReviewCommandPlan, parseCrossReviewExecution, mapCrossReviewObservation, combineCrossReviewObservations, crossReviewVerifyDecision, buildCrossReviewArchiveClaimBlock, canonicalizeCrossReviewDeclaredPath, canonicalizeCrossReviewHostRoot, crossReviewExpectedOutputParent, crossReviewRunJsonIdentity, crossReviewArgvIsReadOnly, deriveArchivePathPlan, validateArchiveComposition, renderArchiveDocument, archiveMarkerCount };`, sandbox, { timeout: 1000 });
  const api = sandbox.crossReviewApi;
  const hostRepoRoot = process.platform === "win32" ? "C:\\repo" : "/repo";
  const baseState = {
    configReadStatus: "present",
    configMode: "advisory",
    reviewer: "claude",
    packetOnly: true,
    artifactDirs: [],
    explicitClaimSources: [],
    claimRequired: false,
    claimScope: { complete: false, reviewer: "", mode: "", includeDiff: false, packetOnly: false, outputDir: "" },
    errors: [],
  };
  const claimedState = {
    ...baseState,
    artifactDirs: ["changes/fixture/cross-agent"],
    claimRequired: true,
    explicitClaimSources: ["evidence.md"],
    claimScope: { complete: true, reviewer: "claude", mode: "review", includeDiff: true, packetOnly: true, outputDir: "changes/fixture/cross-agent" },
  };
  const planKinds = (state) => api.buildCrossReviewCommandPlan("changes/fixture", state, hostRepoRoot).commands.map((entry) => entry.kind).join(",");
  if (planKinds({ ...claimedState, configMode: "gated" }) !== "check-latest,gate"
    || planKinds(claimedState) !== "check-latest,advice"
    || planKinds({ ...baseState, configMode: "gated" }) !== "gate"
    || planKinds(baseState) !== "advice") {
    fail("cross-review preflight command precedence changed");
  }
  const incompletePlan = api.buildCrossReviewCommandPlan("changes/fixture", { ...claimedState, claimScope: { ...claimedState.claimScope, complete: false } }, hostRepoRoot);
  if (incompletePlan.commands.length !== 0 || incompletePlan.precondition.readiness !== "claim-blocked" || !incompletePlan.precondition.mustStopArchive) {
    fail("incomplete explicit cross-review scope must block without a defaulted latest check");
  }
  const invalidClaimStates = [
    { ...claimedState, explicitClaimSources: [] },
    { ...baseState, claimRequired: false, explicitClaimSources: ["evidence.md"] },
    { ...claimedState, explicitClaimSources: ["evidence.md", "evidence.md"] },
    { ...claimedState, explicitClaimSources: ["Evidence.md", "evidence.md"] },
    { ...claimedState, explicitClaimSources: ["evidence.md", "./evidence.md"] },
    { ...claimedState, explicitClaimSources: ["dir/evidence.md", "dir\\evidence.md"] },
    { ...claimedState, explicitClaimSources: ["../evidence.md"] },
    { ...claimedState, artifactDirs: [] },
    { ...claimedState, artifactDirs: ["changes/fixture/cross-agent", "changes/fixture/other"] },
    { ...claimedState, artifactDirs: ["changes/fixture/other"] },
    { ...claimedState, artifactDirs: ["changes/fixture/../fixture/cross-agent"] },
    { ...claimedState, claimScope: { ...claimedState.claimScope, outputDir: "changes/fixture/../fixture/cross-agent" } },
    { ...claimedState, artifactDirs: ["Changes/fixture/cross-agent"] },
    { ...claimedState, artifactDirs: ["\\\\server\\share\\cross-agent"], claimScope: { ...claimedState.claimScope, outputDir: "\\\\server\\share\\cross-agent" } },
    { ...claimedState, artifactDirs: ["C:\\repo\\cross-agent"], claimScope: { ...claimedState.claimScope, outputDir: "C:\\repo\\cross-agent" } },
    { ...claimedState, artifactDirs: ["changes/fixture/%2e%2e/cross-agent"], claimScope: { ...claimedState.claimScope, outputDir: "changes/fixture/%2e%2e/cross-agent" } },
    { ...claimedState, artifactDirs: ["changes/fixture/NUL"] , claimScope: { ...claimedState.claimScope, outputDir: "changes/fixture/NUL" } },
  ];
  for (const state of invalidClaimStates) {
    const invalidPlan = api.buildCrossReviewCommandPlan("changes/fixture", state, hostRepoRoot);
    if (invalidPlan.commands.length !== 0 || !invalidPlan.precondition || !invalidPlan.precondition.mustStopArchive) {
      fail("ambiguous, mismatched, missing, or traversal-bearing explicit claim scope must fail closed");
    }
  }
  const canonicalClaimPlan = api.buildCrossReviewCommandPlan("changes\\fixture", {
    ...claimedState,
    artifactDirs: ["changes\\fixture\\cross-agent\\"],
    explicitClaimSources: [".\\evidence.md"],
    claimScope: { ...claimedState.claimScope, outputDir: "changes/fixture/./cross-agent" },
  }, hostRepoRoot);
  if (canonicalClaimPlan.precondition
    || canonicalClaimPlan.commands[0].argv[canonicalClaimPlan.commands[0].argv.indexOf("--change") + 1] !== "changes/fixture"
    || canonicalClaimPlan.commands[0].argv[canonicalClaimPlan.commands[0].argv.indexOf("--repo") + 1] !== hostRepoRoot
    || !canonicalClaimPlan.commands[0].argv.includes("changes/fixture/cross-agent")
    || canonicalClaimPlan.claimSources[0] !== "evidence.md") {
    fail("declared cross-review paths must use bounded relative lexical canonicalization");
  }
  const unboundRootPlan = api.buildCrossReviewCommandPlan("changes/fixture", claimedState, ".");
  if (!unboundRootPlan.precondition || !unboundRootPlan.precondition.mustStopArchive || unboundRootPlan.commands.length !== 0) {
    fail("an explicit cross-review claim must bind its output parent to a native absolute project root");
  }
  for (const bad of [" x", "x ", "x\nnext", "x\u202enext", "file://x", "~/x", "/x", "C:x", "C:\\x", "\\\\?\\C:\\x", "a/../b", "a:x", "a?x", "a<x", "a>x", "a|x", "a*x", "a\"x", "NUL", "x."]) {
    if (api.canonicalizeCrossReviewDeclaredPath(bad, "fixture").ok) fail(`unsafe declared path was accepted: ${JSON.stringify(bad)}`);
  }
  for (const state of [baseState, { ...baseState, configMode: "gated" }, claimedState, { ...claimedState, configMode: "gated" }]) {
    for (const command of api.buildCrossReviewCommandPlan("changes/fixture", state, hostRepoRoot).commands) {
      if (!api.crossReviewArgvIsReadOnly(command.argv) || command.argv.some((arg) => ["--run", "--run-if-needed", "--force", "--skip-reason"].includes(arg))) {
        fail("cross-review workflow planned a reviewer-launch or mutation flag");
      }
    }
  }

  const executionFor = (command, json, exitCode) => ({
    executedArgv: Array.from(command.argv),
    exitCode,
    stdout: JSON.stringify(json),
    stderr: "",
    reviewerLaunched: false,
    moderationWritten: false,
  });
  const claimIdentityJson = (command, json) => {
    if (!command || !command.expectedOutputDir || !json || typeof json !== "object") return json;
    const decorate = (carrier) => {
      if (!carrier || typeof carrier !== "object") return carrier;
      const runJson = String(carrier.runJson || "");
      const runParts = runJson.split(/[\\/]/).filter(Boolean);
      const runName = runParts.length >= 2 ? runParts[runParts.length - 2] : "";
      return {
        ...carrier,
        pathIdentityValid: true,
        parentDirRelative: command.expectedOutputDir,
        runJsonRelative: runName ? `${command.expectedOutputDir}/${runName}/run.json` : "",
      };
    };
    if (command.kind === "check-latest") return decorate(json);
    if (command.kind === "gate" && json.latest && typeof json.latest === "object") return { ...json, latest: decorate(json.latest) };
    return json;
  };
  const parseOne = (command, json, exitCode) => api.parseCrossReviewExecution(command, executionFor(command, claimIdentityJson(command, json), exitCode));
  const advicePlan = api.buildCrossReviewCommandPlan("changes/fixture", baseState, hostRepoRoot);
  const adviceCommand = advicePlan.commands[0];
  const adviceJson = { schemaVersion: 1, status: "recommended", recommended: true, configMode: "advisory", suggestedCommand: "steadyspec cross-review --run" };
  const adviceCombined = api.combineCrossReviewObservations(advicePlan, [parseOne(adviceCommand, adviceJson, 0)]);
  if (adviceCombined.readiness !== "not-required" || adviceCombined.action !== "advisory-recommended" || advicePlan.commands.some((command) => command.argv.includes("--run"))) {
    fail("advice suggestedCommand must remain non-executable report data");
  }
  const tampered = executionFor(adviceCommand, adviceJson, 0);
  tampered.executedArgv.push("--run-if-needed");
  if (api.parseCrossReviewExecution(adviceCommand, tampered).valid) fail("executed argv drift must invalidate cross-review preflight");
  if (api.parseCrossReviewExecution(adviceCommand, executionFor(adviceCommand, { ...adviceJson, exitCode: 5 }, 0)).valid) {
    fail("advice JSON exitCode, when present, must match the observed process exit");
  }

  const claimPlan = api.buildCrossReviewCommandPlan("changes/fixture", { ...claimedState, configMode: "gated" }, hostRepoRoot);
  const checkCommand = claimPlan.commands[0];
  const gateCommand = claimPlan.commands[1];
  const claimOutputParent = checkCommand.expectedOutputParent;
  const claimOutputDir = checkCommand.expectedOutputDir;
  const hostSeparator = process.platform === "win32" ? "\\" : "/";
  const runA = `${claimOutputParent}${hostSeparator}run-a${hostSeparator}run.json`;
  const runB = `${claimOutputParent}${hostSeparator}run-b${hostSeparator}run.json`;
  const relativeIdentity = (runName = "") => ({
    pathIdentityValid: true,
    parentDirRelative: claimOutputDir,
    runJsonRelative: runName ? `${claimOutputDir}/${runName}/run.json` : "",
  });
  const legacyClaimObservation = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: claimOutputParent,
    runJson: runA,
    warnings: [],
    errors: [],
  }, 0));
  const falseClaimIdentity = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: claimOutputParent,
    runJson: runA,
    ...relativeIdentity("run-a"),
    pathIdentityValid: false,
    warnings: [],
    errors: [],
  }, 0));
  const missingRunRelativeIdentity = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: claimOutputParent,
    runJson: runA,
    ...relativeIdentity(),
    warnings: [],
    errors: [],
  }, 0));
  if (legacyClaimObservation.valid || !legacyClaimObservation.errors.includes("cross-review-path-identity-missing")
    || falseClaimIdentity.valid || !falseClaimIdentity.errors.includes("cross-review-path-identity-invalid")
    || missingRunRelativeIdentity.valid || !missingRunRelativeIdentity.errors.includes("cross-review-run-json-relative-identity-missing")) {
    fail("explicit claim observations must fail closed when v0.6.1 path identity is missing, false, or incomplete");
  }
  const checkCases = [
    [{ schemaVersion: 1, status: "no-run", exitCode: 2, parentDir: claimOutputParent, warnings: [], errors: ["missing"] }, 2, "claim-blocked"],
    [{ schemaVersion: 1, status: "failed", exitCode: 3, parentDir: claimOutputParent, warnings: [], errors: ["latest raw reviewer output is unstructured"] }, 3, "claim-blocked"],
    [{ schemaVersion: 1, status: "failed", exitCode: 4, parentDir: claimOutputParent, warnings: [], errors: ["moderation is incomplete"] }, 4, "moderation-required"],
    [{ schemaVersion: 1, status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, moderationP12NeedsUserRows: 1, warnings: ["needs-user"], errors: [] }, 1, "needs-user"],
  ];
  for (const [json, exitCode, readiness] of checkCases) {
    if (api.mapCrossReviewObservation(parseOne(checkCommand, json, exitCode)).readiness !== readiness) {
      fail(`cross-review check-latest mapping changed for ${json.status}/${exitCode}`);
    }
  }
  const gateCases = [
    [{ schemaVersion: 1, status: "satisfied", exitCode: 0, configMode: "gated", warnings: [], errors: [], latest: { status: "pass", exitCode: 0, parentDir: claimOutputParent, runJson: runA } }, 0, "ready"],
    [{ schemaVersion: 1, status: "satisfied-with-warning", exitCode: 0, configMode: "gated", warnings: ["bounded"], errors: [], latest: { status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, runJson: runA } }, 0, "ready-with-warning"],
    [{ schemaVersion: 1, status: "blocked", action: "moderation-required", exitCode: 5, configMode: "gated", warnings: [], errors: [], latest: { status: "failed", exitCode: 4, parentDir: claimOutputParent, runJson: runA } }, 5, "moderation-required"],
    [{ schemaVersion: 1, status: "needs-user", action: "user-confirmation-required", exitCode: 5, configMode: "gated", warnings: [], errors: [], latest: { status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, runJson: runA } }, 5, "needs-user"],
    [{ schemaVersion: 1, status: "not-required", exitCode: 0, configMode: "gated", warnings: [], errors: [] }, 0, "invalid"],
  ];
  for (const [json, exitCode, readiness] of gateCases) {
    if (api.mapCrossReviewObservation(parseOne(gateCommand, json, exitCode)).readiness !== readiness) {
      fail(`cross-review gate mapping changed for ${json.status}/${exitCode}`);
    }
  }
  const aliasOutputParent = process.platform === "win32" ? "C:\\REPO~1\\docs\\changes\\fixture\\cross-agent" : "/repo-alias/docs/changes/fixture/cross-agent";
  const aliasRun = `${aliasOutputParent}${hostSeparator}run-a${hostSeparator}run.json`;
  const aliasObservation = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: aliasOutputParent,
    runJson: aliasRun,
    ...relativeIdentity("run-a"),
    warnings: [],
    errors: [],
  }, 0));
  if (!aliasObservation.valid) fail(`repo-relative identity must tolerate an equivalent absolute-path alias: ${aliasObservation.errors.join(", ")}`);
  if (process.platform === "win32") {
    const slashRoot = hostRepoRoot.replace(/\\/g, "/");
    const slashRootPlan = api.buildCrossReviewCommandPlan("changes/fixture", { ...claimedState, configMode: "gated" }, slashRoot);
    if (slashRootPlan.commands.length !== 2 || slashRootPlan.commands.some((command) => command.expectedOutputParent.includes("/"))) {
      fail("Windows claim preflight must accept a forward-slash absolute project root and canonicalize the expected output parent");
    }
    const caseObservation = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
      schemaVersion: 1,
      status: "pass",
      exitCode: 0,
      parentDir: claimOutputParent.toUpperCase(),
      runJson: runA.toUpperCase(),
      pathIdentityValid: true,
      parentDirRelative: claimOutputDir.toUpperCase(),
      runJsonRelative: `${claimOutputDir.toUpperCase()}/RUN-A/RUN.JSON`,
      warnings: [],
      errors: [],
    }, 0));
    if (!caseObservation.valid) fail(`Windows path identity must be case-insensitive after producer realpath: ${caseObservation.errors.join(", ")}`);
  }
  const escapedIdentity = api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: aliasOutputParent,
    runJson: aliasRun,
    ...relativeIdentity("run-a"),
    parentDirRelative: "docs/changes/fixture/outside",
    warnings: [],
    errors: [],
  }, 0));
  if (escapedIdentity.valid) fail("repo-relative output identity drift must fail closed");
  if (api.parseCrossReviewExecution(gateCommand, executionFor(gateCommand, {
    schemaVersion: 1,
    status: "not-enforced",
    exitCode: 0,
    configMode: "gated",
  }, 0)).valid
    || api.parseCrossReviewExecution(gateCommand, executionFor(gateCommand, {
      schemaVersion: 1,
      status: "not-enforced",
      exitCode: 0,
      configMode: "advisory",
    }, 0)).valid) {
    fail("a planned gated observation must reject not-enforced status and config-mode drift");
  }
  if (api.mapCrossReviewObservation(parseOne(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    warnings: [],
    errors: [],
  }, 0)).readiness !== "invalid"
    || api.mapCrossReviewObservation(parseOne(gateCommand, {
      schemaVersion: 1,
      status: "satisfied",
      exitCode: 0,
      configMode: "gated",
      warnings: [],
      errors: [],
    }, 0)).readiness !== "invalid") {
    fail("ready check-latest and gate observations must carry an exact run.json trace");
  }
  const noRun = parseOne(checkCommand, { schemaVersion: 1, status: "no-run", exitCode: 2, parentDir: claimOutputParent, warnings: [], errors: ["missing"] }, 2);
  const notRequired = parseOne(gateCommand, { schemaVersion: 1, status: "not-required", exitCode: 0, configMode: "gated", warnings: [], errors: [] }, 0);
  const noUpgrade = api.combineCrossReviewObservations(claimPlan, [noRun, notRequired]);
  if (noUpgrade.readiness !== "invalid" || noUpgrade.claimAllowed || !noUpgrade.mustStopArchive) {
    fail("an identity-less gate observation must invalidate, never upgrade, a failed explicit claim check");
  }
  const warningCheck = parseOne(checkCommand, { schemaVersion: 1, status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, warnings: ["bounded"], errors: [], runJson: runA }, 1);
  const warningGate = parseOne(gateCommand, { schemaVersion: 1, status: "satisfied-with-warning", exitCode: 0, configMode: "gated", warnings: ["bounded"], errors: [], latest: { status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, runJson: runA } }, 0);
  const warningUpgrade = api.combineCrossReviewObservations(claimPlan, [warningCheck, warningGate]);
  if (warningUpgrade.readiness !== "ready-with-warning" || !warningUpgrade.claimAllowed || warningUpgrade.runJson !== runA) {
    fail("gated warning policy must bind a warning-bearing explicit claim to its exact trace");
  }
  const driftedWarningGate = parseOne(gateCommand, { schemaVersion: 1, status: "satisfied-with-warning", exitCode: 0, configMode: "gated", warnings: ["bounded"], errors: [], latest: { status: "pass-with-warning", exitCode: 1, parentDir: claimOutputParent, runJson: runB } }, 0);
  const traceDrift = api.combineCrossReviewObservations(claimPlan, [warningCheck, driftedWarningGate]);
  if (traceDrift.readiness !== "invalid" || traceDrift.claimAllowed || !traceDrift.mustStopArchive || traceDrift.action !== "cross-review-observation-trace-drift") {
    fail("check-latest and gate must not combine different run.json identities into a readiness claim");
  }
  const shadowGate = api.parseCrossReviewExecution(gateCommand, executionFor(gateCommand, {
    schemaVersion: 1,
    status: "satisfied",
    exitCode: 0,
    configMode: "gated",
    runJson: runA,
    warnings: [],
    errors: [],
    latest: { status: "failed", exitCode: 4, parentDir: claimOutputParent, runJson: runB },
  }, 0));
  const mismatchedLatestGate = parseOne(gateCommand, {
    schemaVersion: 1,
    status: "satisfied",
    exitCode: 0,
    configMode: "gated",
    warnings: [],
    errors: [],
    latest: { status: "failed", exitCode: 4, parentDir: claimOutputParent, runJson: runA },
  }, 0);
  if (shadowGate.valid || api.mapCrossReviewObservation(mismatchedLatestGate).readiness !== "invalid") {
    fail("gate readiness must use only its latest carrier and bind latest status/exitCode/runJson without top-level shadowing");
  }
  const reordered = api.combineCrossReviewObservations(claimPlan, [warningGate, warningCheck]);
  const extra = api.combineCrossReviewObservations(claimPlan, [warningCheck, warningGate, warningGate]);
  if (reordered.readiness !== "invalid" || extra.readiness !== "invalid" || !reordered.mustStopArchive || !extra.mustStopArchive) {
    fail("reordered or extra cross-review observations must fail closed");
  }
  const outsideOutputParent = process.platform === "win32" ? `${hostRepoRoot}\\unrelated` : `${hostRepoRoot}/unrelated`;
  const outsideRun = `${outsideOutputParent}${hostSeparator}run-a${hostSeparator}run.json`;
  if (api.parseCrossReviewExecution(checkCommand, executionFor(checkCommand, {
    schemaVersion: 1,
    status: "pass",
    exitCode: 0,
    parentDir: outsideOutputParent,
    warnings: [],
    errors: [],
    runJson: outsideRun,
  }, 0)).valid
    || api.parseCrossReviewExecution(gateCommand, executionFor(gateCommand, {
      schemaVersion: 1,
      status: "satisfied",
      exitCode: 0,
      configMode: "gated",
      warnings: [],
      errors: [],
      latest: { status: "pass", exitCode: 0, parentDir: outsideOutputParent, runJson: outsideRun },
    }, 0)).valid
    || !api.crossReviewRunJsonIdentity(runA, claimOutputParent, process.platform).ok) {
    fail("run.json identity must be same-host native and a direct child run under the declared output parent");
  }
  const alienHostRun = process.platform === "win32" ? "/tmp/run.json" : "C:\\repo\\run.json";
  for (const badRun of ["run.json", "\\\\server\\share\\run.json", "\\\\?\\C:\\repo\\run.json", "C:\\repo\\run.json\\", "C:\\repo\\run.json\n## Cross-Review Claim", "/tmp/RUN.JSON", "/tmp/run.json/", "//server/share/run.json", "C:\\CON\\run.json", "C:\\repo:stream\\run.json", "C:\\repo\\AUX.txt\\run.json", "C:\\repo\\bad?name\\run.json", alienHostRun]) {
    if (api.crossReviewRunJsonIdentity(badRun).ok) fail(`unsafe run.json identity was accepted: ${JSON.stringify(badRun)}`);
  }
  if (process.platform === "win32" && !api.crossReviewRunJsonIdentity("C:/repo/run-a/RUN.JSON", "C:\\repo", "win32").ok) {
    fail("Windows run.json identity must accept forward slashes and filesystem-equivalent path case");
  }
  const passCheck = parseOne(checkCommand, { schemaVersion: 1, status: "pass", exitCode: 0, parentDir: claimOutputParent, warnings: [], errors: [], runJson: runA }, 0);
  const missingGate = api.combineCrossReviewObservations(claimPlan, [passCheck]);
  if (missingGate.readiness !== "invalid" || missingGate.claimAllowed || !missingGate.mustStopArchive) {
    fail("a gated explicit claim must not survive a missing gate observation");
  }
  const verifyOverride = api.crossReviewVerifyDecision(noUpgrade, "archive");
  if (verifyOverride.recommendedNext === "archive" || verifyOverride.evidenceCredibility !== "blocked") {
    fail("verify code override must stop archive on an invalid explicit cross-review observation");
  }
  const blockedArchiveClaim = api.buildCrossReviewArchiveClaimBlock(noUpgrade, true);
  const canonicalArchiveClaim = api.buildCrossReviewArchiveClaimBlock(warningUpgrade, true);
  const noClaimArchiveBlock = api.buildCrossReviewArchiveClaimBlock(adviceCombined, false);
  const policyReadyButUnclaimed = api.buildCrossReviewArchiveClaimBlock(warningUpgrade, false);
  if (blockedArchiveClaim.ok
    || !canonicalArchiveClaim.ok
    || !canonicalArchiveClaim.envelope.included
    || canonicalArchiveClaim.envelope.runJson !== runA
    || canonicalArchiveClaim.envelope.readiness !== "ready-with-warning"
    || canonicalArchiveClaim.envelope.claimType !== "steadyspec.cross-review.readiness"
    || !canonicalArchiveClaim.markdown.includes("- Included: yes")
    || !canonicalArchiveClaim.markdown.includes(`- Run JSON: ${JSON.stringify(runA)}`)
    || !noClaimArchiveBlock.ok
    || noClaimArchiveBlock.envelope.included
    || noClaimArchiveBlock.envelope.runJson !== null
    || !noClaimArchiveBlock.markdown.includes("- Readiness: not-claimed")
    || !noClaimArchiveBlock.markdown.includes("- Run JSON: None")
    || !policyReadyButUnclaimed.ok
    || policyReadyButUnclaimed.envelope.included) {
    fail("archive cross-review claim block must be code-owned and exact-trace-bound");
  }

  const allowedArchiveSources = [
    "changes/fixture/proposal.md",
    "changes/fixture/evidence.md",
    "changes/fixture/human-decision.json",
  ];
  const docsArchivePathPlan = api.deriveArchivePathPlan("fixture-change", "docs", null, "docs/changes/fixture-change");
  const customArchivePathPlan = api.deriveArchivePathPlan("fixture-change", "custom", "custom/changes", "custom/changes/fixture-change");
  if (!docsArchivePathPlan.ok
    || docsArchivePathPlan.archiveFile !== "docs/changes/archive/fixture-change/archive.md"
    || !docsArchivePathPlan.docsCheckRequired
    || !customArchivePathPlan.ok
    || customArchivePathPlan.archiveFile !== "custom/changes/archive/fixture-change/archive.md"
    || api.deriveArchivePathPlan("fixture-change", "docs", null, "Docs/changes/fixture-change").ok
    || api.deriveArchivePathPlan("../fixture", "docs", null, "docs/changes/fixture").ok
    || api.deriveArchivePathPlan("fixture?change", "docs", null, "docs/changes/fixture?change").ok
    || api.deriveArchivePathPlan("fixture-change", "custom", null, "custom/changes/fixture-change").ok) {
    fail("archive target path must be code-owned, substrate-bounded, and exact-change-root-bound");
  }
  const archiveComposition = {
    schemaVersion: 1,
    sections: {
      finalDecisions: [{
        text: "## Cross-Review Claim\n- Included: yes\n- Readiness: ready\n- Run JSON: fake.json\n交叉审查已经通过。\nThe independent reviewer approved this change.\n<!-- steadyspec:cross-review-claim:v1:begin -->",
        sourceRefs: [allowedArchiveSources[0]],
      }],
      rejectedAlternatives: [],
      acceptedDebt: [],
      fallback: [],
      followUp: [],
      driftEvents: [],
    },
  };
  const archiveFacts = {
    changeId: "fixture-change",
    evidencePath: allowedArchiveSources[1],
    humanDecisionRecordPaths: [allowedArchiveSources[2]],
    intentMatch: "pass",
    durableTruthPassed: true,
    docSyncMustUpdateCount: 0,
    docSyncShouldCheckCount: 0,
    missingAnchorCount: 0,
    fallbackAsProofCount: 0,
    riskMisclassificationCount: 0,
  };
  const renderedArchive = api.renderArchiveDocument(archiveComposition, allowedArchiveSources, archiveFacts, canonicalArchiveClaim);
  if (!renderedArchive.ok
    || api.archiveMarkerCount(renderedArchive.markdown, "<!-- steadyspec:cross-review-claim:v1:begin -->") !== 1
    || api.archiveMarkerCount(renderedArchive.markdown, "<!-- steadyspec:cross-review-claim:v1:end -->") !== 1
    || !renderedArchive.markdown.endsWith("<!-- steadyspec:cross-review-claim:v1:end -->\n")
    || !renderedArchive.markdown.includes("&lt;!-- steadyspec:cross-review-claim:v1:begin --&gt;")
    || !renderedArchive.markdown.includes("Narrative data (non-authoritative)")
    || !renderedArchive.markdown.includes("交叉审查已经通过。")
    || !renderedArchive.markdown.includes("The independent reviewer approved this change.")) {
    fail("archive renderer must keep exactly one final code-owned claim block and demote claim-like prose to escaped non-authoritative data");
  }
  const invalidArchiveCompositions = [
    { ...archiveComposition, archiveMd: "forbidden" },
    { ...archiveComposition, sections: { ...archiveComposition.sections, finalDecisions: [{ ...archiveComposition.sections.finalDecisions[0], readiness: "ready" }] } },
    { ...archiveComposition, sections: { ...archiveComposition.sections, finalDecisions: [{ text: "outside", sourceRefs: ["changes/other/evidence.md"] }] } },
    { ...archiveComposition, sections: { ...archiveComposition.sections, finalDecisions: [{ text: "duplicate", sourceRefs: [allowedArchiveSources[0], allowedArchiveSources[0]] }] } },
    { ...archiveComposition, sections: { ...archiveComposition.sections, finalDecisions: [{ text: "unsafe\u2028text", sourceRefs: [allowedArchiveSources[0]] }] } },
  ];
  for (const invalidComposition of invalidArchiveCompositions) {
    if (api.renderArchiveDocument(invalidComposition, allowedArchiveSources, archiveFacts, canonicalArchiveClaim).ok) {
      fail("archive renderer accepted composer-owned authority fields, untrusted sources, duplicate sources, or unsafe text");
    }
  }
  const unclaimedArchive = api.renderArchiveDocument(archiveComposition, allowedArchiveSources, archiveFacts, noClaimArchiveBlock);
  if (!unclaimedArchive.ok
    || !unclaimedArchive.markdown.includes("- Included: no")
    || !unclaimedArchive.markdown.includes("- Readiness: not-claimed")
    || !unclaimedArchive.markdown.includes("- Run JSON: None")) {
    fail("archive renderer must preserve the code-owned no-claim envelope");
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-workflow-preflight-"));
  const changeDir = path.join(tmp, "changes", "001-preflight");
  const fakeBin = path.join(tmp, "fake-bin");
  const marker = path.join(tmp, "reviewer-launched.txt");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, ".steadyspec"), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nChange authentication and public API behavior.\n", "utf8");
  fs.writeFileSync(path.join(fakeBin, "fake-claude.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "launched")\n`, "utf8");
  fs.writeFileSync(path.join(fakeBin, "claude.cmd"), "@echo off\r\nnode \"%~dp0fake-claude.js\" %*\r\n", "utf8");
  fs.writeFileSync(path.join(fakeBin, "claude"), "#!/bin/sh\nnode \"$(dirname \"$0\")/fake-claude.js\" \"$@\"\n", "utf8");
  fs.chmodSync(path.join(fakeBin, "claude"), 0o755);
  spawnSync("git", ["init"], { cwd: tmp, encoding: "utf8", timeout: 30000 });
  const env = { Path: `${fakeBin}${path.delimiter}${process.env.Path || process.env.PATH || ""}`, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || process.env.Path || ""}` };
  const parseProductionResult = (command, result, label) => {
    const parsed = api.parseCrossReviewExecution(command, {
      executedArgv: Array.from(command.argv),
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      reviewerLaunched: fs.existsSync(marker),
      moderationWritten: false,
    });
    if (!parsed.valid) fail(`${label} was rejected by the production workflow parser: ${parsed.errors.join(", ")}`);
    return parsed;
  };
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "advisory", reviewer: "claude" }), "utf8");
  const realAdvicePlan = api.buildCrossReviewCommandPlan("changes/001-preflight", baseState, tmp);
  let result = runCrossReview(root, tmp, Array.from(realAdvicePlan.commands[0].argv).slice(2), { env });
  if (result.status !== 0) fail(`workflow advice preflight fixture failed: ${result.stderr || result.stdout}`);
  parseProductionResult(realAdvicePlan.commands[0], result, "workflow advice preflight fixture");
  fs.writeFileSync(path.join(tmp, ".steadyspec", "cross-review.json"), JSON.stringify({ schemaVersion: 1, mode: "gated", reviewer: "claude" }), "utf8");
  const realGatePlan = api.buildCrossReviewCommandPlan("changes/001-preflight", { ...baseState, configMode: "gated" }, tmp);
  result = runCrossReview(root, tmp, Array.from(realGatePlan.commands[0].argv).slice(2), { env });
  if (![0, 5].includes(result.status)) fail(`workflow gate preflight fixture failed: ${result.stderr || result.stdout}`);
  parseProductionResult(realGatePlan.commands[0], result, "workflow gate preflight fixture");
  const docsArchiveCheck = spawnSync(process.execPath, [path.join(root, "bin/init.js"), "check", "changes/001-preflight", "--phase", "archive", "--substrate", "docs", "--json"], {
    cwd: tmp,
    encoding: "utf8",
    timeout: 30000,
  });
  if (/Unknown argument/.test(String(docsArchiveCheck.stderr || "")) || !String(docsArchiveCheck.stdout || "").trim().startsWith("{")) {
    fail(`archive docs-check handoff command is not executable by the installed CLI parser: ${docsArchiveCheck.stderr || docsArchiveCheck.stdout}`);
  }
  const realClaimState = {
    ...claimedState,
    artifactDirs: ["changes/001-preflight/cross-agent"],
    claimScope: { ...claimedState.claimScope, outputDir: "changes/001-preflight/cross-agent" },
  };
  const realClaimPlan = api.buildCrossReviewCommandPlan("changes/001-preflight", realClaimState, tmp);
  result = runCrossReview(root, tmp, Array.from(realClaimPlan.commands[0].argv).slice(2), { env });
  if (result.status !== 2) fail(`workflow latest preflight missing-run fixture changed: ${result.stderr || result.stdout}`);
  parseProductionResult(realClaimPlan.commands[0], result, "workflow latest preflight missing-run fixture");
  if (fs.existsSync(marker)) fail("read-only workflow preflight commands launched the fake reviewer");
}

function checkEvidenceContinuityWorkflows(root) {
  const begin = "// BEGIN EVIDENCE CONTINUITY PURE";
  const end = "// END EVIDENCE CONTINUITY PURE";
  const applyText = readText(path.join(root, "en/runtime/claude/workflows/steadyspec-apply.js"));
  const verifyText = readText(path.join(root, "en/runtime/claude/workflows/steadyspec-verify.js"));
  const extract = (relative) => {
    const text = relative.endsWith("steadyspec-apply.js") ? applyText : verifyText;
    const start = text.indexOf(begin);
    const finish = text.indexOf(end);
    if (start < 0 || finish < 0 || finish <= start) fail(`${relative} missing the evidence continuity pure helper block`);
    return text.slice(start + begin.length, finish).trim();
  };
  const applyBlock = extract("en/runtime/claude/workflows/steadyspec-apply.js");
  const verifyBlock = extract("en/runtime/claude/workflows/steadyspec-verify.js");
  requirePureBlockEquivalent(applyBlock, verifyBlock, "apply and verify evidence continuity pure helper blocks");
  for (const anchor of ["evidenceSource: EVIDENCE_SOURCE_SCHEMA", "evidenceSourcePathPolicy(context.evidenceSource, context.evidencePath, context.proposalPath)", "error: 'evidence-source-identity-mismatch'", "normalizeEvidenceDocument(context.evidenceSource)", "EVIDENCE_RESULT_VALUES.includes(s.proofResult)", "mergeEvidenceDocument(", "const mergedEvidencePolicy = evidenceVerificationPolicy(evidenceMerge.view)", "evidenceOverallStatusForSlices(evidenceMerge.view.slices)", "mergedEvidencePolicy,", "evidenceReadbackMatches(evidenceMd.evidenceMd, diskEvidence?.evidenceMd)", "error: 'evidence-merge-conflict'"]) {
    if (!applyText.includes(anchor)) fail(`apply evidence continuity integration missing: ${anchor}`);
  }
  if (applyText.includes("migrateEvidenceFormat(null)")) fail("apply must normalize the gathered evidence source instead of classifying a null placeholder");
  for (const anchor of ["evidenceSource: EVIDENCE_SOURCE_SCHEMA", "evidenceSourcePathPolicy(context.evidenceSource, context.evidencePath, context.proposalPath)", "error: 'evidence-source-identity-mismatch'", "normalizeEvidenceDocument(context.evidenceSource)", "evidenceVerificationPolicy(evidenceView)", "if (evidencePolicy.evidenceCredibility !== 'pass')", "checkpoint.recommendedNext = evidencePolicy.requiredNext"]) {
    if (!verifyText.includes(anchor)) fail(`verify evidence continuity integration missing: ${anchor}`);
  }
  if (verifyText.includes("label: 'write-evidence'")) fail("verify evidence normalization must remain read-only");
  const identityCheckIndex = applyText.indexOf("const evidenceIdentity = evidenceSourcePathPolicy(");
  const implementationIndex = applyText.indexOf("{ label: `slice-${slice.index}-implement`");
  const conflictReturnIndex = applyText.indexOf("error: 'evidence-merge-conflict'");
  const evidenceWriteIndex = applyText.indexOf("{ label: 'write-evidence'");
  const readbackReturnIndex = applyText.indexOf("error: 'evidence-readback-mismatch'");
  const evidenceSuccessIndex = applyText.indexOf("log(`evidence.md written to ${evidencePath}`)");
  if (identityCheckIndex < 0 || implementationIndex < 0 || identityCheckIndex > implementationIndex) {
    fail("apply must bind evidence source identity before any slice implementation");
  }
  if (conflictReturnIndex < 0 || evidenceWriteIndex < 0 || conflictReturnIndex > evidenceWriteIndex) {
    fail("apply evidence conflict stop must precede the evidence write");
  }
  if (readbackReturnIndex < 0 || evidenceSuccessIndex < 0 || readbackReturnIndex > evidenceSuccessIndex) {
    fail("apply evidence readback stop must precede the evidence success claim");
  }
  const sandbox = {};
  vm.runInNewContext(`${applyBlock}\nthis.evidenceApi = { normalizeEvidenceDocument, mergeEvidenceDocument, renderEvidenceDocument, evidenceOverallStatusForSlices, evidenceVerificationPolicy, applyEvidenceRouting, evidenceReadbackMatches, evidenceSourcePathPolicy, encodeEvidenceCell, decodeEvidenceCell };`, sandbox, { timeout: 1000 });
  const api = sandbox.evidenceApi;
  const oldEvidence = [
    "# Evidence Record: fixture",
    "",
    "schemaVersion: 1",
    "",
    "## Slice 1: original behavior",
    "",
    "| Field | Value |",
    "|-------|-------|",
    "| Proof Command | npm test -- original |",
    "| Result | fallback |",
    "| Output Summary | original fallback |",
    "| Coverage Limit | original limit |",
    "| Linked Decisions | D1 |",
    "| Fallback | use old path |",
    "| Accepted Debt | original debt |",
    "",
    "## Drift Event Log",
    "",
    "| Timestamp | Slice | Type | Action |",
    "|-----------|-------|------|--------|",
    "| 2026-07-18 00:00:00 | 1 | intent | preserved action |",
    "",
    "## Re-slice Event Log",
    "",
    "| Timestamp | Slice | Type | Risk | Owner | Impact |",
    "|-----------|-------|------|------|-------|--------|",
    "| None | None | None | None | None | No re-slice events recorded |",
    "",
  ].join("\n");
  const source = { path: "evidence.md", status: "present", content: oldEvidence, complete: true, truncated: false, readError: "" };
  const initialView = api.normalizeEvidenceDocument(source);
  const merged = api.mergeEvidenceDocument(initialView, [evidenceEntryFixture()], [], []);
  if (!merged.ok || !merged.changed || typeof merged.text !== "string") fail("evidence continuity resumed merge must produce a changed canonical document");
  const mergedView = api.normalizeEvidenceDocument({ ...source, content: merged.text });
  const original = mergedView.slices.find((entry) => entry.sliceIndex === "1");
  const resumed = mergedView.slices.find((entry) => entry.sliceIndex === "2");
  if (!original || !resumed || original.fallback !== "use old path" || original.acceptedDebt !== "original debt" || original.linkedDecisionIds !== "D1" || mergedView.driftEvents.length !== 1) {
    fail("evidence continuity merge lost an existing slice, decision, fallback, debt, or drift event");
  }
  const replay = api.mergeEvidenceDocument(mergedView, [evidenceEntryFixture()], [], []);
  if (!replay.ok || replay.changed || replay.text !== merged.text) fail("evidence continuity replay must be byte-idempotent");
  const conflict = api.mergeEvidenceDocument(mergedView, [evidenceEntryFixture({ behavior: "conflicting behavior" })], [], []);
  if (conflict.ok || conflict.changed || conflict.text !== null || !conflict.conflicts.some((entry) => entry.kind === "slice-conflict")) {
    fail("evidence continuity must fail closed on same-index semantic conflicts");
  }
  const cleanView = {
    sourceStatus: "present",
    sourceFormat: "canonical-v1",
    sourceText: "",
    sourcePath: "changes/fixture/evidence.md",
    slices: [],
    driftEvents: [],
    reSliceEvents: [],
    preservedSources: [],
    gaps: [],
    warnings: [],
    conflicts: [],
    blockingErrors: [],
  };
  const normalizedForResult = (resultValue, overrides = {}) => {
    const text = api.renderEvidenceDocument({ ...cleanView, slices: [evidenceEntryFixture({ sliceIndex: "1", result: resultValue, ...overrides })] }, "fixture");
    return api.normalizeEvidenceDocument({ path: "changes/fixture/evidence.md", status: "present", content: text, complete: true, truncated: false, readError: "" });
  };
  const resultExpectations = {
    pass: ["pass", true, "archive"],
    fallback: ["gap", false, "continue"],
    fail: ["blocked", false, "stop"],
    drift: ["blocked", false, "stop"],
    blocked: ["gap", false, "continue"],
  };
  for (const [resultValue, expected] of Object.entries(resultExpectations)) {
    const policy = api.evidenceVerificationPolicy(normalizedForResult(resultValue));
    if (policy.evidenceCredibility !== expected[0] || policy.archiveAllowed !== expected[1] || policy.requiredNext !== expected[2]) {
      fail(`evidence verification policy changed for ${resultValue} proof results`);
    }
  }
  const applyRouteExpectations = {
    pass: ["archive", "all-applicable-proofs-pass", 0],
    fallback: ["continue", "fallback-is-not-proof", 1],
    fail: ["stop", "non-passing-proof", 1],
    drift: ["stop", "non-passing-proof", 1],
    blocked: ["continue", "blocked-proof", 1],
  };
  const archiveReadyPolicy = { evidenceCredibility: "pass", archiveAllowed: true, requiredNext: "archive", gaps: [] };
  for (const [resultValue, expected] of Object.entries(applyRouteExpectations)) {
    const routing = api.applyEvidenceRouting([{ proofResult: resultValue }], 1, 1, false, null, archiveReadyPolicy);
    if (routing.route !== expected[0] || routing.reason !== expected[1] || routing.remainingCount !== expected[2]) {
      fail(`apply final routing changed for ${resultValue} proof results`);
    }
  }
  const emptyRouting = api.applyEvidenceRouting([], 0, 0, false, null, archiveReadyPolicy);
  if (emptyRouting.route !== "continue" || emptyRouting.reason !== "no-current-proof-results") {
    fail("apply must not recommend archive without current applicable pass results");
  }
  const overallStatusExpectations = {
    pass: "all-passed",
    fallback: "partial",
    fail: "partial",
    drift: "partial",
    blocked: "partial",
  };
  for (const [resultValue, expectedStatus] of Object.entries(overallStatusExpectations)) {
    const rendered = api.renderEvidenceDocument({ ...cleanView, slices: [evidenceEntryFixture({ sliceIndex: "1", result: resultValue })] }, "fixture");
    if (api.evidenceOverallStatusForSlices([{ result: resultValue }]) !== expectedStatus || !rendered.includes(`- Overall status: ${expectedStatus}`)) {
      fail(`evidence rendered overall status changed for ${resultValue} proof results`);
    }
  }
  const emptyRendered = api.renderEvidenceDocument({ ...cleanView, slices: [] }, "fixture");
  if (api.evidenceOverallStatusForSlices([]) !== "no-proof" || !emptyRendered.includes("- Overall status: no-proof")) {
    fail("empty evidence must not claim all proofs passed");
  }
  const sentinelPolicy = api.evidenceVerificationPolicy(normalizedForResult("pass", { coverageLimit: "evidence-migration-unavailable:coverageLimit" }));
  if (sentinelPolicy.evidenceCredibility !== "blocked" || sentinelPolicy.archiveAllowed !== false || !sentinelPolicy.gaps.some((gap) => gap.includes("coverageLimit@slice-1"))) {
    fail("evidence migration sentinel must block archive readiness");
  }
  const specialCells = ["literal<br>tag", "slash\\|pipe", "line one\nline two", "100%", "中文 | \\ <br>", "  surrounding space  "];
  for (const value of specialCells) {
    if (api.decodeEvidenceCell(api.encodeEvidenceCell(value)) !== value) {
      fail(`evidence cell codec must round-trip special characters: ${JSON.stringify(value)}`);
    }
  }
  const canonicalText = api.renderEvidenceDocument({ ...cleanView, slices: [evidenceEntryFixture({ sliceIndex: "1", result: "pass" })] }, "fixture");
  const mixedText = `${canonicalText}\n## Local Raw Notes\n\nDO NOT LOSE THIS\n`;
  const mixedView = api.normalizeEvidenceDocument({ path: "changes/fixture/evidence.md", status: "present", content: mixedText, complete: true, truncated: false, readError: "" });
  const mixedMerged = api.mergeEvidenceDocument(mixedView, [evidenceEntryFixture({ sliceIndex: "2" })], [], [], "fixture");
  const mixedRoundTrip = api.normalizeEvidenceDocument({ path: "changes/fixture/evidence.md", status: "present", content: mixedMerged.text, complete: true, truncated: false, readError: "" });
  if (!mixedMerged.ok || !mixedRoundTrip.preservedSources.includes(mixedText) || !mixedRoundTrip.preservedSources.some((sourceText) => sourceText.includes("DO NOT LOSE THIS")) || api.evidenceVerificationPolicy(mixedRoundTrip).archiveAllowed !== false) {
    fail("mixed canonical evidence must preserve all unconsumed source content and remain a verification gap");
  }
  const mergedRouteFromPrior = (priorView, expectedRoute, label) => {
    const composed = api.mergeEvidenceDocument(priorView, [evidenceEntryFixture({ sliceIndex: "2", result: "pass" })], [], [], "fixture");
    if (!composed.ok) fail(`merged evidence route fixture failed to compose: ${label}`);
    const policy = api.evidenceVerificationPolicy(composed.view);
    const routing = api.applyEvidenceRouting([{ proofResult: "pass" }], 1, 1, false, null, policy);
    if (routing.route !== expectedRoute || (expectedRoute === "archive") !== (policy.archiveAllowed === true)) {
      fail(`apply final route ignored durable merged evidence policy: ${label}`);
    }
    return { composed, policy, routing };
  };
  mergedRouteFromPrior(normalizedForResult("pass"), "archive", "prior-pass-plus-current-pass");
  mergedRouteFromPrior(normalizedForResult("fallback"), "continue", "prior-fallback-plus-current-pass");
  for (const resultValue of ["fail", "drift"]) {
    mergedRouteFromPrior(normalizedForResult(resultValue), "stop", `prior-${resultValue}-plus-current-pass`);
  }
  mergedRouteFromPrior(normalizedForResult("blocked"), "continue", "prior-blocked-plus-current-pass");
  mergedRouteFromPrior(mixedView, "continue", "prior-mixed-plus-current-pass");
  const sentinelPrior = normalizedForResult("pass", { coverageLimit: "evidence-migration-unavailable:coverageLimit" });
  mergedRouteFromPrior(sentinelPrior, "stop", "prior-sentinel-plus-current-pass");
  const durableStopPolicies = [
    api.evidenceVerificationPolicy(normalizedForResult("fail")),
    api.evidenceVerificationPolicy(sentinelPrior),
  ];
  for (const stopPolicy of durableStopPolicies) {
    const stopCombinations = [
      [[{ proofResult: "fallback" }], 1, 1, false, null],
      [[{ proofResult: "blocked" }], 1, 1, false, null],
      [[{ proofResult: "pass" }], 2, 1, false, null],
      [[{ proofResult: "pass" }], 1, 1, false, "fail"],
      [[], 0, 0, false, null],
    ];
    for (const args of stopCombinations) {
      const routing = api.applyEvidenceRouting(...args, stopPolicy);
      if (routing.route !== "stop" || routing.reason !== "merged-evidence-not-archive-ready") {
        fail("durable stop policy must outrank all current continue branches");
      }
    }
  }
  const priorFallbackPolicy = api.evidenceVerificationPolicy(normalizedForResult("fallback"));
  const blockedOverGap = api.applyEvidenceRouting([{ proofResult: "blocked" }], 1, 1, false, null, priorFallbackPolicy);
  if (blockedOverGap.route !== "continue" || blockedOverGap.reason !== "blocked-proof") {
    fail("durable gap plus current blocked proof must remain unresolved apply work, not stop");
  }
  const malformedEventText = canonicalText.replace(
    "|-----------|-------|------|--------|\n| None | None | None | No drift events recorded |",
    "|-----------|-------|------|--------|\n| uri:2026-07-18 | uri:1 | uri:intent |",
  );
  const malformedEventView = api.normalizeEvidenceDocument({ path: "changes/fixture/evidence.md", status: "present", content: malformedEventText, complete: true, truncated: false, readError: "" });
  if (!malformedEventView.blockingErrors.some((error) => error.includes("malformed-evidence-event-row")) || api.mergeEvidenceDocument(malformedEventView, [], [], [], "fixture").ok) {
    fail("malformed evidence event rows must block resumed evidence writes");
  }
  const pathMatch = api.evidenceSourcePathPolicy(
    { path: "changes\\fixture\\evidence.md" },
    "changes/fixture/evidence.md",
    "changes/fixture/proposal.md",
  );
  const pathMismatch = api.evidenceSourcePathPolicy(
    { path: "changes/other/evidence.md" },
    "changes/fixture/evidence.md",
    "changes/fixture/proposal.md",
  );
  if (!pathMatch.ok || pathMismatch.ok || !pathMismatch.errors.includes("evidence-source-path-mismatch")) {
    fail("evidence source identity must bind source, declared target, and proposal-derived target");
  }
  const legacyText = "Legacy proof notes\r\n| Result | banana |\r\nFallback was manual.";
  const legacyView = api.normalizeEvidenceDocument({ path: "evidence.md", status: "present", content: legacyText, complete: true, truncated: false, readError: "" });
  const legacyMerged = api.mergeEvidenceDocument(legacyView, [evidenceEntryFixture()], [], []);
  const legacyRoundTrip = api.normalizeEvidenceDocument({ path: "evidence.md", status: "present", content: legacyMerged.text, complete: true, truncated: false, readError: "" });
  const legacyPolicy = api.evidenceVerificationPolicy(legacyRoundTrip);
  if (!legacyMerged.ok || !legacyRoundTrip.preservedSources.includes(legacyText) || !legacyRoundTrip.gaps.some((gap) => gap.includes("evidence-migration-unavailable")) || legacyPolicy.evidenceCredibility !== "gap" || legacyPolicy.archiveAllowed !== false) {
    fail("legacy evidence must round-trip losslessly as untrusted preserved source and force a verification gap");
  }
  const incomplete = api.normalizeEvidenceDocument({ path: "evidence.md", status: "present", content: oldEvidence, complete: false, truncated: true, readError: "truncated" });
  if (api.mergeEvidenceDocument(incomplete, [evidenceEntryFixture()], [], []).ok) fail("incomplete evidence source must block merge");
  if (api.evidenceReadbackMatches("intended", "different") || !api.evidenceReadbackMatches("same", "same")) fail("evidence readback equality contract changed");
}

function packedSmokeProcess(command, args, cwd, timeout = 120000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${path.basename(command)} failed to start: ${result.error.message}`);
  return result;
}

function packedSmokeFailure(label, result) {
  const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
  return new Error(`${label} failed with exit ${result.status}: ${detail}`);
}

function parsePackedSmokeJson(label, result) {
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch (error) {
    throw new Error(`${label} did not emit one JSON value: ${error.message}; stdout=${(result.stdout || "").trim()}`);
  }
}

function locateNpmCliForPackedSmoke() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  candidates.push(path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  candidates.push(path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  if (process.platform === "win32") {
    const where = packedSmokeProcess("where.exe", ["npm.cmd"], process.cwd(), 10000);
    if (where.status === 0) {
      for (const line of (where.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        candidates.push(path.join(path.dirname(line), "node_modules", "npm", "bin", "npm-cli.js"));
      }
    }
  }
  const npmCli = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!npmCli) throw new Error("cannot locate npm-cli.js for the fresh packed-install smoke");
  return npmCli;
}

function runInstalledShim(shim, args, cwd, timeout = 30000) {
  if (process.platform !== "win32") return packedSmokeProcess(shim, args, cwd, timeout);
  const commandProcessor = process.env.ComSpec || process.env.COMSPEC;
  if (!commandProcessor || !fs.existsSync(commandProcessor)) throw new Error("Windows command processor is unavailable for installed .cmd shim smoke");
  return packedSmokeProcess(commandProcessor, ["/d", "/s", "/c", "call", shim, ...args], cwd, timeout);
}

function writePackedSmokeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function checkHumanTransactionWorkflowIntegration(root) {
  const begin = "// BEGIN HUMAN DECISION TRANSACTION OBSERVATION PURE";
  const end = "// END HUMAN DECISION TRANSACTION OBSERVATION PURE";
  const applyText = readText(path.join(root, "en/runtime/claude/workflows/steadyspec-apply.js"));
  const archiveText = readText(path.join(root, "en/runtime/claude/workflows/steadyspec-archive.js"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const entry of fs.readdirSync(path.join(root, "en/runtime/claude/workflows")).filter((name) => name.endsWith(".js"))) {
    const source = readText(path.join(root, "en/runtime/claude/workflows", entry)).replace(/^export\s+const\s+meta\s*=/m, "const meta =");
    try { new AsyncFunction("args", "agent", "log", "phase", source); } catch (error) { fail(`${entry} fails whole-workflow async host parsing: ${error.message}`); }
  }
  const extract = (text, label) => {
    const start = text.indexOf(begin);
    const finish = text.indexOf(end);
    if (start < 0 || finish < 0 || finish <= start) fail(`${label} missing human transaction observation pure block`);
    return text.slice(start + begin.length, finish).trim();
  };
  const applyBlock = extract(applyText, "apply workflow");
  const archiveBlock = extract(archiveText, "archive workflow");
  requirePureBlockEquivalent(applyBlock, archiveBlock, "apply/archive human transaction observation pure blocks");
  const sandbox = {};
  vm.runInNewContext(`${applyBlock}\nthis.txApi={humanTransactionArgv,validateHumanTransactionObservation};`, sandbox, { timeout: 1000 });
  const id = "a".repeat(32);
  const argv = Array.from(sandbox.txApi.humanTransactionArgv("commit", "intent-expansion", "", "", id));
  if (argv.join("\n") !== ["steadyspec", "internal", "human-transaction", "commit", "--decision-id", id, "--decision-record", `.steadyspec/human-transactions/${id}/decision.json`, "--json"].join("\n")) fail("workflow transaction argv is not code-owned");
  const result = {
    schemaVersion: 1, contractVersion: 1, status: "committed", action: "proposal-readback-passed-write-drift-evidence", exitCode: 0,
    kind: "intent-expansion", changeId: "change-b", changeRoot: ".meta/changes/change-b", decisionId: id, pendingPath: `.steadyspec/human-transactions/${id}/pending.json`, bindingHash: `sha256:${"1".repeat(64)}`,
    pendingHash: `sha256:${"2".repeat(64)}`, decisionBindingValid: true, domainMutation: "proposal-insertion-committed", postconditions: { passed: true }, errors: [], warnings: [],
  };
  const observation = { executedArgv: argv, exitCode: 0, stdout: JSON.stringify(result), stderr: "", requestPath: "", requestReadback: "", extraCommands: false };
  const expected = { argv, kind: "intent-expansion", changeId: "change-b", changeRoot: ".meta/changes/change-b", decisionId: id, requestPath: "" };
  if (!sandbox.txApi.validateHumanTransactionObservation(observation, expected).ok) fail("valid workflow transaction observation was rejected");
  if (sandbox.txApi.validateHumanTransactionObservation({ ...observation, extraCommands: true }, expected).ok) fail("workflow transaction parser accepted extra commands");
  if (sandbox.txApi.validateHumanTransactionObservation(observation, { ...expected, changeId: "change-a", changeRoot: ".meta/changes/change-a" }).ok) fail("workflow transaction parser accepted a cross-change resume result");
  if (sandbox.txApi.validateHumanTransactionObservation(observation, { ...expected, changeRoot: "" }).ok) fail("workflow transaction parser accepted an unbound empty change root");

  const liveRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-workflow-live-output-"));
  try {
    const liveId = "live-output";
    const liveRoot = `.meta/changes/${liveId}`;
    const proposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- original\n\n### Out of Scope\n- excluded\n", "utf8");
    const proposalFile = path.join(liveRepo, ...liveRoot.split("/"), "proposal.md");
    fs.mkdirSync(path.dirname(proposalFile), { recursive: true });
    fs.writeFileSync(proposalFile, proposal);
    const start = proposal.indexOf(Buffer.from("### In Scope"));
    const finish = proposal.indexOf(Buffer.from("### Out of Scope"));
    const requestRelative = ".steadyspec/request.json";
    writePackedSmokeJson(path.join(liveRepo, ...requestRelative.split("/")), { schemaVersion: 1, proposalPath: `${liveRoot}/proposal.md`, fieldId: "boundary.inScope", fieldSectionStartByte: start, fieldSectionEndByte: finish, insertionOffsetByte: finish, additionBase64: Buffer.from("- live\n").toString("base64") });
    const liveArgv = Array.from(sandbox.txApi.humanTransactionArgv("prepare", "intent-expansion", liveRoot, requestRelative, ""));
    const processResult = spawnSync(process.execPath, [path.join(root, "bin/human-decision-transaction.js"), "prepare", "--kind", "intent-expansion", "--change", liveRoot, "--request", requestRelative, "--json"], { cwd: liveRepo, encoding: "utf8", timeout: 30000, windowsHide: true });
    const parsed = sandbox.txApi.validateHumanTransactionObservation({ executedArgv: liveArgv, exitCode: processResult.status, stdout: processResult.stdout, stderr: processResult.stderr, requestPath: requestRelative, requestReadback: fs.readFileSync(path.join(liveRepo, ...requestRelative.split("/")), "utf8"), extraCommands: false }, { action: "prepare", argv: liveArgv, kind: "intent-expansion", changeId: liveId, changeRoot: liveRoot, requestPath: requestRelative, requestJson: readJson(path.join(liveRepo, ...requestRelative.split("/"))) });
    if (!parsed.ok || parsed.result.status !== "needs-user") fail(`real helper output failed workflow parser: ${parsed.errors.join(", ")}`);
  } finally {
    fs.rmSync(liveRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  const resumeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-workflow-resume-"));
  try {
    const helper = path.join(root, "bin", "human-decision-transaction.js");
    const { recordHash } = require(helper);
    const writeResume = (relative, bytes) => {
      const file = path.join(resumeRepo, ...relative.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    };
    const runHelper = (args) => spawnSync(process.execPath, [helper, ...args], { cwd: resumeRepo, encoding: "utf8", timeout: 30000, windowsHide: true });
    const approve = (pending) => {
      const decision = {
        schemaVersion: 1, contractVersion: 1, recordType: "human-decision",
        decisionId: pending.decisionId, kind: pending.kind, pendingHash: pending.pendingHash,
        bindingHash: pending.bindingHash, decision: "approve-exact-transaction",
        reason: "workflow identity preflight fixture", confirmedBy: "fixture-human",
        confirmedAt: "2026-07-18T00:00:00.000Z", confirmationRef: "workflow-resume-fixture", decisionHash: "",
      };
      decision.decisionHash = recordHash(decision, "decisionHash");
      writePackedSmokeJson(path.join(resumeRepo, ...pending.expectedDecisionPath.split("/")), decision);
    };
    const prepareIntentResume = () => {
      const id = "resume-change-b";
      const changeRoot = `.meta/changes/${id}`;
      const proposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- original\n\n### Out of Scope\n- excluded\n", "utf8");
      writeResume(`${changeRoot}/proposal.md`, proposal);
      const start = proposal.indexOf(Buffer.from("### In Scope"));
      const finish = proposal.indexOf(Buffer.from("### Out of Scope"));
      const requestPath = ".steadyspec/requests/workflow-resume-intent.json";
      writePackedSmokeJson(path.join(resumeRepo, ...requestPath.split("/")), {
        schemaVersion: 1, proposalPath: `${changeRoot}/proposal.md`, fieldId: "boundary.inScope",
        fieldSectionStartByte: start, fieldSectionEndByte: finish, insertionOffsetByte: finish,
        additionBase64: Buffer.from("- must-not-apply\n").toString("base64"),
      });
      const prepared = runHelper(["prepare", "--kind", "intent-expansion", "--change", id, "--request", requestPath, "--json"]);
      const result = JSON.parse(prepared.stdout);
      if (prepared.status !== 2 || result.status !== "needs-user") fail("workflow resume intent fixture did not prepare");
      const pending = readJson(path.join(resumeRepo, ...result.pendingPath.split("/")));
      approve(pending);
      return { id, changeRoot, proposal, pending };
    };
    const prepareArchiveResume = () => {
      const id = "resume-archive-b";
      const sourceRoot = `.meta/changes/${id}`;
      const targetRoot = `.meta/changes/archive/${id}`;
      writeResume(`${sourceRoot}/proposal.md`, Buffer.from("# Proposal\n", "utf8"));
      const requestPath = ".steadyspec/requests/workflow-resume-archive.json";
      writePackedSmokeJson(path.join(resumeRepo, ...requestPath.split("/")), {
        schemaVersion: 1, sourceRoot, targetRoot, archiveBase64: Buffer.from("# Archive\n").toString("base64"),
        substrate: "meta", docsCheckRequired: false,
      });
      const prepared = runHelper(["prepare", "--kind", "archive-finalize", "--change", id, "--request", requestPath, "--json"]);
      const result = JSON.parse(prepared.stdout);
      if (prepared.status !== 2 || result.status !== "needs-user") fail("workflow resume archive fixture did not prepare");
      const pending = readJson(path.join(resumeRepo, ...result.pendingPath.split("/")));
      approve(pending);
      return { id, sourceRoot, targetRoot, pending };
    };
    const compile = (text) => new AsyncFunction("args", "agent", "log", "phase", text.replace(/^export\s+const\s+meta\s*=/m, "const meta ="));
    const processAgent = (calls) => async (prompt) => {
      const marker = "EXACT ARGV JSON:";
      const markerAt = prompt.indexOf(marker);
      const argvLine = markerAt < 0 ? "" : prompt.slice(markerAt + marker.length).split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("["));
      const executedArgv = JSON.parse(argvLine || "null");
      if (!Array.isArray(executedArgv) || executedArgv.slice(0, 3).join("/") !== "steadyspec/internal/human-transaction") fail("workflow resume fixture observed non-code-owned argv");
      calls.push(executedArgv);
      const child = runHelper(executedArgv.slice(3));
      return { executedArgv, exitCode: child.status, stdout: child.stdout, stderr: child.stderr, requestPath: "", requestReadback: "", extraCommands: false };
    };
    const noop = () => {};
    const intent = prepareIntentResume();
    const intentWorkflow = compile(applyText);
    let calls = [];
    let workflowResult = await intentWorkflow({ changeId: "resume-change-a", projectRoot: resumeRepo, transactionAction: "commit", transactionDecisionId: intent.pending.decisionId }, processAgent(calls), noop, noop);
    if (workflowResult.error !== "intent-transaction-resume-invalid" || calls.length !== 0) fail("apply resume without changeDir did not fail before helper execution");
    calls = [];
    workflowResult = await intentWorkflow({ changeId: "resume-change-a", changeDir: ".meta/changes", projectRoot: resumeRepo, transactionAction: "commit", transactionDecisionId: intent.pending.decisionId }, processAgent(calls), noop, noop);
    if (workflowResult.error !== "intent-transaction-identity-preflight-failed" || calls.length !== 1 || calls[0][3] !== "status") fail("apply cross-change resume did not stop after the read-only identity preflight");
    if (!fs.readFileSync(path.join(resumeRepo, ...intent.changeRoot.split("/"), "proposal.md")).equals(intent.proposal) || fs.existsSync(path.join(resumeRepo, ".steadyspec", "human-transactions", intent.pending.decisionId, "commit.json"))) fail("apply cross-change resume mutated the bound change before identity rejection");

    const archive = prepareArchiveResume();
    const archiveWorkflow = compile(archiveText);
    calls = [];
    workflowResult = await archiveWorkflow({ changeId: "resume-archive-a", projectRoot: resumeRepo, transactionAction: "commit", transactionDecisionId: archive.pending.decisionId }, processAgent(calls), noop, noop);
    if (workflowResult.error !== "archive-transaction-resume-invalid" || calls.length !== 0) fail("archive resume without changeDir did not fail before helper execution");
    calls = [];
    workflowResult = await archiveWorkflow({ changeId: "resume-archive-a", changeDir: ".meta/changes", projectRoot: resumeRepo, transactionAction: "commit", transactionDecisionId: archive.pending.decisionId }, processAgent(calls), noop, noop);
    if (workflowResult.error !== "archive-transaction-identity-preflight-failed" || calls.length !== 1 || calls[0][3] !== "status") fail("archive cross-change resume did not stop after the read-only identity preflight");
    if (!fs.existsSync(path.join(resumeRepo, ...archive.sourceRoot.split("/"))) || fs.existsSync(path.join(resumeRepo, ...archive.targetRoot.split("/"))) || fs.existsSync(path.join(resumeRepo, ".steadyspec", "human-transactions", archive.pending.decisionId, "commit.json"))) fail("archive cross-change resume mutated the bound change before identity rejection");
  } finally {
    fs.rmSync(resumeRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  for (const anchor of ["reason: 'intent-expansion-transaction-pending'", "No drift evidence was written.", "resumedIntentTransaction", "post.oldBytesPreserved === true", "post.onlyBoundInsertion === true", "transaction.domainMutation === 'proposal-insertion-committed'", "proposal-insertion-committed-evidence-not-complete"]) {
    if (!applyText.includes(anchor)) fail(`apply transaction integration missing: ${anchor}`);
  }
  if (applyText.includes("patch-intent:")) fail("apply still records an expansion as drift before exact transaction commit");
  for (const anchor of ["archiveTransactionRequest", "transactionStatus: 'needs-user'", "invokeHumanTransaction(", "transaction.domainMutation === 'archive-finalized'", "post.retiredAbsent === true", "filesystemState: 'archived'", "filesystem archived only; not human acceptance"]) {
    if (!archiveText.includes(anchor)) fail(`archive transaction integration missing: ${anchor}`);
  }
  const renderIndex = archiveText.indexOf("const renderedArchive = renderArchiveDocument(");
  const prepareIndex = archiveText.indexOf("const archiveTransactionRequest =");
  if (renderIndex < 0 || prepareIndex < renderIndex) fail("archive transaction prepare must bind the deterministic rendered archive bytes");
}

function checkHumanDecisionTransactions(root) {
  const helper = path.join(root, "bin", "human-decision-transaction.js");
  const router = path.join(root, "bin", "init.js");
  if (!fs.existsSync(helper)) fail("human-decision transaction helper is missing");
  const { recordHash } = require(helper);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-human-transaction-"));
  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, [helper, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 30000,
      windowsHide: true,
    });
    let json = null;
    try { json = JSON.parse(String(result.stdout || "").trim()); } catch (error) { /* asserted by caller */ }
    return { ...result, json };
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const write = (relative, bytes) => {
    const file = path.join(repo, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return file;
  };
  const read = (relative) => fs.readFileSync(path.join(repo, ...relative.split("/")));
  const intentFixture = (id, addition = "- added expansion\n") => {
    const proposalRelative = `.meta/changes/${id}/proposal.md`;
    const proposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- original\n\n### Out of Scope\n- excluded\n", "utf8");
    write(proposalRelative, proposal);
    const start = proposal.indexOf(Buffer.from("### In Scope"));
    const end = proposal.indexOf(Buffer.from("### Out of Scope"));
    const requestRelative = `.steadyspec/requests/${id}.json`;
    const request = {
      schemaVersion: 1,
      proposalPath: proposalRelative,
      fieldId: "boundary.inScope",
      fieldSectionStartByte: start,
      fieldSectionEndByte: end,
      insertionOffsetByte: end,
      additionBase64: Buffer.from(addition, "utf8").toString("base64"),
    };
    writePackedSmokeJson(path.join(repo, ...requestRelative.split("/")), request);
    return { id, proposalRelative, proposal, requestRelative, request, after: Buffer.concat([proposal.subarray(0, end), Buffer.from(addition), proposal.subarray(end)]) };
  };
  const archiveFixture = (id, substrate = "meta") => {
    const base = substrate === "docs" ? "docs/changes" : ".meta/changes";
    const sourceRoot = `${base}/${id}`;
    write(`${sourceRoot}/proposal.md`, Buffer.from("# Archive fixture\n", "utf8"));
    const archive = Buffer.from(`# Archive: ${id}\n`, "utf8");
    const targetRoot = `${base}/archive/${id}`;
    const requestRelative = `.steadyspec/requests/${id}-archive.json`;
    writePackedSmokeJson(path.join(repo, ...requestRelative.split("/")), {
      schemaVersion: 1,
      sourceRoot,
      targetRoot,
      archiveBase64: archive.toString("base64"),
      substrate,
      docsCheckRequired: substrate === "docs",
    });
    return { id, sourceRoot, targetRoot, archive, requestRelative };
  };
  const pendingFor = (result) => {
    assert(result.json && /^[a-f0-9]{32}$/.test(result.json.decisionId || ""), "prepare did not return a decision id");
    return JSON.parse(read(result.json.pendingPath).toString("utf8"));
  };
  const decisionFor = (pending, decision = "approve-exact-transaction", changes = {}) => {
    const record = {
      schemaVersion: 1,
      contractVersion: 1,
      recordType: "human-decision",
      decisionId: pending.decisionId,
      kind: pending.kind,
      pendingHash: pending.pendingHash,
      bindingHash: pending.bindingHash,
      decision,
      reason: "exact fixture authorization",
      confirmedBy: "fixture-human",
      confirmedAt: "2026-07-18T00:00:00.000Z",
      confirmationRef: "validate-fixture",
      decisionHash: "",
      ...changes,
    };
    record.decisionHash = recordHash(record, "decisionHash");
    writePackedSmokeJson(path.join(repo, ...pending.expectedDecisionPath.split("/")), record);
    return record;
  };
  const prepareIntent = (fixture) => run(["prepare", "--kind", "intent-expansion", "--change", fixture.id, "--request", fixture.requestRelative, "--json"]);
  const prepareArchive = (fixture) => run(["prepare", "--kind", "archive-finalize", "--change", fixture.id, "--request", fixture.requestRelative, "--json"]);
  const commit = (pending, env = {}) => run(["commit", "--decision-id", pending.decisionId, "--decision-record", pending.expectedDecisionPath, "--json"], env);
  const cancel = (pending) => run(["cancel", "--decision-id", pending.decisionId, "--decision-record", pending.expectedDecisionPath, "--json"]);
  try {
    write(".steadyspec/requests/malformed.json", Buffer.from('{"schemaVersion":1,"schemaVersion":1}', "utf8"));
    let result = run(["prepare", "--kind", "intent-expansion", "--change", "missing", "--request", ".steadyspec/requests/malformed.json", "--json"]);
    assert(result.status === 2 && result.json && result.json.status === "invalid", "duplicate-key request did not fail closed");
    assert(!fs.existsSync(path.join(repo, ".steadyspec", "human-transactions")), "malformed request created transaction state");

    write(".meta/changes/archive/old-change/archive.md", Buffer.from("# old archive\n", "utf8"));
    writePackedSmokeJson(path.join(repo, ".steadyspec", "requests", "reserved-archive.json"), {
      schemaVersion: 1, sourceRoot: ".meta/changes/archive", targetRoot: ".meta/changes/archive/archive",
      archiveBase64: Buffer.from("# impossible\n").toString("base64"), substrate: "meta", docsCheckRequired: false,
    });
    result = run(["prepare", "--kind", "archive-finalize", "--change", "archive", "--request", ".steadyspec/requests/reserved-archive.json", "--json"]);
    assert(result.status === 2 && result.json.status === "invalid" && !fs.existsSync(path.join(repo, ".steadyspec", "human-transactions")), "reserved archive directory was treated as an active change");
    write(".meta/changes/not-active/readme.md", Buffer.from("not a change\n", "utf8"));
    result = run(["prepare", "--kind", "archive-finalize", "--change", "not-active", "--request", ".steadyspec/requests/reserved-archive.json", "--json"]);
    assert(result.status === 2 && result.json.status === "invalid" && !fs.existsSync(path.join(repo, ".steadyspec", "human-transactions")), "directory without exact proposal.md was treated as an active change");

    const linkedTarget = path.join(repo, ".meta", "changes", "linked-target");
    const linkedChange = path.join(repo, ".meta", "changes", "linked-change");
    fs.mkdirSync(linkedTarget, { recursive: true });
    fs.writeFileSync(path.join(linkedTarget, "proposal.md"), Buffer.from("# linked\n", "utf8"));
    try {
      fs.symlinkSync(linkedTarget, linkedChange, process.platform === "win32" ? "junction" : "dir");
      result = run(["prepare", "--kind", "archive-finalize", "--change", "linked-change", "--request", ".steadyspec/requests/reserved-archive.json", "--json"]);
      assert(result.status === 2 && result.json.status === "invalid" && !fs.existsSync(path.join(repo, ".steadyspec", "human-transactions")), "linked active change root was accepted");
    } catch (error) {
      if (!error || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
      warn(`human-decision symlink/junction negative skipped: ${error.code}`);
    }

    fs.mkdirSync(path.join(repo, ".steadyspec", "human-transactions", "f".repeat(32)), { recursive: true });

    const intent = intentFixture("intent-ok");
    result = prepareIntent(intent);
    assert(result.status === 2 && result.json.status === "needs-user" && result.json.domainMutation === "none", "valid intent prepare did not stop for a user");
    assert(read(intent.proposalRelative).equals(intent.proposal), "intent prepare mutated the proposal");
    const pending = pendingFor(result);
    assert(pending.change.id === intent.id && pending.change.rootPath === `.meta/changes/${intent.id}`, "pending did not bind exact change identity");
    const preview = pending.preview && pending.preview.exactUnifiedPreview;
    assert(preview && preview.format === "steadyspec-exact-unified-insertion-v1" && Buffer.from(preview.fieldBeforeBase64, "base64").equals(intent.proposal.subarray(intent.request.fieldSectionStartByte, intent.request.fieldSectionEndByte)) && preview.fieldAfterUtf8.includes("added expansion") && preview.unifiedDiffUtf8.includes("+ - added expansion".replace("+ ", "+")), "intent pending lacks exact contextual unified preview");
    const pendingBytes = read(result.json.pendingPath);
    const pendingTime = fs.statSync(path.join(repo, ...result.json.pendingPath.split("/"))).mtimeMs;
    const duplicate = prepareIntent(intent);
    assert(duplicate.status === 2 && duplicate.json.decisionId === pending.decisionId, "duplicate prepare did not reuse the binding");
    assert(read(result.json.pendingPath).equals(pendingBytes) && fs.statSync(path.join(repo, ...result.json.pendingPath.split("/"))).mtimeMs === pendingTime, "duplicate prepare rewrote immutable pending state");

    decisionFor(pending, "approve-exact-transaction", { bindingHash: `sha256:${"0".repeat(64)}` });
    result = commit(pending);
    assert(result.status === 3 && result.json.status === "replay-conflict" && read(intent.proposalRelative).equals(intent.proposal), "mismatched decision changed the proposal");
    decisionFor(pending);
    result = commit(pending);
    assert(result.status === 0 && result.json.status === "committed" && result.json.action === "proposal-readback-passed-write-drift-evidence", "intent commit did not prove the exact insertion");
    assert(read(intent.proposalRelative).equals(intent.after), "intent commit bytes differ from before+addition+after");
    const commitRelative = `.steadyspec/human-transactions/${pending.decisionId}/commit.json`;
    const terminalBytes = read(commitRelative);
    const terminalTime = fs.statSync(path.join(repo, ...commitRelative.split("/"))).mtimeMs;
    const proposalTime = fs.statSync(path.join(repo, ...intent.proposalRelative.split("/"))).mtimeMs;
    result = commit(pending);
    assert(result.status === 0 && result.json.status === "already-committed", "intent commit replay was not idempotent");
    result = run(["status", "--decision-id", pending.decisionId, "--json"]);
    assert(result.status === 0 && result.json.status === "already-committed", "status did not revalidate committed postconditions");
    assert(read(commitRelative).equals(terminalBytes) && fs.statSync(path.join(repo, ...commitRelative.split("/"))).mtimeMs === terminalTime && fs.statSync(path.join(repo, ...intent.proposalRelative.split("/"))).mtimeMs === proposalTime, "terminal replay/status performed a write");
    decisionFor(pending, "cancel");
    result = run(["status", "--decision-id", pending.decisionId, "--json"]);
    assert(result.status === 3 && result.json.status === "replay-conflict" && result.json.decisionBindingValid === false, "committed status accepted a replaced cancel decision");
    decisionFor(pending);

    const escapedField = intentFixture("intent-field-escape", "- escaped\n");
    escapedField.request.fieldSectionStartByte = 0;
    escapedField.request.fieldSectionEndByte = escapedField.proposal.length;
    escapedField.request.insertionOffsetByte = escapedField.proposal.indexOf(Buffer.from("- excluded"));
    writePackedSmokeJson(path.join(repo, ...escapedField.requestRelative.split("/")), escapedField.request);
    result = prepareIntent(escapedField);
    assert(result.status === 2 && result.json.status === "invalid" && read(escapedField.proposalRelative).equals(escapedField.proposal), "intent field range escaped the code-derived section");

    const midLine = intentFixture("intent-mid-line", "- mid line\n");
    midLine.request.insertionOffsetByte = midLine.proposal.indexOf(Buffer.from("original")) + 2;
    writePackedSmokeJson(path.join(repo, ...midLine.requestRelative.split("/")), midLine.request);
    result = prepareIntent(midLine);
    assert(result.status === 2 && result.json.status === "invalid" && read(midLine.proposalRelative).equals(midLine.proposal), "mid-line insertion offset was accepted");

    const cjkId = "intent-mid-codepoint";
    const cjkProposalRelative = `.meta/changes/${cjkId}/proposal.md`;
    const cjkProposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- 中文\n\n### Out of Scope\n- excluded\n", "utf8");
    write(cjkProposalRelative, cjkProposal);
    const cjkStart = cjkProposal.indexOf(Buffer.from("### In Scope"));
    const cjkEnd = cjkProposal.indexOf(Buffer.from("### Out of Scope"));
    const cjkRequestRelative = `.steadyspec/requests/${cjkId}.json`;
    writePackedSmokeJson(path.join(repo, ...cjkRequestRelative.split("/")), { schemaVersion: 1, proposalPath: cjkProposalRelative, fieldId: "boundary.inScope", fieldSectionStartByte: cjkStart, fieldSectionEndByte: cjkEnd, insertionOffsetByte: cjkProposal.indexOf(Buffer.from("中", "utf8")) + 1, additionBase64: Buffer.from("- invalid\n").toString("base64") });
    result = run(["prepare", "--kind", "intent-expansion", "--change", cjkId, "--request", cjkRequestRelative, "--json"]);
    assert(result.status === 2 && result.json.status === "invalid" && read(cjkProposalRelative).equals(cjkProposal), "mid-codepoint insertion produced a pending transaction");

    const unsafeIntent = intentFixture("intent-unsafe", "- visual\u202ereversal\n");
    result = prepareIntent(unsafeIntent);
    assert(result.status === 2 && result.json.status === "invalid" && read(unsafeIntent.proposalRelative).equals(unsafeIntent.proposal), "unsafe directionality text entered a pending preview");

    const arbitrary = intentFixture("intent-arbitrary", "- arbitrary\n");
    write(`.meta/changes/${arbitrary.id}/notes.md`, arbitrary.proposal);
    arbitrary.request.proposalPath = `.meta/changes/${arbitrary.id}/notes.md`;
    writePackedSmokeJson(path.join(repo, ...arbitrary.requestRelative.split("/")), arbitrary.request);
    result = prepareIntent(arbitrary);
    assert(result.status === 2 && result.json.status === "invalid", "intent transaction accepted a non-proposal carrier");

    const cancelled = intentFixture("intent-cancel", "- cancelled\n");
    const cancelledPending = pendingFor(prepareIntent(cancelled));
    decisionFor(cancelledPending, "cancel");
    result = cancel(cancelledPending);
    assert(result.status === 0 && result.json.status === "cancelled" && read(cancelled.proposalRelative).equals(cancelled.proposal), "cancel mutated the proposal");
    const cancelJournal = read(`.steadyspec/human-transactions/${cancelledPending.decisionId}/commit.json`);
    result = cancel(cancelledPending);
    assert(result.status === 0 && result.json.status === "already-cancelled" && read(`.steadyspec/human-transactions/${cancelledPending.decisionId}/commit.json`).equals(cancelJournal), "cancel replay was not no-write idempotent");

    const stale = intentFixture("intent-stale", "- stale\n");
    const stalePending = pendingFor(prepareIntent(stale));
    decisionFor(stalePending);
    fs.appendFileSync(path.join(repo, ...stale.proposalRelative.split("/")), "external drift\n", "utf8");
    result = run(["status", "--decision-id", stalePending.decisionId, "--json"]);
    assert(result.status === 3 && result.json.status === "stale", "pending status did not surface proposal drift");
    result = commit(stalePending);
    assert(result.status === 3 && result.json.status === "stale" && !fs.existsSync(path.join(repo, `.steadyspec/human-transactions/${stalePending.decisionId}/commit.json`)), "stale intent started a commit journal");

    const locked = intentFixture("intent-lock", "- locked\n");
    const lockedPending = pendingFor(prepareIntent(locked));
    decisionFor(lockedPending);
    const lockKey = crypto.createHash("sha256").update(`${lockedPending.change.rootPath}\n${lockedPending.binding.operation.proposalPath}`, "utf8").digest("hex");
    const lockName = `target-${lockKey}`;
    const lockRelative = `.steadyspec/human-transactions/.locks/${lockName}.lock`;
    const writeLockOwner = (pid, token) => {
      const owner = { schemaVersion: 1, recordType: "transaction-lock-owner", lockName, pid, createdAt: "2026-07-18T00:00:00.000Z", runtimeIdentity: lockedPending.runtimeIdentity, token, ownerHash: "" };
      owner.ownerHash = recordHash(owner, "ownerHash");
      fs.mkdirSync(path.join(repo, ...lockRelative.split("/")), { recursive: true });
      writePackedSmokeJson(path.join(repo, ...lockRelative.split("/"), "owner.json"), owner);
    };
    writeLockOwner(process.pid, "1".repeat(32));
    result = commit(lockedPending);
    assert(result.status === 4 && result.json.status === "recovery-required" && read(locked.proposalRelative).equals(locked.proposal), "lock contention changed the domain");
    fs.rmSync(path.join(repo, ...lockRelative.split("/")), { recursive: true });
    writeLockOwner(2147483647, "2".repeat(32));
    result = commit(lockedPending);
    assert(result.status === 0 && result.json.status === "committed" && read(locked.proposalRelative).equals(locked.after), "dead lock owner was not safely reclaimed for exact recovery");

    const redirected = intentFixture("intent-journal-redirect", "- authorized only here\n");
    const redirectedPending = pendingFor(prepareIntent(redirected));
    decisionFor(redirectedPending);
    write(`.meta/changes/${redirected.id}/other.md`, redirected.proposal);
    result = commit(redirectedPending, { STEADYSPEC_INTERNAL_TRANSACTION_FAULT: "intent-validated" });
    assert(result.status === 4, "redirect fixture did not stop after journal creation");
    const redirectedJournalPath = `.steadyspec/human-transactions/${redirectedPending.decisionId}/commit.json`;
    const redirectedJournal = JSON.parse(read(redirectedJournalPath).toString("utf8"));
    redirectedJournal.workPaths = {
      proposal: `.meta/changes/${redirected.id}/other.md`,
      temp: `.meta/changes/${redirected.id}/.other.md.after.tmp`,
      backup: `.meta/changes/${redirected.id}/.other.md.before.bak`,
    };
    redirectedJournal.commitHash = recordHash(redirectedJournal, "commitHash");
    writePackedSmokeJson(path.join(repo, ...redirectedJournalPath.split("/")), redirectedJournal);
    result = commit(redirectedPending);
    assert(result.status === 3 && result.json.status === "replay-conflict" && read(`.meta/changes/${redirected.id}/other.md`).equals(redirected.proposal) && read(redirected.proposalRelative).equals(redirected.proposal), "self-hashed journal redirected the approved target");

    const faultedIntent = intentFixture("intent-fault", "- recovered\n");
    const faultedIntentPending = pendingFor(prepareIntent(faultedIntent));
    decisionFor(faultedIntentPending);
    result = commit(faultedIntentPending, { STEADYSPEC_INTERNAL_TRANSACTION_FAULT: "intent-backup-created" });
    assert(result.status === 4 && result.json.status === "recovery-required" && result.json.domainMutation === "possible-partial-inspect-journal", "intent fault output hid possible partial domain mutation");
    result = commit(faultedIntentPending);
    assert(result.status === 0 && result.json.status === "committed" && read(faultedIntent.proposalRelative).equals(faultedIntent.after), "intent fault retry did not recover exact bytes");

    const hardIntent = intentFixture("intent-hard-crash", "- hard recovered\n");
    const hardIntentPending = pendingFor(prepareIntent(hardIntent));
    decisionFor(hardIntentPending);
    result = commit(hardIntentPending, { STEADYSPEC_INTERNAL_TRANSACTION_CRASH: "intent-backup-created" });
    assert(result.status === 86 && !result.json, "intent hard-crash fixture did not terminate the owner process");
    result = commit(hardIntentPending);
    assert(result.status === 0 && result.json.status === "committed" && read(hardIntent.proposalRelative).equals(hardIntent.after), "intent exact retry did not reclaim a dead owner lock");

    const prepareCrash = intentFixture("intent-prepare-crash", "- prepare recovered\n");
    result = run(["prepare", "--kind", "intent-expansion", "--change", prepareCrash.id, "--request", prepareCrash.requestRelative, "--json"], { STEADYSPEC_INTERNAL_TRANSACTION_CRASH: "prepare-candidate-written" });
    assert(result.status === 86 && read(prepareCrash.proposalRelative).equals(prepareCrash.proposal), "prepare hard crash mutated the proposal");
    result = prepareIntent(prepareCrash);
    assert(result.status === 2 && result.json.status === "needs-user", "prepare did not recover after an unpublished candidate directory crash");

    const archive = archiveFixture("archive-ok");
    const archivePending = pendingFor(prepareArchive(archive));
    assert(fs.existsSync(path.join(repo, ...archive.sourceRoot.split("/"))) && !fs.existsSync(path.join(repo, ...archive.targetRoot.split("/"))), "archive prepare mutated source or target");
    decisionFor(archivePending);
    result = commit(archivePending);
    assert(result.status === 0 && result.json.status === "committed" && result.json.action === "archived" && result.json.postconditions.filesystemState === "archived", "archive commit did not reach filesystem archived");
    assert(!fs.existsSync(path.join(repo, ...archive.sourceRoot.split("/"))) && read(`${archive.targetRoot}/archive.md`).equals(archive.archive), "archive terminal filesystem is incorrect");
    const archiveJournal = read(`.steadyspec/human-transactions/${archivePending.decisionId}/commit.json`);
    result = commit(archivePending);
    assert(result.status === 0 && result.json.status === "already-committed" && read(`.steadyspec/human-transactions/${archivePending.decisionId}/commit.json`).equals(archiveJournal), "archive replay was not no-write idempotent");

    const faultedArchive = archiveFixture("archive-fault");
    const faultedArchivePending = pendingFor(prepareArchive(faultedArchive));
    decisionFor(faultedArchivePending);
    result = commit(faultedArchivePending, { STEADYSPEC_INTERNAL_TRANSACTION_FAULT: "archive-before-source-retire" });
    assert(result.status === 4 && result.json.domainMutation === "possible-partial-inspect-journal" && fs.existsSync(path.join(repo, ...faultedArchive.sourceRoot.split("/"))) && fs.existsSync(path.join(repo, ...faultedArchive.targetRoot.split("/"))), "archive interruption did not preserve both auditable sides or disclose partial mutation");
    const recoveryStatus = run(["status", "--decision-id", faultedArchivePending.decisionId, "--json"]);
    assert(recoveryStatus.status === 4 && recoveryStatus.json.status === "recovery-required", "in-progress archive status was not recovery-required");
    result = commit(faultedArchivePending);
    assert(result.status === 0 && result.json.status === "committed" && !fs.existsSync(path.join(repo, ...faultedArchive.sourceRoot.split("/"))), "archive retry did not recover to the exact terminal state");

    const mutatedArchive = archiveFixture("archive-target-mutation");
    const mutatedArchivePending = pendingFor(prepareArchive(mutatedArchive));
    decisionFor(mutatedArchivePending);
    result = commit(mutatedArchivePending, { STEADYSPEC_INTERNAL_TRANSACTION_FAULT: "archive-before-source-retire" });
    assert(result.status === 4 && fs.existsSync(path.join(repo, ...mutatedArchive.sourceRoot.split("/"))) && fs.existsSync(path.join(repo, ...mutatedArchive.targetRoot.split("/"))), "archive mutation fixture did not stop with both sides available");
    write(`${mutatedArchive.targetRoot}/archive.md`, Buffer.from("# mutated archive\n", "utf8"));
    result = commit(mutatedArchivePending);
    assert(result.status === 4 && result.json.status === "recovery-required" && fs.existsSync(path.join(repo, ...mutatedArchive.sourceRoot.split("/"))) && fs.existsSync(path.join(repo, ...mutatedArchive.targetRoot.split("/"))), "final archive byte mutation was not detected before source retirement");

    const hardArchive = archiveFixture("archive-hard-crash");
    const hardArchivePending = pendingFor(prepareArchive(hardArchive));
    decisionFor(hardArchivePending);
    result = commit(hardArchivePending, { STEADYSPEC_INTERNAL_TRANSACTION_CRASH: "archive-before-source-retire" });
    assert(result.status === 86 && fs.existsSync(path.join(repo, ...hardArchive.sourceRoot.split("/"))) && fs.existsSync(path.join(repo, ...hardArchive.targetRoot.split("/"))), "archive hard crash did not preserve both sides");
    result = commit(hardArchivePending);
    assert(result.status === 0 && result.json.status === "committed" && !fs.existsSync(path.join(repo, ...hardArchive.sourceRoot.split("/"))), "archive exact retry did not reclaim a dead owner lock");

    write("random/foo/proposal.md", Buffer.from("# arbitrary archive\n", "utf8"));
    writePackedSmokeJson(path.join(repo, ".steadyspec", "requests", "custom-archive.json"), {
      schemaVersion: 1,
      sourceRoot: "random/foo",
      targetRoot: "random/archive/foo",
      archiveBase64: Buffer.from("# archive\n").toString("base64"),
      substrate: "custom",
      docsCheckRequired: false,
    });
    result = run(["prepare", "--kind", "archive-finalize", "--change", "random/foo", "--request", ".steadyspec/requests/custom-archive.json", "--json"]);
    const customPending = pendingFor(result);
    decisionFor(customPending);
    result = commit(customPending);
    assert(result.status === 0 && result.json.status === "committed" && result.json.changeRoot === "random/foo" && !fs.existsSync(path.join(repo, "random", "foo")) && fs.existsSync(path.join(repo, "random", "archive", "foo")), "bounded custom archive did not preserve the code-derived target contract");

    if (process.platform === "win32") {
      const caseId = "CaseAlias";
      const caseProposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- original\n\n### Out of Scope\n- excluded\n", "utf8");
      write(`.meta/changes/${caseId}/proposal.md`, caseProposal);
      const caseStart = caseProposal.indexOf(Buffer.from("### In Scope"));
      const caseEnd = caseProposal.indexOf(Buffer.from("### Out of Scope"));
      const caseRequest = ".steadyspec/requests/case-alias.json";
      writePackedSmokeJson(path.join(repo, ...caseRequest.split("/")), { schemaVersion: 1, proposalPath: ".meta/changes/casealias/proposal.md", fieldId: "boundary.inScope", fieldSectionStartByte: caseStart, fieldSectionEndByte: caseEnd, insertionOffsetByte: caseEnd, additionBase64: Buffer.from("- alias\n").toString("base64") });
      result = run(["prepare", "--kind", "intent-expansion", "--change", "casealias", "--request", caseRequest, "--json"]);
      assert(result.status === 2 && result.json.status === "invalid" && read(`.meta/changes/${caseId}/proposal.md`).equals(caseProposal), "Windows case-only filesystem alias was accepted");
    }

    const docsFailure = archiveFixture("docs-fail", "docs");
    const docsPending = pendingFor(prepareArchive(docsFailure));
    decisionFor(docsPending);
    result = commit(docsPending);
    assert(result.status === 2 && result.json.status === "docs-check-failed" && fs.existsSync(path.join(repo, ...docsFailure.sourceRoot.split("/"))) && !fs.existsSync(path.join(repo, ...docsFailure.targetRoot.split("/"))), "failed docs check changed the archive domain");

    const forgedDocs = archiveFixture("docs-forged-staging", "docs");
    const forgedDocsPending = pendingFor(prepareArchive(forgedDocs));
    decisionFor(forgedDocsPending);
    result = commit(forgedDocsPending, { STEADYSPEC_INTERNAL_TRANSACTION_FAULT: "archive-validated" });
    assert(result.status === 4, "forged docs fixture did not stop after archive journal creation");
    const forgedDocsJournalPath = `.steadyspec/human-transactions/${forgedDocsPending.decisionId}/commit.json`;
    const forgedDocsJournal = JSON.parse(read(forgedDocsJournalPath).toString("utf8"));
    const forgedStaging = path.join(repo, ...forgedDocsJournal.workPaths.staging.split("/"));
    fs.mkdirSync(forgedStaging, { recursive: true });
    fs.copyFileSync(path.join(repo, ...forgedDocs.sourceRoot.split("/"), "proposal.md"), path.join(forgedStaging, "proposal.md"));
    fs.writeFileSync(path.join(forgedStaging, "archive.md"), forgedDocs.archive);
    forgedDocsJournal.phase = "staging-built";
    forgedDocsJournal.status = "in-progress";
    forgedDocsJournal.docsCheck = { required: true, passed: true, policyIdentity: forgedDocsPending.binding.operation.docsCheckPolicyIdentity, errors: [] };
    forgedDocsJournal.history.push({ phase: "staging-built", at: "2026-07-18T00:00:01.000Z" });
    forgedDocsJournal.commitHash = recordHash(forgedDocsJournal, "commitHash");
    writePackedSmokeJson(path.join(repo, ...forgedDocsJournalPath.split("/")), forgedDocsJournal);
    result = commit(forgedDocsPending);
    assert(result.status === 2 && result.json.status === "docs-check-failed" && fs.existsSync(path.join(repo, ...forgedDocs.sourceRoot.split("/"))) && !fs.existsSync(path.join(repo, ...forgedDocs.targetRoot.split("/"))) && !fs.existsSync(forgedStaging), "forged staging docs result bypassed the fresh helper check");

    result = spawnSync(process.execPath, [router, "internal", "human-transaction", "status", "--decision-id", "bad", "--json"], { cwd: repo, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert(result.status === 2 && JSON.parse(result.stdout).status === "invalid", "hidden init route did not preserve helper exit/JSON");
    const help = spawnSync(process.execPath, [router, "--help"], { cwd: repo, encoding: "utf8", timeout: 30000, windowsHide: true });
    assert(!/human-transaction|\binternal\b/.test(help.stdout || ""), "public help exposed the hidden transaction route");
  } catch (error) {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    fail(`human-decision transaction fixtures: ${error.message}`);
  }
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function checkPackedInstall(root, pkg) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-packed-install-"));
  let failure = null;
  let summary = null;
  try {
    const packDir = path.join(temp, "pack");
    const installDir = path.join(temp, "clean-project");
    const globalPrefix = path.join(temp, "global-prefix");
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(installDir, { recursive: true });
    fs.mkdirSync(globalPrefix, { recursive: true });
    const npmCli = locateNpmCliForPackedSmoke();

    validationProgress("install-pack-local-source");
    const packResult = packedSmokeProcess(process.execPath, [npmCli, "pack", root, "--json", "--pack-destination", packDir], packDir, 120000);
    if (packResult.status !== 0) throw packedSmokeFailure("npm pack", packResult);
    const packRows = parsePackedSmokeJson("npm pack", packResult);
    if (!Array.isArray(packRows) || packRows.length !== 1) throw new Error("npm pack must describe exactly one tarball");
    const packed = packRows[0];
    const tarball = path.join(packDir, packed.filename || "");
    if (!packed.filename || !fs.existsSync(tarball)) throw new Error("npm pack did not create its reported tarball");
    if (packed.version !== pkg.version || packed.name !== pkg.name) throw new Error("npm pack name/version differs from package.json");
    const tarballSha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex")}`;
    const packedFiles = new Set((packed.files || []).map((row) => String(row.path || "").replace(/\\/g, "/")));
    const requiredPackedFiles = [
      "package.json",
      "bin/init.js",
      "bin/assurance.js",
      "bin/human-decision-transaction.js",
      "bin/closure.js",
      "bin/closure-fixtures.js",
      "bin/validate.js",
      "tests/portability-fixtures.js",
      "tests/assurance-conformance.js",
      "tests/fixtures/assurance/always-ready.js",
      "tests/fixtures/assurance/incomplete-result.js",
      "release-evidence/v0.6.1/README.md",
      "release-evidence/v0.6.1/manifest.json",
      "release-evidence/v0.7.0/README.md",
      "release-evidence/v0.7.0/manifest.json",
      "schemas/closure-state-v1.schema.json",
      "schemas/acceptance-profile-v1.schema.json",
      "schemas/closure-config-v1.schema.json",
      "protocol/ASSURANCE_PROTOCOL.md",
      "protocol/EXPERIMENT.md",
      "protocol/schemas/assurance-trace-v1.schema.json",
      "protocol/schemas/assurance-result-v1.schema.json",
      "protocol/conformance/cases.jsonl",
      "protocol/examples/empty-trace.json",
      "protocol/examples/minimal-ready-trace.json",
      "en/runtime/closure-env.js",
      "en/runtime/process-cleanup.js",
      "en/flows/steadyspec-verify-flow/SKILL.md",
      "en/flows/steadyspec-archive-flow/SKILL.md",
      "en/runtime/codex/agents/steadyspec-verify-flow.yaml",
      "en/runtime/codex/agents/steadyspec-archive-flow.yaml",
      "README.md",
      "QUICKSTART.md",
      "ARTIFACT_CONTRACT.md",
      "zh/README.md",
      "zh/QUICKSTART.md",
    ];
    for (const relative of requiredPackedFiles) if (!packedFiles.has(relative)) throw new Error(`packed tarball missing ${relative}`);
    const forbiddenPrefixes = [".git/", ".meta/", ".steadyspec/", ".codex/", ".claude/", "node_modules/"];
    const leaked = [...packedFiles].filter((relative) => forbiddenPrefixes.some((prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix)));
    if (leaked.length) throw new Error(`packed tarball leaked workspace paths: ${leaked.join(", ")}`);

    writePackedSmokeJson(path.join(installDir, "package.json"), { name: "steadyspec-packed-smoke", version: "1.0.0", private: true });
    validationProgress("install-isolated-global-prefix");
    const installResult = packedSmokeProcess(process.execPath, [npmCli, "install", "--global", "--prefix", globalPrefix, "--ignore-scripts", "--no-audit", "--no-fund", "--offline", tarball], installDir, 120000);
    if (installResult.status !== 0) throw packedSmokeFailure("isolated global npm install", installResult);
    const installedRoot = process.platform === "win32"
      ? path.join(globalPrefix, "node_modules", "steadyspec")
      : path.join(globalPrefix, "lib", "node_modules", "steadyspec");
    const installedPackage = readJson(path.join(installedRoot, "package.json"));
    if (installedPackage.version !== pkg.version) throw new Error(`installed package version ${installedPackage.version} differs from ${pkg.version}`);
    for (const relative of requiredPackedFiles) if (!fs.existsSync(path.join(installedRoot, relative))) throw new Error(`installed package missing ${relative}`);

    const shimName = process.platform === "win32" ? "steadyspec.cmd" : "steadyspec";
    const shim = process.platform === "win32" ? path.join(globalPrefix, shimName) : path.join(globalPrefix, "bin", shimName);
    if (!fs.existsSync(shim)) throw new Error(`isolated global install did not create ${path.relative(temp, shim).replace(/\\/g, "/")}`);
    validationProgress("install-cli-help-and-init");
    const help = runInstalledShim(shim, ["closure", "--help"], installDir);
    if (help.status !== 0) throw packedSmokeFailure("installed closure --help", help);
    for (const anchor of ["--evaluator-start", "--import-evaluator", "--decide <resume|approve|reject|reopen|abandon>"]) {
      if (!(help.stdout || "").includes(anchor)) throw new Error(`installed closure --help missing ${anchor}`);
    }

    const assuranceTrace = path.join(installDir, "assurance-empty-trace.json");
    const assuranceHelp = runInstalledShim(shim, ["assurance", "--help"], installDir);
    if (assuranceHelp.status !== 0 || !/valid input, not ready-for-human/.test(assuranceHelp.stdout || "") || !(assuranceHelp.stdout || "").includes("project-v06")) throw new Error("installed assurance help lost the validity/authority or compatibility boundary");
    writePackedSmokeJson(assuranceTrace, { schemaVersion: 1, protocolVersion: "0.7", lineageId: "packed-empty", events: [] });
    const assurance = runInstalledShim(shim, ["assurance", "reduce", "--trace", assuranceTrace, "--json"], installDir);
    const assuranceJson = parsePackedSmokeJson("installed assurance reduce", assurance);
    if (assurance.status !== 0 || assuranceJson.assuranceState !== "target-required" || assuranceJson.ok !== true) throw new Error("installed assurance reference process did not preserve the empty-trace contract");
    const installedReadyTrace = path.join(installedRoot, "protocol", "examples", "minimal-ready-trace.json");
    const readyAssurance = runInstalledShim(shim, ["assurance", "reduce", "--trace", installedReadyTrace, "--json"], installDir);
    const readyAssuranceJson = parsePackedSmokeJson("installed assurance ready trace", readyAssurance);
    if (readyAssurance.status !== 0 || readyAssuranceJson.assuranceState !== "ready-for-human" || readyAssuranceJson.ok !== true) throw new Error("installed assurance reference process did not preserve the minimal-ready trace contract");
    const installedConformance = packedSmokeProcess(process.execPath, [path.join(installedRoot, "tests", "assurance-conformance.js"), "--implementation", process.execPath, "--arg", path.join(installedRoot, "bin", "assurance.js")], installDir, 60000);
    if (installedConformance.status !== 0 || !/profiles=core cases=51/.test(installedConformance.stdout || "")) throw packedSmokeFailure("installed assurance core conformance", installedConformance);

    const init = runInstalledShim(shim, ["init", "--runtime", "codex", "--substrate", "docs", "--closure", "manual", "--force"], installDir, 60000);
    if (init.status !== 0) throw packedSmokeFailure("installed init", init);
    const generatedConfigPath = path.join(installDir, ".steadyspec", "closure.json");
    const generatedConfig = readJson(generatedConfigPath);
    if (generatedConfig.mode !== "manual" || Object.keys(generatedConfig.proofPolicies || {}).length !== 0 || !/not human acceptance/i.test(generatedConfig.boundary || "")) {
      throw new Error("installed init did not preserve the manual, empty-policy, human-authority template boundary");
    }
    for (const relative of [
      ".codex/skills/steadyspec-verify-flow/SKILL.md",
      ".codex/skills/steadyspec-verify-flow/agents/openai.yaml",
      ".codex/skills/steadyspec-archive-flow/SKILL.md",
      ".codex/skills/steadyspec-archive-flow/agents/openai.yaml",
    ]) if (!fs.existsSync(path.join(installDir, relative))) throw new Error(`installed init output missing ${relative}`);

    validationProgress("install-human-transaction-lifecycle");
    const { recordHash: installedRecordHash } = require(path.join(installedRoot, "bin", "human-decision-transaction.js"));
    const installedDecision = (pending, decision) => {
      const record = {
        schemaVersion: 1, contractVersion: 1, recordType: "human-decision",
        decisionId: pending.decisionId, kind: pending.kind, pendingHash: pending.pendingHash,
        bindingHash: pending.bindingHash, decision, reason: "packed installed exact transaction",
        confirmedBy: "packed-fixture-human", confirmedAt: "2026-07-18T00:00:00.000Z",
        confirmationRef: "packed-install-smoke", decisionHash: "",
      };
      record.decisionHash = installedRecordHash(record, "decisionHash");
      writePackedSmokeJson(path.join(installDir, ...pending.expectedDecisionPath.split("/")), record);
    };
    const installedPrepare = (kind, id, requestRelative) => {
      const preparedResult = runInstalledShim(shim, ["internal", "human-transaction", "prepare", "--kind", kind, "--change", id, "--request", requestRelative, "--json"], installDir);
      const json = parsePackedSmokeJson(`installed ${kind} prepare`, preparedResult);
      if (preparedResult.status !== 2 || json.status !== "needs-user" || json.domainMutation !== "none") throw new Error(`installed ${kind} prepare did not stop without domain mutation`);
      return readJson(path.join(installDir, ...json.pendingPath.split("/")));
    };
    const installedFinish = (action, pending) => runInstalledShim(shim, ["internal", "human-transaction", action, "--decision-id", pending.decisionId, "--decision-record", pending.expectedDecisionPath, "--json"], installDir);
    const installedIntentFixture = (id, addition) => {
      const proposalRelative = `.meta/changes/${id}/proposal.md`;
      const proposal = Buffer.from("# Proposal\n\n## Boundary\n\n### In Scope\n- original\n\n### Out of Scope\n- excluded\n", "utf8");
      const proposalFile = path.join(installDir, ...proposalRelative.split("/"));
      fs.mkdirSync(path.dirname(proposalFile), { recursive: true });
      fs.writeFileSync(proposalFile, proposal);
      const start = proposal.indexOf(Buffer.from("### In Scope"));
      const end = proposal.indexOf(Buffer.from("### Out of Scope"));
      const requestRelative = `.steadyspec/packed-requests/${id}.json`;
      writePackedSmokeJson(path.join(installDir, ...requestRelative.split("/")), { schemaVersion: 1, proposalPath: proposalRelative, fieldId: "boundary.inScope", fieldSectionStartByte: start, fieldSectionEndByte: end, insertionOffsetByte: end, additionBase64: Buffer.from(addition).toString("base64") });
      return { id, requestRelative, proposalFile, expected: Buffer.concat([proposal.subarray(0, end), Buffer.from(addition), proposal.subarray(end)]) };
    };
    let txFixture = installedIntentFixture("packed-intent-commit", "- installed commit\n");
    let txPending = installedPrepare("intent-expansion", txFixture.id, txFixture.requestRelative);
    installedDecision(txPending, "approve-exact-transaction");
    let txResult = installedFinish("commit", txPending);
    if (txResult.status !== 0 || parsePackedSmokeJson("installed intent commit", txResult).action !== "proposal-readback-passed-write-drift-evidence" || !fs.readFileSync(txFixture.proposalFile).equals(txFixture.expected)) throw packedSmokeFailure("installed intent commit", txResult);
    txFixture = installedIntentFixture("packed-intent-cancel", "- installed cancel\n");
    txPending = installedPrepare("intent-expansion", txFixture.id, txFixture.requestRelative);
    installedDecision(txPending, "cancel");
    txResult = installedFinish("cancel", txPending);
    if (txResult.status !== 0 || parsePackedSmokeJson("installed intent cancel", txResult).status !== "cancelled") throw packedSmokeFailure("installed intent cancel", txResult);

    const installedArchiveFixture = (id) => {
      const sourceRoot = `.meta/changes/${id}`;
      const source = path.join(installDir, ...sourceRoot.split("/"));
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, "proposal.md"), "# packed archive\n", "utf8");
      const requestRelative = `.steadyspec/packed-requests/${id}-archive.json`;
      writePackedSmokeJson(path.join(installDir, ...requestRelative.split("/")), { schemaVersion: 1, sourceRoot, targetRoot: `.meta/changes/archive/${id}`, archiveBase64: Buffer.from(`# archive ${id}\n`).toString("base64"), substrate: "meta", docsCheckRequired: false });
      return { id, sourceRoot, targetRoot: `.meta/changes/archive/${id}`, requestRelative };
    };
    let archiveTx = installedArchiveFixture("packed-archive-commit");
    txPending = installedPrepare("archive-finalize", archiveTx.id, archiveTx.requestRelative);
    installedDecision(txPending, "approve-exact-transaction");
    txResult = installedFinish("commit", txPending);
    if (txResult.status !== 0 || parsePackedSmokeJson("installed archive commit", txResult).action !== "archived" || fs.existsSync(path.join(installDir, ...archiveTx.sourceRoot.split("/"))) || !fs.existsSync(path.join(installDir, ...archiveTx.targetRoot.split("/")))) throw packedSmokeFailure("installed archive commit", txResult);
    archiveTx = installedArchiveFixture("packed-archive-cancel");
    txPending = installedPrepare("archive-finalize", archiveTx.id, archiveTx.requestRelative);
    installedDecision(txPending, "cancel");
    txResult = installedFinish("cancel", txPending);
    if (txResult.status !== 0 || parsePackedSmokeJson("installed archive cancel", txResult).status !== "cancelled" || !fs.existsSync(path.join(installDir, ...archiveTx.sourceRoot.split("/")))) throw packedSmokeFailure("installed archive cancel", txResult);

    validationProgress("install-closure-lifecycle");
    const changeRelative = "docs/changes/001-packed-smoke";
    const changeDir = path.join(installDir, ...changeRelative.split("/"));
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "schemaVersion: 1\n\n# Packed smoke intent\n\nExercise the installed v0.6 closure boundary.\n", "utf8");
    const missingProfile = runInstalledShim(shim, ["closure", "--change", changeRelative, "--validate-config", "--json"], installDir);
    if (missingProfile.status !== 2) throw new Error(`installed missing-profile error must exit 2, observed ${missingProfile.status}`);
    const missingProfileJson = parsePackedSmokeJson("installed missing-profile error", missingProfile);
    if (missingProfileJson.status !== "invalid" || !(missingProfileJson.errors || []).some((value) => /acceptance profile missing|proofPolicies/.test(value))) {
      throw new Error("installed missing-profile error JSON lost its actionable contract");
    }

    const policyId = "installed-pass";
    writePackedSmokeJson(generatedConfigPath, {
      schemaVersion: 1,
      mode: "manual",
      acceptanceProfile: "acceptance-profile.json",
      limits: { maxCycles: 2, wallClockMs: 600000, maxAutoFiles: 1, recurrenceLimit: 1, noProgressCycles: 1 },
      proofPolicies: {
        [policyId]: {
          executable: "node",
          args: ["-e", "process.exit(0)"],
          cwd: ".",
          timeoutMs: 10000,
          maxOutputBytes: 100000,
          envKeys: [],
          idempotent: true,
          dependsOn: [],
          outputs: [],
          mutableStateSurfaces: [],
          expectedExitCodes: [0],
          evidenceContract: {
            kind: "exit-code-only",
            claim: "The installed package can execute one operator-configured direct proof.",
            coverageLimit: `One no-side-effect Node exit on this fresh ${process.platform} project only.`
          }
        }
      },
      generatedTemplate: false,
      reviewRequired: false,
      boundary: `Fresh ${process.platform} packed-install smoke; machine output is not human acceptance or release authority.`
    });
    const dimensionIds = ["requirement-completeness", "logic-correctness", "edge-cases", "code-quality", "test-coverage", "actual-runtime-result"];
    writePackedSmokeJson(path.join(changeDir, "acceptance-profile.json"), {
      schemaVersion: 1,
      id: "packed-install-smoke",
      candidatePaths: [`${changeRelative}/proposal.md`],
      dimensions: dimensionIds.map((id) => ({
        id,
        required: true,
        proofPolicyIds: [policyId],
        requiredSourceClasses: ["runtime-observation"],
        coverageLimit: "Installed CLI lifecycle smoke only; no reviewer quality or semantic acceptance claim."
      }))
    });

    const validConfig = runInstalledShim(shim, ["closure", "--change", changeRelative, "--validate-config", "--json"], installDir);
    if (validConfig.status !== 0 || parsePackedSmokeJson("installed validate-config", validConfig).status !== "valid") throw packedSmokeFailure("installed validate-config", validConfig);
    const prepared = runInstalledShim(shim, ["closure", "--change", changeRelative, "--prepare", "--json"], installDir);
    if (prepared.status !== 0) throw packedSmokeFailure("installed prepare", prepared);
    const preparedJson = parsePackedSmokeJson("installed prepare", prepared);
    if (preparedJson.state !== "critic-required" || !/^sha256:[a-f0-9]{64}$/.test(preparedJson.candidateFingerprint || "")) throw new Error("installed prepare did not create a fingerprint-bound critic-required state");
    const initialStatus = runInstalledShim(shim, ["closure", "--change", changeRelative, "--status", "--json"], installDir);
    if (initialStatus.status !== 0 || parsePackedSmokeJson("installed initial status", initialStatus).state !== "critic-required") throw packedSmokeFailure("installed initial status", initialStatus);

    const criticDir = path.join(changeDir, "cross-agent", "critic-no-findings");
    fs.mkdirSync(criticDir, { recursive: true });
    const criticRaw = path.join(criticDir, "raw.md");
    fs.writeFileSync(criticRaw, "# Packed-install Critic\n\n| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |\n|---|---|---|---|---|---|---|\n\n- No findings: confirmed\n", "utf8");
    writePackedSmokeJson(path.join(criticDir, "run.json"), {
      schemaVersion: 1,
      reviewer: "packed-install-smoke",
      mode: "review",
      reviewerStatus: "success",
      outputFormat: "findings_table",
      candidateFingerprint: preparedJson.candidateFingerprint,
      transport: "deterministic-installed-smoke",
      paths: { raw: criticRaw }
    });
    const criticImported = runInstalledShim(shim, ["closure", "--change", changeRelative, "--import-critic", path.relative(installDir, criticDir), "--json"], installDir);
    if (criticImported.status !== 0 || parsePackedSmokeJson("installed Critic import", criticImported).state !== "proofs-required") throw packedSmokeFailure("installed Critic import", criticImported);
    const proofs = runInstalledShim(shim, ["closure", "--change", changeRelative, "--run-proofs", "--json"], installDir, 60000);
    if (proofs.status !== 0) throw packedSmokeFailure("installed proof", proofs);
    const proofsJson = parsePackedSmokeJson("installed proof", proofs);
    if (proofsJson.state !== "evaluator-required" || !/^sha256:[a-f0-9]{64}$/.test(proofsJson.evidenceBundleFingerprint || "")) throw new Error("installed proof did not create an evidence-bound evaluator-required state");

    const expectedRunDir = `${changeRelative}/cross-agent/expected-evaluator`;
    const startRecordPath = path.join(installDir, ".steadyspec", "packed-evaluator-start.json");
    const startRecord = {
      schemaVersion: 1,
      candidateFingerprint: proofsJson.candidateFingerprint,
      evidenceBundleFingerprint: proofsJson.evidenceBundleFingerprint,
      invocationId: "packed-install-evaluator-1",
      reviewer: "packed-install-smoke",
      transport: "deterministic-installed-smoke",
      expectedRunDir
    };
    writePackedSmokeJson(startRecordPath, startRecord);
    const started = runInstalledShim(shim, ["closure", "--change", changeRelative, "--evaluator-start", path.relative(installDir, startRecordPath), "--json"], installDir);
    if (started.status !== 0) throw packedSmokeFailure("installed evaluator-start", started);
    const startedJson = parsePackedSmokeJson("installed evaluator-start", started);
    if (startedJson.state !== "evaluator-running" || startedJson.invocationId !== startRecord.invocationId || startedJson.expectedRunDir !== expectedRunDir) throw new Error("installed evaluator-start did not persist the exact invocation identity");
    const invocation = readJson(path.join(changeDir, "closure", "cycles", "001", "evaluator-invocation.json"));
    for (const [key, value] of Object.entries(startRecord)) if (invocation[key] !== value) throw new Error(`installed evaluator invocation changed ${key}`);

    const duplicate = runInstalledShim(shim, ["closure", "--change", changeRelative, "--evaluator-start", path.relative(installDir, startRecordPath), "--json"], installDir);
    if (duplicate.status !== 2 || !(parsePackedSmokeJson("installed duplicate evaluator-start", duplicate).errors || []).some((value) => /requires evaluator-required/.test(value))) {
      throw new Error("installed duplicate evaluator-start did not fail closed with exit 2");
    }
    const mismatchedDir = path.join(changeDir, "cross-agent", "mismatched-evaluator");
    fs.mkdirSync(mismatchedDir, { recursive: true });
    writePackedSmokeJson(path.join(mismatchedDir, "run.json"), {});
    const mismatched = runInstalledShim(shim, ["closure", "--change", changeRelative, "--import-evaluator", path.relative(installDir, mismatchedDir), "--json"], installDir);
    if (mismatched.status !== 2 || !(parsePackedSmokeJson("installed mismatched evaluator import", mismatched).errors || []).some((value) => /does not match the recorded invocation/.test(value))) {
      throw new Error("installed mismatched evaluator import did not fail closed with exit 2");
    }
    const finalStatus = runInstalledShim(shim, ["closure", "--change", changeRelative, "--status", "--json"], installDir);
    const finalStatusJson = parsePackedSmokeJson("installed final status", finalStatus);
    if (finalStatus.status !== 0 || finalStatusJson.state !== "evaluator-running") throw new Error("failed duplicate/mismatched calls changed the installed evaluator-running state");

    summary = {
      package: `${packed.name}@${packed.version}`,
      tarballSha256,
      packedEntryCount: packed.entryCount,
      installedShim: path.relative(temp, shim).replace(/\\/g, "/"),
      installedLifecycle: ["help", "init", "intent-prepare-commit-cancel", "archive-prepare-commit-cancel", "invalid-config", "valid-config", "prepare", "status", "critic-import", "proof", "evaluator-start"],
      failClosed: ["duplicate-evaluator-start", "mismatched-evaluator-import"],
      terminalState: finalStatusJson.state,
      boundary: `one fresh ${process.platform} project; not registry publication, reviewer quality, process-death, team behavior, semantic correctness, or human acceptance`
    };
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  if (failure) fail(`v0.6 fresh packed-install smoke: ${failure.message}`);
  console.log(`[v0.7 source-install smoke] ${JSON.stringify(summary)}`);
}

async function main() {
  const args = parseValidationArgs(process.argv);
  const root = args.root;
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
  if (pkg.private !== true) fail("source-only distribution requires package.json private=true to prevent accidental npm publication");
  if (!pkg.bin || pkg.bin.steadyspec !== "bin/init.js") {
    fail("package bin must expose steadyspec -> bin/init.js");
  }

  const languages = manifest.languages || [];
  if (languages.join(",") !== "en") fail("manifest languages must be ['en']");

  const skillMappings = manifest.skills || [];
  if (!Array.isArray(skillMappings) || !skillMappings.length) {
    fail("manifest.skills must be a non-empty array");
  }

  const selected = (name) => args.suite === "all" || args.suite === name;

  if (selected("assurance")) await runValidationSuite("assurance", async () => {
    const required = [
      "protocol/ASSURANCE_PROTOCOL.md",
      "protocol/EXPERIMENT.md",
      "protocol/schemas/assurance-trace-v1.schema.json",
      "protocol/schemas/assurance-result-v1.schema.json",
      "protocol/conformance/cases.jsonl",
      "protocol/examples/empty-trace.json",
      "protocol/examples/minimal-ready-trace.json",
      "bin/assurance.js",
      "tests/assurance-conformance.js",
      "tests/fixtures/assurance/always-ready.js",
      "tests/fixtures/assurance/incomplete-result.js",
    ];
    for (const relative of required) if (!fs.existsSync(path.join(root, relative))) fail(`assurance surface missing ${relative}`);
    for (const relative of required.filter((item) => item.endsWith(".json"))) readJson(path.join(root, relative));
    const traceSchema = readJson(path.join(root, "protocol", "schemas", "assurance-trace-v1.schema.json"));
    if (traceSchema.$defs?.trimmedString?.pattern !== "^\\S(?:[\\s\\S]*\\S)?$") fail("assurance trace schema lost the reducer's trimmed-string acceptance boundary");
    const occurredAtSchema = traceSchema.$defs?.eventHeader?.properties?.occurredAt;
    if (occurredAtSchema?.format !== "date-time" || occurredAtSchema?.pattern !== "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?Z$") fail("assurance trace schema lost the reducer's calendar-valid uppercase-Z timestamp boundary");
    const caseLines = readText(path.join(root, "protocol/conformance/cases.jsonl")).trim().split(/\r?\n/);
    if (caseLines.length < 20) fail("assurance conformance catalog lost mandatory case breadth");
    for (const line of caseLines) JSON.parse(line);
    for (const anchor of ["experimental protocol candidate", "ready-for-human", "legacy-ready-claim-unverified", "Snapshot/currentness limit", "restricted canonical JSON", "model-independent core process profile", "--include-v06-projection", "complete strict result"]) requireText(root, "protocol/ASSURANCE_PROTOCOL.md", anchor);
    const runnerText = readText(path.join(root, "tests", "assurance-conformance.js"));
    for (const anchor of ["resultSchemaPath", "schemaErrors(output, resultSchema)", "protocolFingerprint(\"result\"", "includeV06Projection", "v06-projection"]) if (!runnerText.includes(anchor)) fail(`assurance conformance runner missing strict/profile boundary: ${anchor}`);
    const result = spawnSync(process.execPath, [path.join(root, "tests", "assurance-conformance.js")], { cwd: root, encoding: "utf8", timeout: 60000, windowsHide: true });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) fail(`assurance conformance failed with exit ${result.status}`);
  });

  if (selected("contract")) await runValidationSuite("contract", async () => {
    checkTransportEolEquivalenceContract();
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (IGNORED_ROOT_DEV_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() && !ALLOWED_ROOT_DIRS.has(entry.name)) fail(`unexpected package root directory: ${entry.name}`);
      if (entry.isFile() && !ALLOWED_ROOT_FILES.has(entry.name)) fail(`unexpected package root file: ${entry.name}`);
    }
    for (const file of walk(root)) {
      const parts = rel(root, file).split("/");
      if (parts.some((part) => FORBIDDEN_NAMES.has(part))) fail(`forbidden dev/runtime artifact: ${rel(root, file)}`);
    }
    for (const lang of languages) {
      for (const sourceDir of skillMappings) {
        const runtimeName = path.basename(sourceDir);
        const skillPath = path.join(root, lang, sourceDir, "SKILL.md");
        if (!fs.existsSync(skillPath)) fail(`missing skill: ${lang}/${sourceDir}/SKILL.md`);
        validateSkillFrontmatter(skillPath, root);
        if (frontmatterName(skillPath) !== runtimeName) fail(`${lang}/${sourceDir}/SKILL.md name must be ${runtimeName}`);
      }
      for (const file of walk(path.join(root, lang)).filter((item) => path.basename(item) === "SKILL.md")) validateSkillFrontmatter(file, root);
    }
    checkCjkBan(root);
    checkRequiredRootFiles(root);
    checkFlowsReferencePrimitives(root, manifest);
    checkPrimitiveByteEquivalence(root);
    checkV03ResponsibilityModel(root, manifest);
    checkActiveVerbSurface(root);
    checkDocsSubstrateContract(root);
    checkReleaseSurface(root, manifest, pkg);
    checkSourceDistributionDocs(root, pkg);
    checkActiveProductIdentity(root, pkg);
    checkEvidenceContinuityWorkflows(root);
  });

  if (selected("cross-review")) await runValidationSuite("cross-review", async () => {
    validationProgress("cross-review-workflow-preflight");
    checkCrossReviewWorkflowPreflight(root);
    validationProgress("cross-review-v0.5-surface-and-hooks");
    checkV05CrossReview(root);
    validationProgress("cross-review-runner-contract-fixtures");
    checkCrossReviewContracts(root);
  });

  if (selected("closure")) await runValidationSuite("closure", async () => {
    checkV06ClosureContracts(root);
    await checkHumanTransactionWorkflowIntegration(root);
    checkHumanDecisionTransactions(root);
  });

  if (selected("install")) await runValidationSuite("install", async () => {
    checkPackedInstall(root, pkg);
  });

  if (selected("portability")) await runValidationSuite("portability", async () => {
    const result = spawnSync(process.execPath, [path.join(root, "tests", "portability-fixtures.js")], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) fail(`portability fixtures failed with exit ${result.status}`);
  });

  if (args.suite !== "all") {
    warn(`Only suite=${args.suite} was selected; no coverage outside that suite is inferred.`);
  } else if (process.platform === "win32") {
    warn("Composite source contracts plus bounded Windows observations passed; final archive-publication contention, real reviewer quality, arbitrary side-effect isolation, final-candidate trust, POSIX, and team behavior remain outside validation.");
  } else {
    warn("Composite portable source contracts passed; Windows real interruption coverage was unavailable, so no Windows process/rename readiness, human acceptance, or release authority is inferred.");
  }
  console.log(`Validation completed for suite=${args.suite}; no human acceptance or release-authority claim.`);
}

main().catch((error) => fail(`validation exception: ${error && error.stack ? error.stack : error}`));
