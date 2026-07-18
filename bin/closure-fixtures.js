#!/usr/bin/env node
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  DIMENSION_IDS,
  ROLE_CONTRACTS,
  actionDecide,
  actionReset,
  actionRunProofs,
  evaluateConfiguredLoopLimit,
  evaluateLoopSafety,
  evaluateWallClockLimit,
  ensureProofFailureFinding,
  inspectStateFile,
  normalizedFindingSignature,
  STATE_KEYS,
  globRegex,
  hashValue,
  invalidateCandidateBoundSteps,
  isAutoProtectedChange,
  manifestDiff,
  policyDependencyClosure,
  policyDependsOn,
  policyPathOverlap,
  proofOrder,
  parseCriticFindings,
  validateConfigProfile,
  validateBuilderBefore,
  validateEvaluation,
  validateSchemaPackage,
  validateState,
} = require("./closure");
const { buildReviewerEnv, parseEvaluatorOutput, renderPrompt, shouldRetryEvaluator } = require("./cross-review");
const { buildScrubbedEnv } = require("../en/runtime/closure-env");
const { terminateProcessTree } = require("../en/runtime/process-cleanup");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args, cwd, timeoutMs = 120000) {
  return spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, timeout: timeoutMs });
}

function runClosure(packageRoot, repo, args, expectedStatus = 0) {
  const result = run(process.execPath, [path.join(packageRoot, "bin", "closure.js"), "--repo", repo, "--change", "001-contract", ...args, "--json"], repo);
  let value;
  try { value = JSON.parse(result.stdout); } catch (error) { fail(`closure fixture returned invalid JSON (${args.join(" ")}): ${result.stdout}\n${result.stderr}`); }
  if (result.status !== expectedStatus) fail(`closure fixture status ${result.status}, expected ${expectedStatus} (${args.join(" ")}): ${JSON.stringify(value)}`);
  return value;
}

function runClosureObserved(packageRoot, repo, args, expectedStatus = 0) {
  const result = run(process.execPath, [path.join(packageRoot, "bin", "closure.js"), "--repo", repo, "--change", "001-contract", ...args, "--json"], repo, 30000);
  let value;
  try { value = JSON.parse(result.stdout); } catch (error) { throw new Error(`real closure smoke returned invalid JSON (${args.join(" ")}): ${result.stdout}\n${result.stderr}`); }
  if (result.status !== expectedStatus) throw new Error(`real closure smoke status ${result.status}, expected ${expectedStatus} (${args.join(" ")}): ${JSON.stringify(value)}`);
  return value;
}

function runClosureDetached(packageRoot, repo, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [path.join(packageRoot, "bin", "closure.js"), "--repo", repo, "--change", "001-contract", ...args, "--json"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    detached: process.platform === "win32",
    timeout: 120000,
  });
  let value;
  try { value = JSON.parse(result.stdout); } catch (error) { fail(`detached closure fixture returned invalid JSON (${args.join(" ")}): ${result.stdout}\n${result.stderr}`); }
  if (result.status !== expectedStatus) fail(`detached closure fixture status ${result.status}, expected ${expectedStatus} (${args.join(" ")}): ${JSON.stringify(value)}`);
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function waitForChildExit(child, label, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} pid ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    }
    function onExit() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopTrackedChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  terminateProcessTree(child, "SIGKILL", { label });
  await waitForChildExit(child, label);
}

function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function assertSafeRealTempRoot(root) {
  const resolved = path.resolve(root);
  const temp = path.resolve(os.tmpdir());
  const relative = path.relative(temp, resolved);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "real interruption root must stay inside the OS temp directory");
  assert(path.basename(resolved).startsWith("steadyspec-v06-windows-real-"), "real interruption root must use the dedicated safety prefix");
  return resolved;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function realChildMain(args) {
  const [kind, target, nonce] = args;
  if (!nonce || !/^[a-f0-9]{16}$/.test(nonce)) throw new Error("real interruption child requires a bounded nonce");
  if (kind === "proof") {
    const root = path.resolve(target);
    fs.appendFileSync(path.join(root, "proof-attempts.log"), `${nonce}\n`, "utf8");
    writeJson(path.join(root, "proof-child-started.json"), { pid: process.pid, nonce, startedAt: new Date().toISOString() });
  } else if (kind === "evaluator") {
    const runDir = path.resolve(target);
    fs.mkdirSync(runDir, { recursive: true });
    writeJson(path.join(runDir, "transport-started.json"), { pid: process.pid, nonce, startedAt: new Date().toISOString() });
  } else {
    throw new Error(`unknown real interruption child kind ${kind}`);
  }
  setInterval(() => {}, 1000);
}

function policy(executable, args, kind, extra = {}) {
  return {
    executable,
    args,
    cwd: ".",
    timeoutMs: 30000,
    maxOutputBytes: 100000,
    envKeys: [],
    idempotent: true,
    dependsOn: [],
    outputs: [],
    mutableStateSurfaces: [],
    expectedExitCodes: kind === "negative-control" ? [1] : [0],
    evidenceContract: {
      kind,
      claim: kind === "negative-control" ? "Controlled negative fixture fails." : "Controlled positive fixture passes.",
      coverageLimit: "Fixture process only.",
      ...(extra.negativeControlPolicy ? { negativeControlPolicy: extra.negativeControlPolicy } : {}),
    },
  };
}

function profile() {
  return {
    schemaVersion: 1,
    id: "fixture-software",
    candidatePaths: ["src/**", "docs/changes/001-contract/**"],
    dimensions: DIMENSION_IDS.map((id) => ({
      id,
      required: true,
      proofPolicyIds: ["fixture-pass"],
      requiredSourceClasses: [],
      coverageLimit: "Fixture only.",
    })),
  };
}

function evaluatorValue(candidateFingerprint, evidenceBundleFingerprint, targetBaselineFingerprintValue = null) {
  return {
    schemaVersion: 1,
    role: "evaluator",
    candidateFingerprint,
    evidenceBundleFingerprint,
    ...(targetBaselineFingerprintValue ? { targetBaselineFingerprint: targetBaselineFingerprintValue } : {}),
    dimensions: DIMENSION_IDS.map((id) => ({ id, status: "pass", evidence: ["fixture"], sourceClasses: [], coverageLimit: "Fixture only.", naReason: null })),
    wholeIntent: { status: "pass", evidence: ["fixture"], coverageLimit: "Fixture only." },
    findingClosure: [{ findingId: "F1", status: "fixed", evidence: ["fixture"], residual: null }],
    newFindings: [],
    contextCoverage: ["fixture"],
    unobservedReality: ["non-fixture behavior"],
    independence: { class: "fixture", criticFamily: "fixture", evaluatorFamily: "fixture", limits: ["synthetic"] },
    residualUnknowns: [],
    verdict: "candidate-ready",
    verdictReason: "Synthetic contract fixture passes.",
  };
}

function safeRiskAssessment() {
  return {
    requirements: "unchanged",
    proofStrategy: "unchanged",
    userVisibleOutcome: "unchanged",
    securityOrMigration: "unchanged",
    residualP12Accepted: false,
    semanticReviewRequired: true,
  };
}

function environmentHelperContracts() {
  const sourceEnv = {
    Path: "C:\\fixture-bin",
    TEMP: "C:\\fixture-temp",
    TMP: "C:\\fixture-tmp",
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.CMD",
    LANG: "zh_CN.UTF-8",
    FIXTURE_TOKEN: "fixture-secret-value",
    UNDECLARED_SECRET: "must-not-cross-scrubbed-boundary",
  };
  const proof = buildScrubbedEnv({
    sourceEnv,
    explicitKeys: ["fixture_token"],
    requireExplicit: true,
  });
  const reviewer = buildReviewerEnv({
    inheritEnv: false,
    passEnv: ["fixture_token", "MISSING_REVIEWER_KEY"],
    sourceEnv,
  });

  for (const key of ["Path", "TEMP", "TMP", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "FIXTURE_TOKEN"]) {
    assert(Object.prototype.hasOwnProperty.call(proof.env, key), `proof scrubber must retain declared key ${key}`);
    assert(Object.prototype.hasOwnProperty.call(reviewer.env, key), `reviewer scrubber must retain declared key ${key}`);
  }
  assert(!Object.prototype.hasOwnProperty.call(proof.env, "PATH") && !Object.prototype.hasOwnProperty.call(reviewer.env, "PATH"), "shared helper must preserve the actual Windows key spelling without a PATH/Path duplicate");
  assert(!Object.prototype.hasOwnProperty.call(proof.env, "UNDECLARED_SECRET") && !Object.prototype.hasOwnProperty.call(reviewer.env, "UNDECLARED_SECRET"), "scrubbed proof and reviewer paths must exclude undeclared values");
  assert(reviewer.env.LANG === sourceEnv.LANG, "reviewer extras must be an explicit extension of the shared proof baseline");
  assert(reviewer.env.STEADYSPEC_CROSS_REVIEW_CHILD === "1", "scrubbed reviewer environment must carry the child marker");
  assert(JSON.stringify(proof.inspection).includes("FIXTURE_TOKEN") && !JSON.stringify(proof.inspection).includes(sourceEnv.FIXTURE_TOKEN), "proof inspection must contain key names and sources but never values");
  assert(!JSON.stringify(reviewer.keys).includes(sourceEnv.FIXTURE_TOKEN), "reviewer inspection must remain key-name-only");
  assert(JSON.stringify(reviewer.missingExplicitKeys) === JSON.stringify(["MISSING_REVIEWER_KEY"]), "reviewer must expose missing named pass-env keys without values");

  let missingProofError = null;
  try {
    buildScrubbedEnv({ sourceEnv, explicitKeys: ["MISSING_PROOF_KEY"], requireExplicit: true });
  } catch (error) {
    missingProofError = error;
  }
  assert(missingProofError && missingProofError.code === "MISSING_ENV_KEYS" && missingProofError.missingKeys[0] === "MISSING_PROOF_KEY", "proof execution must fail closed on a missing named environment key");

  const inheritedReviewer = buildReviewerEnv({ inheritEnv: true, passEnv: [], sourceEnv });
  assert(inheritedReviewer.env.UNDECLARED_SECRET === sourceEnv.UNDECLARED_SECRET && inheritedReviewer.env.STEADYSPEC_CROSS_REVIEW_CHILD === "1", "dangerous inherit must remain an explicit full-environment exception with its child marker");
  assert(inheritedReviewer.missingExplicitKeys.length === 0, "dangerous inherit must not invent scrubbed-key diagnostics");
}

