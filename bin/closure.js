#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { buildScrubbedEnv } = require("../en/runtime/closure-env");
const { terminateProcessTree } = require("../en/runtime/process-cleanup");

const CONTRACT_VERSION = "0.6";
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const DIMENSION_IDS = [
  "requirement-completeness",
  "logic-correctness",
  "edge-cases",
  "code-quality",
  "test-coverage",
  "actual-runtime-result",
];
const STATES = new Set([
  "idle", "critic-required", "builder-required", "builder-in-progress",
  "proofs-required", "evaluator-required", "evaluator-running",
  "candidate-ready", "fix-required", "needs-user",
  "blocked-by-environment", "non-convergent", "abandoned",
]);
const TERMINAL_STATES = new Set(["candidate-ready", "needs-user", "blocked-by-environment", "non-convergent", "abandoned"]);
const STATE_KEYS = [
  "schemaVersion", "contractVersion", "lineageId", "change", "mode", "state",
  "cycle", "nextAction", "inProgressStep", "completedSteps",
  "candidateFingerprint", "candidateManifest", "evidenceBundleFingerprint",
  "evidenceManifest", "findings", "builder", "proofs", "evaluator", "counters",
  "escalations", "decisions", "contextLimits", "createdAt", "updatedAt",
];
const SAME_FAMILY_MINIMUM_SOURCES = {
  "requirement-completeness": ["structural-check", "deterministic-check"],
  "logic-correctness": ["deterministic-check", "runtime-observation"],
  "edge-cases": ["deterministic-check", "runtime-observation"],
  "code-quality": ["structural-check", "deterministic-check"],
  "test-coverage": ["structural-check", "deterministic-check"],
  "actual-runtime-result": ["runtime-observation"],
};
const ROLE_CONTRACTS = {
  critic: "critic-findings-table-v1",
  evaluator: "evaluator-json-v1",
};
const SCHEMA_SHA256 = {
  state: "sha256:007c6ef475f5653b5dc633979a5c173467dfb661097f0a1776d46183bd57c91f",
  profile: "sha256:9547f68d3531080fd2b9dd3d0f3295974356c9f0dba4c7acd8a6c080fbc62d64",
  config: "sha256:383bf4a7cc9f129b683e83b01cf61a8d644f7f05c753d4979ea3d11097b9f51b",
};
const SENSITIVE_PATH = /(?:^|\/)(?:\.git|node_modules|cross-agent|closure)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const AUTO_PROTECTED_PATHS = [
  /(?:^|\/)(?:proposal|requirements|evidence-contract|acceptance-profile)(?:\.md|\.json)$/i,
  /^(?:README|QUICKSTART|CHANGELOG|ARTIFACT_CONTRACT|EVIDENCE|SCOPE)\.md$/i,
  /^zh\/(?:README|QUICKSTART|CHANGELOG|ARTIFACT_CONTRACT|EVIDENCE|SCOPE)\.md$/i,
  /^(?:manifest|package)\.json$/i,
  /^schemas\//i,
  /^\.steadyspec\//i,
];
const SAFE_RISK_ASSESSMENT = {
  requirements: "unchanged",
  proofStrategy: "unchanged",
  userVisibleOutcome: "unchanged",
  securityOrMigration: "unchanged",
  residualP12Accepted: false,
  semanticReviewRequired: true,
};

function usage() {
  return `steadyspec closure

Usage:
  steadyspec closure --change <id-or-path> --validate-config [--json]
  steadyspec closure --change <id-or-path> --prepare [--json]
  steadyspec closure --change <id-or-path> --status [--json]
  steadyspec closure --change <id-or-path> --dry-run-env [--json]
  steadyspec closure --change <id-or-path> --calibrate <policy-id> [--json]
  steadyspec closure --change <id-or-path> --import-critic <run-dir> [--json]
  steadyspec closure --change <id-or-path> --builder-before <record.json> [--json]
  steadyspec closure --change <id-or-path> --builder-complete <record.json> [--json]
  steadyspec closure --change <id-or-path> --run-proofs [--json]
  steadyspec closure --change <id-or-path> --evaluator-start <record.json> [--json]
  steadyspec closure --change <id-or-path> --import-evaluator <run-dir> [--json]
  steadyspec closure --change <id-or-path> --check [--json]
  steadyspec closure --change <id-or-path> --decide <resume|approve|reject|reopen|abandon> --reason <text> [--json]
  steadyspec closure --change <id-or-path> --recover-previous --reason <text> [--json]
  steadyspec closure --change <id-or-path> --reset --reason <text> [--json]

This support command persists and validates a closure cycle. It never edits
implementation files and never replaces human-owned decisions.
`;
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), change: null, json: false, reason: null, action: null, value: null };
  const valueActions = new Set(["--calibrate", "--import-critic", "--builder-before", "--builder-complete", "--evaluator-start", "--import-evaluator", "--decide"]);
  const flagActions = new Set(["--validate-config", "--prepare", "--status", "--dry-run-env", "--run-proofs", "--check", "--recover-previous", "--reset"]);
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--json") { args.json = true; continue; }
    if (arg === "--repo" || arg === "--change" || arg === "--reason") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === "--repo") args.repo = value;
      if (arg === "--change") args.change = value;
      if (arg === "--reason") args.reason = value;
      index += 1;
      continue;
    }
    if (flagActions.has(arg) || valueActions.has(arg)) {
      if (args.action) throw new Error(`choose exactly one closure action; already selected ${args.action}`);
      args.action = arg.slice(2);
      if (valueActions.has(arg)) {
        const value = argv[index + 1];
        if (!value) throw new Error(`${arg} requires a value`);
        args.value = value;
        index += 1;
      }
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.change) throw new Error("--change is required");
  if (!args.action) throw new Error("one closure action is required");
  if (["decide", "recover-previous", "reset"].includes(args.action) && !args.reason) throw new Error(`--${args.action} requires --reason`);
  return args;
}

function repoRoot(input) {
  const requested = path.resolve(input);
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: requested, encoding: "utf8", timeout: 30000 });
  const observed = result.status === 0 && result.stdout.trim() ? path.resolve(result.stdout.trim()) : requested;
  return realpathWithMissingTail(observed);
}

function realpathWithMissingTail(value) {
  let cursor = path.resolve(value);
  const tail = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`no existing ancestor for ${value}`);
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  const real = fs.realpathSync.native ? fs.realpathSync.native(cursor) : fs.realpathSync(cursor);
  return path.resolve(real, ...tail);
}

function containedPathIdentity(parent, child) {
  try {
    const realParent = realpathWithMissingTail(parent);
    const realChild = realpathWithMissingTail(child);
    const relative = path.relative(realParent, realChild);
    const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    return { inside, relative: inside ? relative.replace(/\\/g, "/") : "", realParent, realChild };
  } catch (error) {
    return { inside: false, relative: "", realParent: "", realChild: "", error: error.message };
  }
}

function pathInsideOrSame(parent, child) {
  return containedPathIdentity(parent, child).inside;
}

function resolveChange(repo, input) {
  const direct = path.resolve(repo, input);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;
  for (const root of [".meta/changes", "docs/changes", "openspec/changes"]) {
    const candidate = path.join(repo, root, input);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`change directory not found: ${input}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
  writeJson(temporary, value);
  fs.renameSync(temporary, file);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function hashBuffer(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function hashValue(value) {
  return hashBuffer(Buffer.from(canonicalJson(value), "utf8"));
}

function hashFile(file) {
  return hashBuffer(fs.readFileSync(file));
}

function hashPortableTextFile(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return hashBuffer(Buffer.from(text, "utf8"));
}

function diagnosticHash(value) {
  return hashValue({ present: value !== undefined, value: value === undefined ? null : value });
}

function structuredFieldDiff(left, right, prefix = "") {
  if (canonicalJson(left) === canonicalJson(right)) return [];
  const leftObject = left && typeof left === "object";
  const rightObject = right && typeof right === "object";
  if (leftObject && rightObject && Array.isArray(left) === Array.isArray(right)) {
    const keys = Array.isArray(left)
      ? [...Array(Math.max(left.length, right.length)).keys()].map(String)
      : [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => structuredFieldDiff(left[key], right[key], Array.isArray(left) ? `${prefix}[${key}]` : (prefix ? `${prefix}.${key}` : key)));
  }
  return [{ field: prefix || "<root>", beforeHash: diagnosticHash(left), afterHash: diagnosticHash(right) }];
}

function policyDependencyClosure(policies, roots) {
  const included = new Set();
  function visit(id) {
    if (included.has(id) || !policies[id]) return;
    included.add(id);
    for (const dependency of policies[id].dependsOn || []) visit(dependency);
  }
  for (const id of roots) visit(id);
  return included;
}

function policyDependsOn(policies, dependent, dependency, seen = new Set()) {
  if (dependent === dependency || seen.has(dependent) || !policies[dependent]) return false;
  seen.add(dependent);
  for (const direct of policies[dependent].dependsOn || []) {
    if (direct === dependency || policyDependsOn(policies, direct, dependency, seen)) return true;
  }
  return false;
}

function repoRelative(repo, file) {
  const identity = containedPathIdentity(repo, file);
  if (!identity.inside) throw new Error(`path escapes repository identity: ${file}${identity.error ? ` (${identity.error})` : ""}`);
  return identity.relative;
}

function normalizeRel(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`path must be safe repo-relative: ${value}`);
  }
  return normalized;
}

function walkFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(file, out);
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

function patternRoot(pattern) {
  const normalized = normalizeRel(pattern);
  const wildcard = normalized.search(/[?*]/);
  return wildcard < 0 ? normalized : normalized.slice(0, wildcard).replace(/\/$/, "");
}

function globRegex(pattern) {
  const normalized = normalizeRel(pattern);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function collectPatternFiles(repo, pattern) {
  const normalized = normalizeRel(pattern);
  const hasWildcard = /[?*]/.test(normalized);
  if (!hasWildcard) {
    const file = path.resolve(repo, normalized);
    if (!pathInsideOrSame(repo, file)) throw new Error(`candidate path escapes repo: ${pattern}`);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return [file];
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) return walkFiles(file);
    return [];
  }
  const rootRel = patternRoot(normalized) || ".";
  const root = path.resolve(repo, rootRel);
  if (!pathInsideOrSame(repo, root)) throw new Error(`candidate pattern escapes repo: ${pattern}`);
  const regex = globRegex(normalized);
  return walkFiles(root).filter((file) => regex.test(repoRelative(repo, file)));
}

function candidateFiles(repo, profile) {
  const files = new Set();
  for (const pattern of profile.candidatePaths) {
    for (const file of collectPatternFiles(repo, pattern)) {
      const rel = repoRelative(repo, file);
      if (!SENSITIVE_PATH.test(rel)) files.add(path.resolve(file));
    }
  }
  return [...files].sort((a, b) => repoRelative(repo, a).localeCompare(repoRelative(repo, b)));
}

function schemaPaths(packageRoot) {
  return {
    state: path.join(packageRoot, "schemas", "closure-state-v1.schema.json"),
    profile: path.join(packageRoot, "schemas", "acceptance-profile-v1.schema.json"),
    config: path.join(packageRoot, "schemas", "closure-config-v1.schema.json"),
  };
}

function validateSchemaPackage(packageRoot) {
  const errors = [];
  for (const [name, file] of Object.entries(schemaPaths(packageRoot))) {
    if (!fs.existsSync(file)) { errors.push(`${name} schema missing: ${file}; reinstall the current pinned SteadySpec source/tarball`); continue; }
    try {
      const observedDigest = hashPortableTextFile(file);
      if (observedDigest !== SCHEMA_SHA256[name]) {
        errors.push(`${name} schema package-integrity mismatch: expected ${SCHEMA_SHA256[name]}, observed ${observedDigest}; reinstall the current pinned SteadySpec source/tarball`);
        continue;
      }
      const schema = readJson(file);
      if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") errors.push(`${name} schema has unexpected draft identifier`);
      if (schema.type !== "object") errors.push(`${name} schema root must be object`);
    } catch (error) {
      errors.push(`${name} schema unreadable: ${error.message}; reinstall the current pinned SteadySpec source/tarball`);
    }
  }
  return errors;
}

function loadConfig(repo, changeDir, packageRoot, options = {}) {
  const errors = validateSchemaPackage(packageRoot);
  const warnings = [];
  const configPath = path.join(repo, ".steadyspec", "closure.json");
  if (!fs.existsSync(configPath)) errors.push(`closure config missing: ${configPath}; run steadyspec init --closure manual|auto`);
  let config = null;
  if (fs.existsSync(configPath)) {
    try { config = readJson(configPath); } catch (error) { errors.push(`closure config invalid JSON: ${error.message}`); }
  }
  if (config) validateConfigShape(config, errors);
  let profile = null;
  let profilePath = null;
  if (config && typeof config.acceptanceProfile === "string") {
    profilePath = path.resolve(changeDir, config.acceptanceProfile);
    if (!pathInsideOrSame(changeDir, profilePath)) errors.push("acceptanceProfile must resolve inside the change directory");
    else if (!fs.existsSync(profilePath)) errors.push(`acceptance profile missing: ${profilePath}; create the generated explicit profile before prepare`);
    else {
      try { profile = readJson(profilePath); } catch (error) { errors.push(`acceptance profile invalid JSON: ${error.message}`); }
    }
  }
  if (profile) validateProfileShape(profile, errors);
  if (config && profile) validateConfigProfile(config, profile, errors, warnings, options);
  return { configPath, config, profilePath, profile, errors, warnings };
}

function validateConfigShape(config, errors) {
  if (config.schemaVersion !== 1) errors.push("closure config schemaVersion must be 1");
  if (!["off", "manual", "auto"].includes(config.mode)) errors.push("closure config mode must be off, manual, or auto");
  if (typeof config.acceptanceProfile !== "string" || !config.acceptanceProfile.trim()) errors.push("closure config acceptanceProfile is required");
  if (!config.limits || typeof config.limits !== "object") errors.push("closure config limits object is required");
  else {
    for (const [key, minimum] of [["maxCycles", 1], ["wallClockMs", 60000], ["maxAutoFiles", 1], ["recurrenceLimit", 1], ["noProgressCycles", 1]]) {
      if (!Number.isInteger(config.limits[key]) || config.limits[key] < minimum) errors.push(`closure config limits.${key} must be integer >= ${minimum}`);
    }
  }
  if (!config.proofPolicies || typeof config.proofPolicies !== "object" || Array.isArray(config.proofPolicies) || !Object.keys(config.proofPolicies).length) errors.push("closure config proofPolicies must be a non-empty object");
}

function validateProfileShape(profile, errors) {
  if (profile.schemaVersion !== 1) errors.push("acceptance profile schemaVersion must be 1");
  if (typeof profile.id !== "string" || !profile.id.trim()) errors.push("acceptance profile id is required");
  if (!Array.isArray(profile.candidatePaths) || !profile.candidatePaths.length) errors.push("acceptance profile candidatePaths must be non-empty");
  else for (const pattern of profile.candidatePaths) {
    try { normalizeRel(pattern); } catch (error) { errors.push(error.message); }
  }
  if (!Array.isArray(profile.dimensions)) { errors.push("acceptance profile dimensions must be an array"); return; }
  const ids = profile.dimensions.map((row) => row && row.id);
  for (const id of DIMENSION_IDS) if (ids.filter((value) => value === id).length !== 1) errors.push(`acceptance dimension ${id} must appear exactly once`);
  for (const row of profile.dimensions) {
    if (!row || !DIMENSION_IDS.includes(row.id)) { errors.push(`unknown acceptance dimension ${row && row.id ? row.id : "(missing)"}`); continue; }
    if (typeof row.required !== "boolean") errors.push(`acceptance dimension ${row.id}.required must be boolean`);
    if (!Array.isArray(row.proofPolicyIds)) errors.push(`acceptance dimension ${row.id}.proofPolicyIds must be array`);
    if (!Array.isArray(row.requiredSourceClasses)) errors.push(`acceptance dimension ${row.id}.requiredSourceClasses must be array`);
    if (typeof row.coverageLimit !== "string" || !row.coverageLimit.trim()) errors.push(`acceptance dimension ${row.id}.coverageLimit is required`);
  }
}

function policyPathOverlap(left, right) {
  const a = normalizeRel(left).replace(/\/\*\*$/, "");
  const b = normalizeRel(right).replace(/\/\*\*$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validatePolicy(id, policy, mode, errors) {
  const prefix = `proofPolicies.${id}`;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) { errors.push(`${prefix} must be object`); return; }
  if (typeof policy.executable !== "string" || !/^[A-Za-z0-9_.-]+$/.test(policy.executable)) errors.push(`${prefix}.executable must be a simple executable name`);
  if (!Array.isArray(policy.args) || policy.args.some((value) => typeof value !== "string")) errors.push(`${prefix}.args must be a string array`);
  try { normalizeRel(policy.cwd || "."); } catch (error) { errors.push(`${prefix}.cwd ${error.message}`); }
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs <= 0) errors.push(`${prefix}.timeoutMs must be positive integer`);
  if (!Number.isInteger(policy.maxOutputBytes) || policy.maxOutputBytes <= 0) errors.push(`${prefix}.maxOutputBytes must be positive integer`);
  if (!Array.isArray(policy.envKeys) || policy.envKeys.some((value) => typeof value !== "string")) errors.push(`${prefix}.envKeys must be string array`);
  if (mode === "auto" && policy.idempotent !== true) errors.push(`${prefix}.idempotent must be true in auto mode`);
  if (!Array.isArray(policy.dependsOn)) errors.push(`${prefix}.dependsOn must be array`);
  if (!Array.isArray(policy.outputs)) errors.push(`${prefix}.outputs must be array`);
  if (!Array.isArray(policy.mutableStateSurfaces)) errors.push(`${prefix}.mutableStateSurfaces must be array`);
  if (!policy.evidenceContract || !["exit-code-only", "structured-json", "human-observation", "negative-control"].includes(policy.evidenceContract.kind)) errors.push(`${prefix}.evidenceContract.kind is invalid`);
  else {
    if (typeof policy.evidenceContract.claim !== "string" || !policy.evidenceContract.claim.trim()) errors.push(`${prefix}.evidenceContract.claim is required`);
    if (typeof policy.evidenceContract.coverageLimit !== "string" || !policy.evidenceContract.coverageLimit.trim()) errors.push(`${prefix}.evidenceContract.coverageLimit is required`);
  }
  if (policy.expectedExitCodes !== undefined && (!Array.isArray(policy.expectedExitCodes) || policy.expectedExitCodes.some((value) => !Number.isInteger(value)))) errors.push(`${prefix}.expectedExitCodes must be integer array`);
}

function validateConfigProfile(config, profile, errors, warnings, options) {
  if (config.mode === "off") errors.push("closure config mode is off; opt in before using closure");
  const policies = config.proofPolicies || {};
  for (const [id, policy] of Object.entries(policies)) validatePolicy(id, policy, config.mode, errors);
  for (const [id, policy] of Object.entries(policies)) {
    for (const dependency of policy.dependsOn || []) if (!policies[dependency]) errors.push(`proofPolicies.${id}.dependsOn references missing policy ${dependency}`);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`proof policy dependency cycle at ${id}`); return; }
    if (visited.has(id) || !policies[id]) return;
    visiting.add(id);
    for (const dep of policies[id].dependsOn || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of Object.keys(policies)) visit(id);
  const referenced = new Set();
  for (const dimension of profile.dimensions || []) {
    for (const policyId of dimension.proofPolicyIds || []) {
      referenced.add(policyId);
      if (!policies[policyId]) errors.push(`acceptance dimension ${dimension.id} references missing proof policy ${policyId}`);
    }
  }
  const entries = [...policyDependencyClosure(policies, referenced)];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const aId = entries[left]; const bId = entries[right];
      const a = policies[aId]; const b = policies[bId];
      const ordered = policyDependsOn(policies, aId, bId) || policyDependsOn(policies, bId, aId);
      for (const outputA of a.outputs || []) for (const outputB of b.outputs || []) {
        if (policyPathOverlap(outputA, outputB) && !ordered) errors.push(`independent proof outputs overlap: ${aId}:${outputA} and ${bId}:${outputB}`);
      }
      const surfacesA = new Set(a.mutableStateSurfaces || []);
      const overlaps = (b.mutableStateSurfaces || []).filter((surface) => surfacesA.has(surface));
      if (overlaps.length && !ordered) errors.push(`independent proof mutableStateSurfaces overlap: ${aId}/${bId}: ${overlaps.join(", ")}`);
    }
  }
  for (const id of entries) {
    const policy = policies[id];
    if (config.mode === "auto" && policy.evidenceContract && policy.evidenceContract.kind === "exit-code-only" && !policy.evidenceContract.negativeControlPolicy) {
      errors.push(`auto required exit-code-only policy ${id} needs evidenceContract.negativeControlPolicy`);
    }
    if (policy.evidenceContract && policy.evidenceContract.negativeControlPolicy && !policies[policy.evidenceContract.negativeControlPolicy]) {
      errors.push(`policy ${id} references missing negative control ${policy.evidenceContract.negativeControlPolicy}`);
    }
  }
  const negativeEdges = new Map(Object.entries(policies).map(([id, policy]) => [id, policy.evidenceContract && policy.evidenceContract.negativeControlPolicy]));
  for (const start of negativeEdges.keys()) {
    const visitedNegative = new Set();
    let current = start;
    while (negativeEdges.get(current)) {
      if (visitedNegative.has(current)) {
        errors.push(`negative control policies form a cycle from ${start}`);
        break;
      }
      visitedNegative.add(current);
      current = negativeEdges.get(current);
    }
  }
  if (!options.requireCalibration) warnings.push("config structure validated; sensitivity calibration is checked by prepare");
}

function closurePaths(changeDir) {
  const closureDir = path.join(changeDir, "closure");
  return {
    closureDir,
    state: path.join(closureDir, "state.json"),
    previous: path.join(closureDir, "state.prev.json"),
    cycles: path.join(closureDir, "cycles"),
    archive: path.join(closureDir, "archive"),
    calibration: path.join(closureDir, "calibration.json"),
    resetJournal: path.join(closureDir, "reset-in-progress.json"),
  };
}

function validateState(state) {
  const errors = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) return ["state root must be object"];
  for (const key of STATE_KEYS) if (!Object.prototype.hasOwnProperty.call(state, key)) errors.push(`state missing ${key}`);
  for (const key of Object.keys(state)) if (!STATE_KEYS.includes(key)) errors.push(`state has unknown top-level field ${key}`);
  if (state.schemaVersion !== 1) errors.push("state schemaVersion must be 1");
  if (state.contractVersion !== CONTRACT_VERSION) errors.push(`state contractVersion must be ${CONTRACT_VERSION}`);
  if (!STATES.has(state.state)) errors.push(`state has invalid state ${state.state}`);
  if (!Number.isInteger(state.cycle) || state.cycle < 0) errors.push("state cycle must be non-negative integer");
  if (!Array.isArray(state.completedSteps)) errors.push("state completedSteps must be array");
  if (state.candidateFingerprint !== null && !SHA256_ID.test(state.candidateFingerprint || "")) errors.push("state candidateFingerprint invalid");
  if (state.evidenceBundleFingerprint !== null && !SHA256_ID.test(state.evidenceBundleFingerprint || "")) errors.push("state evidenceBundleFingerprint invalid");
  for (const key of ["findings", "proofs", "escalations", "decisions", "contextLimits"]) if (!Array.isArray(state[key])) errors.push(`state ${key} must be array`);
  return errors;
}

function inspectStateFile(file) {
  if (!fs.existsSync(file)) return { valid: false, status: "missing", errors: ["file does not exist"] };
  let value;
  try {
    value = readJson(file);
  } catch (error) {
    return { valid: false, status: "invalid-json", errors: [error.message] };
  }
  const errors = validateState(value);
  return { valid: errors.length === 0, status: errors.length ? "invalid-schema" : "valid", errors, value };
}

function readState(changeDir) {
  const files = closurePaths(changeDir);
  if (!fs.existsSync(files.state)) return null;
  let state;
  try { state = readJson(files.state); } catch (error) {
    const previous = inspectStateFile(files.previous);
    const previousNote = previous.valid ? `; validated previous candidate at ${files.previous}` : `; previous state ${previous.status}: ${previous.errors.join("; ")}`;
    const failure = new Error(`closure state invalid JSON: ${error.message}${previousNote}`);
    failure.code = "STATE_CORRUPT";
    failure.previousState = { path: files.previous, valid: previous.valid, status: previous.status, errors: previous.errors };
    throw failure;
  }
  const errors = validateState(state);
  if (errors.length) {
    const previous = inspectStateFile(files.previous);
    const previousNote = previous.valid ? `; validated previous candidate at ${files.previous}` : `; previous state ${previous.status}: ${previous.errors.join("; ")}`;
    const failure = new Error(`closure state schema failed: ${errors.join("; ")}${previousNote}`);
    failure.code = "STATE_INVALID";
    failure.previousState = { path: files.previous, valid: previous.valid, status: previous.status, errors: previous.errors };
    throw failure;
  }
  return state;
}

function writeState(changeDir, state) {
  const errors = validateState(state);
  if (errors.length) throw new Error(`refusing invalid closure state write: ${errors.join("; ")}`);
  const files = closurePaths(changeDir);
  fs.mkdirSync(files.closureDir, { recursive: true });
  if (fs.existsSync(files.state)) {
    const current = readJson(files.state);
    const currentErrors = validateState(current);
    if (currentErrors.length) throw new Error(`refusing to replace invalid state: ${currentErrors.join("; ")}`);
    writeJson(files.previous, current);
  }
  state.updatedAt = new Date().toISOString();
  const temporary = path.join(files.closureDir, `.state-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
  writeJson(temporary, state);
  fs.renameSync(temporary, files.state);
}

function configPolicyManifest(config) {
  return Object.fromEntries(Object.entries(config.proofPolicies || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, policy]) => [id, { sha256: hashValue(policy), policy: stableValue(policy) }]));
}