function unitContracts(packageRoot) {
  environmentHelperContracts();
  const fixtureSource = fs.readFileSync(__filename, "utf8");
  assert(!/function\s+killKnownWindowsPid\s*\(/.test(fixtureSource) && !/for\s*\([^)]*knownPids[^)]*\)\s*killKnownWindowsPid/.test(fixtureSource), "real-smoke cleanup must never re-signal a retained bare PID");
  assert(fixtureSource.includes("marker.pid === transport.pid") && fixtureSource.includes("diagnostic root retained at"), "real-smoke cleanup must bind owned transport identity and retain diagnostics when exit is unconfirmed");
  assert(validateSchemaPackage(packageRoot).length === 0, "packaged schemas must match their canonical integrity digests");
  const schemaFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-schema-integrity-"));
  try {
    fs.mkdirSync(path.join(schemaFixtureRoot, "schemas"), { recursive: true });
    for (const name of ["closure-state-v1.schema.json", "acceptance-profile-v1.schema.json", "closure-config-v1.schema.json"]) {
      fs.copyFileSync(path.join(packageRoot, "schemas", name), path.join(schemaFixtureRoot, "schemas", name));
    }
    const stateSchemaFile = path.join(schemaFixtureRoot, "schemas", "closure-state-v1.schema.json");
    const mutated = JSON.parse(fs.readFileSync(stateSchemaFile, "utf8"));
    mutated.required = ["schemaVersion"];
    writeJson(stateSchemaFile, mutated);
    assert(validateSchemaPackage(schemaFixtureRoot).some((error) => error.includes("package-integrity mismatch")), "valid-JSON schema substitution must fail package integrity");
    fs.rmSync(path.join(schemaFixtureRoot, "schemas", "closure-config-v1.schema.json"));
    assert(validateSchemaPackage(schemaFixtureRoot).some((error) => error.includes("config schema missing")), "missing packaged schema must fail closed");
  } finally {
    fs.rmSync(schemaFixtureRoot, { recursive: true, force: true });
  }
  const stateSchema = JSON.parse(fs.readFileSync(path.join(packageRoot, "schemas", "closure-state-v1.schema.json"), "utf8"));
  assert(JSON.stringify([...stateSchema.required].sort()) === JSON.stringify([...STATE_KEYS].sort()), "state schema required keys must match the runtime state contract");
  assert(JSON.stringify(Object.keys(stateSchema.properties).sort()) === JSON.stringify([...STATE_KEYS].sort()), "state schema properties must match the runtime state contract");
  assert(globRegex("src/**").test("src/a/b.js"), "globRegex must match recursive candidate path");
  assert(!globRegex("src/**").test("other/a.js"), "globRegex must not escape candidate prefix");
  assert(policyPathOverlap("tmp/**", "tmp/results/**"), "policy output overlap must detect nested paths");
  assert(!policyPathOverlap("tmp/a/**", "tmp/b/**"), "policy output overlap must keep disjoint paths separate");
  const invalidState = Object.fromEntries([
    ["schemaVersion", 1], ["contractVersion", "0.6"], ["lineageId", "x"],
    ["change", {}], ["mode", "auto"], ["state", "candidate-ready"], ["cycle", 1],
    ["nextAction", "human"], ["inProgressStep", null], ["completedSteps", []],
    ["candidateFingerprint", `sha256:${"a".repeat(64)}`], ["candidateManifest", {}],
    ["evidenceBundleFingerprint", `sha256:${"b".repeat(64)}`], ["evidenceManifest", {}],
    ["findings", []], ["builder", null], ["proofs", []], ["evaluator", null],
    ["counters", {}], ["escalations", []], ["decisions", []], ["contextLimits", []],
    ["createdAt", new Date().toISOString()], ["updatedAt", new Date().toISOString()],
    ["unexpected", true],
  ]);
  assert(validateState(invalidState).some((error) => error.includes("unknown top-level")), "state validator must reject unknown top-level fields");
  const candidate = `sha256:${"a".repeat(64)}`;
  const evidence = `sha256:${"b".repeat(64)}`;
  const targetBaseline = `sha256:${"c".repeat(64)}`;
  const invalidEvaluator = parseEvaluatorOutput("PRIOR_OUTPUT_SENTINEL", {
    candidateFingerprint: candidate,
    evidenceBundleFingerprint: evidence,
    targetBaselineFingerprint: targetBaseline,
  });
  assert(shouldRetryEvaluator({ status: 0, stdout: "PRIOR_OUTPUT_SENTINEL" }, invalidEvaluator, false), "first non-empty formatting failure must allow one Evaluator retry");
  assert(!shouldRetryEvaluator({ status: 0, stdout: "PRIOR_OUTPUT_SENTINEL" }, invalidEvaluator, true), "Evaluator formatting failure must not allow a third invocation");
  assert(!shouldRetryEvaluator({ status: 1, stdout: "Not logged in" }, invalidEvaluator, false), "nonzero environment failure must not be misclassified as a formatting retry");
  const retryPrompt = renderPrompt("packet.md", "evaluate", packageRoot, packageRoot, "codex", true, {
    packetOnly: true,
    packet: "PACKET_SENTINEL",
    candidateFingerprint: candidate,
    evidenceBundleFingerprint: evidence,
    targetBaselineFingerprint: targetBaseline,
    evaluatorRetryErrorClass: invalidEvaluator.errorClass,
  });
  assert(retryPrompt.includes("attempt 2 of 2") && retryPrompt.includes(invalidEvaluator.errorClass), "Evaluator retry prompt must identify its bounded attempt and first parse-error class");
  assert(retryPrompt.includes("PACKET_SENTINEL"), "Evaluator retry prompt must carry the unchanged packet");
  assert(retryPrompt.includes(targetBaseline) && retryPrompt.includes("three required fingerprints"), "Evaluator prompt must bind all three closure identities");
  assert(!retryPrompt.includes("PRIOR_OUTPUT_SENTINEL"), "Evaluator retry prompt must not carry the first Evaluator output");
  const publicEvaluator = evaluatorValue(candidate, evidence, targetBaseline);
  let publicParsed = parseEvaluatorOutput(`\`\`\`json\n${JSON.stringify(publicEvaluator)}\n\`\`\``, { candidateFingerprint: candidate, evidenceBundleFingerprint: evidence, targetBaselineFingerprint: targetBaseline });
  assert(publicParsed.ok, "public Evaluator parser must accept the exact three-fingerprint contract");
  delete publicEvaluator.targetBaselineFingerprint;
  publicParsed = parseEvaluatorOutput(`\`\`\`json\n${JSON.stringify(publicEvaluator)}\n\`\`\``, { candidateFingerprint: candidate, evidenceBundleFingerprint: evidence, targetBaselineFingerprint: targetBaseline });
  assert(!publicParsed.ok && publicParsed.errors.some((error) => error.includes("targetBaselineFingerprint")), "public Evaluator parser must reject a missing immutable target baseline");
  const state = { candidateFingerprint: candidate, evidenceBundleFingerprint: evidence };
  const prof = profile();
  const bad = evaluatorValue(candidate, evidence);
  bad.dimensions[0].status = "n/a";
  bad.dimensions[0].naReason = "not-applicable-to-output";
  assert(validateEvaluation(bad, state, prof).some((error) => error.includes("all dimensions pass")), "required n/a must block candidate-ready");
  const noWholeIntentLimit = evaluatorValue(candidate, evidence);
  noWholeIntentLimit.wholeIntent.coverageLimit = "";
  assert(validateEvaluation(noWholeIntentLimit, state, prof).some((error) => error.includes("wholeIntent.coverageLimit")), "Evaluator whole-intent claims must declare a coverage limit");
  const weakSameFamily = evaluatorValue(candidate, evidence);
  weakSameFamily.independence.class = "run-isolated-same-family";
  assert(validateEvaluation(weakSameFamily, state, prof).some((error) => error.includes("same-family dimension")), "same-family candidate-ready must satisfy code-level evidence minima even with a weak profile");
  const negativeCycleErrors = [];
  const negativeCyclePolicy = policy("node", ["-e", "process.exit(0)"], "exit-code-only", { negativeControlPolicy: "loop" });
  validateConfigProfile(
    { mode: "auto", proofPolicies: { loop: negativeCyclePolicy } },
    { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["loop"] }] },
    negativeCycleErrors,
    [],
    { requireCalibration: false },
  );
  assert(negativeCycleErrors.some((error) => error.includes("negative control policies form a cycle")), "negative-control policy cycles must be rejected");
  const missingDependencyErrors = [];
  const missingDependency = policy("node", ["-e", "process.exit(0)"], "structured-json");
  missingDependency.dependsOn = ["missing"];
  validateConfigProfile({ mode: "manual", proofPolicies: { a: missingDependency } }, { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["a"] }] }, missingDependencyErrors, [], { requireCalibration: false });
  assert(missingDependencyErrors.some((error) => error.includes("references missing policy missing")), "ordinary proof dependency must reject a missing policy");
  const dependencyCycleErrors = [];
  const cycleA = policy("node", ["-e", "process.exit(0)"], "structured-json");
  const cycleB = policy("node", ["-e", "process.exit(0)"], "structured-json");
  cycleA.dependsOn = ["b"];
  cycleB.dependsOn = ["a"];
  validateConfigProfile({ mode: "manual", proofPolicies: { a: cycleA, b: cycleB } }, { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["a"] }] }, dependencyCycleErrors, [], { requireCalibration: false });
  assert(dependencyCycleErrors.some((error) => error.includes("proof policy dependency cycle")), "ordinary proof dependency cycle must fail closed");

  const dependencyPolicies = {
    a: policy("node", ["-e", "process.exit(0)"], "structured-json"),
    b: policy("node", ["-e", "process.exit(0)"], "structured-json"),
    c: policy("node", ["-e", "process.exit(0)"], "structured-json"),
  };
  dependencyPolicies.a.outputs = ["tmp/results/**"];
  dependencyPolicies.b.dependsOn = ["a"];
  dependencyPolicies.c.dependsOn = ["b"];
  dependencyPolicies.c.outputs = ["tmp/**"];
  const dependencyProfile = { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["c"] }] };
  const transitiveErrors = [];
  validateConfigProfile({ mode: "manual", proofPolicies: dependencyPolicies }, dependencyProfile, transitiveErrors, [], { requireCalibration: false });
  assert(transitiveErrors.length === 0, `transitively ordered output overlap must be accepted: ${transitiveErrors.join("; ")}`);
  assert(JSON.stringify(proofOrder({ proofPolicies: dependencyPolicies }, dependencyProfile)) === JSON.stringify(["a", "b", "c"]), "proof order must execute the full transitive dependency closure");
  assert(policyDependencyClosure(dependencyPolicies, new Set(["c"])).size === 3 && policyDependsOn(dependencyPolicies, "c", "a"), "dependency helpers must expose transitive closure and ordering");
  const unorderedPolicies = JSON.parse(JSON.stringify(dependencyPolicies));
  unorderedPolicies.c.dependsOn = [];
  const unorderedErrors = [];
  validateConfigProfile({ mode: "manual", proofPolicies: unorderedPolicies }, { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["a", "c"] }] }, unorderedErrors, [], { requireCalibration: false });
  assert(unorderedErrors.some((error) => error.includes("independent proof outputs overlap")), "unordered overlapping outputs must fail closed");
  const mutablePolicies = {
    a: policy("node", ["-e", "process.exit(0)"], "structured-json"),
    b: policy("node", ["-e", "process.exit(0)"], "structured-json"),
  };
  mutablePolicies.a.mutableStateSurfaces = ["process:fixture"];
  mutablePolicies.b.mutableStateSurfaces = ["process:fixture"];
  const mutableErrors = [];
  validateConfigProfile({ mode: "manual", proofPolicies: mutablePolicies }, { dimensions: [{ id: "logic-correctness", proofPolicyIds: ["a", "b"] }] }, mutableErrors, [], { requireCalibration: false });
  assert(mutableErrors.some((error) => error.includes("mutableStateSurfaces overlap")), "unordered identical mutable surfaces must fail closed");

  assert(ROLE_CONTRACTS.critic === "critic-findings-table-v1" && ROLE_CONTRACTS.evaluator === "evaluator-json-v1", "candidate identity must name both role-contract versions");
  const diagnosticProfile = profile();
  const diagnosticPolicy = policy("node", ["-e", "process.exit(0)"], "structured-json");
  const baseManifest = {
    files: [], intentFiles: [], roleContracts: ROLE_CONTRACTS,
    profile: { sha256: hashValue(diagnosticProfile), value: diagnosticProfile },
    policies: { p: { sha256: hashValue(diagnosticPolicy), policy: diagnosticPolicy } },
  };
  const profileChanged = JSON.parse(JSON.stringify(diagnosticProfile));
  profileChanged.dimensions[0].coverageLimit = "Changed coverage.";
  let diagnosticChanges = manifestDiff(baseManifest, { ...baseManifest, profile: { sha256: hashValue(profileChanged), value: profileChanged } });
  assert(diagnosticChanges.some((row) => row.inputClass === "acceptance-profile" && row.field === "dimensions[0].coverageLimit"), "profile mismatch must identify the changed field without exposing its value");
  const policyFields = [
    ["args[1]", (value) => { value.args[1] = "process.exit(1)"; }],
    ["cwd", (value) => { value.cwd = "src"; }],
    ["timeoutMs", (value) => { value.timeoutMs -= 1; }],
    ["outputs[0]", (value) => { value.outputs = ["tmp/out"]; }],
    ["dependsOn[0]", (value) => { value.dependsOn = ["dep"]; }],
    ["evidenceContract.claim", (value) => { value.evidenceContract.claim = "Changed claim."; }],
  ];
  for (const [field, mutate] of policyFields) {
    const changed = JSON.parse(JSON.stringify(diagnosticPolicy));
    mutate(changed);
    diagnosticChanges = manifestDiff(baseManifest, { ...baseManifest, policies: { p: { sha256: hashValue(changed), policy: changed } } });
    assert(diagnosticChanges.some((row) => row.inputClass === "proof-policy" && row.policyId === "p" && row.field === field), `policy mismatch must identify ${field}`);
  }
  diagnosticChanges = manifestDiff(baseManifest, { ...baseManifest, roleContracts: { ...ROLE_CONTRACTS, critic: "critic-findings-table-v2" } });
  assert(diagnosticChanges.some((row) => row.inputClass === "role-contract" && row.field === "critic"), "role-contract change must be a named candidate mismatch");
  assert(diagnosticChanges.some(isAutoProtectedChange), "role-contract changes must be protected from auto Builder completion");
  const policyStrategyChange = manifestDiff(baseManifest, { ...baseManifest, policies: { p: { sha256: hashValue({ ...diagnosticPolicy, timeoutMs: 1 }), policy: { ...diagnosticPolicy, timeoutMs: 1 } } } });
  assert(policyStrategyChange.some((row) => row.inputClass === "proof-policy" && isAutoProtectedChange(row)), "proof-strategy changes must be protected even when represented outside ordinary file paths");
  assert(hashValue({ b: 1, a: 2 }) === hashValue({ a: 2, b: 1 }), "canonical hash must be key-order stable");
  assert(normalizedFindingSignature({ claim: "CF1: Same defect!" }) === normalizedFindingSignature({ claim: "NF9 same defect" }), "finding signature must ignore finding IDs and punctuation");
  const builderLoaded = { config: { mode: "auto", limits: { maxAutoFiles: 2 }, proofPolicies: { "fixture-pass": {} } }, profile: profile() };
  const builderRecord = { candidateFingerprint: candidate, findingIds: ["CF1"], changes: [{ path: "src/app.js", changeSummary: "Repair the carried finding." }], authorityIds: ["fixture"], proofPolicyIds: ["fixture-pass"], riskClass: "safe-harbor-mechanical", riskAssessment: safeRiskAssessment() };
  const carriedState = { candidateFingerprint: candidate, findings: [{ findingId: "CF1", status: "carried-forward" }] };
  assert(validateBuilderBefore(builderRecord, carriedState, builderLoaded, packageRoot).length === 0, "Builder must admit a carried-forward finding after a fix-required Evaluator verdict");
  const missingRiskAssessment = { ...builderRecord };
  delete missingRiskAssessment.riskAssessment;
  assert(validateBuilderBefore(missingRiskAssessment, carriedState, builderLoaded, packageRoot).some((error) => error.includes("riskAssessment is required")), "auto Builder must not self-admit with only a safe-harbor label");
  const narrowingAssessment = { ...builderRecord, riskAssessment: { ...safeRiskAssessment(), requirements: "narrowed" } };
  assert(validateBuilderBefore(narrowingAssessment, carriedState, builderLoaded, packageRoot).some((error) => error.includes("riskAssessment.requirements")), "auto Builder must stop a declared requirement-narrowing signal");
  const protectedProfileRecord = { ...builderRecord, changes: [{ path: "docs/changes/001-contract/acceptance-profile.json", changeSummary: "Narrow a required dimension." }] };
  assert(validateBuilderBefore(protectedProfileRecord, carriedState, builderLoaded, packageRoot).some((error) => error.includes("requires explicit human reopen")), "auto Builder must stop protected acceptance-profile edits before repair");
  const publicLoaded = JSON.parse(JSON.stringify(builderLoaded));
  publicLoaded.profile.candidatePaths.push("README.md");
  const publicRecord = { ...builderRecord, changes: [{ path: "README.md", changeSummary: "Change a public user-facing contract." }] };
  assert(validateBuilderBefore(publicRecord, carriedState, publicLoaded, packageRoot).some((error) => error.includes("requires explicit human reopen")), "auto Builder must stop declared public-contract edits before repair");
  for (const status of ["fixed", "rejected-with-evidence"]) {
    const terminalState = { candidateFingerprint: candidate, findings: [{ findingId: "CF1", status }] };
    assert(validateBuilderBefore(builderRecord, terminalState, builderLoaded, packageRoot).some((error) => error.includes("non-open finding")), `Builder must reject ${status} findings`);
  }
  const loopState = {
    cycle: 3,
    candidateFingerprint: candidate,
    counters: { recurrence: {}, verdictHistory: [], progressHistory: [] },
    findings: [{ findingId: "CF2", severity: "P1", claim: "Repeated defect", status: "carried-forward" }],
  };
  const recurrence = evaluateLoopSafety(loopState, { verdict: "fix-required" }, { limits: { recurrenceLimit: 1 } }, [{ findingId: "CF1", severity: "P1", claim: "Repeated defect", status: "fixed" }]);
  assert(recurrence && recurrence.reason === "finding-recurrence", "fixed finding recurrence must trigger the configured limit");
  const oscillationState = { cycle: 4, candidateFingerprint: candidate, counters: { recurrence: {}, verdictHistory: [{ cycle: 2, candidateFingerprint: candidate, verdict: "fix-required" }], progressHistory: [] }, findings: [] };
  const oscillation = evaluateLoopSafety(oscillationState, { verdict: "candidate-ready" }, { limits: { recurrenceLimit: 2 } }, []);
  assert(oscillation && oscillation.reason === "candidate-verdict-oscillation", "same candidate with a different verdict must be non-convergent");
  const limitConfig = { limits: { maxCycles: 5, noProgressCycles: 3 } };
  assert(evaluateConfiguredLoopLimit({ cycle: 4, counters: { noProgressCycles: 8 } }, limitConfig, false) === null, "unknown legacy progress baseline must not invent a no-progress breach");
  assert(evaluateConfiguredLoopLimit({ cycle: 4, counters: { noProgressCycles: 3 } }, limitConfig, true).reason === "no-progress", "known progress baseline must enforce the configured no-progress limit");
  assert(evaluateConfiguredLoopLimit({ cycle: 5, counters: { noProgressCycles: 0 } }, limitConfig, false).reason === "max-cycles", "maxCycles must remain independently terminal when progress baseline is unknown");
  const reopenedStepState = {
    cycle: 5,
    completedSteps: ["critic:5", "builder:5", "proof:5:package-validate", "evaluator:5:attempt-1", "evaluator:5", "critic:5"],
    inProgressStep: "evaluator:5:obsolete",
  };
  invalidateCandidateBoundSteps(reopenedStepState);
  assert(JSON.stringify(reopenedStepState.completedSteps) === JSON.stringify(["critic:5"]), "new Builder candidate must invalidate and deduplicate same-cycle Builder/proof/Evaluator completion markers");
  assert(reopenedStepState.inProgressStep === null, "new Builder candidate must clear an obsolete same-cycle proof/Evaluator in-progress marker");
  const publicHelp = run(process.execPath, [path.join(packageRoot, "bin", "init.js"), "closure", "--help"], packageRoot);
  assert(publicHelp.status === 0 && /steadyspec closure/.test(publicHelp.stdout) && /recover-previous/.test(publicHelp.stdout), "public init-to-closure dispatch must expose closure help and recovery");
  const criticFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-critic-parser-"));
  try {
    const duplicate = path.join(criticFixtureDir, "duplicate.md");
    fs.writeFileSync(duplicate, [
      "## STDOUT", "",
      "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
      "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
      "| F1 | P2 | First | e | s | a | x |",
      "| F1 | P3 | Duplicate | e | s | a | x |",
    ].join("\n"), "utf8");
    assert(parseCriticFindings(duplicate).errors.some((error) => error.includes("duplicated")), "Critic parser must reject duplicate IDs");
    const malformed = path.join(criticFixtureDir, "malformed.md");
    fs.writeFileSync(malformed, "## STDOUT\n\nReviewer prose mentions F1 but has no table.\n", "utf8");
    assert(parseCriticFindings(malformed).errors.length >= 1, "Critic parser must reject prose-only findings");
    const blankAction = path.join(criticFixtureDir, "blank-action.md");
    fs.writeFileSync(blankAction, [
      "## STDOUT", "",
      "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
      "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
      "| F2 | P2 | Missing action | e | s | a | |",
    ].join("\n"), "utf8");
    assert(parseCriticFindings(blankAction).errors.some((error) => error.includes("empty Recommended Action")), "Critic parser must reject blank recommended actions");
    const empty = path.join(criticFixtureDir, "empty.md");
    fs.writeFileSync(empty, "## STDOUT\n\n- No findings: confirmed\n", "utf8");
    const emptyParsed = parseCriticFindings(empty);
    assert(emptyParsed.errors.length === 0 && emptyParsed.noFindingsConfirmed, "Critic parser must accept explicit no-findings confirmation");
  } finally {
    fs.rmSync(criticFixtureDir, { recursive: true, force: true });
  }
}

function publicEvaluatorTransportContracts(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-public-evaluator-transport-"));
  try {
    run("git", ["init"], tmp);
    const changeDir = path.join(tmp, "docs", "changes", "001-contract");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nPublic Evaluator transport fixture.\n", "utf8");
    const candidate = `sha256:${"a".repeat(64)}`;
    const evidence = `sha256:${"b".repeat(64)}`;
    const targetBaseline = `sha256:${"c".repeat(64)}`;
    const runner = path.join(packageRoot, "bin", "cross-review.js");
    const baseArgs = [runner, "--repo", tmp, "--change", "docs/changes/001-contract", "--mode", "evaluate", "--packet-only", "--candidate-fingerprint", candidate, "--evidence-bundle-fingerprint", evidence];
    const missingTarget = run(process.execPath, baseArgs, tmp);
    assert(missingTarget.status === 1 && /target-baseline-fingerprint/.test(missingTarget.stderr || missingTarget.stdout || ""), "public evaluate CLI must reject a missing target baseline before transport");
    const outputDir = path.join(tmp, "review-output");
    const prepared = run(process.execPath, [...baseArgs, "--target-baseline-fingerprint", targetBaseline, "--output-dir", outputDir], tmp);
    assert(prepared.status === 0, `public three-fingerprint evaluate dry run must succeed: ${prepared.stderr || prepared.stdout}`);
    const runDir = fs.readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(outputDir, entry.name))[0];
    const runRecord = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
    const prompt = fs.readFileSync(path.join(runDir, "prompt.md"), "utf8");
    assert(runRecord.candidateFingerprint === candidate && runRecord.evidenceBundleFingerprint === evidence && runRecord.targetBaselineFingerprint === targetBaseline, "public evaluate run.json must preserve all three requested identities");
    assert(prompt.includes(candidate) && prompt.includes(evidence) && prompt.includes(targetBaseline), "public evaluate prompt must carry all three requested identities without post-processing");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function integrationContract(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-closure-fixture-"));
  try {
    run("git", ["init"], tmp);
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
    const changeDir = path.join(tmp, "docs", "changes", "001-contract");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nFixture closure intent.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- fixture.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
    writeJson(path.join(changeDir, "acceptance-profile.json"), profile());
    const config = {
      schemaVersion: 1,
      mode: "auto",
      acceptanceProfile: "acceptance-profile.json",
      limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
      proofPolicies: {
        "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only", { negativeControlPolicy: "fixture-negative" }),
        "fixture-negative": policy("node", ["-e", "process.exit(1)"], "negative-control"),
      },
    };
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);

    let value = runClosure(packageRoot, tmp, ["--validate-config"]);
    assert(value.status === "valid", "fixture config must validate structurally");
    value = runClosure(packageRoot, tmp, ["--prepare"], 2);
    assert(value.errors.some((error) => error.includes("sensitivity calibration")), "prepare must fail closed before negative calibration");
    value = runClosure(packageRoot, tmp, ["--calibrate", "fixture-pass"]);
    assert(value.status === "calibrated", "negative control must calibrate sensitivity");
    config.proofPolicies["fixture-negative"].args = ["-e", "process.exit(0)"];
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);
    value = runClosure(packageRoot, tmp, ["--prepare"], 2);
    assert(value.errors.some((error) => error.includes("sensitivity calibration")), "changing the negative control must stale calibration");
    config.proofPolicies["fixture-negative"].args = ["-e", "process.exit(1)"];
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);
    value = runClosure(packageRoot, tmp, ["--prepare"]);
    assert(value.state === "critic-required" && value.candidateFingerprint, "prepare must create critic-required candidate state");
    const initialFingerprint = value.candidateFingerprint;
    const initialTargetBaseline = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8")).change.targetBaseline.fingerprint;

    const criticDir = path.join(changeDir, "cross-agent", "fixture-critic");
    fs.mkdirSync(criticDir, { recursive: true });
    fs.writeFileSync(path.join(criticDir, "raw.md"), [
      "# Raw fixture Output", "", "## STDOUT", "",
      "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
      "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
      "| F1 | P2 | Fixture defect. | src/app.js | Value is one. | Use two. | Change value to two. |", "",
    ].join("\n"), "utf8");
    const criticRun = { schemaVersion: 1, mode: "review", reviewer: "fixture", reviewerStatus: "success", outputFormat: "findings_table", candidateFingerprint: initialFingerprint, transport: "fixture-read-only", scopeFingerprint: `sha256:${"c".repeat(64)}`, paths: { raw: path.join(criticDir, "raw.md") } };
    writeJson(path.join(criticDir, "run.json"), { ...criticRun, mode: "evaluate" });
    let rejectedIdentity = runClosure(packageRoot, tmp, ["--import-critic", criticDir], 2);
    assert(rejectedIdentity.errors.some((error) => error.includes("successful structured review mode")), "Critic import must reject the wrong requested role/mode");
    writeJson(path.join(criticDir, "run.json"), { ...criticRun, candidateFingerprint: `sha256:${"d".repeat(64)}` });
    rejectedIdentity = runClosure(packageRoot, tmp, ["--import-critic", criticDir], 2);
    assert(rejectedIdentity.errors.some((error) => error.includes("candidateFingerprint")), "Critic import must reject a run over another included candidate scope");
    writeJson(path.join(criticDir, "run.json"), criticRun);
    value = runClosure(packageRoot, tmp, ["--import-critic", criticDir]);
    assert(value.state === "builder-required" && value.findingCount === 1, "critic import must create Builder work");
    const criticRef = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "cycles", "001", "critic-ref.json"), "utf8"));
    assert(criticRef.requestedRole === "critic" && criticRef.roleContract === ROLE_CONTRACTS.critic && criticRef.includedScopeFingerprint === initialFingerprint, "Critic reference must make requested role and included closure scope explicit");
    assert(criticRef.transportScopeFingerprint === criticRun.scopeFingerprint, "Critic reference must preserve the separate transport scope fingerprint without folding it into candidate identity");
    let persistedState = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    assert(persistedState.counters.cycleOpenP12 === 1, "Critic import must bind the cycle's blocking-finding baseline before Builder disposition");

    const beforeFile = path.join(tmp, "builder-before.json");
    writeJson(beforeFile, { candidateFingerprint: initialFingerprint, findingIds: ["F1"], changes: [{ path: "src/app.js", changeSummary: "Change exported fixture value from one to two." }], authorityIds: ["D-fixture"], proofPolicyIds: ["fixture-pass"], riskClass: "safe-harbor-mechanical", riskAssessment: safeRiskAssessment() });
    value = runClosure(packageRoot, tmp, ["--builder-before", beforeFile]);
    assert(value.state === "builder-in-progress" && value.completionToken, "Builder before must return a completion token");
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 2;\n", "utf8");
    const completeFile = path.join(tmp, "builder-complete.json");
    writeJson(completeFile, { completionToken: value.completionToken, findings: [{ findingId: "F1", status: "fixed", evidence: ["src/app.js"], residual: null }] });
    value = runClosure(packageRoot, tmp, ["--builder-complete", completeFile]);
    assert(value.state === "proofs-required" && value.candidateFingerprint !== initialFingerprint, "Builder completion must bind a new candidate");
    assert(JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8")).change.targetBaseline.fingerprint === initialTargetBaseline, "Builder repair must preserve the immutable lineage target baseline");
    config.proofPolicies["fixture-pass"].timeoutMs = 29999;
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);
    value = runClosure(packageRoot, tmp, ["--run-proofs"], 2);
    assert(value.state === "needs-user" && value.errors.some((error) => error.includes("changed after candidate binding")), "proof policy drift must stop execution before the proof runs");
    config.proofPolicies["fixture-pass"].timeoutMs = 30000;
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);
    fs.copyFileSync(path.join(changeDir, "closure", "state.prev.json"), path.join(changeDir, "closure", "state.json"));
    value = runClosure(packageRoot, tmp, ["--run-proofs"]);
    assert(value.state === "evaluator-required" && value.evidenceBundleFingerprint, "passing proof must create evaluator-required evidence bundle");
    persistedState = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    persistedState.counters.noProgressCycles = 7;
    delete persistedState.counters.cycleOpenP12;
    writeJson(path.join(changeDir, "closure", "state.json"), persistedState);

    const evaluatorDir = path.join(changeDir, "cross-agent", "fixture-evaluator");
    const evaluatorStartFile = path.join(tmp, "evaluator-start.json");
    const evaluatorStart = {
      schemaVersion: 1,
      candidateFingerprint: value.candidateFingerprint,
      evidenceBundleFingerprint: value.evidenceBundleFingerprint,
      invocationId: "fixture-evaluator-1",
      reviewer: "fixture",
      transport: "fixture-read-only",
      expectedRunDir: path.relative(tmp, evaluatorDir).replace(/\\/g, "/"),
    };
    const invalidStarts = [
      [{ ...evaluatorStart, candidateFingerprint: initialFingerprint }, "candidateFingerprint"],
      [{ ...evaluatorStart, evidenceBundleFingerprint: `sha256:${"e".repeat(64)}` }, "evidenceBundleFingerprint"],
      [{ ...evaluatorStart, invocationId: "bad invocation id" }, "invocationId"],
      [{ ...evaluatorStart, reviewer: "" }, "reviewer"],
      [{ ...evaluatorStart, transport: "" }, "transport"],
      [{ ...evaluatorStart, expectedRunDir: "../outside" }, "repo-relative"],
    ];
    for (const [record, field] of invalidStarts) {
      writeJson(evaluatorStartFile, record);
      const rejectedStart = runClosure(packageRoot, tmp, ["--evaluator-start", evaluatorStartFile], 2);
      assert(rejectedStart.status === "invalid-evaluator-start" && rejectedStart.errors.some((error) => error.includes(field)), `Evaluator start mismatch matrix must reject ${field}`);
    }
    writeJson(evaluatorStartFile, evaluatorStart);
    value = runClosure(packageRoot, tmp, ["--evaluator-start", evaluatorStartFile]);
    assert(value.state === "evaluator-running" && value.invocationId === "fixture-evaluator-1", "Evaluator start must atomically commit the invocation identity before transport");
    const invocationRecord = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "cycles", "001", "evaluator-invocation.json"), "utf8"));
    assert(invocationRecord.requestedRole === "evaluator" && invocationRecord.roleContract === ROLE_CONTRACTS.evaluator && /^sha256:[a-f0-9]{64}$/.test(invocationRecord.includedScopeFingerprint), "Evaluator invocation must bind requested role contract and included candidate/evidence/target scope");
    assert(/^sha256:[a-f0-9]{64}$/.test(invocationRecord.targetBaselineFingerprint), "Evaluator invocation must bind the immutable lineage target baseline");
    const duplicateStart = runClosure(packageRoot, tmp, ["--evaluator-start", evaluatorStartFile], 2);
    assert(duplicateStart.errors.some((error) => error.includes("evaluator-running")), "an interrupted Evaluator invocation must not be started twice");
    value = runClosure(packageRoot, tmp, ["--prepare"]);
    assert(value.state === "evaluator-running" && value.action === "inspect-evaluator-run", "prepare must resume an interrupted Evaluator at inspection, not duplicate invocation");
    fs.mkdirSync(evaluatorDir, { recursive: true });
    const evaluation = evaluatorValue(value.candidateFingerprint, value.evidenceBundleFingerprint, invocationRecord.targetBaselineFingerprint);
    writeJson(path.join(evaluatorDir, "evaluation.json"), evaluation);
    const evaluatorRun = { schemaVersion: 1, mode: "evaluate", reviewer: "fixture", transport: "fixture-read-only", reviewerStatus: "success", outputFormat: "evaluator_json", candidateFingerprint: value.candidateFingerprint, evidenceBundleFingerprint: value.evidenceBundleFingerprint, targetBaselineFingerprint: invocationRecord.targetBaselineFingerprint, scopeFingerprint: `sha256:${"f".repeat(64)}`, paths: { evaluation: path.join(evaluatorDir, "evaluation.json") } };
    const wrongEvaluatorDir = path.join(changeDir, "cross-agent", "wrong-evaluator-dir");
    fs.mkdirSync(wrongEvaluatorDir, { recursive: true });
    writeJson(path.join(wrongEvaluatorDir, "run.json"), evaluatorRun);
    rejectedIdentity = runClosure(packageRoot, tmp, ["--import-evaluator", wrongEvaluatorDir], 2);
    assert(rejectedIdentity.errors.some((error) => error.includes("directory does not match")), "Evaluator import must reject the wrong invocation directory");
    const evaluatorMismatches = [
      [{ ...evaluatorRun, mode: "review" }, "evaluate mode"],
      [{ ...evaluatorRun, reviewer: "other" }, "reviewer"],
      [{ ...evaluatorRun, transport: "other-transport" }, "transport"],
      [{ ...evaluatorRun, candidateFingerprint: initialFingerprint }, "fingerprints"],
      [{ ...evaluatorRun, evidenceBundleFingerprint: `sha256:${"e".repeat(64)}` }, "fingerprints"],
      [{ ...evaluatorRun, targetBaselineFingerprint: `sha256:${"a".repeat(64)}` }, "targetBaselineFingerprint"],
    ];
    for (const [runRecord, message] of evaluatorMismatches) {
      writeJson(path.join(evaluatorDir, "run.json"), runRecord);
      rejectedIdentity = runClosure(packageRoot, tmp, ["--import-evaluator", evaluatorDir], 2);
      assert(rejectedIdentity.errors.some((error) => error.includes(message)), `Evaluator import mismatch matrix must reject ${message}`);
    }
    writeJson(path.join(evaluatorDir, "run.json"), evaluatorRun);
    value = runClosure(packageRoot, tmp, ["--import-evaluator", evaluatorDir]);
    assert(value.state === "candidate-ready", "valid Evaluator result must produce bounded candidate-ready");
    persistedState = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    const latestProgress = persistedState.counters.progressHistory[persistedState.counters.progressHistory.length - 1];
    assert(persistedState.counters.noProgressCycles === 7 && persistedState.counters.cycleOpenP12 === 0, "a missing legacy Critic baseline must preserve rather than invent or erase no-progress history");
    assert(latestProgress.progressAssessment === "unknown-legacy-baseline" && latestProgress.baselineOpenP12 === null, "legacy baseline recovery must retain an explicit progress coverage diagnostic");
    value = runClosure(packageRoot, tmp, ["--check"]);
    assert(value.status === "candidate-ready", "current candidate-ready state must check pass");
    const stateFile = path.join(changeDir, "closure", "state.json");
    const previousStateFile = path.join(changeDir, "closure", "state.prev.json");
    const readyState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const readyStateText = fs.readFileSync(stateFile);
    const previousStateText = fs.readFileSync(previousStateFile);
    const tamperedEvidenceState = JSON.parse(JSON.stringify(readyState));
    tamperedEvidenceState.evidenceManifest.tampered = true;
    writeJson(stateFile, tamperedEvidenceState);
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.errors.some((error) => error.includes("evidence manifest")), "check must reject evidence manifest fingerprint drift");
    const tamperedEvaluatorState = JSON.parse(JSON.stringify(readyState));
    tamperedEvaluatorState.evaluator.candidateFingerprint = initialFingerprint;
    writeJson(stateFile, tamperedEvaluatorState);
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.errors.some((error) => error.includes("Evaluator identity")), "check must reject an Evaluator bound to another candidate");
    writeJson(stateFile, readyState);

    const proofStdout = path.resolve(tmp, readyState.proofs[0].artifact.stdout);
    const proofStdoutBytes = fs.readFileSync(proofStdout);
    fs.writeFileSync(proofStdout, Buffer.concat([proofStdoutBytes, Buffer.from("tamper", "utf8")]));
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.mismatches.some((row) => row.policyId === "fixture-pass" && row.field === "artifact.stdout" && row.kind === "hash-mismatch"), "check must re-read proof stdout bytes and identify the exact policy/artifact mismatch");
    fs.writeFileSync(proofStdout, proofStdoutBytes);

    const proofsArtifact = path.join(changeDir, "closure", "cycles", "001", "proofs.json");
    const proofsArtifactBytes = fs.readFileSync(proofsArtifact);
    writeJson(proofsArtifact, []);
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.mismatches.some((row) => row.field === "proofs.json"), "check must identify persisted proofs.json drift");
    fs.writeFileSync(proofsArtifact, proofsArtifactBytes);
    const evidenceArtifact = path.join(changeDir, "closure", "cycles", "001", "evidence-manifest.json");
    const evidenceArtifactBytes = fs.readFileSync(evidenceArtifact);
    writeJson(evidenceArtifact, {});
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.mismatches.some((row) => row.field === "evidence-manifest.json"), "check must identify persisted evidence-manifest.json drift");
    fs.writeFileSync(evidenceArtifact, evidenceArtifactBytes);

    const profileFile = path.join(changeDir, "acceptance-profile.json");
    const originalProfile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    const changedProfile = JSON.parse(JSON.stringify(originalProfile));
    changedProfile.dimensions[0].coverageLimit = "Changed fixture coverage.";
    writeJson(profileFile, changedProfile);
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.changedInputs.some((row) => row.inputClass === "acceptance-profile" && row.field === "dimensions[0].coverageLimit"), "check must report the exact acceptance-profile field that changed");
    writeJson(profileFile, originalProfile);

    const configFile = path.join(tmp, ".steadyspec", "closure.json");
    const originalConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));
    const runtimePolicyFields = [
      ["args[1]", (policyValue) => { policyValue.args[1] = "process.exit(0);"; }],
      ["cwd", (policyValue) => { policyValue.cwd = "src"; }],
      ["timeoutMs", (policyValue) => { policyValue.timeoutMs -= 1; }],
      ["outputs[0]", (policyValue) => { policyValue.outputs = ["tmp/out"]; }],
      ["dependsOn[0]", (policyValue) => { policyValue.dependsOn = ["fixture-negative"]; }],
      ["evidenceContract.claim", (policyValue) => { policyValue.evidenceContract.claim = "Changed runtime claim."; }],
    ];
    for (const [field, mutate] of runtimePolicyFields) {
      const changedConfig = JSON.parse(JSON.stringify(originalConfig));
      mutate(changedConfig.proofPolicies["fixture-pass"]);
      writeJson(configFile, changedConfig);
      value = runClosure(packageRoot, tmp, ["--check"], 3);
      assert(value.changedInputs.some((row) => row.inputClass === "proof-policy" && row.policyId === "fixture-pass" && row.field === field), `check must report changed proof-policy field ${field}`);
    }
    writeJson(configFile, originalConfig);

    fs.writeFileSync(stateFile, "{", "utf8");
    assert(inspectStateFile(previousStateFile).valid, "recovery fixture requires a validated previous state");
    value = runClosure(packageRoot, tmp, ["--recover-previous", "--reason", "fixture corrupt-primary recovery"], 2);
    assert(value.status === "recovered-needs-user" && value.possibleLostTransition, "valid previous state must recover into explicit needs-user inspection");
    fs.writeFileSync(stateFile, readyStateText);
    fs.writeFileSync(previousStateFile, previousStateText);
    fs.writeFileSync(stateFile, "{", "utf8");
    fs.writeFileSync(previousStateFile, "{", "utf8");
    value = runClosure(packageRoot, tmp, ["--recover-previous", "--reason", "fixture invalid-previous recovery"], 2);
    assert(value.status === "recovery-unavailable" && value.previous.status === "invalid-json", "invalid previous state must fail closed without recovery");
    fs.writeFileSync(stateFile, readyStateText);
    fs.writeFileSync(previousStateFile, previousStateText);
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 3;\n", "utf8");
    value = runClosure(packageRoot, tmp, ["--check"], 3);
    assert(value.status === "stale" && value.changedInputs.some((row) => row.path === "src/app.js"), "candidate mutation must stale prior verdict with path diagnostic");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function proofFailureRecoveryContracts(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-proof-failure-recovery-"));
  try {
    run("git", ["init"], tmp);
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
    const changeDir = path.join(tmp, "docs", "changes", "001-contract");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nProof failure recovery fixture.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Failed proofs remain repairable.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
    const prof = profile();
    for (const dimension of prof.dimensions) dimension.proofPolicyIds = ["fixture-fail"];
    writeJson(path.join(changeDir, "acceptance-profile.json"), prof);
    const failingPolicy = policy("node", ["-e", "process.exit(1)"], "exit-code-only");
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), {
      schemaVersion: 1,
      mode: "manual",
      acceptanceProfile: "acceptance-profile.json",
      limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
      proofPolicies: { "fixture-fail": failingPolicy },
    });
    let value = runClosure(packageRoot, tmp, ["--prepare"]);
    const initialFingerprint = value.candidateFingerprint;
    const criticDir = path.join(changeDir, "cross-agent", "no-findings-critic");
    fs.mkdirSync(criticDir, { recursive: true });
    fs.writeFileSync(path.join(criticDir, "raw.md"), "## STDOUT\n\n- No findings: confirmed\n", "utf8");
    writeJson(path.join(criticDir, "run.json"), {
      schemaVersion: 1,
      mode: "review",
      reviewer: "fixture",
      reviewerStatus: "success",
      outputFormat: "findings_table",
      candidateFingerprint: initialFingerprint,
      paths: { raw: path.join(criticDir, "raw.md") },
    });
    value = runClosure(packageRoot, tmp, ["--import-critic", criticDir]);
    assert(value.state === "proofs-required", "no-findings Critic must route directly to proofs");
    value = runClosure(packageRoot, tmp, ["--run-proofs"], 2);
    assert(value.state === "builder-required" && value.action === "record-builder-before", "ordinary proof failure must reopen the explicit Builder authorization path");
    let state = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    const proofFinding = state.findings.find((row) => /^PROOF-fixture-fail-/.test(row.findingId));
    assert(proofFinding && proofFinding.status === "open" && proofFinding.evidence.some((row) => row.includes("actualExit=1")), "failed proof must create a deterministic open finding with bounded evidence");

    state.findings = state.findings.filter((row) => row.findingId !== proofFinding.findingId);
    state.nextAction = "repair-failed-proof";
    writeJson(path.join(changeDir, "closure", "state.json"), state);
    value = runClosure(packageRoot, tmp, ["--prepare"]);
    assert(value.status === "proof-failure-migrated" && value.findingId === proofFinding.findingId, "prepare must reconcile an exact-candidate legacy failed-proof deadlock");
    value = runClosure(packageRoot, tmp, ["--prepare"]);
    state = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    assert(value.status === "resumed" && state.findings.filter((row) => row.findingId === proofFinding.findingId).length === 1, "repeated prepare must not duplicate the synthetic finding");

    state.findings = state.findings.filter((row) => row.findingId !== proofFinding.findingId);
    state.nextAction = "repair-failed-proof";
    writeJson(path.join(changeDir, "closure", "state.json"), state);
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 2;\n", "utf8");
    value = runClosure(packageRoot, tmp, ["--prepare"]);
    assert(value.status === "candidate-refreshed" && value.state === "critic-required" && value.candidateFingerprint !== initialFingerprint, "candidate drift must follow ordinary fresh-Critic routing rather than inherit synthetic Builder authority");

    const boundPolicy = { sha256: hashValue(failingPolicy), policy: failingPolicy };
    const timeoutState = { candidateFingerprint: initialFingerprint, candidateManifest: { policies: { "fixture-fail": boundPolicy } }, findings: [], proofs: [{ policyId: "fixture-fail", status: null, timedOut: true, error: null }] };
    assert(ensureProofFailureFinding(timeoutState, { proofPolicies: { "fixture-fail": failingPolicy } }).status === "not-applicable", "timeout failures must remain environment work, not synthetic Builder findings");
    const errorState = { candidateFingerprint: initialFingerprint, candidateManifest: { policies: { "fixture-fail": boundPolicy } }, findings: [], proofs: [{ policyId: "fixture-fail", status: null, timedOut: false, error: "spawn failed" }] };
    assert(ensureProofFailureFinding(errorState, { proofPolicies: { "fixture-fail": failingPolicy } }).status === "not-applicable", "process errors must remain environment work, not synthetic Builder findings");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function prepareNoFindingFixture(packageRoot, repo, name, proofPolicies, proofPolicyIds, options = {}) {
  const closureRun = options.observed ? runClosureObserved : runClosure;
  fs.mkdirSync(repo, { recursive: true });
  run("git", ["init"], repo);
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "module.exports = 1;\n", "utf8");
  const changeDir = path.join(repo, "docs", "changes", "001-contract");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), `# Intent\n\n${name} fixture.\n`, "utf8");
  fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Preserve exact interruption and recovery identity.\n", "utf8");
  fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
  const prof = profile();
  for (const dimension of prof.dimensions) dimension.proofPolicyIds = [...proofPolicyIds];
  writeJson(path.join(changeDir, "acceptance-profile.json"), prof);
  const config = {
    schemaVersion: 1,
    mode: "manual",
    acceptanceProfile: "acceptance-profile.json",
    limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
    proofPolicies,
  };
  writeJson(path.join(repo, ".steadyspec", "closure.json"), config);
  let value = closureRun(packageRoot, repo, ["--prepare"]);
  const criticDir = path.join(changeDir, "cross-agent", `${name}-critic`);
  fs.mkdirSync(criticDir, { recursive: true });
  fs.writeFileSync(path.join(criticDir, "raw.md"), "## STDOUT\n\n- No findings: confirmed\n", "utf8");
  writeJson(path.join(criticDir, "run.json"), { schemaVersion: 1, mode: "review", reviewer: "fixture", reviewerStatus: "success", outputFormat: "findings_table", candidateFingerprint: value.candidateFingerprint, paths: { raw: path.join(criticDir, "raw.md") } });
  value = closureRun(packageRoot, repo, ["--import-critic", criticDir]);
  if (options.observed) expect(value.state === "proofs-required", `${name} fixture must reach proofs-required`);
  else assert(value.state === "proofs-required", `${name} fixture must reach proofs-required`);
  return { repo, changeDir, config, profile: prof, value };
}