function buildCandidateManifest(repo, changeDir, config, profile) {
  const files = candidateFiles(repo, profile).map((file) => ({ path: repoRelative(repo, file), sha256: hashFile(file), bytes: fs.statSync(file).size }));
  const intentFiles = ["proposal.md", "requirements.md", "evidence-contract.md", "acceptance-profile.md", "acceptance-profile.json"]
    .map((name) => path.join(changeDir, name)).filter((file) => fs.existsSync(file)).map((file) => ({ path: repoRelative(repo, file), sha256: hashFile(file) }));
  return {
    schemaVersion: 1,
    exactByteIdentity: true,
    change: repoRelative(repo, changeDir),
    profile: { id: profile.id, sha256: hashValue(profile), value: stableValue(profile) },
    policies: configPolicyManifest(config),
    roleContracts: stableValue(ROLE_CONTRACTS),
    intentFiles,
    files,
  };
}

function targetBaselineFromManifest(manifest) {
  const value = {
    schemaVersion: 1,
    intentFiles: stableValue(manifest.intentFiles || []),
    profile: stableValue(manifest.profile || null),
    policies: stableValue(manifest.policies || {}),
    roleContracts: stableValue(manifest.roleContracts || {}),
  };
  return { ...value, fingerprint: hashValue(value) };
}

function targetBaselineFingerprint(state) {
  const baseline = state && state.change && state.change.targetBaseline;
  return baseline && baseline.fingerprint || null;
}

function manifestDiff(before, after) {
  const changes = [];
  const left = new Map((before && before.files || []).map((row) => [row.path, row.sha256]));
  const right = new Map((after && after.files || []).map((row) => [row.path, row.sha256]));
  for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(name)) changes.push({ path: name, kind: "added", before: null, after: right.get(name) });
    else if (!right.has(name)) changes.push({ path: name, kind: "removed", before: left.get(name), after: null });
    else if (left.get(name) !== right.get(name)) changes.push({ path: name, kind: "modified", before: left.get(name), after: right.get(name) });
  }
  if (before && after && before.profile.sha256 !== after.profile.sha256) {
    const fields = structuredFieldDiff(before.profile.value, after.profile.value);
    changes.push(...(fields.length ? fields : [{ field: "<unknown-legacy-profile-field>", beforeHash: before.profile.sha256, afterHash: after.profile.sha256 }]).map((row) => ({
      path: "<acceptance-profile>", inputClass: "acceptance-profile", kind: "field-changed", ...row,
    })));
  }
  if (before && after && hashValue(before.policies) !== hashValue(after.policies)) {
    for (const policyId of [...new Set([...Object.keys(before.policies || {}), ...Object.keys(after.policies || {})])].sort()) {
      const prior = before.policies && before.policies[policyId];
      const current = after.policies && after.policies[policyId];
      for (const row of structuredFieldDiff(prior && prior.policy, current && current.policy)) {
        changes.push({ path: "<proof-policies>", inputClass: "proof-policy", policyId, kind: "field-changed", ...row });
      }
    }
  }
  if (before && after && hashValue(before.roleContracts || null) !== hashValue(after.roleContracts || null)) {
    for (const row of structuredFieldDiff(before.roleContracts, after.roleContracts)) {
      changes.push({ path: "<role-contracts>", inputClass: "role-contract", kind: "field-changed", ...row });
    }
  }
  if (before && after && hashValue(before.intentFiles || []) !== hashValue(after.intentFiles || [])) {
    const prior = new Map((before.intentFiles || []).map((row) => [row.path, row.sha256]));
    const current = new Map((after.intentFiles || []).map((row) => [row.path, row.sha256]));
    for (const intentPath of [...new Set([...prior.keys(), ...current.keys()])].sort()) {
      if (prior.get(intentPath) !== current.get(intentPath) && !changes.some((row) => row.path === intentPath)) changes.push({ path: intentPath, inputClass: "intent", kind: prior.has(intentPath) ? (current.has(intentPath) ? "modified" : "removed") : "added", before: prior.get(intentPath) || null, after: current.get(intentPath) || null });
    }
  }
  return changes;
}

function calibrationState(changeDir) {
  const file = closurePaths(changeDir).calibration;
  if (!fs.existsSync(file)) return { schemaVersion: 1, policies: {} };
  return readJson(file);
}

function requiredPolicyIds(profile) {
  return [...new Set(profile.dimensions.flatMap((dimension) => dimension.proofPolicyIds || []))];
}

function calibrationErrors(changeDir, config, profile) {
  if (config.mode !== "auto") return [];
  const calibration = calibrationState(changeDir);
  const errors = [];
  for (const id of proofOrder(config, profile)) {
    const policy = config.proofPolicies[id];
    if (!policy || !policy.evidenceContract || policy.evidenceContract.kind !== "exit-code-only") continue;
    const record = calibration.policies[id];
    const negativeId = policy.evidenceContract.negativeControlPolicy;
    const negative = config.proofPolicies[negativeId];
    if (!record || record.policyHash !== hashValue(policy) || record.negativeControlPolicy !== negativeId || record.negativeControlPolicyHash !== hashValue(negative) || record.status !== "sensitive") {
      errors.push(`proof policy ${id} lacks current negative-control sensitivity calibration; run --calibrate ${id}`);
    }
  }
  return errors;
}