function prepareEvaluatorRunningFixture(packageRoot, name, repo = null, options = {}) {
  const closureRun = options.observed ? runClosureObserved : runClosure;
  const ownedRoot = !repo;
  const fixtureRepo = repo || fs.mkdtempSync(path.join(os.tmpdir(), `steadyspec-${name}-`));
  const fixture = prepareNoFindingFixture(packageRoot, fixtureRepo, name, {
    "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only"),
  }, ["fixture-pass"], options);
  let value = closureRun(packageRoot, fixtureRepo, ["--run-proofs"]);
  if (options.observed) expect(value.state === "evaluator-required", `${name} fixture must reach evaluator-required`);
  else assert(value.state === "evaluator-required", `${name} fixture must reach evaluator-required`);
  const expectedRunDir = path.join(fixture.changeDir, "cross-agent", `${name}-evaluator`);
  const startFile = path.join(fixtureRepo, `${name}-evaluator-start.json`);
  const startRecord = {
    schemaVersion: 1,
    candidateFingerprint: value.candidateFingerprint,
    evidenceBundleFingerprint: value.evidenceBundleFingerprint,
    invocationId: `${name}-invocation-1`,
    reviewer: "fixture-external-evaluator",
    transport: "fixture-external-transport",
    expectedRunDir: path.relative(fixtureRepo, expectedRunDir).replace(/\\/g, "/"),
  };
  writeJson(startFile, startRecord);
  value = closureRun(packageRoot, fixtureRepo, ["--evaluator-start", startFile]);
  if (options.observed) expect(value.state === "evaluator-running", `${name} fixture must record evaluator-running before transport`);
  else assert(value.state === "evaluator-running", `${name} fixture must record evaluator-running before transport`);
  const stateFile = path.join(fixture.changeDir, "closure", "state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  return { ...fixture, ownedRoot, value, stateFile, expectedRunDir, startFile, startRecord, invocation: JSON.parse(JSON.stringify(state.evaluator)) };
}

function assertEvaluatorDecisionBasis(record, invocation, label) {
  const bound = record && record.basis && record.basis.evaluatorInvocation;
  assert(bound, `${label} decision must bind an evaluator invocation`);
  for (const key of ["status", "requestedRole", "roleContract", "includedScopeFingerprint", "targetBaselineFingerprint", "invocationId", "reviewer", "transport", "expectedRunDir", "candidateFingerprint", "evidenceBundleFingerprint", "startedAt"]) {
    assert(bound[key] === invocation[key], `${label} decision must preserve evaluator ${key}`);
  }
}

function evaluatorTerminationContracts(packageRoot) {
  for (const decision of ["reopen", "abandon"]) {
    const fixture = prepareEvaluatorRunningFixture(packageRoot, `evaluator-${decision}`);
    try {
      const reason = `fixture explicitly ${decision}s the interrupted evaluator`;
      const result = runClosure(packageRoot, fixture.repo, ["--decide", decision, "--reason", reason], decision === "abandon" ? 2 : 0);
      const record = JSON.parse(fs.readFileSync(path.resolve(fixture.repo, result.artifact), "utf8"));
      assertEvaluatorDecisionBasis(record, fixture.invocation, decision);
      const state = JSON.parse(fs.readFileSync(fixture.stateFile, "utf8"));
      assert(state.inProgressStep === null && !state.completedSteps.some((step) => step.startsWith("evaluator:1")), `${decision} must not fabricate Evaluator completion`);
      if (decision === "reopen") {
        assert(state.state === "critic-required" && state.evaluator === null, "reopen must clear the active evaluator and require a fresh Critic");
      } else {
        assert(state.state === "abandoned" && state.evaluator.status === "abandoned", "abandon must terminate the active evaluator lifecycle in state");
        assert(state.evaluator.decisionId === record.decisionId && state.evaluator.endedAt === record.at, "abandoned evaluator must bind its ending decision and time");
        assert(state.evaluator.invocationId === fixture.invocation.invocationId, "abandon must preserve the exact terminated invocation identity");
      }
    } finally {
      if (fixture.ownedRoot) fs.rmSync(fixture.repo, { recursive: true, force: true });
    }
  }
}

function evaluatorWallClockImportContracts(packageRoot) {
  for (const simultaneous of [false, true]) {
    const fixture = prepareEvaluatorRunningFixture(packageRoot, `evaluator-wall-clock-import-${simultaneous ? "simultaneous" : "only"}`);
    try {
      const state = JSON.parse(fs.readFileSync(fixture.stateFile, "utf8"));
      state.counters.startedAt = new Date(Date.now() - fixture.config.limits.wallClockMs - 5000).toISOString();
      if (simultaneous) state.counters.verdictHistory.push({ cycle: 0, candidateFingerprint: fixture.invocation.candidateFingerprint, verdict: "fix-required", at: new Date().toISOString() });
      writeJson(fixture.stateFile, state);
      const wallClock = evaluateWallClockLimit(state, fixture.config);
      assert(wallClock && wallClock.reason === "wall-clock" && wallClock.observed > wallClock.limit, "wall-clock helper must detect an expired active lineage");

      const evaluation = evaluatorValue(fixture.invocation.candidateFingerprint, fixture.invocation.evidenceBundleFingerprint, fixture.invocation.targetBaselineFingerprint);
      fs.mkdirSync(fixture.expectedRunDir, { recursive: true });
      writeJson(path.join(fixture.expectedRunDir, "evaluation.json"), evaluation);
      writeJson(path.join(fixture.expectedRunDir, "run.json"), {
        schemaVersion: 1,
        mode: "evaluate",
        reviewer: fixture.invocation.reviewer,
        transport: fixture.invocation.transport,
        reviewerStatus: "success",
        outputFormat: "evaluator_json",
        candidateFingerprint: fixture.invocation.candidateFingerprint,
        evidenceBundleFingerprint: fixture.invocation.evidenceBundleFingerprint,
        targetBaselineFingerprint: fixture.invocation.targetBaselineFingerprint,
        paths: { evaluation: path.join(fixture.expectedRunDir, "evaluation.json") },
      });
      const value = runClosure(packageRoot, fixture.repo, ["--import-evaluator", fixture.expectedRunDir], 2);
      assert(value.status === "non-convergent" && value.state === "non-convergent", "an expired lineage must not import candidate-ready as effective readiness");
      assert(value.configuredLimit && value.configuredLimit.reason === "wall-clock", "late Evaluator import must report the exact configured wall-clock breach");
      const persisted = JSON.parse(fs.readFileSync(fixture.stateFile, "utf8"));
      assert(persisted.evaluator.verdict === "candidate-ready", "wall-clock enforcement must preserve the Evaluator's exact raw verdict");
      assert(persisted.counters.verdictHistory.at(-1).verdict === "candidate-ready", "verdict history must preserve the exact machine result rather than rewriting it");
      const escalation = persisted.escalations.at(-1);
      assert(escalation.originalVerdict === "candidate-ready" && escalation.breaches.some((row) => row.reason === "wall-clock"), "wall-clock escalation must bind the original imported verdict and configured breach");
      if (simultaneous) assert(escalation.breaches.some((row) => row.reason === "candidate-verdict-oscillation"), "simultaneous oscillation and wall-clock facts must both persist");
      const rawVerdict = JSON.parse(fs.readFileSync(path.join(fixture.changeDir, "closure", "cycles", "001", "verdict.json"), "utf8"));
      assert(rawVerdict.verdict === "candidate-ready", "the evaluated-cycle verdict artifact must remain the raw machine verdict");
    } finally {
      if (fixture.ownedRoot) fs.rmSync(fixture.repo, { recursive: true, force: true });
    }
  }
}

function evaluatorImportStalenessContracts(packageRoot) {
  for (const mutation of ["candidate", "proof-bytes"]) {
    const fixture = prepareEvaluatorRunningFixture(packageRoot, `evaluator-import-stale-${mutation}`);
    try {
      const evaluation = evaluatorValue(fixture.invocation.candidateFingerprint, fixture.invocation.evidenceBundleFingerprint, fixture.invocation.targetBaselineFingerprint);
      fs.mkdirSync(fixture.expectedRunDir, { recursive: true });
      writeJson(path.join(fixture.expectedRunDir, "evaluation.json"), evaluation);
      writeJson(path.join(fixture.expectedRunDir, "run.json"), {
        schemaVersion: 1,
        mode: "evaluate",
        reviewer: fixture.invocation.reviewer,
        transport: fixture.invocation.transport,
        reviewerStatus: "success",
        outputFormat: "evaluator_json",
        candidateFingerprint: fixture.invocation.candidateFingerprint,
        evidenceBundleFingerprint: fixture.invocation.evidenceBundleFingerprint,
        targetBaselineFingerprint: fixture.invocation.targetBaselineFingerprint,
        paths: { evaluation: path.join(fixture.expectedRunDir, "evaluation.json") },
      });
      const stateBefore = fs.readFileSync(fixture.stateFile);
      const cycleDir = path.join(fixture.changeDir, "closure", "cycles", "001");
      if (mutation === "candidate") fs.writeFileSync(path.join(fixture.repo, "src", "app.js"), "module.exports = 'stale';\n", "utf8");
      else {
        const state = JSON.parse(stateBefore.toString("utf8"));
        fs.appendFileSync(path.resolve(fixture.repo, state.proofs[0].artifact.stdout), "tampered-after-evaluator-start\n", "utf8");
      }
      const value = runClosure(packageRoot, fixture.repo, ["--import-evaluator", fixture.expectedRunDir], 3);
      assert(value.status === "stale" && value.action === (mutation === "candidate" ? "prepare" : "run-proofs"), `Evaluator import must reject ${mutation} drift before writing authority`);
      assert(fs.readFileSync(fixture.stateFile).equals(stateBefore), `stale ${mutation} import must leave state/history byte-identical`);
      assert(!fs.existsSync(path.join(cycleDir, "evaluator-ref.json")) && !fs.existsSync(path.join(cycleDir, "verdict.json")), `stale ${mutation} import must not write ref/verdict artifacts`);
    } finally {
      if (fixture.ownedRoot) fs.rmSync(fixture.repo, { recursive: true, force: true });
    }
  }
}

function fixRequiredCycleAttributionContracts(packageRoot) {
  const fixture = prepareEvaluatorRunningFixture(packageRoot, "fix-required-cycle-attribution");
  try {
    const evaluation = evaluatorValue(fixture.invocation.candidateFingerprint, fixture.invocation.evidenceBundleFingerprint, fixture.invocation.targetBaselineFingerprint);
    evaluation.dimensions[0].status = "fail";
    evaluation.wholeIntent.status = "fail";
    evaluation.findingClosure = [];
    evaluation.newFindings = [{ findingId: "F9", severity: "P2", status: "new", claim: "Fixture repair remains.", evidence: ["fixture"], breakingScenario: "Fixture remains incomplete.", recommendedAction: "Repair the fixture." }];
    evaluation.residualUnknowns = ["fixture repair remains"];
    evaluation.verdict = "fix-required";
    evaluation.verdictReason = "Fixture requires one more Builder cycle.";
    fs.mkdirSync(fixture.expectedRunDir, { recursive: true });
    writeJson(path.join(fixture.expectedRunDir, "evaluation.json"), evaluation);
    writeJson(path.join(fixture.expectedRunDir, "run.json"), {
      schemaVersion: 1,
      mode: "evaluate",
      reviewer: fixture.invocation.reviewer,
      transport: fixture.invocation.transport,
      reviewerStatus: "success",
      outputFormat: "evaluator_json",
      candidateFingerprint: fixture.invocation.candidateFingerprint,
      evidenceBundleFingerprint: fixture.invocation.evidenceBundleFingerprint,
      targetBaselineFingerprint: fixture.invocation.targetBaselineFingerprint,
      paths: { evaluation: path.join(fixture.expectedRunDir, "evaluation.json") },
    });
    let value = runClosure(packageRoot, fixture.repo, ["--import-evaluator", fixture.expectedRunDir], 2);
    assert(value.state === "builder-required" && value.cycle === 2, "fix-required import must open the next Builder cycle");
    const cycle1 = path.join(fixture.changeDir, "closure", "cycles", "001");
    const cycle2 = path.join(fixture.changeDir, "closure", "cycles", "002");
    const cycle1Ref = JSON.parse(fs.readFileSync(path.join(cycle1, "evaluator-ref.json"), "utf8"));
    const cycle1Verdict = JSON.parse(fs.readFileSync(path.join(cycle1, "verdict.json"), "utf8"));
    assert(cycle1Ref.invocationId === fixture.invocation.invocationId && cycle1Ref.evaluatedCycle === 1, "Evaluator ref must stay under the completed cycle");
    assert(cycle1Verdict.candidateFingerprint === fixture.invocation.candidateFingerprint, "Evaluator verdict must stay with the candidate it evaluated");
    assert(!fs.existsSync(path.join(cycle2, "evaluator-ref.json")) && !fs.existsSync(path.join(cycle2, "verdict.json")), "new Builder cycle must not inherit the prior Evaluator artifacts");

    fs.renameSync(path.join(cycle1, "evaluator-ref.json"), path.join(cycle2, "evaluator-ref.json"));
    fs.renameSync(path.join(cycle1, "verdict.json"), path.join(cycle2, "verdict.json"));
    const beforeFile = path.join(fixture.repo, "attribution-builder-before.json");
    writeJson(beforeFile, {
      candidateFingerprint: value.candidateFingerprint,
      findingIds: ["F9"],
      changes: [{ path: "src/app.js", changeSummary: "Repair the fixture after attribution reconciliation." }],
      authorityIds: ["R4", "R16"],
      proofPolicyIds: ["fixture-pass"],
      riskClass: "safe-harbor-mechanical",
    });
    value = runClosure(packageRoot, fixture.repo, ["--builder-before", beforeFile]);
    fs.writeFileSync(path.join(fixture.repo, "src", "app.js"), "module.exports = 2;\n", "utf8");
    const completeFile = path.join(fixture.repo, "attribution-builder-complete.json");
    writeJson(completeFile, { completionToken: value.completionToken, findings: [{ findingId: "F9", status: "fixed", evidence: ["src/app.js"], residual: null }] });

    const sourceRefFile = path.join(cycle2, "evaluator-ref.json");
    const sourceVerdictFile = path.join(cycle2, "verdict.json");
    const originalRef = JSON.parse(fs.readFileSync(sourceRefFile, "utf8"));
    const originalVerdict = JSON.parse(fs.readFileSync(sourceVerdictFile, "utf8"));
    const repairJournal = path.join(fixture.changeDir, "closure", "evaluator-artifact-attribution-repair.json");
    const initialMismatchCases = [
      ["candidateFingerprint", (ref, verdict) => { ref.candidateFingerprint = `sha256:${"a".repeat(64)}`; verdict.candidateFingerprint = ref.candidateFingerprint; }],
      ["evidenceBundleFingerprint", (ref, verdict) => { ref.evidenceBundleFingerprint = `sha256:${"a".repeat(64)}`; verdict.evidenceBundleFingerprint = ref.evidenceBundleFingerprint; }],
      ["targetBaselineFingerprint", (ref, verdict) => { ref.targetBaselineFingerprint = `sha256:${"a".repeat(64)}`; verdict.targetBaselineFingerprint = ref.targetBaselineFingerprint; }],
      ["reviewer", (ref) => { ref.reviewer = "wrong-reviewer"; }],
      ["verdictReason", (ref) => { ref.verdictReason = "conflicting ref summary"; }],
      ["residualUnknowns", (ref) => { ref.residualUnknowns = ["conflicting ref residual"]; }],
      ["evaluatedCycle", (ref) => { ref.evaluatedCycle = 99; }],
      ["run", (ref) => { ref.run = "wrong/run"; }],
      ["evaluation", (ref) => { ref.evaluation = "wrong/run/evaluation.json"; }],
    ];
    for (const [field, mutate] of initialMismatchCases) {
      const tamperedRef = JSON.parse(JSON.stringify(originalRef));
      const tamperedVerdict = JSON.parse(JSON.stringify(originalVerdict));
      mutate(tamperedRef, tamperedVerdict);
      writeJson(sourceRefFile, tamperedRef);
      writeJson(sourceVerdictFile, tamperedVerdict);
      const refBefore = fs.readFileSync(sourceRefFile);
      const verdictBefore = fs.readFileSync(sourceVerdictFile);
      const rejected = runClosure(packageRoot, fixture.repo, ["--builder-complete", completeFile], 2);
      assert(rejected.status === "failed" && rejected.errors.some((error) => error.includes("invocation identity")), `attribution repair must reject a ref/verdict pair whose ${field} disagrees with the saved invocation`);
      assert(!fs.existsSync(repairJournal), "initial attribution mismatch must not create a prepared repair journal");
      assert(!fs.existsSync(path.join(cycle1, "evaluator-ref.json")) && !fs.existsSync(path.join(cycle1, "verdict.json")), "initial attribution mismatch must not write target-cycle bytes");
      assert(fs.readFileSync(sourceRefFile).equals(refBefore) && fs.readFileSync(sourceVerdictFile).equals(verdictBefore), "initial attribution mismatch must not move or rewrite source bytes");
    }
    writeJson(sourceRefFile, originalRef);
    writeJson(sourceVerdictFile, originalVerdict);

    const preparedJournal = {
      schemaVersion: 1,
      status: "prepared",
      createdAt: new Date().toISOString(),
      reason: "fixture-prepared-journal",
      mappings: [{ sourceCycle: 2, targetCycle: 1, evaluatorRef: originalRef, verdict: originalVerdict }],
    };

    writeJson(repairJournal, preparedJournal);
    const conflictingSourceRef = { ...originalRef, verdictReason: "source conflict after journal prepare" };
    writeJson(sourceRefFile, conflictingSourceRef);
    const sourceConflictRefBefore = fs.readFileSync(sourceRefFile);
    const sourceConflictVerdictBefore = fs.readFileSync(sourceVerdictFile);
    const sourceConflictJournalBefore = fs.readFileSync(repairJournal);
    const rejectedSourceConflict = runClosure(packageRoot, fixture.repo, ["--builder-complete", completeFile], 2);
    assert(rejectedSourceConflict.status === "failed" && rejectedSourceConflict.errors.some((error) => error.includes("conflicts with the prepared journal")), "prepared attribution replay must reject source evidence changed after journal creation");
    assert(!fs.existsSync(path.join(cycle1, "evaluator-ref.json")) && !fs.existsSync(path.join(cycle1, "verdict.json")), "source conflict must not write target-cycle bytes");
    assert(fs.readFileSync(sourceRefFile).equals(sourceConflictRefBefore) && fs.readFileSync(sourceVerdictFile).equals(sourceConflictVerdictBefore) && fs.readFileSync(repairJournal).equals(sourceConflictJournalBefore), "source conflict must preserve source and journal bytes exactly");
    writeJson(sourceRefFile, originalRef);

    writeJson(repairJournal, preparedJournal);
    fs.mkdirSync(cycle1, { recursive: true });
    writeJson(path.join(cycle1, "evaluator-ref.json"), { ...originalRef, verdictReason: "conflicting target evidence" });
    writeJson(path.join(cycle1, "verdict.json"), originalVerdict);
    const targetConflictRefBefore = fs.readFileSync(path.join(cycle1, "evaluator-ref.json"));
    const targetConflictVerdictBefore = fs.readFileSync(path.join(cycle1, "verdict.json"));
    const targetConflictSourceRefBefore = fs.readFileSync(sourceRefFile);
    const targetConflictSourceVerdictBefore = fs.readFileSync(sourceVerdictFile);
    const targetConflictJournalBefore = fs.readFileSync(repairJournal);
    const rejectedTargetConflict = runClosure(packageRoot, fixture.repo, ["--builder-complete", completeFile], 2);
    assert(rejectedTargetConflict.status === "failed" && rejectedTargetConflict.errors.some((error) => error.includes("conflicts with the prepared journal")), "prepared attribution replay must reject conflicting target evidence");
    assert(fs.readFileSync(path.join(cycle1, "evaluator-ref.json")).equals(targetConflictRefBefore) && fs.readFileSync(path.join(cycle1, "verdict.json")).equals(targetConflictVerdictBefore), "target conflict must preserve target bytes exactly");
    assert(fs.readFileSync(sourceRefFile).equals(targetConflictSourceRefBefore) && fs.readFileSync(sourceVerdictFile).equals(targetConflictSourceVerdictBefore) && fs.readFileSync(repairJournal).equals(targetConflictJournalBefore), "target conflict must preserve source and journal bytes exactly");
    fs.rmSync(path.join(cycle1, "evaluator-ref.json"), { force: true });
    fs.rmSync(path.join(cycle1, "verdict.json"), { force: true });

    const preparedRef = { ...originalRef, verdictReason: "prepared journal summary mismatch" };
    writeJson(repairJournal, { ...preparedJournal, reason: "fixture-prepared-journal-identity-mismatch", mappings: [{ sourceCycle: 2, targetCycle: 1, evaluatorRef: preparedRef, verdict: originalVerdict }] });
    const preparedRefBefore = fs.readFileSync(sourceRefFile);
    const preparedVerdictBefore = fs.readFileSync(sourceVerdictFile);
    const preparedJournalBefore = fs.readFileSync(repairJournal);
    const rejectedPrepared = runClosure(packageRoot, fixture.repo, ["--builder-complete", completeFile], 2);
    assert(rejectedPrepared.status === "failed" && rejectedPrepared.errors.some((error) => error.includes("invocation identity")), "prepared attribution journal must be revalidated against the saved invocation before replay");
    assert(!fs.existsSync(path.join(cycle1, "evaluator-ref.json")) && !fs.existsSync(path.join(cycle1, "verdict.json")), "rejected prepared journal must not write target-cycle bytes");
    assert(fs.readFileSync(sourceRefFile).equals(preparedRefBefore) && fs.readFileSync(sourceVerdictFile).equals(preparedVerdictBefore) && fs.readFileSync(repairJournal).equals(preparedJournalBefore), "rejected prepared journal must not move or rewrite source/journal bytes");
    assert(JSON.parse(fs.readFileSync(repairJournal, "utf8")).status === "prepared", "rejected prepared journal must remain available for explicit forensics");
    fs.rmSync(repairJournal, { force: true });

    value = runClosure(packageRoot, fixture.repo, ["--builder-complete", completeFile]);
    assert(value.evaluatorAttributionRepair && value.evaluatorAttributionRepair.status === "committed", "Builder completion must reconcile a known fix-required attribution defect");
    assert(fs.existsSync(path.join(cycle1, "evaluator-ref.json")) && fs.existsSync(path.join(cycle1, "verdict.json")), "attribution repair must restore the completed-cycle artifacts");
    assert(!fs.existsSync(path.join(cycle2, "evaluator-ref.json")) && !fs.existsSync(path.join(cycle2, "verdict.json")), "attribution repair must remove the obsolete next-cycle copies");
  } finally {
    if (fixture.ownedRoot) fs.rmSync(fixture.repo, { recursive: true, force: true });
  }
}