function initialState(repo, changeDir, loaded, manifest) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    lineageId: `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    change: {
      id: path.basename(changeDir),
      path: repoRelative(repo, changeDir),
      profilePath: repoRelative(repo, loaded.profilePath),
      configPath: repoRelative(repo, loaded.configPath),
      targetBaseline: targetBaselineFromManifest(manifest),
    },
    mode: loaded.config.mode,
    state: "critic-required",
    cycle: 1,
    nextAction: "run-critic",
    inProgressStep: null,
    completedSteps: [],
    candidateFingerprint: hashValue(manifest),
    candidateManifest: manifest,
    evidenceBundleFingerprint: null,
    evidenceManifest: null,
    findings: [],
    builder: null,
    proofs: [],
    evaluator: null,
    counters: { startedAt: now, evaluations: 0, noProgressCycles: 0, recurrence: {}, fingerprintHistory: [hashValue(manifest)], verdictHistory: [], progressHistory: [] },
    escalations: [],
    decisions: [],
    contextLimits: ["Windows single-user", "no Builder OS sandbox", "no proof side-effect isolation", "machine verdict is not human acceptance"],
    createdAt: now,
    updatedAt: now,
  };
}

function cycleDir(changeDir, state) {
  return path.join(closurePaths(changeDir).cycles, String(state.cycle).padStart(3, "0"));
}

function cycleDirFor(changeDir, cycle) {
  return path.join(closurePaths(changeDir).cycles, String(cycle).padStart(3, "0"));
}

const EVALUATOR_ATTRIBUTION_REF_IDENTITY_FIELDS = [
  "requestedRole",
  "roleContract",
  "includedScopeFingerprint",
  "targetBaselineFingerprint",
  "invocationId",
  "reviewer",
  "transport",
  "expectedRunDir",
  "candidateFingerprint",
  "evidenceBundleFingerprint",
  "startedAt",
];

function evaluatorAttributionIdentityErrors(invocation, evaluatorRef, verdict, targetCycle) {
  const errors = [];
  for (const field of EVALUATOR_ATTRIBUTION_REF_IDENTITY_FIELDS) {
    if (evaluatorRef[field] !== invocation[field]) errors.push(`evaluator ref ${field} disagrees with invocation`);
  }
  for (const field of ["candidateFingerprint", "evidenceBundleFingerprint", "targetBaselineFingerprint"]) {
    if (verdict[field] !== invocation[field]) errors.push(`evaluator verdict ${field} disagrees with invocation`);
  }
  for (const field of ["verdict", "verdictReason"]) {
    if (evaluatorRef[field] !== verdict[field]) errors.push(`evaluator ref ${field} disagrees with verdict`);
  }
  for (const field of ["independence", "residualUnknowns"]) {
    if (hashValue(evaluatorRef[field]) !== hashValue(verdict[field])) errors.push(`evaluator ref ${field} disagrees with verdict`);
  }
  if (evaluatorRef.evaluatedCycle !== undefined && evaluatorRef.evaluatedCycle !== targetCycle) errors.push("evaluator ref evaluatedCycle disagrees with invocation cycle");
  if (normalizeRel(evaluatorRef.run) !== normalizeRel(invocation.expectedRunDir)) errors.push("evaluator ref run disagrees with invocation expectedRunDir");
  const expectedEvaluation = `${String(invocation.expectedRunDir).replace(/[\\/]+$/, "")}/evaluation.json`;
  if (normalizeRel(evaluatorRef.evaluation) !== normalizeRel(expectedEvaluation)) errors.push("evaluator ref evaluation path disagrees with invocation expectedRunDir");
  return errors;
}

function assertEvaluatorAttributionMapping(changeDir, row) {
  if (!row || !Number.isInteger(row.sourceCycle) || !Number.isInteger(row.targetCycle) || !row.evaluatorRef || !row.verdict) {
    throw new Error("Evaluator attribution repair mapping is incomplete");
  }
  const invocationFile = path.join(cycleDirFor(changeDir, row.targetCycle), "evaluator-invocation.json");
  if (!fs.existsSync(invocationFile)) throw new Error(`Evaluator attribution target cycle ${row.targetCycle} has no saved invocation`);
  const invocation = readJson(invocationFile);
  if (row.sourceCycle === row.targetCycle) throw new Error("Evaluator attribution repair mapping cannot relocate a cycle onto itself");
  const errors = evaluatorAttributionIdentityErrors(invocation, row.evaluatorRef, row.verdict, row.targetCycle);
  if (errors.length) throw new Error(`Evaluator attribution mapping ${row.sourceCycle}->${row.targetCycle} failed invocation identity: ${errors.join("; ")}`);
}

function evaluatorArtifactPair(directory) {
  const refFile = path.join(directory, "evaluator-ref.json");
  const verdictFile = path.join(directory, "verdict.json");
  const hasRef = fs.existsSync(refFile);
  const hasVerdict = fs.existsSync(verdictFile);
  if (hasRef !== hasVerdict) throw new Error(`Evaluator attribution pair is incomplete in ${directory}`);
  return hasRef ? { ref: fs.readFileSync(refFile), verdict: fs.readFileSync(verdictFile) } : null;
}

function evaluatorPayloadPair(row) {
  return {
    ref: Buffer.from(`${JSON.stringify(row.evaluatorRef, null, 2)}\n`, "utf8"),
    verdict: Buffer.from(`${JSON.stringify(row.verdict, null, 2)}\n`, "utf8"),
  };
}

function evaluatorPairsEqual(left, right) {
  return Boolean(left && right && left.ref.equals(right.ref) && left.verdict.equals(right.verdict));
}

function preflightEvaluatorAttributionRepair(changeDir, mappings) {
  const pairs = new Map();
  const payloads = new Map();
  const involvedCycles = new Set();
  for (const row of mappings) {
    assertEvaluatorAttributionMapping(changeDir, row);
    payloads.set(row, evaluatorPayloadPair(row));
    involvedCycles.add(row.sourceCycle);
    involvedCycles.add(row.targetCycle);
  }
  for (const cycle of involvedCycles) pairs.set(cycle, evaluatorArtifactPair(cycleDirFor(changeDir, cycle)));
  for (const cycle of involvedCycles) {
    const observed = pairs.get(cycle);
    if (!observed) continue;
    const allowed = mappings.filter((row) => row.sourceCycle === cycle || row.targetCycle === cycle).map((row) => payloads.get(row));
    if (!allowed.some((payload) => evaluatorPairsEqual(observed, payload))) {
      throw new Error(`Evaluator attribution cycle ${cycle} conflicts with the prepared journal payloads`);
    }
  }
  for (const row of mappings) {
    const payload = payloads.get(row);
    const sourceMatches = evaluatorPairsEqual(pairs.get(row.sourceCycle), payload);
    const targetMatches = evaluatorPairsEqual(pairs.get(row.targetCycle), payload);
    if (!sourceMatches && !targetMatches) {
      throw new Error(`Evaluator attribution mapping ${row.sourceCycle}->${row.targetCycle} has no exact source or committed target payload`);
    }
  }
}

function applyEvaluatorAttributionRepair(changeDir, journalFile, journal) {
  preflightEvaluatorAttributionRepair(changeDir, journal.mappings);
  const targets = new Set(journal.mappings.map((row) => row.targetCycle));
  for (const row of journal.mappings) {
    const targetDir = cycleDirFor(changeDir, row.targetCycle);
    writeJsonAtomic(path.join(targetDir, "evaluator-ref.json"), row.evaluatorRef);
    writeJsonAtomic(path.join(targetDir, "verdict.json"), row.verdict);
  }
  for (const row of journal.mappings) {
    if (row.sourceCycle === row.targetCycle || targets.has(row.sourceCycle)) continue;
    fs.rmSync(path.join(cycleDirFor(changeDir, row.sourceCycle), "evaluator-ref.json"), { force: true });
    fs.rmSync(path.join(cycleDirFor(changeDir, row.sourceCycle), "verdict.json"), { force: true });
  }
  for (const row of journal.mappings) {
    const targetDir = cycleDirFor(changeDir, row.targetCycle);
    if (!evaluatorPairsEqual(evaluatorArtifactPair(targetDir), evaluatorPayloadPair(row))) {
      throw new Error(`Evaluator attribution repair could not verify cycle ${row.targetCycle}`);
    }
  }
  const committed = { ...journal, status: "committed", completedAt: journal.completedAt || new Date().toISOString() };
  writeJsonAtomic(journalFile, committed);
  return committed;
}

function reconcileEvaluatorArtifactAttribution(changeDir) {
  const files = closurePaths(changeDir);
  const journalFile = path.join(files.closureDir, "evaluator-artifact-attribution-repair.json");
  if (fs.existsSync(journalFile)) {
    const prior = readJson(journalFile);
    if (prior.schemaVersion !== 1 || !Array.isArray(prior.mappings)) throw new Error("Evaluator attribution repair journal is invalid");
    if (prior.status === "prepared") return applyEvaluatorAttributionRepair(changeDir, journalFile, prior);
    if (prior.status !== "committed") throw new Error(`Evaluator attribution repair journal has invalid status ${prior.status}`);
  }
  if (!fs.existsSync(files.cycles)) return null;
  const cycleEntries = fs.readdirSync(files.cycles, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => ({ cycle: Number(entry.name), dir: path.join(files.cycles, entry.name) }));
  const invocationCycle = new Map();
  for (const entry of cycleEntries) {
    const invocationFile = path.join(entry.dir, "evaluator-invocation.json");
    if (!fs.existsSync(invocationFile)) continue;
    const invocation = readJson(invocationFile);
    if (!invocation.invocationId) throw new Error(`Evaluator invocation in cycle ${entry.cycle} has no invocationId`);
    if (invocationCycle.has(invocation.invocationId)) throw new Error(`Evaluator invocationId ${invocation.invocationId} appears in multiple cycles`);
    invocationCycle.set(invocation.invocationId, { cycle: entry.cycle, invocation });
  }
  const mappings = [];
  const targetCycles = new Set();
  for (const entry of cycleEntries) {
    const refFile = path.join(entry.dir, "evaluator-ref.json");
    const verdictFile = path.join(entry.dir, "verdict.json");
    const hasRef = fs.existsSync(refFile);
    const hasVerdict = fs.existsSync(verdictFile);
    if (!hasRef && !hasVerdict) continue;
    if (hasRef !== hasVerdict) throw new Error(`Evaluator attribution in cycle ${entry.cycle} is incomplete`);
    const evaluatorRef = readJson(refFile);
    const verdict = readJson(verdictFile);
    const target = invocationCycle.get(evaluatorRef.invocationId);
    if (!target) throw new Error(`Evaluator ref ${evaluatorRef.invocationId || "(missing)"} has no matching invocation cycle`);
    const targetCycle = target.cycle;
    if (evaluatorRef.candidateFingerprint !== verdict.candidateFingerprint
      || evaluatorRef.evidenceBundleFingerprint !== verdict.evidenceBundleFingerprint
      || evaluatorRef.targetBaselineFingerprint !== verdict.targetBaselineFingerprint) {
      throw new Error(`Evaluator ref/verdict fingerprints disagree in cycle ${entry.cycle}`);
    }
    const identityErrors = evaluatorAttributionIdentityErrors(target.invocation, evaluatorRef, verdict, targetCycle);
    if (identityErrors.length) throw new Error(`Evaluator attribution in cycle ${entry.cycle} failed invocation identity: ${identityErrors.join("; ")}`);
    if (targetCycles.has(targetCycle)) throw new Error(`Multiple Evaluator refs resolve to cycle ${targetCycle}`);
    targetCycles.add(targetCycle);
    if (entry.cycle !== targetCycle) mappings.push({ sourceCycle: entry.cycle, targetCycle, evaluatorRef, verdict });
  }
  if (!mappings.length) return fs.existsSync(journalFile) ? readJson(journalFile) : null;
  const journal = {
    schemaVersion: 1,
    status: "prepared",
    createdAt: new Date().toISOString(),
    reason: "repair-fix-required-evaluator-cycle-attribution",
    mappings,
  };
  writeJsonAtomic(journalFile, journal);
  return applyEvaluatorAttributionRepair(changeDir, journalFile, journal);
}

function emit(result, args) {
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`[closure] status: ${result.status}`);
    if (result.state) console.log(`[closure] state: ${result.state}`);
    if (result.action) console.log(`[closure] action: ${result.action}`);
    if (result.candidateFingerprint) console.log(`[closure] candidate: ${result.candidateFingerprint}`);
    if (result.evidenceBundleFingerprint) console.log(`[closure] evidence: ${result.evidenceBundleFingerprint}`);
    for (const warning of result.warnings || []) console.warn(`[closure] WARN: ${warning}`);
    for (const error of result.errors || []) console.error(`[closure] ERROR: ${error}`);
  }
  process.exitCode = result.exitCode || 0;
}

function resultFromState(state, extra = {}) {
  return {
    schemaVersion: 1,
    status: TERMINAL_STATES.has(state.state) ? state.state : "active",
    exitCode: state.state === "candidate-ready" ? 0 : TERMINAL_STATES.has(state.state) ? 2 : 0,
    state: state.state,
    cycle: state.cycle,
    action: state.nextAction,
    candidateFingerprint: state.candidateFingerprint,
    evidenceBundleFingerprint: state.evidenceBundleFingerprint,
    ...extra,
  };
}

function validateRecordPath(repo, input) {
  const file = path.resolve(repo, input);
  if (!pathInsideOrSame(repo, file)) throw new Error(`record path escapes repository: ${input}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`record file not found: ${input}`);
  return file;
}

function validateRunDir(repo, input) {
  const dir = path.resolve(repo, input);
  if (!pathInsideOrSame(repo, dir)) throw new Error(`run directory escapes repository: ${input}`);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`run.json not found under ${input}`);
  return dir;
}

function rawStdout(rawFile) {
  const text = fs.readFileSync(rawFile, "utf8");
  const match = text.match(/\r?\n##\s*STDOUT\s*\r?\n/i);
  return match && typeof match.index === "number" ? text.slice(match.index + match[0].length) : text;
}

function parseCriticFindings(rawFile) {
  const text = rawStdout(rawFile);
  const findings = [];
  const errors = [];
  const seen = new Set();
  const hasCanonicalHeader = /^\s*\|\s*Finding ID\s*\|\s*Severity\s*\|/im.test(text);
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const id = cells[0].replace(/[*_`]/g, "");
    const severity = cells[1].replace(/[*_`]/g, "");
    if (!/^[A-Z][A-Z0-9_.:-]*\d[A-Z0-9_.:-]*$/i.test(id)) continue;
    if (!/^P[123]$/i.test(severity)) {
      errors.push(`Critic finding ${id} has invalid severity ${severity || "(missing)"}`);
      continue;
    }
    if (seen.has(id.toLowerCase())) {
      errors.push(`Critic finding ID is duplicated: ${id}`);
      continue;
    }
    seen.add(id.toLowerCase());
    findings.push({
      findingId: id,
      severity: severity.toUpperCase(),
      claim: cells[2] || "",
      evidence: cells[3] || "",
      breakingScenario: cells[4] || "",
      recommendedAction: cells[6] || "",
      status: "open",
    });
    if (!cells[6]) errors.push(`Critic finding ${id} has an empty Recommended Action`);
  }
  const noFindingsConfirmed = /^\s*-\s*No findings:\s*confirmed\s*$/im.test(text);
  if (!hasCanonicalHeader && !noFindingsConfirmed) errors.push("Critic output lacks the canonical Finding ID/Severity table or explicit `- No findings: confirmed`");
  if (!findings.length && !noFindingsConfirmed) errors.push("Critic output contains no usable findings and does not explicitly confirm no findings");
  if (findings.length && noFindingsConfirmed) errors.push("Critic output both reports findings and confirms no findings");
  return { findings, errors, noFindingsConfirmed };
}

function isAutoProtectedPath(value) {
  const normalized = normalizeRel(value);
  return AUTO_PROTECTED_PATHS.some((pattern) => pattern.test(normalized));
}

function isAutoProtectedChange(change) {
  return ["intent", "acceptance-profile", "proof-policy", "role-contract"].includes(change.inputClass)
    || (!change.path.startsWith("<") && isAutoProtectedPath(change.path));
}

function validateAutoRiskAssessment(record) {
  const assessment = record && record.riskAssessment;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return ["auto Builder before riskAssessment is required"];
  const errors = [];
  for (const [field, expected] of Object.entries(SAFE_RISK_ASSESSMENT)) {
    if (assessment[field] !== expected) errors.push(`auto Builder riskAssessment.${field} must be ${JSON.stringify(expected)}`);
  }
  const unknown = Object.keys(assessment).filter((field) => !Object.prototype.hasOwnProperty.call(SAFE_RISK_ASSESSMENT, field));
  if (unknown.length) errors.push(`auto Builder riskAssessment has unknown fields: ${unknown.sort().join(", ")}`);
  return errors;
}

function validateBuilderBefore(record, state, loaded, repo) {
  const errors = [];
  if (!record || typeof record !== "object") return ["Builder before record must be object"];
  if (record.candidateFingerprint !== state.candidateFingerprint) errors.push("Builder before candidateFingerprint mismatch");
  if (!Array.isArray(record.findingIds) || !record.findingIds.length) errors.push("Builder before findingIds must be non-empty array");
  const openIds = new Set(state.findings.filter((row) => ["open", "carried-forward"].includes(row.status)).map((row) => row.findingId));
  for (const id of record.findingIds || []) if (!openIds.has(id)) errors.push(`Builder before references non-open finding ${id}`);
  if (!Array.isArray(record.changes) || !record.changes.length) errors.push("Builder before changes must be non-empty array");
  if (record.changes && record.changes.length > loaded.config.limits.maxAutoFiles && loaded.config.mode === "auto") errors.push(`Builder before exceeds maxAutoFiles ${loaded.config.limits.maxAutoFiles}`);
  const candidateMatchers = loaded.profile.candidatePaths.map(globRegex);
  for (const change of record.changes || []) {
    let rel;
    try { rel = normalizeRel(change.path); } catch (error) { errors.push(error.message); continue; }
    if (!candidateMatchers.some((regex) => regex.test(rel))) errors.push(`Builder path is outside declared candidate paths: ${rel}`);
    if (typeof change.changeSummary !== "string" || !change.changeSummary.trim()) errors.push(`Builder changeSummary is required for ${rel}`);
  }
  if (!Array.isArray(record.authorityIds) || !record.authorityIds.length) errors.push("Builder before authorityIds must be non-empty array");
  if (!Array.isArray(record.proofPolicyIds) || !record.proofPolicyIds.length) errors.push("Builder before proofPolicyIds must be non-empty array");
  for (const id of record.proofPolicyIds || []) if (!loaded.config.proofPolicies[id]) errors.push(`Builder before references missing proof policy ${id}`);
  if (loaded.config.mode === "auto") {
    if (record.riskClass !== "safe-harbor-mechanical") errors.push("auto Builder before riskClass must be safe-harbor-mechanical");
    errors.push(...validateAutoRiskAssessment(record));
    for (const change of record.changes || []) {
      try {
        if (isAutoProtectedPath(change.path)) errors.push(`auto Builder path requires explicit human reopen before editing: ${normalizeRel(change.path)}`);
      } catch (error) {
        // Path validation already reports the canonical error above.
      }
    }
  }
  return errors;
}