function prepareProofEnvironmentFixture(packageRoot, name, proofPolicy) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `steadyspec-${name}-`));
  run("git", ["init"], tmp);
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
  const changeDir = path.join(tmp, "docs", "changes", "001-contract");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nProof environment recovery fixture.\n", "utf8");
  fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Explicitly recover a failed proof environment.\n", "utf8");
  fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
  const prof = profile();
  for (const dimension of prof.dimensions) dimension.proofPolicyIds = ["fixture-environment"];
  writeJson(path.join(changeDir, "acceptance-profile.json"), prof);
  writeJson(path.join(tmp, ".steadyspec", "closure.json"), {
    schemaVersion: 1,
    mode: "manual",
    acceptanceProfile: "acceptance-profile.json",
    limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
    proofPolicies: { "fixture-environment": proofPolicy },
  });
  let value = runClosure(packageRoot, tmp, ["--prepare"]);
  const criticDir = path.join(changeDir, "cross-agent", "no-findings-critic");
  fs.mkdirSync(criticDir, { recursive: true });
  fs.writeFileSync(path.join(criticDir, "raw.md"), "## STDOUT\n\n- No findings: confirmed\n", "utf8");
  writeJson(path.join(criticDir, "run.json"), { schemaVersion: 1, mode: "review", reviewer: "fixture", reviewerStatus: "success", outputFormat: "findings_table", candidateFingerprint: value.candidateFingerprint, paths: { raw: path.join(criticDir, "raw.md") } });
  value = runClosure(packageRoot, tmp, ["--import-critic", criticDir]);
  assert(value.state === "proofs-required", `${name} fixture must reach proofs-required`);
  return { tmp, changeDir };
}

function proofEnvironmentRecoveryContracts(packageRoot) {
  const markerName = "proof-environment-ready.marker";
  let fixture = prepareProofEnvironmentFixture(packageRoot, "proof-timeout-recovery", {
    ...policy("node", ["-e", `const fs=require('fs'); if(fs.existsSync('${markerName}')) process.exit(0); setTimeout(()=>{},10000);`], "exit-code-only"),
    timeoutMs: 100,
  });
  try {
    let value = runClosureDetached(packageRoot, fixture.tmp, ["--run-proofs"], 2);
    assert(value.state === "blocked-by-environment" && value.action === "inspect-proof-environment", "real timeout must route to an explicit environment decision");
    const stateFile = path.join(fixture.changeDir, "closure", "state.json");
    const blockedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const environmentEscalation = blockedState.escalations[blockedState.escalations.length - 1];
    assert(environmentEscalation.reason === "proof-environment-failure" && environmentEscalation.resumeState === "proofs-required", "timeout must persist the exact proof recovery target");

    value = runClosure(packageRoot, fixture.tmp, ["--decide", "reopen", "--reason", "fixture chooses a fresh Critic after timeout"]);
    let reopened = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert(value.state === "critic-required" && reopened.proofs.length === 0 && !reopened.completedSteps.some((step) => step.startsWith("proof:1:")), "reopen after timeout must invalidate failed proof authority before a fresh Critic");

    writeJson(stateFile, blockedState);
    const staleEscalationState = JSON.parse(JSON.stringify(blockedState));
    staleEscalationState.escalations.push({ at: new Date().toISOString(), reason: "obsolete-fixture-escalation", resumeState: "builder-required" });
    writeJson(stateFile, staleEscalationState);
    value = runClosure(packageRoot, fixture.tmp, ["--decide", "resume", "--reason", "fixture must not reuse stale escalation"], 2);
    assert(value.errors.some((error) => error.includes("latest exact proof or Evaluator")), "blocked proof resume must reject an unrelated latest escalation");

    writeJson(stateFile, blockedState);
    fs.writeFileSync(path.join(fixture.tmp, markerName), "ready\n", "utf8");
    value = runClosure(packageRoot, fixture.tmp, ["--decide", "resume", "--reason", "fixture repaired the timeout environment"]);
    assert(value.state === "proofs-required" && value.action === "run-proofs", "explicit timeout resume must clear only the bound failed proof attempt");
    value = runClosure(packageRoot, fixture.tmp, ["--run-proofs"]);
    assert(value.state === "evaluator-required", "repaired timeout environment must allow one fresh proof run");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }

  if (process.platform === "win32") {
    const executable = "fixture-node.exe";
    fixture = prepareProofEnvironmentFixture(packageRoot, "proof-spawn-recovery", policy(executable, ["-e", "process.exit(0)"], "exit-code-only"));
    try {
      let value = runClosure(packageRoot, fixture.tmp, ["--run-proofs"], 2);
      assert(value.state === "blocked-by-environment", "missing Windows proof executable must route to blocked-by-environment");
      const stateFile = path.join(fixture.changeDir, "closure", "state.json");
      let state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert(state.escalations[state.escalations.length - 1].reason === "proof-environment-failure", "spawn error must persist the exact environment recovery identity");
      fs.copyFileSync(process.execPath, path.join(fixture.tmp, executable));
      value = runClosure(packageRoot, fixture.tmp, ["--decide", "resume", "--reason", "fixture installed the missing proof executable"]);
      assert(value.state === "proofs-required", "spawn-error resume must return to the exact proof stage");
      value = runClosure(packageRoot, fixture.tmp, ["--run-proofs"]);
      assert(value.state === "evaluator-required", "installed proof executable must run once after explicit resume");
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}

function proofSpawnRecoveryContracts(packageRoot) {
  if (process.platform !== "win32") return;
  const executable = "fixture-node.exe";
  const fixture = prepareProofEnvironmentFixture(packageRoot, "proof-spawn-recovery-bounded", policy(executable, ["-e", "process.exit(0)"], "exit-code-only"));
  try {
    let value = runClosure(packageRoot, fixture.tmp, ["--run-proofs"], 2);
    assert(value.state === "blocked-by-environment", "missing Windows proof executable must route to blocked-by-environment");
    const stateFile = path.join(fixture.changeDir, "closure", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert(state.escalations[state.escalations.length - 1].reason === "proof-environment-failure", "spawn error must persist the exact environment recovery identity");
    fs.copyFileSync(process.execPath, path.join(fixture.tmp, executable));
    value = runClosure(packageRoot, fixture.tmp, ["--decide", "resume", "--reason", "fixture installed the missing proof executable"]);
    assert(value.state === "proofs-required", "spawn-error resume must return to the exact proof stage");
    value = runClosure(packageRoot, fixture.tmp, ["--run-proofs"]);
    assert(value.state === "evaluator-required", "installed proof executable must run once after explicit resume");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function exactByteIdentityContracts(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-exact-bytes-"));
  try {
    run("git", ["init"], tmp);
    const src = path.join(tmp, "src");
    fs.mkdirSync(src, { recursive: true });
    const variants = [
      { name: "bom.txt", before: Buffer.from("alpha\n", "utf8"), after: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("alpha\n", "utf8")]) },
      { name: "crlf.txt", before: Buffer.from("alpha\nbeta\n", "utf8"), after: Buffer.from("alpha\r\nbeta\r\n", "utf8") },
      { name: "whitespace.txt", before: Buffer.from(" \n", "utf8"), after: Buffer.from("\t\n", "utf8") },
      { name: "binary.bin", before: Buffer.from([0x00, 0x7f, 0x80, 0xff]), after: Buffer.from([0x00, 0x7f, 0x81, 0xff]) },
    ];
    for (const variant of variants) fs.writeFileSync(path.join(src, variant.name), variant.before);
    const changeDir = path.join(tmp, "docs", "changes", "001-contract");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nExact-byte fixture.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Preserve exact bytes.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
    writeJson(path.join(changeDir, "acceptance-profile.json"), profile());
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), {
      schemaVersion: 1,
      mode: "manual",
      acceptanceProfile: "acceptance-profile.json",
      limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
      proofPolicies: { "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only") },
    });
    const prepared = runClosure(packageRoot, tmp, ["--prepare"]);
    for (const variant of variants) {
      const file = path.join(src, variant.name);
      fs.writeFileSync(file, variant.after);
      const stale = runClosure(packageRoot, tmp, ["--check"], 3);
      assert(stale.status === "stale" && stale.observedCandidateFingerprint !== prepared.candidateFingerprint, `${variant.name} byte mutation must change the candidate fingerprint`);
      assert(stale.changedInputs.some((row) => row.path === `src/${variant.name}`), `${variant.name} byte mutation must report its exact path`);
      fs.writeFileSync(file, variant.before);
      const restored = runClosure(packageRoot, tmp, ["--check"], 2);
      assert(restored.status === "incomplete" && restored.candidateFingerprint === prepared.candidateFingerprint, `${variant.name} restoration must recover the bound candidate bytes`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function proofInterruptionContracts(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-proof-resume-"));
  try {
    run("git", ["init"], tmp);
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
    const changeDir = path.join(tmp, "docs", "changes", "001-contract");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nProof resume fixture.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Do not replay committed proof work.\n", "utf8");
    fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
    const prof = profile();
    for (const dimension of prof.dimensions) dimension.proofPolicyIds = ["proof-a", "proof-b"];
    writeJson(path.join(changeDir, "acceptance-profile.json"), prof);
    const config = {
      schemaVersion: 1,
      mode: "manual",
      acceptanceProfile: "acceptance-profile.json",
      limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
      proofPolicies: {
        "proof-a": policy("node", ["-e", "require('fs').appendFileSync('proof-a.count','a')"], "structured-json"),
        "proof-b": policy("node", ["-e", "require('fs').appendFileSync('proof-b.count','b')"], "structured-json"),
      },
    };
    writeJson(path.join(tmp, ".steadyspec", "closure.json"), config);
    let value = runClosure(packageRoot, tmp, ["--prepare"]);
    const criticDir = path.join(changeDir, "cross-agent", "proof-resume-critic");
    fs.mkdirSync(criticDir, { recursive: true });
    fs.writeFileSync(path.join(criticDir, "raw.md"), "## STDOUT\n\n- No findings: confirmed\n", "utf8");
    writeJson(path.join(criticDir, "run.json"), { schemaVersion: 1, mode: "review", reviewer: "fixture", reviewerStatus: "success", outputFormat: "findings_table", candidateFingerprint: value.candidateFingerprint, paths: { raw: path.join(criticDir, "raw.md") } });
    value = runClosure(packageRoot, tmp, ["--import-critic", criticDir]);
    assert(value.state === "proofs-required", "no-finding Critic must route the proof interruption fixture to proofs");
    let interrupted = false;
    try {
      await actionRunProofs({ repo: tmp, changeDir, loaded: { config, profile: prof } }, {
        afterProofCommitted({ policyId }) {
          if (policyId === "proof-a") throw new Error("fixture interruption after proof-a atomic commit");
        },
      });
    } catch (error) {
      interrupted = error.message.includes("fixture interruption");
    }
    assert(interrupted, "proof fixture must interrupt after the first committed policy");
    assert(fs.readFileSync(path.join(tmp, "proof-a.count"), "utf8") === "a" && !fs.existsSync(path.join(tmp, "proof-b.count")), "only proof-a may execute before the injected interruption");
    const interruptedState = JSON.parse(fs.readFileSync(path.join(changeDir, "closure", "state.json"), "utf8"));
    assert(interruptedState.state === "proofs-required" && interruptedState.inProgressStep === null && interruptedState.completedSteps.includes("proof:1:proof-a"), "interrupted state must expose proof-a as one complete transition");
    const inconsistentState = JSON.parse(JSON.stringify(interruptedState));
    inconsistentState.proofs = [];
    writeJson(path.join(changeDir, "closure", "state.json"), inconsistentState);
    const rejectedMismatch = runClosure(packageRoot, tmp, ["--run-proofs"], 2);
    assert(rejectedMismatch.state === "needs-user" && rejectedMismatch.errors.some((error) => error.includes("has no persisted result")), "completed proof marker without its result must remain a fail-closed recovery error");
    writeJson(path.join(changeDir, "closure", "state.json"), interruptedState);
    value = runClosure(packageRoot, tmp, ["--run-proofs"]);
    assert(value.state === "evaluator-required" && value.proofCount === 2, "proof resume must complete only the remaining policy and bind both results");
    assert(fs.readFileSync(path.join(tmp, "proof-a.count"), "utf8") === "a", "proof resume must not replay already committed proof-a");
    assert(fs.readFileSync(path.join(tmp, "proof-b.count"), "utf8") === "b", "proof resume must execute proof-b exactly once");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function resetInterruptionContracts(packageRoot) {
  for (const stage of ["afterJournal", "afterArchiveCommit", "afterStateCleanup"]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `steadyspec-reset-${stage}-`));
    try {
      run("git", ["init"], tmp);
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
      const changeDir = path.join(tmp, "docs", "changes", "001-contract");
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nReset interruption fixture.\n", "utf8");
      fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- Preserve terminal lineage.\n", "utf8");
      fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
      writeJson(path.join(changeDir, "acceptance-profile.json"), profile());
      writeJson(path.join(tmp, ".steadyspec", "closure.json"), {
        schemaVersion: 1,
        mode: "manual",
        acceptanceProfile: "acceptance-profile.json",
        limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
        proofPolicies: { "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only") },
      });
      runClosure(packageRoot, tmp, ["--prepare"]);
      const stateFile = path.join(changeDir, "closure", "state.json");
      const terminal = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const priorLineage = terminal.lineageId;
      terminal.state = "candidate-ready";
      terminal.nextAction = "human-trust-checkpoint";
      terminal.inProgressStep = null;
      writeJson(stateFile, terminal);
      let interrupted = false;
      const hooks = {
        [stage]() { throw new Error(`fixture reset interruption ${stage}`); },
      };
      try {
        await actionReset({ repo: tmp, changeDir }, `fixture initial reset ${stage}`, hooks);
      } catch (error) {
        interrupted = error.message.includes(`fixture reset interruption ${stage}`);
      }
      assert(interrupted, `reset fixture must interrupt at ${stage}`);
      const blockedPrepare = runClosure(packageRoot, tmp, ["--prepare"], 2);
      assert(blockedPrepare.state === "needs-user" && blockedPrepare.action === "resume-reset", `${stage} interruption must block a silent new lineage`);
      const resumed = runClosure(packageRoot, tmp, ["--reset", "--reason", `fixture explicitly resumes ${stage}`]);
      assert(resumed.status === "reset" && resumed.recoverability.includes("atomically committed"), `${stage} interruption must resume from the journaled archive boundary`);
      const archive = path.resolve(tmp, resumed.archive);
      assert(fs.existsSync(path.join(archive, "state.json")) && fs.existsSync(path.join(archive, "cycles")) && fs.existsSync(path.join(archive, "reset-decision.json")) && fs.existsSync(path.join(archive, "reset-journal-final.json")), `${stage} reset archive must preserve state, cycles, decision, and recovery journal`);
      assert(!fs.existsSync(stateFile) && !fs.existsSync(path.join(changeDir, "closure", "reset-in-progress.json")), `${stage} recovery must finish live cleanup only after archive commit`);
      const prepared = runClosure(packageRoot, tmp, ["--prepare"]);
      const fresh = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert(prepared.state === "critic-required" && fresh.lineageId !== priorLineage && fs.existsSync(archive), `${stage} recovery must permit a distinct new lineage without deleting the archive`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function prepareIncompleteScopeRepair(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-scope-decision-"));
  run("git", ["init"], tmp);
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
  const changeDir = path.join(tmp, "docs", "changes", "001-contract");
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Intent\n\nScope decision fixture.\n", "utf8");
  fs.writeFileSync(path.join(changeDir, "requirements.md"), "# Requirements\n\n- explicit scope decision.\n", "utf8");
  fs.writeFileSync(path.join(changeDir, "acceptance-profile.md"), "# Acceptance Profile\n\nFixture only.\n", "utf8");
  const originalProfile = profile();
  writeJson(path.join(changeDir, "acceptance-profile.json"), originalProfile);
  writeJson(path.join(tmp, ".steadyspec", "closure.json"), {
    schemaVersion: 1,
    mode: "manual",
    acceptanceProfile: "acceptance-profile.json",
    limits: { maxCycles: 5, wallClockMs: 3600000, maxAutoFiles: 3, recurrenceLimit: 2, noProgressCycles: 3 },
    proofPolicies: { "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only") },
  });
  let value = runClosure(packageRoot, tmp, ["--prepare"]);
  const criticDir = path.join(changeDir, "cross-agent", "scope-critic");
  fs.mkdirSync(criticDir, { recursive: true });
  fs.writeFileSync(path.join(criticDir, "raw.md"), [
    "## STDOUT", "",
    "| Finding ID | Severity | Claim / Risk | Evidence | Breaking Scenario | Alternative | Recommended Action |",
    "|------------|----------|--------------|----------|-------------------|-------------|--------------------|",
    "| F1 | P2 | Incomplete repair fixture. | src/app.js | An unplanned file may be added. | Keep the delta declared. | Repair only the planned file. |",
  ].join("\n"), "utf8");
  writeJson(path.join(criticDir, "run.json"), { schemaVersion: 1, mode: "review", reviewer: "fixture", reviewerStatus: "success", outputFormat: "findings_table", candidateFingerprint: value.candidateFingerprint, paths: { raw: path.join(criticDir, "raw.md") } });
  value = runClosure(packageRoot, tmp, ["--import-critic", criticDir]);
  const beforeFile = path.join(tmp, "scope-builder-before.json");
  writeJson(beforeFile, {
    candidateFingerprint: value.candidateFingerprint,
    findingIds: ["F1"],
    changes: [{ path: "src/app.js", changeSummary: "Repair the declared fixture implementation." }],
    authorityIds: ["R-scope"],
    proofPolicyIds: ["fixture-pass"],
    riskClass: "safe-harbor-mechanical",
  });
  value = runClosure(packageRoot, tmp, ["--builder-before", beforeFile]);
  fs.writeFileSync(path.join(tmp, "src", "app.js"), "module.exports = 2;\n", "utf8");
  fs.writeFileSync(path.join(tmp, "src", "unplanned.js"), "module.exports = 'unexpected';\n", "utf8");
  const completeFile = path.join(tmp, "scope-builder-complete.json");
  writeJson(completeFile, { completionToken: value.completionToken, findings: [{ findingId: "F1", status: "fixed", evidence: ["src/app.js"], residual: null }] });
  value = runClosure(packageRoot, tmp, ["--builder-complete", completeFile], 2);
  assert(value.state === "needs-user" && value.inspection.unexpected.some((row) => row.path === "src/unplanned.js"), "incomplete repair must stop on an undeclared candidate path");
  return { tmp, changeDir, originalProfile };
}

function incompleteRepairDecisionContracts(packageRoot) {
  let fixture = prepareIncompleteScopeRepair(packageRoot);
  try {
    const approved = runClosure(packageRoot, fixture.tmp, ["--decide", "approve", "--reason", "fixture explicitly approves the inspected unplanned file"]);
    assert(approved.state === "proofs-required" && approved.approvedUnexpectedPaths.includes("src/unplanned.js"), "approve must bind the inspected unplanned file and require fresh proofs");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }

  fixture = prepareIncompleteScopeRepair(packageRoot);
  try {
    let rejected = runClosure(packageRoot, fixture.tmp, ["--decide", "reject", "--reason", "fixture rejects the unplanned scope expansion"], 2);
    assert(rejected.state === "needs-user" && rejected.action === "revert-unapproved-builder-delta", "reject must wait for the unapproved delta to be reverted");
    fs.writeFileSync(path.join(fixture.tmp, "src", "app.js"), "module.exports = 1;\n", "utf8");
    fs.rmSync(path.join(fixture.tmp, "src", "unplanned.js"), { force: true });
    rejected = runClosure(packageRoot, fixture.tmp, ["--decide", "resume", "--reason", "fixture confirms the rejected delta was reverted"]);
    assert(rejected.state === "builder-required" && rejected.action === "record-builder-before", "resume after a verified revert must return to a fresh Builder record");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }

  fixture = prepareIncompleteScopeRepair(packageRoot);
  try {
    const reopened = runClosure(packageRoot, fixture.tmp, ["--decide", "reopen", "--reason", "fixture reopens intent around the inspected scope expansion"]);
    assert(reopened.state === "critic-required" && reopened.action === "run-critic", "reopen must bind the inspected candidate and require a fresh Critic");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
}

async function decisionInterruptionContracts(packageRoot) {
  for (const stage of ["afterDecisionArtifact", "afterStateCommit"]) {
    const fixture = prepareIncompleteScopeRepair(packageRoot);
    try {
      const reason = `fixture deterministic reopen ${stage}`;
      const config = JSON.parse(fs.readFileSync(path.join(fixture.tmp, ".steadyspec", "closure.json"), "utf8"));
      const prof = JSON.parse(fs.readFileSync(path.join(fixture.changeDir, "acceptance-profile.json"), "utf8"));
      let interrupted = false;
      const hooks = { [stage]() { throw new Error(`fixture decision interruption ${stage}`); } };
      try {
        await actionDecide({ repo: fixture.tmp, changeDir: fixture.changeDir, loaded: { config, profile: prof } }, "reopen", reason, hooks);
      } catch (error) {
        interrupted = error.message.includes(`fixture decision interruption ${stage}`);
      }
      assert(interrupted, `decision fixture must interrupt at ${stage}`);
      const decisionDir = path.join(fixture.changeDir, "closure", "cycles", "001");
      let artifacts = fs.readdirSync(decisionDir).filter((name) => /^human-decision-[a-f0-9]{24}\.json$/.test(name));
      assert(artifacts.length === 1, `${stage} interruption must publish exactly one stable decision artifact`);
      const artifactRecord = JSON.parse(fs.readFileSync(path.join(decisionDir, artifacts[0]), "utf8"));
      const retry = runClosure(packageRoot, fixture.tmp, ["--decide", "reopen", "--reason", reason]);
      assert(["decision-recorded", "decision-already-recorded"].includes(retry.status) && retry.decisionId === artifactRecord.decisionId, `${stage} retry must reconcile the same decision ID`);
      const duplicateRetry = runClosure(packageRoot, fixture.tmp, ["--decide", "reopen", "--reason", reason]);
      assert(duplicateRetry.status === "decision-already-recorded" && duplicateRetry.decisionId === artifactRecord.decisionId, `${stage} committed retry must be idempotent`);
      artifacts = fs.readdirSync(decisionDir).filter((name) => /^human-decision-[a-f0-9]{24}\.json$/.test(name));
      const persisted = JSON.parse(fs.readFileSync(path.join(fixture.changeDir, "closure", "state.json"), "utf8"));
      assert(artifacts.length === 1 && persisted.decisions.filter((row) => row.decisionId === artifactRecord.decisionId).length === 1, `${stage} retries must not duplicate artifact or state authority records`);
    } finally {
      fs.rmSync(fixture.tmp, { recursive: true, force: true });
    }
  }
}

function historicalIncompleteRepairDoesNotHijackEnvironmentReopen(packageRoot) {
  const fixture = prepareIncompleteScopeRepair(packageRoot);
  try {
    const stateFile = path.join(fixture.changeDir, "closure", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert(state.escalations.some((row) => row.reason === "undeclared-builder-delta"), "regression precondition requires a historical incomplete-repair escalation");
    state.state = "blocked-by-environment";
    state.nextAction = "repair-environment";
    state.inProgressStep = null;
    state.escalations.push({
      at: new Date().toISOString(),
      reason: "evaluator-retry-exhausted",
      resumeState: "evaluator-required",
    });
    writeJson(stateFile, state);

    fs.writeFileSync(path.join(fixture.tmp, "src", "app.js"), "module.exports = 2;\n", "utf8");
    const reopened = runClosure(packageRoot, fixture.tmp, ["--decide", "reopen", "--reason", "fixture repairs the later evaluator environment without reusing an obsolete scope inspection"]);
    assert(reopened.state === "critic-required" && reopened.action === "run-critic", "blocked environment reopen must ignore an obsolete incomplete-repair inspection");
    const reopenedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const decision = reopenedState.decisions[reopenedState.decisions.length - 1];
    assert(decision.priorState === "blocked-by-environment", "environment reopen must preserve its actual prior-state authority record");

    const refreshed = runClosure(packageRoot, fixture.tmp, ["--prepare"]);
    assert(refreshed.state === "critic-required" && refreshed.status === "candidate-refreshed", "prepare must bind the changed candidate after the environment decision");
  } finally {
    fs.rmSync(fixture.tmp, { recursive: true, force: true });
  }
}

async function realProofProcessDeath(packageRoot, suiteRoot, trackedChildren, knownPids) {
  const repo = path.join(suiteRoot, "proof-process-death");
  const nonce = crypto.randomBytes(8).toString("hex");
  const fixture = prepareNoFindingFixture(packageRoot, repo, "real-proof-process-death", {
    "real-proof": {
      ...policy("node", [__filename, "--real-child", "proof", repo, nonce], "exit-code-only"),
      timeoutMs: 60000,
    },
  }, ["real-proof"], { observed: true });
  const closureChild = spawn(process.execPath, [
    path.join(packageRoot, "bin", "closure.js"),
    "--repo", repo,
    "--change", "001-contract",
    "--run-proofs",
    "--json",
  ], { cwd: repo, windowsHide: true, detached: true, stdio: "ignore" });
  trackedChildren.push({ child: closureChild, label: "real proof orchestrator" });
  const stateFile = path.join(fixture.changeDir, "closure", "state.json");
  const markerFile = path.join(repo, "proof-child-started.json");
  await waitFor(() => {
    if (!fs.existsSync(markerFile) || !fs.existsSync(stateFile)) return false;
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return state.inProgressStep === "proof:1:real-proof";
  }, "real proof child and committed in-progress marker");
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  expect(marker.nonce === nonce && Number.isSafeInteger(marker.pid), "real proof child marker must bind its nonce and PID");
  knownPids.add(marker.pid);
  const killWarnings = terminateProcessTree(closureChild, "SIGKILL", { label: "real proof orchestrator" });
  expect(killWarnings.length === 0, `real proof orchestrator must terminate through Windows taskkill /T /F: ${killWarnings.join(" ")}`);
  await waitForChildExit(closureChild, "real proof orchestrator");
  await waitFor(() => !isKnownWindowsPidRunning(marker.pid), "real proof descendant exit after taskkill tree", 10000);
  knownPids.delete(marker.pid);

  const attemptsBefore = fs.readFileSync(path.join(repo, "proof-attempts.log"), "utf8").trim().split(/\r?\n/).filter(Boolean);
  expect(attemptsBefore.length === 1 && attemptsBefore[0] === nonce, "killed proof must have exactly one observed attempt");
  const resumed = runClosureObserved(packageRoot, repo, ["--run-proofs"], 2);
  expect(resumed.state === "needs-user" && resumed.action === "inspect-uncertain-proof", "real process death must route the persisted proof marker to uncertain inspection");
  expect((resumed.errors || []).some((error) => error.includes("will not be replayed automatically")), "real process death must explicitly reject automatic replay");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  expect(!state.completedSteps.includes("proof:1:real-proof"), "killed proof must not acquire a completed marker");
  const prepared = runClosureObserved(packageRoot, repo, ["--prepare"]);
  expect(prepared.state === "needs-user" && prepared.action === "inspect-uncertain-proof", "prepare after real proof death must preserve the uncertain decision boundary");
  const attemptsAfter = fs.readFileSync(path.join(repo, "proof-attempts.log"), "utf8").trim().split(/\r?\n/).filter(Boolean);
  expect(attemptsAfter.length === 1, "inspection after process death must not replay the proof child");
  return { taskkillTreeSucceeded: true, uncertainMarkerPreserved: true, proofAttempts: attemptsAfter.length, automaticReplay: false };
}

function directoryLockerScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$Archive = $env:STEADYSPEC_V06_LOCK_ARCHIVE",
    "$Ready = $env:STEADYSPEC_V06_LOCK_READY",
    "$Release = $env:STEADYSPEC_V06_LOCK_RELEASE",
    "$Started = $env:STEADYSPEC_V06_LOCK_STARTED",
    "[IO.File]::WriteAllText($Started, 'entered')",
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "using Microsoft.Win32.SafeHandles;",
    "public static class SteadySpecDirectoryShareLock {",
    "  [DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
    "  public static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);",
    "}",
    "'@",
    "[IO.File]::WriteAllText($Started, 'compiled')",
    "$deadline = [DateTime]::UtcNow.AddSeconds(30)",
    "$handle = $null",
    "$candidate = $null",
    "while ([DateTime]::UtcNow -lt $deadline) {",
    "  $candidate = Get-ChildItem -LiteralPath $Archive -Directory -Filter '.reset-*.tmp' -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  if ($null -ne $candidate) {",
    "    $handle = [SteadySpecDirectoryShareLock]::CreateFileW($candidate.FullName, 1, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)",
    "    if (-not $handle.IsInvalid) { break }",
    "    $handle.Dispose()",
    "    $handle = $null",
    "  }",
    "  [Threading.Thread]::Sleep(5)",
    "}",
    "if ($null -eq $handle -or $handle.IsInvalid) { throw 'failed to acquire the reset staging directory without delete sharing' }",
    "[IO.File]::WriteAllText($Ready, $candidate.FullName)",
    "try {",
    "  $releaseDeadline = [DateTime]::UtcNow.AddSeconds(60)",
    "  while (-not (Test-Path -LiteralPath $Release)) {",
    "    if ([DateTime]::UtcNow -ge $releaseDeadline) { throw 'timed out waiting for the directory lock release marker' }",
    "    [Threading.Thread]::Sleep(10)",
    "  }",
    "} finally {",
    "  $handle.Dispose()",
    "}",
  ].join("\n");
}

async function realResetRenameContention(packageRoot, suiteRoot, trackedChildren, releaseMarkers) {
  const repo = path.join(suiteRoot, "reset-rename-contention");
  const fixture = prepareNoFindingFixture(packageRoot, repo, "real-reset-rename-contention", {
    "fixture-pass": policy("node", ["-e", "process.exit(0)"], "exit-code-only"),
  }, ["fixture-pass"], { observed: true });
  const stateFile = path.join(fixture.changeDir, "closure", "state.json");
  const terminal = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const priorLineage = terminal.lineageId;
  terminal.state = "candidate-ready";
  terminal.nextAction = "human-trust-checkpoint";
  terminal.inProgressStep = null;
  writeJson(stateFile, terminal);
  const archiveDir = path.join(fixture.changeDir, "closure", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  let journalBoundaryObserved = false;
  try {
    await actionReset({ repo, changeDir: fixture.changeDir }, "real fixture commits the reset journal boundary", {
      afterJournal() { throw new Error("real fixture stops after journal commit"); },
    });
  } catch (error) {
    journalBoundaryObserved = error.message.includes("stops after journal commit");
  }
  expect(journalBoundaryObserved, "real reset fixture must stop after the committed journal boundary");
  const journalFile = path.join(fixture.changeDir, "closure", "reset-in-progress.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  const staging = path.join(archiveDir, journal.stagingName);
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "preexisting-staging.marker"), "journal-boundary\n", "utf8");
  const ready = path.join(suiteRoot, "directory-lock-ready.txt");
  const release = path.join(suiteRoot, "directory-lock-release.txt");
  const started = path.join(suiteRoot, "directory-lock-started.txt");
  releaseMarkers.add(release);
  const encodedLocker = Buffer.from(directoryLockerScript(), "utf16le").toString("base64");
  const lockerEnv = buildScrubbedEnv().env;
  const locker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedLocker], {
    cwd: suiteRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...lockerEnv,
      STEADYSPEC_V06_LOCK_ARCHIVE: archiveDir,
      STEADYSPEC_V06_LOCK_READY: ready,
      STEADYSPEC_V06_LOCK_RELEASE: release,
      STEADYSPEC_V06_LOCK_STARTED: started,
    },
  });
  let lockerStdout = "";
  let lockerStderr = "";
  locker.stdout.on("data", (chunk) => { lockerStdout += chunk.toString(); });
  locker.stderr.on("data", (chunk) => { lockerStderr += chunk.toString(); });
  trackedChildren.push({ child: locker, label: "Win32 reset directory locker" });
  try {
    await waitFor(() => fs.existsSync(started) && fs.readFileSync(started, "utf8") === "compiled", "Win32 directory-lock watcher start", 10000);
  } catch (error) {
    const stage = fs.existsSync(started) ? fs.readFileSync(started, "utf8") : "missing";
    throw new Error(`${error.message}; stage=${stage}; locker exit=${locker.exitCode}; stdout=${lockerStdout.trim()}; stderr=${lockerStderr.trim()}`);
  }
  await waitFor(() => fs.existsSync(ready), "Win32 directory lock acquisition");
  expect(path.resolve(fs.readFileSync(ready, "utf8")) === path.resolve(staging), "Win32 directory lock must bind the exact journaled staging path");
  const failedReset = runClosureObserved(packageRoot, repo, ["--reset", "--reason", "real fixture starts reset under Win32 rename contention"], 2);
  expect(failedReset.status === "failed" && (failedReset.errors || []).some((error) => /EPERM|EBUSY|access denied|operation not permitted/i.test(error)), "held Win32 directory handle must cause a real reset rename failure");
  expect(fs.existsSync(journalFile), "rename contention must preserve the reset journal");
  const failedJournal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  expect(failedJournal.status === "copying" && failedJournal.resetId === journal.resetId, "rename contention must preserve the exact copying reset phase");
  const target = path.join(archiveDir, journal.archiveName);
  expect(!fs.existsSync(target), "failed staging rename must not publish the final archive target");
  expect(fs.existsSync(stateFile) && fs.existsSync(path.join(fixture.changeDir, "closure", "cycles")), "failed reset must not delete live state or cycles");
  const pending = runClosureObserved(packageRoot, repo, ["--prepare"], 2);
  expect(pending.action === "resume-reset" && pending.resetId === journal.resetId, "prepare must expose the exact interrupted reset identity");

  fs.writeFileSync(release, "release\n", "utf8");
  await waitForChildExit(locker, "Win32 reset directory locker");
  const resumed = runClosureObserved(packageRoot, repo, ["--reset", "--reason", "real fixture explicitly resumes the same reset after releasing contention"]);
  expect(resumed.status === "reset", "released rename contention must allow explicit reset recovery");
  const archive = path.resolve(repo, resumed.archive);
  const finalJournal = JSON.parse(fs.readFileSync(path.join(archive, "reset-journal-final.json"), "utf8"));
  expect(finalJournal.resetId === journal.resetId && finalJournal.status === "committed", "reset recovery must preserve and commit the same reset ID");
  expect(fs.readdirSync(archiveDir).some((name) => name.startsWith(`interrupted-${journal.resetId}-`)), "reset recovery must preserve the contended staging directory before recopy");
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, "reset-manifest.json"), "utf8"));
  for (const row of manifest.files || []) {
    const file = path.resolve(archive, row.path);
    expect(file.startsWith(`${archive}${path.sep}`) && fs.existsSync(file), `reset archive must contain ${row.path}`);
    expect(fs.statSync(file).size === row.bytes && sha256File(file) === row.sha256, `reset archive must byte-verify ${row.path}`);
  }
  expect(!fs.existsSync(stateFile) && !fs.existsSync(path.join(fixture.changeDir, "closure", "cycles")) && !fs.existsSync(journalFile), "reset recovery must clean live state only after archive commit");
  const prepared = runClosureObserved(packageRoot, repo, ["--prepare"]);
  const fresh = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  expect(prepared.state === "critic-required" && fresh.lineageId !== priorLineage, "reset recovery must permit a distinct new lineage only after cleanup");
  return { sharingViolationObserved: true, contentionPoint: "journaled-staging-preservation-rename", resetIdPreserved: true, archiveFilesVerified: manifest.files.length, freshLineageAfterCommit: true };
}