function builderToken(state, record) {
  return hashValue({
    contractVersion: CONTRACT_VERSION,
    cycle: state.cycle,
    candidateFingerprint: state.candidateFingerprint,
    findingIds: record.findingIds,
    changes: record.changes,
    authorityIds: record.authorityIds,
    proofPolicyIds: record.proofPolicyIds,
    riskClass: record.riskClass,
    riskAssessment: record.riskAssessment || null,
  });
}

function validateBuilderCompletion(record, state) {
  const errors = [];
  if (!record || typeof record !== "object") return ["Builder completion record must be object"];
  if (!state.builder || record.completionToken !== state.builder.completionToken) errors.push("Builder completionToken mismatch");
  if (!Array.isArray(record.findings)) errors.push("Builder completion findings must be array");
  const allowed = new Set(["fixed", "rejected-with-evidence", "carried-forward", "needs-user", "blocked"]);
  const expected = new Set(state.builder ? state.builder.findingIds : []);
  for (const row of record.findings || []) {
    if (!expected.has(row.findingId)) errors.push(`Builder completion has unexpected finding ${row.findingId}`);
    if (!allowed.has(row.status)) errors.push(`Builder completion finding ${row.findingId} has invalid status ${row.status}`);
    if (row.status === "rejected-with-evidence" && (!Array.isArray(row.evidence) || !row.evidence.length)) errors.push(`rejected finding ${row.findingId} needs evidence`);
  }
  for (const id of expected) if (!(record.findings || []).some((row) => row.findingId === id)) errors.push(`Builder completion missing finding ${id}`);
  return errors;
}

function runProcess(executable, args, options) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let cleanupWarnings = [];
    let settled = false;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    function append(current, chunk) {
      const joined = Buffer.concat([current, chunk]);
      if (joined.length <= options.maxOutputBytes) return joined;
      truncated = true;
      return joined.subarray(0, options.maxOutputBytes);
    }
    child.stdout.on("data", (chunk) => { stdout = append(stdout, Buffer.from(chunk)); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, Buffer.from(chunk)); });
    const timer = setTimeout(() => {
      timedOut = true;
      cleanupWarnings = terminateProcessTree(child, "SIGTERM", { label: "proof" });
      setTimeout(() => {
        if (!settled) cleanupWarnings.push(...terminateProcessTree(child, "SIGKILL", { label: "proof" }));
      }, 1000).unref();
    }, options.timeoutMs);
    function finish(status, signal, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, signal, error: error ? error.message : null, timedOut, truncated, cleanupWarnings, stdout, stderr, durationMs: Date.now() - started });
    }
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (status, signal) => finish(status, signal, null));
  });
}

async function executePolicy(repo, policyId, policy) {
  const cwd = path.resolve(repo, normalizeRel(policy.cwd || "."));
  if (!pathInsideOrSame(repo, cwd)) throw new Error(`proof policy ${policyId} cwd escapes repository`);
  const envConfig = buildScrubbedEnv({ sourceEnv: process.env, explicitKeys: policy.envKeys || [], requireExplicit: true });
  const result = await runProcess(policy.executable, policy.args || [], {
    cwd,
    env: envConfig.env,
    timeoutMs: policy.timeoutMs,
    maxOutputBytes: policy.maxOutputBytes,
  });
  return {
    policyId,
    executable: policy.executable,
    args: policy.args || [],
    cwd: repoRelative(repo, cwd) || ".",
    envKeys: envConfig.keys,
    status: result.status,
    signal: result.signal,
    error: result.error,
    timedOut: result.timedOut,
    truncated: result.truncated,
    cleanupWarnings: result.cleanupWarnings,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutSha256: hashBuffer(result.stdout),
    stderrSha256: hashBuffer(result.stderr),
    cleanupWarnings: result.cleanupWarnings,
  };
}

function proofOrder(config, profile) {
  const requested = new Set(requiredPolicyIds(profile));
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visited.has(id) || !config.proofPolicies[id]) return;
    if (visiting.has(id)) throw new Error(`proof policy dependency cycle at ${id}`);
    visiting.add(id);
    for (const dep of config.proofPolicies[id].dependsOn || []) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of requested) visit(id);
  return order;
}

function proofPublicResult(result, artifact) {
  return {
    policyId: result.policyId,
    executable: result.executable,
    args: result.args,
    cwd: result.cwd,
    envKeys: result.envKeys,
    status: result.status,
    signal: result.signal,
    error: result.error,
    timedOut: result.timedOut,
    truncated: result.truncated,
    durationMs: result.durationMs,
    stdoutSha256: result.stdoutSha256,
    stderrSha256: result.stderrSha256,
    artifact,
  };
}

function writeProofArtifacts(repo, changeDir, state, result) {
  const dir = path.join(cycleDir(changeDir, state), "proofs");
  fs.mkdirSync(dir, { recursive: true });
  const stdoutFile = path.join(dir, `${result.policyId}.stdout.txt`);
  const stderrFile = path.join(dir, `${result.policyId}.stderr.txt`);
  fs.writeFileSync(stdoutFile, result.stdout);
  fs.writeFileSync(stderrFile, result.stderr);
  return { stdout: repoRelative(repo, stdoutFile), stderr: repoRelative(repo, stderrFile) };
}

function evidenceIntegrityMismatches(repo, changeDir, state) {
  const mismatches = [];
  const currentCycleDir = cycleDir(changeDir, state);
  for (const [name, expected] of [["evidence-manifest.json", state.evidenceManifest], ["proofs.json", state.proofs]]) {
    const file = path.join(currentCycleDir, name);
    if (!fs.existsSync(file)) {
      mismatches.push({ inputClass: "proof-evidence", field: name, kind: "missing", expectedHash: diagnosticHash(expected), observedHash: null });
      continue;
    }
    try {
      const observed = readJson(file);
      if (hashValue(observed) !== hashValue(expected)) mismatches.push({ inputClass: "proof-evidence", field: name, kind: "hash-mismatch", expectedHash: hashValue(expected), observedHash: hashValue(observed) });
    } catch (error) {
      mismatches.push({ inputClass: "proof-evidence", field: name, kind: "invalid-json", expectedHash: diagnosticHash(expected), observedHash: hashFile(file) });
    }
  }
  const manifestByPolicy = new Map((state.evidenceManifest && state.evidenceManifest.policies || []).map((row) => [row.policyId, row]));
  for (const proof of state.proofs || []) {
    const manifestRow = manifestByPolicy.get(proof.policyId);
    for (const stream of ["stdout", "stderr"]) {
      const expectedHash = proof[`${stream}Sha256`];
      const manifestHash = manifestRow && manifestRow[`${stream}Sha256`];
      if (manifestHash !== expectedHash) mismatches.push({ inputClass: "proof-evidence", policyId: proof.policyId, field: `manifest.${stream}Sha256`, kind: "field-mismatch", expectedHash, observedHash: manifestHash || null });
      const relative = proof.artifact && proof.artifact[stream];
      let artifact = null;
      try {
        artifact = path.resolve(repo, normalizeRel(relative));
        if (!pathInsideOrSame(repo, artifact) || !pathInsideOrSame(changeDir, artifact)) throw new Error("artifact escapes governed change");
      } catch (error) {
        mismatches.push({ inputClass: "proof-evidence", policyId: proof.policyId, field: `artifact.${stream}`, kind: "invalid-path", expectedHash, observedHash: null });
        continue;
      }
      if (!fs.existsSync(artifact) || !fs.statSync(artifact).isFile()) {
        mismatches.push({ inputClass: "proof-evidence", policyId: proof.policyId, field: `artifact.${stream}`, kind: "missing", expectedHash, observedHash: null });
        continue;
      }
      const observedHash = hashFile(artifact);
      if (observedHash !== expectedHash) mismatches.push({ inputClass: "proof-evidence", policyId: proof.policyId, field: `artifact.${stream}`, kind: "hash-mismatch", expectedHash, observedHash });
    }
  }
  return mismatches;
}

function validateEvaluation(value, state, profile) {
  const errors = [];
  if (!value || value.schemaVersion !== 1 || value.role !== "evaluator") errors.push("evaluation schemaVersion/role invalid");
  if (value && value.candidateFingerprint !== state.candidateFingerprint) errors.push("evaluation candidateFingerprint mismatch");
  if (value && value.evidenceBundleFingerprint !== state.evidenceBundleFingerprint) errors.push("evaluation evidenceBundleFingerprint mismatch");
  if (targetBaselineFingerprint(state) && value && value.targetBaselineFingerprint !== targetBaselineFingerprint(state)) errors.push("evaluation targetBaselineFingerprint mismatch");
  const ids = Array.isArray(value && value.dimensions) ? value.dimensions.map((row) => row.id) : [];
  for (const id of DIMENSION_IDS) if (ids.filter((entry) => entry === id).length !== 1) errors.push(`evaluation dimension ${id} must appear exactly once`);
  if (!value || !value.wholeIntent || typeof value.wholeIntent.coverageLimit !== "string" || !value.wholeIntent.coverageLimit.trim()) errors.push("evaluation wholeIntent.coverageLimit is required");
  if (value && value.verdict === "candidate-ready") {
    if (value.dimensions.some((row) => row.status !== "pass")) errors.push("candidate-ready requires all dimensions pass");
    if (!value.wholeIntent || value.wholeIntent.status !== "pass") errors.push("candidate-ready requires wholeIntent pass");
    for (const dimension of profile.dimensions) {
      const row = value.dimensions.find((entry) => entry.id === dimension.id);
      if (dimension.required && row && row.status === "n/a") errors.push(`candidate-ready cannot use n/a for required dimension ${dimension.id}`);
      const sources = new Set(row && row.sourceClasses || []);
      for (const required of dimension.requiredSourceClasses || []) if (!sources.has(required)) errors.push(`dimension ${dimension.id} missing required source class ${required}`);
    }
    if (value.independence && value.independence.class === "run-isolated-same-family") {
      for (const [dimensionId, requiredClasses] of Object.entries(SAME_FAMILY_MINIMUM_SOURCES)) {
        const row = value.dimensions.find((entry) => entry.id === dimensionId);
        const sources = new Set(row && row.sourceClasses || []);
        for (const required of requiredClasses) if (!sources.has(required)) errors.push(`same-family dimension ${dimensionId} missing minimum source class ${required}`);
      }
    }
    if (Array.isArray(value.newFindings) && value.newFindings.length) errors.push("candidate-ready cannot contain new findings");
  }
  if (!new Set(["candidate-ready", "fix-required", "needs-user", "blocked-by-environment", "non-convergent"]).has(value && value.verdict)) errors.push("evaluation verdict invalid");
  return errors;
}

function normalizedFindingSignature(finding) {
  const claim = String(finding && finding.claim || "")
    .toLowerCase()
    .replace(/[`*_#]/g, "")
    .replace(/\b(?:cf|nf|f)\d+\b/g, "<finding>")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return hashValue({ claim });
}

function evaluateLoopSafety(state, evaluation, config, beforeFindings) {
  state.counters.recurrence = state.counters.recurrence || {};
  state.counters.verdictHistory = state.counters.verdictHistory || [];
  state.counters.progressHistory = state.counters.progressHistory || [];
  const fixedBefore = new Map((beforeFindings || [])
    .filter((finding) => finding.status === "fixed")
    .map((finding) => [normalizedFindingSignature(finding), finding]));
  const blockingStatuses = new Set(["open", "carried-forward", "needs-user", "blocked"]);
  const blocking = state.findings.filter((finding) => /^P[12]$/.test(finding.severity || "") && blockingStatuses.has(finding.status));
  const repeated = [];
  const seen = new Set();
  for (const finding of blocking) {
    const signature = normalizedFindingSignature(finding);
    if (seen.has(signature) || !fixedBefore.has(signature)) continue;
    seen.add(signature);
    const record = state.counters.recurrence[signature] || { count: 0, findingIds: [], firstCycle: state.cycle };
    record.count += 1;
    record.lastCycle = state.cycle;
    record.findingIds = [...new Set([...record.findingIds, fixedBefore.get(signature).findingId, finding.findingId])];
    state.counters.recurrence[signature] = record;
    if (record.count >= config.limits.recurrenceLimit) repeated.push({ signature, ...record });
  }
  const priorVerdict = [...state.counters.verdictHistory].reverse()
    .find((entry) => entry.candidateFingerprint === state.candidateFingerprint);
  const oscillation = priorVerdict && priorVerdict.verdict !== evaluation.verdict
    ? { candidateFingerprint: state.candidateFingerprint, priorVerdict: priorVerdict.verdict, currentVerdict: evaluation.verdict, priorCycle: priorVerdict.cycle, currentCycle: state.cycle }
    : null;
  state.counters.verdictHistory.push({ cycle: state.cycle, candidateFingerprint: state.candidateFingerprint, verdict: evaluation.verdict, at: new Date().toISOString() });
  const progress = {
    cycle: state.cycle,
    verdict: evaluation.verdict,
    openP12: blocking.length,
    resolved: state.findings.filter((finding) => ["fixed", "rejected-with-evidence"].includes(finding.status)).length,
    repeated: repeated.length,
    at: new Date().toISOString(),
  };
  state.counters.progressHistory.push(progress);
  return repeated.length ? { reason: "finding-recurrence", repeated, progress } : oscillation ? { reason: "candidate-verdict-oscillation", oscillation, progress } : null;
}

function evaluateConfiguredLoopLimit(state, config, progressBaselineKnown) {
  if (state.cycle >= config.limits.maxCycles) {
    return { reason: "max-cycles", observed: state.cycle, limit: config.limits.maxCycles };
  }
  if (progressBaselineKnown && state.counters.noProgressCycles >= config.limits.noProgressCycles) {
    return { reason: "no-progress", observed: state.counters.noProgressCycles, limit: config.limits.noProgressCycles };
  }
  return null;
}

function evaluateWallClockLimit(state, config, now = Date.now()) {
  const startedAt = Date.parse(state && state.counters && state.counters.startedAt);
  const limit = config && config.limits && config.limits.wallClockMs;
  if (!Number.isFinite(startedAt) || !Number.isInteger(limit)) {
    return { reason: "wall-clock-invalid", observed: Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null, limit: Number.isInteger(limit) ? limit : null };
  }
  const observed = Math.max(0, now - startedAt);
  return observed > limit ? { reason: "wall-clock", observed, limit } : null;
}

function proofFailureFindingId(state, proof, policyManifest) {
  const policySlug = String(proof.policyId || "unknown").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  const identity = hashValue({
    policyId: proof.policyId,
    candidateFingerprint: state.candidateFingerprint,
    policySha256: policyManifest.sha256,
  }).slice("sha256:".length, "sha256:".length + 16);
  return `PROOF-${policySlug}-${identity}`;
}

function ensureProofFailureFinding(state, config) {
  const proof = [...(state.proofs || [])].reverse().find((row) => {
    const policy = config.proofPolicies && config.proofPolicies[row.policyId];
    const expected = policy && Array.isArray(policy.expectedExitCodes) ? policy.expectedExitCodes : [0];
    return policy && !row.timedOut && !row.error && !expected.includes(row.status);
  });
  if (!proof) return { status: "not-applicable", created: false, findingId: null };
  const policyManifest = state.candidateManifest && state.candidateManifest.policies && state.candidateManifest.policies[proof.policyId];
  const currentPolicy = config.proofPolicies && config.proofPolicies[proof.policyId];
  if (!policyManifest || !currentPolicy || policyManifest.sha256 !== hashValue(currentPolicy)) {
    return { status: "policy-drift", created: false, findingId: null, policyId: proof.policyId };
  }
  const findingId = proofFailureFindingId(state, proof, policyManifest);
  const existing = (state.findings || []).find((row) => row.findingId === findingId);
  if (existing && ["open", "carried-forward"].includes(existing.status)) {
    return { status: "ready", created: false, findingId };
  }
  const policy = currentPolicy;
  const expected = Array.isArray(policy.expectedExitCodes) ? policy.expectedExitCodes : [0];
  const finding = {
    findingId,
    severity: "P1",
    claim: `Required proof policy ${proof.policyId} exited outside its declared success contract.`,
    evidence: [
      `candidate=${state.candidateFingerprint}`,
      `policy=${proof.policyId}@${policyManifest.sha256}`,
      `expectedExitCodes=${expected.join(",")}; actualExit=${proof.status}`,
      `stdout=${proof.stdoutSha256}; stderr=${proof.stderrSha256}`,
      `artifacts=${proof.artifact ? `${proof.artifact.stdout || "-"},${proof.artifact.stderr || "-"}` : "-"}`,
    ],
    breakingScenario: "The candidate cannot satisfy its declared proof contract, and Builder authorization would otherwise have no open finding to reference.",
    alternative: "Classify timeout or process-launch errors as environment failures; ordinary unexpected exits remain candidate repair work.",
    recommendedAction: `Record a bounded Builder repair for ${proof.policyId}, then rerun the complete bound proof set.`,
    status: "open",
  };
  if (existing) Object.assign(existing, finding);
  else state.findings.push(finding);
  return { status: "ready", created: true, findingId };
}

async function actionValidateConfig(context) {
  const { loaded } = context;
  return {
    schemaVersion: 1,
    status: loaded.errors.length ? "invalid" : "valid",
    exitCode: loaded.errors.length ? 2 : 0,
    action: loaded.errors.length ? "fix-config" : "prepare",
    configPath: loaded.configPath,
    profilePath: loaded.profilePath,
    proofPolicyIds: loaded.config ? Object.keys(loaded.config.proofPolicies || {}) : [],
    errors: loaded.errors,
    warnings: loaded.warnings,
  };
}

async function actionPrepare(context) {
  const { repo, changeDir, loaded } = context;
  const errors = [...loaded.errors, ...(!loaded.errors.length ? calibrationErrors(changeDir, loaded.config, loaded.profile) : [])];
  if (errors.length) return { schemaVersion: 1, status: "invalid", exitCode: 2, action: "fix-config", errors, warnings: loaded.warnings };
  const manifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const fingerprint = hashValue(manifest);
  let state = readState(changeDir);
  if (!state) {
    state = initialState(repo, changeDir, loaded, manifest);
    fs.mkdirSync(cycleDir(changeDir, state), { recursive: true });
    writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), manifest);
    writeState(changeDir, state);
    return resultFromState(state, { status: "prepared", exitCode: 0, warnings: loaded.warnings });
  }
  if (state.candidateFingerprint === fingerprint && state.state === "builder-required" && state.nextAction === "repair-failed-proof") {
    const recovery = ensureProofFailureFinding(state, loaded.config);
    if (recovery.status === "policy-drift") {
      state.state = "needs-user";
      state.nextAction = "restore-bound-proof-policy-or-reopen";
      state.escalations.push({ at: new Date().toISOString(), reason: "failed-proof-policy-drift", policyId: recovery.policyId });
      writeState(changeDir, state);
      return resultFromState(state, { status: "needs-user", exitCode: 2, errors: [`proof policy ${recovery.policyId} changed before failed-proof recovery`] });
    }
    if (recovery.status !== "ready") {
      state.state = "needs-user";
      state.nextAction = "inspect-unrecoverable-proof-failure";
      state.escalations.push({ at: new Date().toISOString(), reason: "failed-proof-finding-unrecoverable" });
      writeState(changeDir, state);
      return resultFromState(state, { status: "needs-user", exitCode: 2, errors: ["failed-proof state has no durable ordinary proof failure to reconcile"] });
    }
    if (recovery.created) state.escalations.push({ at: new Date().toISOString(), reason: "legacy-proof-failure-finding-migrated", findingId: recovery.findingId });
    state.nextAction = "record-builder-before";
    writeState(changeDir, state);
    return resultFromState(state, { status: recovery.created ? "proof-failure-migrated" : "proof-failure-ready", exitCode: 0, findingId: recovery.findingId, warnings: loaded.warnings });
  }
  if (state.candidateFingerprint === fingerprint) return resultFromState(state, { status: "resumed", exitCode: 0, warnings: loaded.warnings });
  if (state.cycle >= loaded.config.limits.maxCycles) {
    state.state = "non-convergent";
    state.nextAction = "inspect-progress-and-decide";
    state.escalations.push({ at: new Date().toISOString(), reason: "max-cycles", previousFingerprint: state.candidateFingerprint, observedFingerprint: fingerprint });
    writeState(changeDir, state);
    return resultFromState(state, { errors: ["candidate changed after maximum cycle limit"] });
  }
  const changes = manifestDiff(state.candidateManifest, manifest);
  state.cycle += 1;
  state.state = "critic-required";
  state.nextAction = "run-critic";
  state.inProgressStep = null;
  state.completedSteps = [];
  state.candidateManifest = manifest;
  state.candidateFingerprint = fingerprint;
  state.evidenceManifest = null;
  state.evidenceBundleFingerprint = null;
  state.builder = null;
  state.proofs = [];
  state.evaluator = null;
  state.counters.fingerprintHistory.push(fingerprint);
  fs.mkdirSync(cycleDir(changeDir, state), { recursive: true });
  writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), manifest);
  writeState(changeDir, state);
  return resultFromState(state, { status: "candidate-refreshed", exitCode: 0, changedInputs: changes });
}

async function actionStatus(context) {
  const state = readState(context.changeDir);
  if (!state) return { schemaVersion: 1, status: "not-prepared", exitCode: 2, action: "prepare", errors: ["closure state does not exist"] };
  return resultFromState(state, {
    elapsedMs: Date.now() - Date.parse(state.counters.startedAt),
    completedSteps: state.completedSteps,
    findings: state.findings.map((row) => ({ findingId: row.findingId, severity: row.severity, status: row.status })),
    contextLimits: state.contextLimits,
  });
}

async function actionDryRunEnv(context) {
  if (context.loaded.errors.length) return actionValidateConfig(context);
  const policies = {};
  for (const [id, policy] of Object.entries(context.loaded.config.proofPolicies)) {
    try {
      const built = buildScrubbedEnv({ sourceEnv: process.env, explicitKeys: policy.envKeys || [], requireExplicit: false });
      policies[id] = { keys: built.inspection, missingExplicitKeys: built.missingExplicitKeys };
    } catch (error) {
      policies[id] = { error: error.message };
    }
  }
  return { schemaVersion: 1, status: "inspection", exitCode: 0, action: "none", valuesIncluded: false, policies, warnings: context.loaded.warnings, errors: [] };
}

async function actionCalibrate(context, policyId) {
  const { repo, changeDir, loaded } = context;
  if (loaded.errors.length) return actionValidateConfig(context);
  const policy = loaded.config.proofPolicies[policyId];
  if (!policy) return { schemaVersion: 1, status: "invalid", exitCode: 2, action: "fix-config", errors: [`unknown proof policy ${policyId}`], warnings: [] };
  const negativeId = policy.evidenceContract && policy.evidenceContract.negativeControlPolicy;
  if (!negativeId || !loaded.config.proofPolicies[negativeId]) return { schemaVersion: 1, status: "invalid", exitCode: 2, action: "fix-config", errors: [`policy ${policyId} has no valid negativeControlPolicy`], warnings: [] };
  const before = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const result = await executePolicy(repo, negativeId, loaded.config.proofPolicies[negativeId]);
  const after = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const changes = manifestDiff(before, after);
  const expected = loaded.config.proofPolicies[negativeId].expectedExitCodes || [1];
  const sensitive = !result.timedOut && expected.includes(result.status) && changes.length === 0;
  const calibration = calibrationState(changeDir);
  calibration.policies[policyId] = {
    status: sensitive ? "sensitive" : "failed",
    policyHash: hashValue(policy),
    negativeControlPolicy: negativeId,
    negativeControlPolicyHash: hashValue(loaded.config.proofPolicies[negativeId]),
    observedExit: result.status,
    expectedExitCodes: expected,
    candidateMutations: changes,
    recordedAt: new Date().toISOString(),
  };
  writeJson(closurePaths(changeDir).calibration, calibration);
  return { schemaVersion: 1, status: sensitive ? "calibrated" : "failed", exitCode: sensitive ? 0 : 2, action: sensitive ? "prepare" : "fix-negative-control", policyId, result: proofPublicResult(result, null), candidateMutations: changes, errors: sensitive ? [] : ["negative control did not demonstrate sensitivity without mutating candidate"], warnings: [] };
}

async function actionImportCritic(context, input) {
  const { repo, changeDir } = context;
  const state = readState(changeDir);
  if (!state || state.state !== "critic-required") throw new Error(`import-critic requires critic-required state; current ${state ? state.state : "missing"}`);
  const dir = validateRunDir(repo, input);
  const run = readJson(path.join(dir, "run.json"));
  if (run.mode !== "review" || run.reviewerStatus !== "success" || !["findings_table", "numbered_findings"].includes(run.outputFormat)) throw new Error("Critic run must be a successful structured review mode run");
  if (run.candidateFingerprint !== state.candidateFingerprint) throw new Error("Critic run candidateFingerprint does not match current candidate");
  const raw = run.paths && run.paths.raw ? run.paths.raw : path.join(dir, "raw.md");
  const parsed = parseCriticFindings(raw);
  if (parsed.errors.length) throw new Error(`Critic output is ambiguous: ${parsed.errors.join("; ")}`);
  const findings = parsed.findings;
  state.findings = findings;
  state.counters.cycleOpenP12 = findings.filter((row) => /^P[12]$/.test(row.severity || "") && row.status === "open").length;
  state.completedSteps.push(`critic:${state.cycle}`);
  state.state = findings.length ? "builder-required" : "proofs-required";
  state.nextAction = findings.length ? "record-builder-before" : "run-proofs";
  const reference = {
    run: repoRelative(repo, dir),
    requestedRole: "critic",
    roleContract: ROLE_CONTRACTS.critic,
    reviewer: run.reviewer,
    transport: run.transport || null,
    transportScopeFingerprint: run.scopeFingerprint || null,
    includedScopeFingerprint: state.candidateFingerprint,
    candidateFingerprint: run.candidateFingerprint,
    findingIds: findings.map((row) => row.findingId),
  };
  writeJson(path.join(cycleDir(changeDir, state), "critic-ref.json"), reference);
  writeState(changeDir, state);
  return resultFromState(state, { status: "critic-imported", findingCount: findings.length, criticRef: reference });
}

async function actionBuilderBefore(context, input) {
  const { repo, changeDir, loaded } = context;
  const state = readState(changeDir);
  if (!state || state.state !== "builder-required") throw new Error(`builder-before requires builder-required state; current ${state ? state.state : "missing"}`);
  const record = readJson(validateRecordPath(repo, input));
  const errors = validateBuilderBefore(record, state, loaded, repo);
  if (errors.length) return { ...resultFromState(state), status: "invalid-builder-before", exitCode: 2, errors };
  const token = builderToken(state, record);
  state.builder = {
    beforeRecord: record,
    findingIds: record.findingIds,
    declaredChanges: record.changes.map((change) => ({ path: normalizeRel(change.path), changeSummary: change.changeSummary })),
    authorityIds: record.authorityIds,
    proofPolicyIds: record.proofPolicyIds,
    riskClass: record.riskClass,
    riskAssessment: record.riskAssessment || null,
    beforeManifest: state.candidateManifest,
    completionToken: token,
  };
  state.state = "builder-in-progress";
  state.nextAction = "builder-repair-then-complete";
  state.inProgressStep = `builder:${state.cycle}`;
  writeJson(path.join(cycleDir(changeDir, state), "builder-before.json"), { ...record, completionToken: token });
  writeState(changeDir, state);
  return resultFromState(state, { status: "builder-authorized", completionToken: token, declaredChanges: state.builder.declaredChanges });
}

function invalidateCandidateBoundSteps(state) {
  const proofPrefix = `proof:${state.cycle}:`;
  const evaluatorStep = `evaluator:${state.cycle}`;
  const builderStep = `builder:${state.cycle}`;
  state.completedSteps = [...new Set(state.completedSteps.filter((step) => (
    step !== builderStep
    && !step.startsWith(proofPrefix)
    && step !== evaluatorStep
    && !step.startsWith(`${evaluatorStep}:`)
  )))];
  if (state.inProgressStep && (state.inProgressStep.startsWith(proofPrefix) || state.inProgressStep === evaluatorStep || state.inProgressStep.startsWith(`${evaluatorStep}:`))) state.inProgressStep = null;
}

function clearProofAttempt(state, policyId) {
  const step = `proof:${state.cycle}:${policyId}`;
  state.proofs = (state.proofs || []).filter((proof) => proof.policyId !== policyId);
  state.completedSteps = (state.completedSteps || []).filter((completed) => completed !== step);
  if (state.inProgressStep === step) state.inProgressStep = null;
  state.evidenceManifest = null;
  state.evidenceBundleFingerprint = null;
  state.evaluator = null;
}

function invalidateForFreshCritic(state) {
  const prefixes = [`critic:${state.cycle}`, `builder:${state.cycle}`, `proof:${state.cycle}:`, `evaluator:${state.cycle}`];
  state.completedSteps = (state.completedSteps || []).filter((step) => !prefixes.some((prefix) => step === prefix || step.startsWith(`${prefix}:`) || (prefix.endsWith(":") && step.startsWith(prefix))));
  state.inProgressStep = null;
  state.builder = null;
  state.proofs = [];
  state.evidenceManifest = null;
  state.evidenceBundleFingerprint = null;
  state.evaluator = null;
}

function commitBuilderCompletion(state, record, manifest, changes) {
  invalidateCandidateBoundSteps(state);
  for (const disposition of record.findings) {
    const finding = state.findings.find((row) => row.findingId === disposition.findingId);
    if (finding) Object.assign(finding, { status: disposition.status, builderEvidence: disposition.evidence || [], residual: disposition.residual || null });
  }
  state.builder.completionRecord = record;
  state.builder.afterManifest = manifest;
  state.builder.actualChanges = changes;
  state.candidateManifest = manifest;
  state.candidateFingerprint = hashValue(manifest);
  state.proofs = [];
  state.evidenceManifest = null;
  state.evidenceBundleFingerprint = null;
  state.evaluator = null;
  state.counters.fingerprintHistory.push(state.candidateFingerprint);
  state.state = "proofs-required";
  state.nextAction = "run-proofs";
  state.inProgressStep = null;
  state.completedSteps.push(`builder:${state.cycle}`);
}

async function actionBuilderComplete(context, input) {
  const { repo, changeDir, loaded } = context;
  const state = readState(changeDir);
  if (!state || state.state !== "builder-in-progress") throw new Error(`builder-complete requires builder-in-progress state; current ${state ? state.state : "missing"}`);
  const evaluatorAttributionRepair = reconcileEvaluatorArtifactAttribution(changeDir);
  const record = readJson(validateRecordPath(repo, input));
  const errors = validateBuilderCompletion(record, state);
  const manifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const changes = manifestDiff(state.builder.beforeManifest, manifest);
  const declared = new Set(state.builder.declaredChanges.map((row) => row.path));
  const unexpected = changes.filter((change) => !change.path.startsWith("<") && !declared.has(change.path));
  const protectedChanges = changes.filter(isAutoProtectedChange);
  if (!state.change.targetBaseline) state.change.targetBaseline = targetBaselineFromManifest(state.builder.beforeManifest);
  if (errors.length || unexpected.length || protectedChanges.length) {
    state.state = "needs-user";
    state.nextAction = "inspect-incomplete-repair";
    const inspectionPath = path.join(cycleDir(changeDir, state), "incomplete-repair-inspection.json");
    const reason = errors.length ? "builder-completion-invalid" : protectedChanges.length ? "protected-builder-delta" : "undeclared-builder-delta";
    state.escalations.push({
      at: new Date().toISOString(),
      reason,
      errors,
      unexpected,
      protectedChanges,
      inspection: repoRelative(repo, inspectionPath),
      resumeState: "builder-in-progress",
    });
    const inspection = {
      planned: state.builder.declaredChanges,
      actual: changes,
      unexpected,
      protectedChanges,
      errors,
      completionRecord: record,
      candidateManifest: manifest,
      decisions: ["approve", "reject", "reopen"],
      boundary: protectedChanges.length
        ? "Protected target/public/proof-strategy changes cannot be auto-approved as mechanical repair. Revert/reject them or explicitly reopen the target for a fresh Critic."
        : "Only an explicit operator decision may accept or reopen an undeclared Builder delta; approval does not skip fresh proofs and evaluation.",
    };
    writeJson(inspectionPath, inspection);
    writeState(changeDir, state);
    return resultFromState(state, { status: "needs-user", exitCode: 2, inspection, errors: [...errors, ...unexpected.map((row) => `unexpected Builder path ${row.path}`), ...protectedChanges.map((row) => `protected Builder change ${row.path}${row.field ? `:${row.field}` : ""}`)] });
  }
  commitBuilderCompletion(state, record, manifest, changes);
  writeJson(path.join(cycleDir(changeDir, state), "builder-completion.json"), { ...record, actualChanges: changes, candidateFingerprint: state.candidateFingerprint });
  writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), manifest);
  writeState(changeDir, state);
  return resultFromState(state, { status: "builder-complete", actualChanges: changes, evaluatorAttributionRepair: evaluatorAttributionRepair ? { status: evaluatorAttributionRepair.status, mappings: evaluatorAttributionRepair.mappings.map((row) => ({ sourceCycle: row.sourceCycle, targetCycle: row.targetCycle, invocationId: row.evaluatorRef.invocationId })) } : null });
}

async function actionRunProofs(context, hooks = {}) {
  const { repo, changeDir, loaded } = context;
  let state = readState(changeDir);
  if (!state || state.state !== "proofs-required") throw new Error(`run-proofs requires proofs-required state; current ${state ? state.state : "missing"}`);
  if (state.inProgressStep && !state.completedSteps.includes(state.inProgressStep)) {
    state.state = "needs-user";
    state.nextAction = "inspect-uncertain-proof";
    state.escalations.push({ at: new Date().toISOString(), reason: "uncertain-in-progress-proof", step: state.inProgressStep });
    writeState(changeDir, state);
    return resultFromState(state, { status: "needs-user", exitCode: 2, errors: [`proof ${state.inProgressStep} has uncertain execution state and will not be replayed automatically`] });
  }
  const ids = proofOrder(loaded.config, loaded.profile);
  const completedPrefix = `proof:${state.cycle}:`;
  const completedPolicyIds = new Set(state.completedSteps.filter((step) => step.startsWith(completedPrefix)).map((step) => step.slice(completedPrefix.length)));
  const savedById = new Map();
  const recoveryErrors = [];
  for (const proof of state.proofs) {
    if (!proof || typeof proof.policyId !== "string") { recoveryErrors.push("persisted proof result has no policyId"); continue; }
    if (savedById.has(proof.policyId)) recoveryErrors.push(`persisted proof result is duplicated for ${proof.policyId}`);
    savedById.set(proof.policyId, proof);
    if (!ids.includes(proof.policyId)) recoveryErrors.push(`persisted proof result references unrequested policy ${proof.policyId}`);
    if (!completedPolicyIds.has(proof.policyId)) recoveryErrors.push(`persisted proof ${proof.policyId} lacks its completedSteps commit`);
    if (proof.candidateFingerprint !== state.candidateFingerprint) recoveryErrors.push(`persisted proof ${proof.policyId} is bound to another candidate`);
    if (proof.timedOut || proof.error || !Array.isArray(proof.mutations) || proof.mutations.length) recoveryErrors.push(`persisted proof ${proof.policyId} is not a clean committed result`);
    const expectedExits = loaded.config.proofPolicies[proof.policyId] && (loaded.config.proofPolicies[proof.policyId].expectedExitCodes || [0]);
    if (expectedExits && !expectedExits.includes(proof.status)) recoveryErrors.push(`persisted proof ${proof.policyId} has unexpected exit ${proof.status}`);
  }
  for (const policyId of completedPolicyIds) {
    if (!ids.includes(policyId)) recoveryErrors.push(`completedSteps references unrequested proof ${policyId}`);
    if (!savedById.has(policyId)) recoveryErrors.push(`completed proof ${policyId} has no persisted result`);
  }
  if (recoveryErrors.length) {
    state.state = "needs-user";
    state.nextAction = "inspect-proof-recovery";
    state.escalations.push({ at: new Date().toISOString(), reason: "inconsistent-completed-proof-state", errors: recoveryErrors });
    writeState(changeDir, state);
    return resultFromState(state, { status: "needs-user", exitCode: 2, errors: recoveryErrors });
  }
  for (const id of ids) {
    const expectedPolicy = state.candidateManifest && state.candidateManifest.policies && state.candidateManifest.policies[id];
    const observedPolicyHash = hashValue(loaded.config.proofPolicies[id]);
    if (!expectedPolicy || expectedPolicy.sha256 !== observedPolicyHash) {
      state.state = "needs-user";
      state.nextAction = "inspect-proof-policy-drift";
      state.escalations.push({ at: new Date().toISOString(), reason: "proof-policy-drift", policyId: id, expectedPolicyHash: expectedPolicy && expectedPolicy.sha256, observedPolicyHash });
      writeState(changeDir, state);
      return resultFromState(state, { status: "needs-user", exitCode: 2, errors: [`proof policy ${id} changed after candidate binding and was not executed`] });
    }
    const step = `proof:${state.cycle}:${id}`;
    if (completedPolicyIds.has(id)) continue;
    state.inProgressStep = step;
    writeState(changeDir, state);
    const before = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
    let result;
    try {
      result = await executePolicy(repo, id, loaded.config.proofPolicies[id]);
    } catch (error) {
      state = readState(changeDir);
      const environmentFailure = error.code === "MISSING_ENV_KEYS";
      state.state = environmentFailure ? "blocked-by-environment" : "needs-user";
      state.nextAction = "inspect-proof-environment";
      state.escalations.push({
        at: new Date().toISOString(),
        reason: environmentFailure ? "proof-environment-failure" : "proof-spawn-failed",
        policyId: id,
        error: error.message,
        ...(environmentFailure ? {
          resumeState: "proofs-required",
          candidateFingerprint: state.candidateFingerprint,
          policySha256: state.candidateManifest.policies[id].sha256,
          executionStarted: false,
        } : {}),
      });
      if (environmentFailure) state.inProgressStep = null;
      writeState(changeDir, state);
      return resultFromState(state, { status: state.state, exitCode: 2, errors: [error.message] });
    }
    state = readState(changeDir);
    const after = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
    const mutations = manifestDiff(before, after);
    const artifact = writeProofArtifacts(repo, changeDir, state, result);
    const publicResult = { ...proofPublicResult(result, artifact), candidateFingerprint: state.candidateFingerprint, mutations };
    state.proofs.push(publicResult);
    state.inProgressStep = null;
    state.completedSteps.push(step);
    const expected = loaded.config.proofPolicies[id].expectedExitCodes || [0];
    if (mutations.length) {
      state.state = "needs-user";
      state.nextAction = "inspect-proof-mutation";
      state.escalations.push({ at: new Date().toISOString(), reason: "proof-mutated-candidate", policyId: id, mutations });
      writeJson(path.join(cycleDir(changeDir, state), "proofs.json"), state.proofs);
      writeState(changeDir, state);
      return resultFromState(state, { status: "needs-user", exitCode: 2, errors: [`proof policy ${id} mutated the candidate`], mutations });
    }
    if (result.timedOut || !expected.includes(result.status)) {
      state.state = result.timedOut || result.error ? "blocked-by-environment" : "builder-required";
      if (state.state === "builder-required") {
        const recovery = ensureProofFailureFinding(state, loaded.config);
        if (recovery.status !== "ready") throw new Error(`failed proof ${id} could not create a Builder finding (${recovery.status})`);
        state.nextAction = "record-builder-before";
      } else {
        state.nextAction = "inspect-proof-environment";
        state.escalations.push({
          at: new Date().toISOString(),
          reason: "proof-environment-failure",
          resumeState: "proofs-required",
          policyId: id,
          candidateFingerprint: state.candidateFingerprint,
          policySha256: state.candidateManifest.policies[id].sha256,
          proofIdentity: hashValue({ policyId: id, candidateFingerprint: state.candidateFingerprint, stdoutSha256: publicResult.stdoutSha256, stderrSha256: publicResult.stderrSha256, status: publicResult.status, timedOut: publicResult.timedOut, error: publicResult.error }),
        });
      }
      writeJson(path.join(cycleDir(changeDir, state), "proofs.json"), state.proofs);
      writeState(changeDir, state);
      return resultFromState(state, { status: state.state === "builder-required" ? "fix-required" : state.state, exitCode: 2, failedPolicy: id, proof: publicResult });
    }
    writeState(changeDir, state);
    if (hooks.afterProofCommitted) await hooks.afterProofCommitted({ policyId: id, step, state: JSON.parse(JSON.stringify(state)) });
  }
  state.proofs = ids.map((id) => state.proofs.find((proof) => proof.policyId === id));
  const evidenceManifest = {
    schemaVersion: 1,
    candidateFingerprint: state.candidateFingerprint,
    policies: state.proofs.map((result) => ({
      policyId: result.policyId,
      policyHash: hashValue(loaded.config.proofPolicies[result.policyId]),
      status: result.status,
      timedOut: result.timedOut,
      stdoutSha256: result.stdoutSha256,
      stderrSha256: result.stderrSha256,
      durationMs: result.durationMs,
    })),
  };
  state.evidenceManifest = evidenceManifest;
  state.evidenceBundleFingerprint = hashValue(evidenceManifest);
  state.state = "evaluator-required";
  state.nextAction = "run-evaluator";
  writeJson(path.join(cycleDir(changeDir, state), "proofs.json"), state.proofs);
  writeJson(path.join(cycleDir(changeDir, state), "evidence-manifest.json"), evidenceManifest);
  writeState(changeDir, state);
  return resultFromState(state, { status: "proofs-passed", proofCount: state.proofs.length });
}

async function actionEvaluatorStart(context, input) {
  const { repo, changeDir } = context;
  const state = readState(changeDir);
  if (!state || state.state !== "evaluator-required") throw new Error(`evaluator-start requires evaluator-required state; current ${state ? state.state : "missing"}`);
  const record = readJson(validateRecordPath(repo, input));
  const errors = [];
  const baselineFingerprint = targetBaselineFingerprint(state);
  if (!SHA256_ID.test(baselineFingerprint || "")) errors.push("Evaluator start requires an immutable lineage target baseline");
  if (record.schemaVersion !== 1) errors.push("Evaluator start schemaVersion must be 1");
  if (record.candidateFingerprint !== state.candidateFingerprint) errors.push("Evaluator start candidateFingerprint does not match current candidate");
  if (record.evidenceBundleFingerprint !== state.evidenceBundleFingerprint) errors.push("Evaluator start evidenceBundleFingerprint does not match current evidence bundle");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record.invocationId || "")) errors.push("Evaluator start invocationId is invalid");
  if (typeof record.reviewer !== "string" || !record.reviewer.trim()) errors.push("Evaluator start reviewer is required");
  if (typeof record.transport !== "string" || !record.transport.trim()) errors.push("Evaluator start transport is required");
  let expectedRunDir = null;
  try {
    expectedRunDir = normalizeRel(record.expectedRunDir);
    const resolved = path.resolve(repo, expectedRunDir);
    if (!pathInsideOrSame(repo, resolved)) errors.push("Evaluator start expectedRunDir escapes repository");
    if (!pathInsideOrSame(changeDir, resolved)) errors.push("Evaluator start expectedRunDir must stay inside the governed change directory");
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) return { ...resultFromState(state), status: "invalid-evaluator-start", exitCode: 2, errors };
  const startedAt = new Date().toISOString();
  const step = `evaluator:${state.cycle}:${record.invocationId}`;
  state.evaluator = {
    status: "running",
    requestedRole: "evaluator",
    roleContract: ROLE_CONTRACTS.evaluator,
    includedScopeFingerprint: hashValue({ candidateFingerprint: state.candidateFingerprint, evidenceBundleFingerprint: state.evidenceBundleFingerprint, targetBaselineFingerprint: baselineFingerprint }),
    targetBaselineFingerprint: baselineFingerprint,
    invocationId: record.invocationId,
    reviewer: record.reviewer,
    transport: record.transport,
    expectedRunDir,
    candidateFingerprint: state.candidateFingerprint,
    evidenceBundleFingerprint: state.evidenceBundleFingerprint,
    startedAt,
  };
  state.state = "evaluator-running";
  state.nextAction = "inspect-evaluator-run";
  state.inProgressStep = step;
  writeJson(path.join(cycleDir(changeDir, state), "evaluator-invocation.json"), {
    ...record,
    requestedRole: state.evaluator.requestedRole,
    roleContract: state.evaluator.roleContract,
    includedScopeFingerprint: state.evaluator.includedScopeFingerprint,
    targetBaselineFingerprint: state.evaluator.targetBaselineFingerprint,
    expectedRunDir,
    startedAt,
    step,
  });
  writeState(changeDir, state);
  return resultFromState(state, { status: "evaluator-started", invocationId: record.invocationId, expectedRunDir });
}

async function actionImportEvaluator(context, input) {
  const { repo, changeDir, loaded } = context;
  const state = readState(changeDir);
  if (!state || state.state !== "evaluator-running" || !state.evaluator || state.evaluator.status !== "running") throw new Error(`import-evaluator requires a recorded evaluator-running invocation; current ${state ? state.state : "missing"}`);
  const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const currentFingerprint = hashValue(currentManifest);
  if (currentFingerprint !== state.candidateFingerprint) {
    return {
      ...resultFromState(state),
      status: "stale",
      exitCode: 3,
      action: "prepare",
      errors: ["candidate inputs changed after the Evaluator invocation was recorded"],
      changedInputs: manifestDiff(state.candidateManifest, currentManifest),
      observedCandidateFingerprint: currentFingerprint,
    };
  }
  if (state.evidenceManifest === null || hashValue(state.evidenceManifest) !== state.evidenceBundleFingerprint) {
    return { ...resultFromState(state), status: "stale", exitCode: 3, action: "run-proofs", errors: ["evidence manifest no longer matches the Evaluator invocation"] };
  }
  const evidenceMismatches = evidenceIntegrityMismatches(repo, changeDir, state);
  if (evidenceMismatches.length) {
    return {
      ...resultFromState(state),
      status: "stale",
      exitCode: 3,
      action: "run-proofs",
      errors: ["persisted proof evidence bytes changed after the Evaluator invocation was recorded"],
      mismatches: evidenceMismatches,
    };
  }
  const invocation = JSON.parse(JSON.stringify(state.evaluator));
  const evaluatedCycle = state.cycle;
  const evaluatedCycleDirectory = cycleDirFor(changeDir, evaluatedCycle);
  const dir = validateRunDir(repo, input);
  const run = readJson(path.join(dir, "run.json"));
  if (repoRelative(repo, dir) !== invocation.expectedRunDir) throw new Error("Evaluator run directory does not match the recorded invocation");
  if (run.mode !== "evaluate") throw new Error("Evaluator run must be an evaluate mode run");
  if (run.candidateFingerprint !== state.candidateFingerprint || run.evidenceBundleFingerprint !== state.evidenceBundleFingerprint) throw new Error("Evaluator run fingerprints do not match current candidate/evidence bundle");
  if (run.targetBaselineFingerprint !== invocation.targetBaselineFingerprint) throw new Error("Evaluator run targetBaselineFingerprint does not match the recorded lineage target");
  if (run.reviewer !== invocation.reviewer) throw new Error("Evaluator run reviewer does not match the recorded invocation");
  if (run.transport !== invocation.transport) throw new Error("Evaluator run transport does not match the recorded invocation");
  if (run.reviewerStatus !== "success") {
    state.evaluator = { ...invocation, status: "failed", reviewerStatus: run.reviewerStatus || "unknown", run: repoRelative(repo, dir), completedAt: new Date().toISOString() };
    state.state = "blocked-by-environment";
    state.nextAction = "repair-evaluator-environment";
    state.inProgressStep = null;
    state.escalations.push({ at: new Date().toISOString(), reason: "evaluator-invocation-failed", invocationId: invocation.invocationId, run: repoRelative(repo, dir), resumeState: "evaluator-required" });
    writeJson(path.join(cycleDir(changeDir, state), "evaluator-ref.json"), state.evaluator);
    writeState(changeDir, state);
    return resultFromState(state, { status: "blocked-by-environment", exitCode: 2, errors: ["recorded Evaluator invocation did not complete successfully"] });
  }
  if (run.outputFormat !== "evaluator_json") throw new Error("successful Evaluator run must use evaluator_json output");
  const evaluationFile = run.paths && run.paths.evaluation ? run.paths.evaluation : path.join(dir, "evaluation.json");
  if (!fs.existsSync(evaluationFile)) throw new Error("Evaluator run evaluation.json is missing");
  const evaluation = readJson(evaluationFile);
  const errors = validateEvaluation(evaluation, state, loaded.profile);
  if (errors.length) return { ...resultFromState(state), status: "unusable-evaluator", exitCode: 3, errors };
  state.evaluator = {
    status: "completed",
    requestedRole: invocation.requestedRole,
    roleContract: invocation.roleContract,
    includedScopeFingerprint: invocation.includedScopeFingerprint,
    targetBaselineFingerprint: invocation.targetBaselineFingerprint,
    invocationId: invocation.invocationId,
    expectedRunDir: invocation.expectedRunDir,
    startedAt: invocation.startedAt,
    completedAt: new Date().toISOString(),
    run: repoRelative(repo, dir),
    reviewer: run.reviewer,
    transport: run.transport,
    transportScopeFingerprint: run.scopeFingerprint || null,
    candidateFingerprint: evaluation.candidateFingerprint,
    evidenceBundleFingerprint: evaluation.evidenceBundleFingerprint,
    verdict: evaluation.verdict,
    verdictReason: evaluation.verdictReason,
    independence: evaluation.independence,
    residualUnknowns: evaluation.residualUnknowns,
    evaluatedCycle,
  };
  const reference = { ...state.evaluator, evaluation: repoRelative(repo, evaluationFile) };
  writeJson(path.join(evaluatedCycleDirectory, "evaluator-ref.json"), reference);
  writeJson(path.join(evaluatedCycleDirectory, "verdict.json"), evaluation);
  if (state.inProgressStep && !state.completedSteps.includes(state.inProgressStep)) state.completedSteps.push(state.inProgressStep);
  state.inProgressStep = null;
  state.completedSteps.push(`evaluator:${state.cycle}`);
  state.counters.evaluations += 1;
  const beforeFindings = JSON.parse(JSON.stringify(state.findings));
  const progressBaselineKnown = Number.isInteger(state.counters.cycleOpenP12);
  const previousOpen = progressBaselineKnown ? state.counters.cycleOpenP12 : null;
  for (const closure of evaluation.findingClosure || []) {
    const finding = state.findings.find((row) => row.findingId === closure.findingId);
    if (finding) Object.assign(finding, { status: closure.status, evaluatorEvidence: closure.evidence || [], residual: closure.residual || null });
  }
  for (const finding of evaluation.newFindings || []) {
    if (finding && finding.findingId && !state.findings.some((row) => row.findingId === finding.findingId)) state.findings.push({ ...finding, status: "open" });
  }
  const open = state.findings.filter((row) => /^P[12]$/.test(row.severity || "") && (row.status === "open" || row.status === "carried-forward")).length;
  if (progressBaselineKnown) state.counters.noProgressCycles = open < previousOpen ? 0 : state.counters.noProgressCycles + 1;
  state.counters.cycleOpenP12 = open;
  const loopBreach = evaluateLoopSafety(state, evaluation, loaded.config, beforeFindings);
  const progress = state.counters.progressHistory[state.counters.progressHistory.length - 1];
  Object.assign(progress, {
    baselineOpenP12: previousOpen,
    progressAssessment: progressBaselineKnown ? (open < previousOpen ? "progress" : "no-progress") : "unknown-legacy-baseline",
    progressDiagnostic: progressBaselineKnown ? null : "cycleOpenP12 was unavailable; noProgressCycles was preserved because post-Builder findings cannot reconstruct the Critic-time baseline",
  });
  const wallClockLimit = evaluateWallClockLimit(state, loaded.config);
  const configuredLimit = wallClockLimit || (evaluation.verdict === "fix-required" ? evaluateConfiguredLoopLimit(state, loaded.config, progressBaselineKnown) : null);
  let effectiveVerdict = evaluation.verdict;
  if (loopBreach || configuredLimit) {
    effectiveVerdict = "non-convergent";
    state.state = "non-convergent";
    state.nextAction = "inspect-progress-and-decide";
    const breaches = [
      ...(loopBreach ? [{ source: "evaluation-loop-safety", ...loopBreach }] : []),
      ...(configuredLimit ? [{ source: "configured-limit", ...configuredLimit }] : []),
    ];
    const effectiveBreach = breaches[0];
    state.escalations.push({
      at: new Date().toISOString(),
      ...effectiveBreach,
      breaches,
      originalVerdict: evaluation.verdict,
      originalOpenP12: previousOpen,
      currentOpenP12: open,
      progressBaselineKnown,
      recommendedNext: "inspect-progress-and-decide",
    });
  } else if (evaluation.verdict === "candidate-ready") {
    state.state = "candidate-ready";
    state.nextAction = "human-trust-checkpoint";
  } else if (evaluation.verdict === "fix-required") {
    if (configuredLimit) {
      state.state = "non-convergent";
      state.nextAction = "inspect-progress-and-decide";
      state.escalations.push({ at: new Date().toISOString(), ...configuredLimit, progressBaselineKnown, originalOpenP12: previousOpen, currentOpenP12: open, recommendedNext: "inspect-progress-and-decide" });
    } else {
      state.cycle += 1;
      state.state = "builder-required";
      state.nextAction = "record-builder-before";
      state.builder = null;
      state.proofs = [];
      state.evidenceManifest = null;
      state.evidenceBundleFingerprint = null;
      fs.mkdirSync(cycleDir(changeDir, state), { recursive: true });
      writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), state.candidateManifest);
    }
  } else {
    state.state = evaluation.verdict;
    state.nextAction = evaluation.verdict === "needs-user" ? "human-trust-decision" : evaluation.verdict === "blocked-by-environment" ? "repair-environment" : "inspect-progress-and-decide";
  }
  writeState(changeDir, state);
  return resultFromState(state, { status: effectiveVerdict, exitCode: effectiveVerdict === "candidate-ready" ? 0 : 2, verdictReason: evaluation.verdictReason, residualUnknowns: evaluation.residualUnknowns, loopBreach, configuredLimit });
}

async function actionCheck(context) {
  const { repo, changeDir, loaded } = context;
  if (loaded.errors.length) return actionValidateConfig(context);
  const state = readState(changeDir);
  if (!state) return { schemaVersion: 1, status: "not-prepared", exitCode: 2, action: "prepare", errors: ["closure state does not exist"] };
  const manifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
  const fingerprint = hashValue(manifest);
  if (fingerprint !== state.candidateFingerprint) {
    return { ...resultFromState(state), status: "stale", exitCode: 3, action: "prepare", errors: ["candidate inputs changed after the current closure evidence"], changedInputs: manifestDiff(state.candidateManifest, manifest), observedCandidateFingerprint: fingerprint };
  }
  if (state.evidenceManifest !== null && hashValue(state.evidenceManifest) !== state.evidenceBundleFingerprint) {
    return {
      ...resultFromState(state),
      status: "stale",
      exitCode: 3,
      action: "run-proofs",
      errors: ["evidence manifest does not match the bound evidence bundle fingerprint"],
      mismatches: [{ inputClass: "proof-evidence", field: "state.evidenceManifest", kind: "hash-mismatch", expectedHash: state.evidenceBundleFingerprint, observedHash: hashValue(state.evidenceManifest) }],
    };
  }
  if (state.evidenceManifest !== null) {
    const mismatches = evidenceIntegrityMismatches(repo, changeDir, state);
    if (mismatches.length) return { ...resultFromState(state), status: "stale", exitCode: 3, action: "run-proofs", errors: ["persisted proof evidence bytes do not match the bound evidence records"], mismatches };
  }
  if (state.evaluator) {
    const expectedIncludedScope = hashValue({ candidateFingerprint: state.candidateFingerprint, evidenceBundleFingerprint: state.evidenceBundleFingerprint, targetBaselineFingerprint: targetBaselineFingerprint(state) });
    const identityFields = [
      ["requestedRole", state.evaluator.requestedRole, "evaluator"],
      ["roleContract", state.evaluator.roleContract, ROLE_CONTRACTS.evaluator],
      ["includedScopeFingerprint", state.evaluator.includedScopeFingerprint, expectedIncludedScope],
      ["targetBaselineFingerprint", state.evaluator.targetBaselineFingerprint, targetBaselineFingerprint(state)],
      ["candidateFingerprint", state.evaluator.candidateFingerprint, state.candidateFingerprint],
      ["evidenceBundleFingerprint", state.evaluator.evidenceBundleFingerprint, state.evidenceBundleFingerprint],
    ];
    const mismatches = identityFields.filter(([, observed, expected]) => observed !== expected).map(([field, observed, expected]) => ({ inputClass: "evaluator-identity", field, kind: "field-mismatch", expectedHash: diagnosticHash(expected), observedHash: diagnosticHash(observed) }));
    if (mismatches.length) return { ...resultFromState(state), status: "stale", exitCode: 3, action: "run-evaluator", errors: ["Evaluator identity does not match the current role, candidate, and evidence scope"], mismatches };
  }
  const elapsed = Math.max(0, Date.now() - Date.parse(state.counters.startedAt));
  const wallClockLimit = evaluateWallClockLimit(state, loaded.config);
  if (wallClockLimit && !TERMINAL_STATES.has(state.state)) {
    return { ...resultFromState(state), status: "non-convergent", exitCode: 2, action: "inspect-progress-and-decide", errors: [`wall clock ${wallClockLimit.observed}ms exceeds configured ${wallClockLimit.limit}ms`] };
  }
  return resultFromState(state, {
    status: state.state === "candidate-ready" ? "candidate-ready" : "incomplete",
    exitCode: state.state === "candidate-ready" ? 0 : 2,
    elapsedMs: elapsed,
    proofDurationMs: state.proofs.reduce((sum, row) => sum + (row.durationMs || 0), 0),
    residualUnknowns: state.evaluator ? state.evaluator.residualUnknowns : [],
    errors: state.state === "candidate-ready" ? [] : [`closure is ${state.state}, not candidate-ready`],
  });
}

function activeIncompleteRepairEscalation(state) {
  if (state.state !== "needs-user" || !["inspect-incomplete-repair", "revert-unapproved-builder-delta"].includes(state.nextAction)) return null;
  return [...state.escalations].reverse()
    .find((entry) => ["undeclared-builder-delta", "protected-builder-delta", "builder-completion-invalid", "rejected-builder-delta-awaiting-revert"].includes(entry.reason)) || null;
}

function evaluatorInvocationDecisionBasis(state) {
  const evaluator = state && state.evaluator;
  if (!evaluator) return null;
  return {
    status: evaluator.status,
    requestedRole: evaluator.requestedRole,
    roleContract: evaluator.roleContract,
    includedScopeFingerprint: evaluator.includedScopeFingerprint,
    targetBaselineFingerprint: evaluator.targetBaselineFingerprint,
    invocationId: evaluator.invocationId,
    reviewer: evaluator.reviewer,
    transport: evaluator.transport,
    expectedRunDir: evaluator.expectedRunDir,
    candidateFingerprint: evaluator.candidateFingerprint,
    evidenceBundleFingerprint: evaluator.evidenceBundleFingerprint,
    startedAt: evaluator.startedAt,
  };
}

function decisionBasis(state, decision, reason) {
  return {
    contractVersion: CONTRACT_VERSION,
    lineageId: state.lineageId,
    cycle: state.cycle,
    priorState: state.state,
    priorStateUpdatedAt: state.updatedAt,
    candidateFingerprint: state.candidateFingerprint,
    evidenceBundleFingerprint: state.evidenceBundleFingerprint,
    decision,
    reason,
    ...(state.state === "evaluator-running" ? { evaluatorInvocation: evaluatorInvocationDecisionBasis(state) } : {}),
  };
}

function decisionArtifactPath(changeDir, state, decisionId) {
  return path.join(cycleDir(changeDir, state), `human-decision-${decisionId}.json`);
}

function matchingCommittedDecision(state, decision, reason) {
  const record = state.decisions[state.decisions.length - 1];
  if (!record || !record.decisionId || record.decision !== decision || record.reason !== reason || !record.result) return null;
  if (record.result.state !== state.state || record.result.nextAction !== state.nextAction) return null;
  if (record.result.candidateFingerprint !== state.candidateFingerprint || record.result.evidenceBundleFingerprint !== state.evidenceBundleFingerprint) return null;
  if (record.result.decisionCount !== state.decisions.length || record.result.escalationCount !== state.escalations.length) return null;
  return record;
}

function prepareDecisionRecord(changeDir, state, decision, reason) {
  const basis = decisionBasis(state, decision, reason);
  const basisHash = hashValue(basis);
  const decisionId = basisHash.slice("sha256:".length, "sha256:".length + 24);
  const file = decisionArtifactPath(changeDir, state, decisionId);
  if (fs.existsSync(file)) {
    const existing = readJson(file);
    if (existing.decisionId !== decisionId || existing.basisHash !== basisHash || hashValue(existing.basis) !== hashValue(basis)) throw new Error("existing human decision artifact conflicts with the current bound decision");
    return { record: existing, file };
  }
  return {
    file,
    record: {
      schemaVersion: 1,
      decisionId,
      basisHash,
      basis,
      at: new Date().toISOString(),
      decision,
      reason,
      candidateFingerprint: state.candidateFingerprint,
      evidenceBundleFingerprint: state.evidenceBundleFingerprint,
      priorState: state.state,
      source: "explicit-cli-operator",
    },
  };
}

async function actionDecide(context, decision, reason, hooks = {}) {
  const { repo, changeDir, loaded } = context;
  const state = readState(changeDir);
  const committedRetry = state && matchingCommittedDecision(state, decision, reason);
  if (committedRetry) {
    const artifact = decisionArtifactPath(changeDir, state, committedRetry.decisionId);
    if (fs.existsSync(artifact) && hashValue(readJson(artifact)) !== hashValue(committedRetry)) throw new Error("committed human decision artifact conflicts with closure state");
    if (!fs.existsSync(artifact)) writeJsonAtomic(artifact, committedRetry);
    return resultFromState(state, { status: "decision-already-recorded", decision, decisionId: committedRetry.decisionId, artifact: repoRelative(repo, artifact) });
  }
  if (!state || !["needs-user", "blocked-by-environment", "non-convergent", "evaluator-running"].includes(state.state)) throw new Error(`decide requires a human-decision or interrupted-evaluator state; current ${state ? state.state : "missing"}`);
  if (!new Set(["resume", "approve", "reject", "reopen", "abandon"]).has(decision)) throw new Error("--decide must be resume, approve, reject, reopen, or abandon");
  if (state.state === "evaluator-running" && !new Set(["reopen", "abandon"]).has(decision)) throw new Error("an interrupted evaluator-running invocation may only be explicitly reopened or abandoned; it cannot be resumed or duplicated");
  if (state.state === "evaluator-running" && (!state.evaluator || state.evaluator.status !== "running")) throw new Error("evaluator-running decision requires the exact active evaluator invocation");
  const preparedDecision = prepareDecisionRecord(changeDir, state, decision, reason);
  const record = preparedDecision.record;
  async function publishDecision(extra = {}) {
    record.result = {
      state: state.state,
      nextAction: state.nextAction,
      candidateFingerprint: state.candidateFingerprint,
      evidenceBundleFingerprint: state.evidenceBundleFingerprint,
      decisionCount: state.decisions.length,
      escalationCount: state.escalations.length,
    };
    if (fs.existsSync(preparedDecision.file) && hashValue(readJson(preparedDecision.file)) !== hashValue(record)) throw new Error("existing human decision artifact does not match the deterministic transition result");
    writeJsonAtomic(preparedDecision.file, record);
    if (hooks.afterDecisionArtifact) await hooks.afterDecisionArtifact(JSON.parse(JSON.stringify(record)));
    writeState(changeDir, state);
    if (hooks.afterStateCommit) await hooks.afterStateCommit(JSON.parse(JSON.stringify(record)));
    return resultFromState(state, { status: "decision-recorded", decision, decisionId: record.decisionId, artifact: repoRelative(repo, preparedDecision.file), ...extra });
  }
  const incompleteEscalation = activeIncompleteRepairEscalation(state);
  const inspectionPath = path.join(cycleDir(changeDir, state), "incomplete-repair-inspection.json");
  const inspection = incompleteEscalation && fs.existsSync(inspectionPath) ? readJson(inspectionPath) : null;

  if (decision === "approve") {
    if (!inspection || !state.builder || incompleteEscalation.reason !== "undeclared-builder-delta" || (inspection.errors || []).length) {
      throw new Error("approve requires a preserved undeclared Builder delta with no completion-record errors");
    }
    const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
    if (hashValue(currentManifest) !== hashValue(inspection.candidateManifest)) throw new Error("incomplete repair changed after inspection; reopen or regenerate the inspection");
    const currentChanges = manifestDiff(state.builder.beforeManifest, currentManifest);
    if (hashValue(currentChanges) !== hashValue(inspection.actual)) throw new Error("incomplete repair delta no longer matches the preserved inspection");
    record.approvedUnexpectedPaths = (inspection.unexpected || []).map((row) => row.path);
    state.decisions.push(record);
    commitBuilderCompletion(state, inspection.completionRecord, currentManifest, currentChanges);
    writeJson(path.join(cycleDir(changeDir, state), "builder-completion.json"), { ...inspection.completionRecord, approvedByDecision: record, actualChanges: currentChanges, candidateFingerprint: state.candidateFingerprint });
    writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), currentManifest);
    return publishDecision({ approvedUnexpectedPaths: record.approvedUnexpectedPaths });
  }

  if (decision === "reject") {
    if (!inspection || !state.builder) throw new Error("reject requires a preserved incomplete Builder repair");
    state.decisions.push(record);
    const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
    if (hashValue(currentManifest) !== hashValue(state.builder.beforeManifest)) {
      state.state = "needs-user";
      state.nextAction = "revert-unapproved-builder-delta";
      state.escalations.push({ at: record.at, reason: "rejected-builder-delta-awaiting-revert", resumeState: "builder-required", inspection: repoRelative(repo, inspectionPath) });
    } else {
      state.builder = null;
      state.state = "builder-required";
      state.nextAction = "record-builder-before";
      state.inProgressStep = null;
    }
    return publishDecision();
  }

  state.decisions.push(record);
  if (decision === "abandon") {
    if (state.state === "evaluator-running") {
      state.evaluator = { ...state.evaluator, status: "abandoned", endedAt: record.at, decisionId: record.decisionId };
    }
    state.state = "abandoned";
    state.nextAction = "none";
    state.inProgressStep = null;
  }
  else if (decision === "reopen") {
    if (inspection && state.builder) {
      const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
      if (hashValue(currentManifest) !== hashValue(inspection.candidateManifest)) throw new Error("incomplete repair changed after inspection; regenerate the inspection before reopening");
      state.candidateManifest = currentManifest;
      state.candidateFingerprint = hashValue(currentManifest);
      state.counters.fingerprintHistory.push(state.candidateFingerprint);
    }
    invalidateForFreshCritic(state);
    state.state = "critic-required";
    state.nextAction = "run-critic";
    writeJson(path.join(cycleDir(changeDir, state), "candidate.json"), state.candidateManifest);
  }
  else {
    const latestEscalation = state.escalations[state.escalations.length - 1];
    const prior = latestEscalation && latestEscalation.resumeState ? latestEscalation : null;
    if (!prior) throw new Error("resume requires the current escalation to declare an exact resumeState; use reopen or abandon for uncertain work");
    if (state.state === "blocked-by-environment" && !["proof-environment-failure", "evaluator-invocation-failed"].includes(prior.reason)) {
      throw new Error("blocked environment resume requires the latest exact proof or Evaluator environment escalation; use reopen for legacy/uncertain state");
    }
    if (prior && prior.reason === "rejected-builder-delta-awaiting-revert" && state.builder) {
      const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
      if (hashValue(currentManifest) !== hashValue(state.builder.beforeManifest)) throw new Error("rejected Builder delta is still present; revert it before resume");
      state.builder = null;
    }
    if (prior.reason === "proof-environment-failure") {
      const currentManifest = buildCandidateManifest(repo, changeDir, loaded.config, loaded.profile);
      if (hashValue(currentManifest) !== hashValue(state.candidateManifest) || prior.candidateFingerprint !== state.candidateFingerprint) {
        throw new Error("candidate changed after proof environment failure; use reopen for a fresh Critic");
      }
      const currentPolicy = loaded.config.proofPolicies[prior.policyId];
      if (!currentPolicy || hashValue(currentPolicy) !== prior.policySha256) throw new Error("proof policy changed after environment failure; use reopen for a fresh Critic");
      clearProofAttempt(state, prior.policyId);
      record.environmentRetry = { policyId: prior.policyId, policySha256: prior.policySha256, priorFailureAt: prior.at, executionStarted: prior.executionStarted !== false };
    }
    state.state = prior ? prior.resumeState : "critic-required";
    if (state.state === "evaluator-required") state.evaluator = null;
    state.nextAction = state.state === "builder-required" ? "record-builder-before" : state.state === "builder-in-progress" ? "builder-repair-then-complete" : state.state === "proofs-required" ? "run-proofs" : state.state === "evaluator-required" ? "run-evaluator" : "run-critic";
    state.inProgressStep = null;
  }
  return publishDecision();
}

async function actionRecoverPrevious(context, reason) {
  const { changeDir } = context;
  const files = closurePaths(changeDir);
  const primary = inspectStateFile(files.state);
  const previous = inspectStateFile(files.previous);
  if (primary.valid) {
    return { schemaVersion: 1, status: "recovery-not-required", exitCode: 2, action: "status", errors: ["primary closure state is valid; recovery would discard a known transition"], warnings: [] };
  }
  if (!previous.valid) {
    return {
      schemaVersion: 1,
      status: "recovery-unavailable",
      exitCode: 2,
      action: "manual-forensics-or-reset-checkout",
      primary: { status: primary.status, errors: primary.errors },
      previous: { status: previous.status, errors: previous.errors },
      errors: ["validated previous closure state is unavailable; no state was modified"],
      warnings: [],
    };
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const archive = path.join(files.archive, `recovery-${stamp}`);
  fs.mkdirSync(archive, { recursive: true });
  if (fs.existsSync(files.state)) fs.copyFileSync(files.state, path.join(archive, "state.corrupt.raw"));
  fs.copyFileSync(files.previous, path.join(archive, "state.previous.raw"));
  const recovered = JSON.parse(JSON.stringify(previous.value));
  const decision = {
    at: new Date().toISOString(),
    decision: "recover-previous",
    reason,
    source: "explicit-cli-operator",
    priorPrimaryStatus: primary.status,
    recoveredPreviousUpdatedAt: recovered.updatedAt,
    possibleLostTransition: true,
  };
  recovered.state = "needs-user";
  recovered.nextAction = "inspect-recovered-state-and-lost-transition";
  recovered.inProgressStep = null;
  recovered.decisions.push(decision);
  recovered.escalations.push({ at: decision.at, reason: "recovered-validated-previous-state", possibleLostTransition: true, archive: repoRelative(context.repo, archive) });
  recovered.updatedAt = decision.at;
  const errors = validateState(recovered);
  if (errors.length) throw new Error(`validated previous state became invalid during recovery: ${errors.join("; ")}`);
  writeJson(path.join(archive, "recovery-decision.json"), decision);
  const temporary = path.join(files.closureDir, `.state-recovery-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
  writeJson(temporary, recovered);
  fs.renameSync(temporary, files.state);
  return resultFromState(recovered, {
    status: "recovered-needs-user",
    exitCode: 2,
    archive: repoRelative(context.repo, archive),
    possibleLostTransition: true,
    errors: ["restored validated previous state; operator must inspect the possible lost transition before resume/reopen"],
  });
}

function resetSourceManifest(files) {
  const rows = [];
  for (const [name, source] of [["state.json", files.state], ["state.prev.json", files.previous]]) {
    if (fs.existsSync(source) && fs.statSync(source).isFile()) rows.push({ path: name, sha256: hashFile(source), bytes: fs.statSync(source).size });
  }
  if (fs.existsSync(files.cycles)) {
    for (const file of walkFiles(files.cycles)) {
      const rel = `cycles/${path.relative(files.cycles, file).replace(/\\/g, "/")}`;
      rows.push({ path: rel, sha256: hashFile(file), bytes: fs.statSync(file).size });
    }
  }
  return { schemaVersion: 1, files: rows.sort((a, b) => a.path.localeCompare(b.path)) };
}

function copyResetSources(files, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const [name, source] of [["state.json", files.state], ["state.prev.json", files.previous]]) {
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
  }
  if (fs.existsSync(files.cycles)) {
    for (const file of walkFiles(files.cycles)) {
      const destination = path.join(target, "cycles", path.relative(files.cycles, file));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
    }
  }
}

function resetArchiveErrors(target, manifest) {
  const errors = [];
  for (const row of manifest.files || []) {
    const file = path.resolve(target, row.path);
    if (!pathInsideOrSame(target, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      errors.push(`reset archive is missing ${row.path}`);
      continue;
    }
    if (fs.statSync(file).size !== row.bytes || hashFile(file) !== row.sha256) errors.push(`reset archive bytes differ for ${row.path}`);
  }
  return errors;
}

function pendingResetResult(changeDir) {
  const files = closurePaths(changeDir);
  if (!fs.existsSync(files.resetJournal)) return null;
  let journal;
  try { journal = readJson(files.resetJournal); } catch (error) {
    return { schemaVersion: 1, status: "needs-user", exitCode: 2, state: "needs-user", action: "manual-reset-forensics", errors: [`reset journal is unreadable: ${error.message}`], warnings: [] };
  }
  return {
    schemaVersion: 1,
    status: "needs-user",
    exitCode: 2,
    state: "needs-user",
    action: "resume-reset",
    resetId: journal.resetId || null,
    phase: journal.status || "unknown",
    archive: journal.archiveName ? path.join(files.archive, journal.archiveName) : null,
    errors: ["a terminal reset was interrupted; rerun --reset with an explicit reason before starting a new lineage"],
    warnings: [],
  };
}

async function actionReset(context, reason, hooks = {}) {
  const { repo, changeDir } = context;
  const files = closurePaths(changeDir);
  let journal = null;
  if (fs.existsSync(files.resetJournal)) {
    try { journal = readJson(files.resetJournal); } catch (error) { throw new Error(`cannot resume unreadable reset journal: ${error.message}`); }
    if (journal.schemaVersion !== 1 || !journal.archiveName || !journal.stagingName || !journal.sourceManifest) throw new Error("cannot resume invalid reset journal");
    journal.resumeReasons = [...(journal.resumeReasons || []), { at: new Date().toISOString(), reason }];
    writeJsonAtomic(files.resetJournal, journal);
  } else {
    const state = readState(changeDir);
    if (!state || !TERMINAL_STATES.has(state.state)) throw new Error(`reset requires terminal state; current ${state ? state.state : "missing"}`);
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const resetId = `${stamp}-${crypto.randomBytes(4).toString("hex")}`;
    journal = {
      schemaVersion: 1,
      resetId,
      status: "copying",
      createdAt: new Date().toISOString(),
      reason,
      source: "explicit-cli-operator",
      priorState: state.state,
      candidateFingerprint: state.candidateFingerprint,
      archiveName: resetId,
      stagingName: `.reset-${resetId}.tmp`,
      sourceManifest: resetSourceManifest(files),
      resumeReasons: [],
    };
    writeJsonAtomic(files.resetJournal, journal);
    if (hooks.afterJournal) await hooks.afterJournal(JSON.parse(JSON.stringify(journal)));
  }

  fs.mkdirSync(files.archive, { recursive: true });
  const target = path.join(files.archive, journal.archiveName);
  const staging = path.join(files.archive, journal.stagingName);
  if (!pathInsideOrSame(files.archive, target) || !pathInsideOrSame(files.archive, staging)) throw new Error("reset journal archive path is unsafe");

  if (!fs.existsSync(target)) {
    const liveManifest = resetSourceManifest(files);
    if (hashValue(liveManifest) !== hashValue(journal.sourceManifest)) {
      return { schemaVersion: 1, status: "needs-user", exitCode: 2, state: "needs-user", action: "manual-reset-forensics", errors: ["live reset sources changed after the reset journal was committed"], warnings: [] };
    }
    if (fs.existsSync(staging)) {
      const interrupted = path.join(files.archive, `interrupted-${journal.resetId}-${Date.now()}`);
      fs.renameSync(staging, interrupted);
    }
    copyResetSources(files, staging);
    writeJson(path.join(staging, "reset-manifest.json"), journal.sourceManifest);
    writeJson(path.join(staging, "reset-decision.json"), {
      at: journal.createdAt,
      reason: journal.reason,
      priorState: journal.priorState,
      candidateFingerprint: journal.candidateFingerprint,
      source: journal.source,
    });
    const stagingErrors = resetArchiveErrors(staging, journal.sourceManifest);
    if (stagingErrors.length) throw new Error(`reset staging verification failed: ${stagingErrors.join("; ")}`);
    fs.renameSync(staging, target);
    if (hooks.afterArchiveCommit) await hooks.afterArchiveCommit(JSON.parse(JSON.stringify(journal)));
  }

  const archiveErrors = resetArchiveErrors(target, journal.sourceManifest);
  if (archiveErrors.length) return { schemaVersion: 1, status: "needs-user", exitCode: 2, state: "needs-user", action: "manual-reset-forensics", errors: archiveErrors, warnings: [] };
  journal.status = "committed";
  journal.committedAt = journal.committedAt || new Date().toISOString();
  writeJsonAtomic(files.resetJournal, journal);
  writeJson(path.join(target, "reset-journal-final.json"), journal);

  for (const source of [files.state, files.previous, files.cycles]) {
    if (fs.existsSync(source)) fs.rmSync(source, { recursive: true, force: true });
  }
  if (hooks.afterStateCleanup) await hooks.afterStateCleanup(JSON.parse(JSON.stringify(journal)));
  fs.rmSync(files.resetJournal, { force: true });
  return { schemaVersion: 1, status: "reset", exitCode: 0, action: "prepare", archive: repoRelative(repo, target), recoverability: "prior evidence atomically committed before live cleanup", errors: [], warnings: [] };
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = repoRoot(args.repo);
  const changeDir = resolveChange(repo, args.change);
  const packageRoot = path.resolve(__dirname, "..");
  const loaded = loadConfig(repo, changeDir, packageRoot, { requireCalibration: args.action === "prepare" });
  const context = { args, repo, changeDir, packageRoot, loaded };
  const pendingReset = pendingResetResult(changeDir);
  if (pendingReset && args.action !== "reset") {
    emit(pendingReset, args);
    return;
  }
  let result;
  if (args.action === "validate-config") result = await actionValidateConfig(context);
  else if (args.action === "prepare") result = await actionPrepare(context);
  else if (args.action === "status") result = await actionStatus(context);
  else if (args.action === "dry-run-env") result = await actionDryRunEnv(context);
  else if (args.action === "calibrate") result = await actionCalibrate(context, args.value);
  else if (args.action === "import-critic") result = await actionImportCritic(context, args.value);
  else if (args.action === "builder-before") result = await actionBuilderBefore(context, args.value);
  else if (args.action === "builder-complete") result = await actionBuilderComplete(context, args.value);
  else if (args.action === "run-proofs") result = await actionRunProofs(context);
  else if (args.action === "evaluator-start") result = await actionEvaluatorStart(context, args.value);
  else if (args.action === "import-evaluator") result = await actionImportEvaluator(context, args.value);
  else if (args.action === "check") result = await actionCheck(context);
  else if (args.action === "decide") result = await actionDecide(context, args.value, args.reason);
  else if (args.action === "recover-previous") result = await actionRecoverPrevious(context, args.reason);
  else if (args.action === "reset") result = await actionReset(context, args.reason);
  else throw new Error(`unsupported closure action ${args.action}`);
  emit(result, args);
}

if (require.main === module) {
  main().catch((error) => {
    const result = { schemaVersion: 1, status: error.code === "STATE_CORRUPT" || error.code === "STATE_INVALID" ? "needs-user" : "failed", exitCode: 2, action: error.code === "STATE_CORRUPT" || error.code === "STATE_INVALID" ? "recover-previous-or-manual-forensics" : "inspect-error", errors: [error.message], warnings: [] };
    const json = process.argv.includes("--json");
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.error(`[closure] ERROR: ${error.message}`);
    process.exitCode = result.exitCode;
  });
}

module.exports = {
  DIMENSION_IDS,
  ROLE_CONTRACTS,
  SCHEMA_SHA256,
  STATE_KEYS,
  actionDecide,
  actionReset,
  actionRunProofs,
  buildCandidateManifest,
  calibrationErrors,
  canonicalJson,
  globRegex,
  hashValue,
  invalidateCandidateBoundSteps,
  isAutoProtectedChange,
  inspectStateFile,
  manifestDiff,
  evaluateLoopSafety,
  evaluateConfiguredLoopLimit,
  evaluateWallClockLimit,
  ensureProofFailureFinding,
  evidenceIntegrityMismatches,
  normalizedFindingSignature,
  policyPathOverlap,
  policyDependencyClosure,
  policyDependsOn,
  proofOrder,
  parseCriticFindings,
  pathInsideOrSame,
  repoRelative,
  structuredFieldDiff,
  validateConfigProfile,
  validateEvaluation,
  validateBuilderBefore,
  validateProfileShape,
  validateState,
  validateSchemaPackage,
};