async function realEvaluatorTransportBranch(packageRoot, suiteRoot, decision, trackedChildren, knownPids) {
  const repo = path.join(suiteRoot, `evaluator-transport-${decision}`);
  const fixture = prepareEvaluatorRunningFixture(packageRoot, `real-evaluator-${decision}`, repo, { observed: true });
  const nonce = crypto.randomBytes(8).toString("hex");
  const transport = spawn(process.execPath, [__filename, "--real-child", "evaluator", fixture.expectedRunDir, nonce], {
    cwd: repo,
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  trackedChildren.push({ child: transport, label: `real evaluator ${decision} transport` });
  const markerFile = path.join(fixture.expectedRunDir, "transport-started.json");
  await waitFor(() => fs.existsSync(markerFile), `real evaluator ${decision} transport marker`);
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  expect(marker.nonce === nonce && marker.pid === transport.pid, `real evaluator ${decision} marker must bind nonce and the owned transport PID`);
  const killWarnings = terminateProcessTree(transport, "SIGKILL", { label: `real evaluator ${decision} transport` });
  expect(killWarnings.length === 0, `real evaluator ${decision} transport must terminate through Windows taskkill /T /F: ${killWarnings.join(" ")}`);
  await waitForChildExit(transport, `real evaluator ${decision} transport`);
  expect(!fs.existsSync(path.join(fixture.expectedRunDir, "run.json")), "dead evaluator transport must not fabricate run.json");
  const duplicate = runClosureObserved(packageRoot, repo, ["--evaluator-start", fixture.startFile], 2);
  expect((duplicate.errors || []).some((error) => error.includes("evaluator-running")), "dead evaluator transport must reject duplicate evaluator-start");
  const prepared = runClosureObserved(packageRoot, repo, ["--prepare"]);
  expect(prepared.state === "evaluator-running" && prepared.action === "inspect-evaluator-run", "prepare must inspect rather than infer completion after transport death");
  const decisionResult = runClosureObserved(packageRoot, repo, ["--decide", decision, "--reason", `real fixture explicitly ${decision}s the killed evaluator transport`], decision === "abandon" ? 2 : 0);
  const record = JSON.parse(fs.readFileSync(path.resolve(repo, decisionResult.artifact), "utf8"));
  const bound = record.basis && record.basis.evaluatorInvocation;
  expect(bound, `${decision} decision must bind the killed evaluator invocation`);
  for (const key of ["status", "requestedRole", "roleContract", "includedScopeFingerprint", "targetBaselineFingerprint", "invocationId", "reviewer", "transport", "expectedRunDir", "candidateFingerprint", "evidenceBundleFingerprint", "startedAt"]) {
    expect(bound[key] === fixture.invocation[key], `${decision} decision must preserve killed evaluator ${key}`);
  }
  const state = JSON.parse(fs.readFileSync(fixture.stateFile, "utf8"));
  expect(state.inProgressStep === null && !state.completedSteps.some((step) => step.startsWith("evaluator:1")), `${decision} after transport death must not fabricate completion`);
  const invocationFile = path.join(fixture.changeDir, "closure", "cycles", "001", "evaluator-invocation.json");
  expect(fs.existsSync(invocationFile), `${decision} must preserve the original evaluator invocation artifact`);
  if (decision === "reopen") {
    expect(state.state === "critic-required" && state.evaluator === null, "reopen after transport death must require a fresh Critic and clear active evaluator state");
  } else {
    expect(state.state === "abandoned" && state.evaluator.status === "abandoned", "abandon after transport death must end, not retain, evaluator-running state");
    expect(state.evaluator.decisionId === record.decisionId && state.evaluator.invocationId === fixture.invocation.invocationId, "abandon after transport death must preserve exact invocation and decision identity");
  }
  return { taskkillTreeSucceeded: true, duplicateStartRejected: true, completionInferred: false, decisionBoundToInvocation: true, terminalState: state.state };
}

function isKnownWindowsPidRunning(pid) {
  if (process.platform !== "win32" || !Number.isSafeInteger(pid) || pid <= 0) return false;
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  return result.status === 0 && (result.stdout || "").includes(`,\"${pid}\",`);
}

async function runWindowsRealSmoke() {
  if (process.platform !== "win32") {
    return { schemaVersion: 1, status: "skipped", platform: process.platform, reason: "Windows-only real interruption evidence; no platform claim is inferred." };
  }
  const suiteRoot = assertSafeRealTempRoot(fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-v06-windows-real-")));
  const trackedChildren = [];
  const knownPids = new Set();
  const releaseMarkers = new Set();
  let summary;
  let failure = null;
  const cleanupErrors = [];
  try {
    const proofProcessDeath = await realProofProcessDeath(path.resolve(__dirname, ".."), suiteRoot, trackedChildren, knownPids);
    const resetRenameContention = await realResetRenameContention(path.resolve(__dirname, ".."), suiteRoot, trackedChildren, releaseMarkers);
    const evaluatorReopen = await realEvaluatorTransportBranch(path.resolve(__dirname, ".."), suiteRoot, "reopen", trackedChildren, knownPids);
    const evaluatorAbandon = await realEvaluatorTransportBranch(path.resolve(__dirname, ".."), suiteRoot, "abandon", trackedChildren, knownPids);
    summary = {
      schemaVersion: 1,
      status: "passed",
      platform: process.platform,
      observed: { proofProcessDeath, resetRenameContention, evaluatorTransportDeath: { reopen: evaluatorReopen, abandon: evaluatorAbandon } },
      controlledHookCoverage: ["proof-after-commit", "reset-journal/archive/cleanup", "decision-artifact/state-commit"],
      coverageLimits: [
        "One Windows and Node runtime on the current local filesystem only.",
        "Proof filesystem, database, network, and arbitrary external-process side effects are not isolated or transactionally rolled back.",
        "The evaluator stub proves transport lifecycle only, not reviewer quality, protocol semantics, or external service behavior.",
        "No POSIX, team concurrency, CI, network filesystem, or all-Windows-filesystem claim is inferred.",
      ],
    };
  } catch (error) {
    failure = error;
  } finally {
    for (const marker of releaseMarkers) {
      try { fs.writeFileSync(marker, "release\n", "utf8"); } catch (error) { cleanupErrors.push(error.message); }
    }
    for (const tracked of [...trackedChildren].reverse()) {
      try { await stopTrackedChild(tracked.child, tracked.label); } catch (error) { cleanupErrors.push(error.message); }
    }
    await delay(100);
    for (const pid of knownPids) if (isKnownWindowsPidRunning(pid)) cleanupErrors.push(`known fixture pid ${pid} is still running`);
    if (!cleanupErrors.length) {
      try {
        assertSafeRealTempRoot(suiteRoot);
        fs.rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        cleanupErrors.push(error.message);
      }
    } else {
      cleanupErrors.push(`diagnostic root retained at ${suiteRoot}`);
    }
  }
  if (failure) throw failure;
  if (cleanupErrors.length) throw new Error(`real interruption cleanup failed: ${cleanupErrors.join("; ")}`);
  return summary;
}

async function main() {
  const packageRoot = path.resolve(__dirname, "..");
  unitContracts(packageRoot);
  publicEvaluatorTransportContracts(packageRoot);
  integrationContract(packageRoot);
  proofFailureRecoveryContracts(packageRoot);
  proofEnvironmentRecoveryContracts(packageRoot);
  exactByteIdentityContracts(packageRoot);
  await proofInterruptionContracts(packageRoot);
  await resetInterruptionContracts(packageRoot);
  incompleteRepairDecisionContracts(packageRoot);
  await decisionInterruptionContracts(packageRoot);
  historicalIncompleteRepairDoesNotHijackEnvironmentReopen(packageRoot);
  evaluatorTerminationContracts(packageRoot);
  evaluatorWallClockImportContracts(packageRoot);
  evaluatorImportStalenessContracts(packageRoot);
  fixRequiredCycleAttributionContracts(packageRoot);
  console.log("Closure contracts are valid (structural-contract cycle fixture; legacy validator marker: synthetic full-cycle fixture; no real reviewer claim). ");
}

if (process.argv[2] === "--real-child") {
  realChildMain(process.argv.slice(3)).catch((error) => fail(error.stack || error.message));
} else if (process.argv.includes("--windows-real-smoke")) {
  runWindowsRealSmoke()
    .then((result) => console.log(JSON.stringify(result, null, process.argv.includes("--json") ? 2 : 0)))
    .catch((error) => fail(error.stack || error.message));
} else {
  main().catch((error) => fail(error.stack || error.message));
}
