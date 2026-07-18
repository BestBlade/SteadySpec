// SteadySpec verify-flow as deterministic Workflow script.
// Runs the v0.3 trust checkpoint before archive, handoff, or risky continuation.
//
// Invocation: /steadyspec:verify <change-id>
//
// args: { changeId: string, projectRoot: string, changeDir?: string, writeSnapshot?: boolean }

export const meta = {
  name: 'steadyspec-verify',
  description: 'SteadySpec verify verb as deterministic workflow - trust checkpoint for intent, evidence, ownership, risk routing, debt visibility, and next safest action',
  phases: [
    { title: 'Gather', detail: 'Read change artifacts, ledger, evidence, and current changed files' },
    { title: 'CrossReview', detail: 'Consume existing cross-review policy and claim state without reviewer launch' },
    { title: 'Intent', detail: 'Review output against original intent and boundary' },
    { title: 'Evidence', detail: 'Check proof signal credibility and coverage limits' },
    { title: 'Responsibility', detail: 'Review decision ownership and risk routing' },
    { title: 'Handoff', detail: 'Create handoff snapshot when requested or recommended' },
    { title: 'Report', detail: 'Report checkpoint result and next safest action' },
  ],
}

const EVIDENCE_SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    status: { type: 'string', enum: ['absent', 'present', 'unreadable'] },
    content: { type: 'string' },
    complete: { type: 'boolean' },
    truncated: { type: 'boolean' },
    readError: { type: 'string' },
  },
  required: ['path', 'status', 'content', 'complete', 'truncated', 'readError'],
}

const CROSS_REVIEW_STATE_SCHEMA = {
  type: 'object',
  properties: {
    configReadStatus: { type: 'string', enum: ['absent', 'present', 'unreadable'] },
    configMode: { type: 'string', enum: ['default', 'off', 'manual', 'advisory', 'gated', 'unknown'] },
    reviewer: { type: 'string', enum: ['claude', 'codex', 'unknown'] },
    packetOnly: { type: 'boolean' },
    artifactDirs: { type: 'array', items: { type: 'string' } },
    explicitClaimSources: { type: 'array', items: { type: 'string' } },
    claimRequired: { type: 'boolean' },
    claimScope: {
      type: 'object',
      properties: {
        complete: { type: 'boolean' },
        reviewer: { type: 'string' },
        mode: { type: 'string' },
        includeDiff: { type: 'boolean' },
        packetOnly: { type: 'boolean' },
        outputDir: { type: 'string' },
      },
      required: ['complete', 'reviewer', 'mode', 'includeDiff', 'packetOnly', 'outputDir'],
    },
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['configReadStatus', 'configMode', 'reviewer', 'packetOnly', 'artifactDirs', 'explicitClaimSources', 'claimRequired', 'claimScope', 'errors'],
}

const CROSS_REVIEW_EXEC_SCHEMA = {
  type: 'object',
  properties: {
    executedArgv: { type: 'array', items: { type: 'string' } },
    exitCode: { type: 'number' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    reviewerLaunched: { type: 'boolean' },
    moderationWritten: { type: 'boolean' },
  },
  required: ['executedArgv', 'exitCode', 'stdout', 'stderr', 'reviewerLaunched', 'moderationWritten'],
}

const VERIFY_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    changeDir: { type: 'string' },
    substrate: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    proposalPath: { type: 'string' },
    evidencePath: { type: 'string' },
    checkpointPath: { type: 'string' },
    handoffPath: { type: 'string' },
    intent: { type: 'string' },
    boundary: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    evidenceRequired: { type: 'array', items: { type: 'string' } },
    completedSlices: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    ledgerEntries: { type: 'array', items: { type: 'string' } },
    pendingUserDecisions: { type: 'array', items: { type: 'string' } },
    debtAndFallback: { type: 'array', items: { type: 'string' } },
    driftEvents: { type: 'array', items: { type: 'string' } },
    evidenceSource: EVIDENCE_SOURCE_SCHEMA,
    crossReviewState: CROSS_REVIEW_STATE_SCHEMA,
  },
  required: ['changeId', 'proposalPath', 'evidencePath', 'intent', 'completedSlices', 'ledgerEntries', 'evidenceSource', 'crossReviewState'],
}

const TRUST_CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    intentMatch: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    evidenceCredibility: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    riskRoutingReview: { type: 'string', enum: ['pass', 'misclassified', 'blocked'] },
    debtFallbackVisibility: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    recommendedNext: { type: 'string', enum: ['continue', 'archive', 'handoff', 're-open-intent', 'stop'] },
    mustReadDecisions: { type: 'array', items: { type: 'string' } },
    needsGlance: { type: 'array', items: { type: 'string' } },
    collapsedLedgerCount: { type: 'number' },
    evidenceGaps: { type: 'array', items: { type: 'string' } },
    riskMisclassifications: { type: 'array', items: { type: 'string' } },
    pendingUserDecisions: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: [
    'intentMatch',
    'evidenceCredibility',
    'riskRoutingReview',
    'debtFallbackVisibility',
    'recommendedNext',
    'mustReadDecisions',
    'evidenceGaps',
    'pendingUserDecisions',
    'rationale',
  ],
}

const WRITE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    checkpointWritten: { type: 'boolean' },
    checkpointPath: { type: 'string' },
    handoffWritten: { type: 'boolean' },
    handoffPath: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['checkpointWritten', 'handoffWritten'],
}

const CLOSURE_STATUS_SCHEMA = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    status: { type: 'string' },
    state: { type: 'string' },
    action: { type: 'string' },
    candidateFingerprint: { type: 'string' },
    evidenceBundleFingerprint: { type: 'string' },
    errors: { type: 'array', items: { type: 'string' } },
    residualUnknowns: { type: 'array', items: { type: 'string' } },
  },
  required: ['enabled', 'status', 'action', 'errors', 'residualUnknowns'],
}

// BEGIN CROSS REVIEW PREFLIGHT PURE
const CROSS_REVIEW_FORBIDDEN_FLAGS = ["--run", "--run-if-needed", "--force", "--skip-reason"]

function crossReviewResult(readiness, claimAllowed, mustStopArchive, action, details = {}) {
  return {
    readiness,
    claimAllowed,
    mustStopArchive,
    action,
    status: details.status || "",
    runJson: details.runJson || "",
    moderationPath: details.moderationPath || "",
    warnings: [...(details.warnings || [])],
    errors: [...(details.errors || [])],
    traces: [...(details.traces || [])],
  }
}

function crossReviewArgvEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function crossReviewArgvIsReadOnly(argv) {
  return Array.isArray(argv) && !argv.some((value) => CROSS_REVIEW_FORBIDDEN_FLAGS.includes(value) || String(value).startsWith("--experimental-"))
}

const CROSS_REVIEW_UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/
const CROSS_REVIEW_WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const CROSS_REVIEW_WINDOWS_ILLEGAL = /[<>:"|?*]/

function crossReviewCanonicalKey(value) {
  return String(value || "").toLowerCase()
}

function crossReviewHostPlatform(explicitPlatform) {
  const observed = explicitPlatform || (typeof process !== "undefined" && process && process.platform) || "unknown"
  return observed === "win32" ? "win32" : observed === "posix" || observed === "linux" || observed === "darwin" ? "posix" : "unknown"
}

function crossReviewWindowsSegmentSafe(part) {
  return !!part
    && part !== "."
    && part !== ".."
    && !CROSS_REVIEW_WINDOWS_ILLEGAL.test(part)
    && !/[. ]$/.test(part)
    && !CROSS_REVIEW_WINDOWS_RESERVED.test(part)
}

function canonicalizeCrossReviewHostRoot(value, explicitPlatform) {
  const platform = crossReviewHostPlatform(explicitPlatform)
  if (typeof value !== "string" || !value || value.trim() !== value || CROSS_REVIEW_UNSAFE_TEXT.test(value)) {
    return { ok: false, raw: typeof value === "string" ? value : "", canonical: "", platform, reason: "host-root-invalid-text" }
  }
  if (platform === "win32") {
    if (!/^[A-Za-z]:\\/.test(value) || value.includes("/")) return { ok: false, raw: value, canonical: "", platform, reason: "host-root-not-windows-native-absolute" }
    const parts = value.slice(3).split("\\").filter(Boolean)
    if (parts.some((part) => !crossReviewWindowsSegmentSafe(part))) return { ok: false, raw: value, canonical: "", platform, reason: "host-root-windows-segment-invalid" }
    const canonical = value.length > 3 ? value.replace(/\\+$/, "") : value
    return { ok: true, raw: value, canonical, platform, reason: "windows-native-absolute" }
  }
  if (platform === "posix") {
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("//")) return { ok: false, raw: value, canonical: "", platform, reason: "host-root-not-posix-native-absolute" }
    const parts = value.split("/").filter(Boolean)
    if (parts.some((part) => part === "." || part === "..")) return { ok: false, raw: value, canonical: "", platform, reason: "host-root-posix-segment-invalid" }
    return { ok: true, raw: value, canonical: value.length > 1 ? value.replace(/\/+$/, "") : value, platform, reason: "posix-native-absolute" }
  }
  return { ok: false, raw: value, canonical: "", platform, reason: "host-platform-unsupported" }
}

function crossReviewExpectedOutputParent(projectRoot, canonicalOutputDir, explicitPlatform) {
  const root = canonicalizeCrossReviewHostRoot(projectRoot, explicitPlatform)
  if (!root.ok) return { ...root, absolute: "" }
  const separator = root.platform === "win32" ? "\\" : "/"
  const relative = String(canonicalOutputDir || "").split("/").join(separator)
  return { ok: true, platform: root.platform, absolute: `${root.canonical}${root.canonical.endsWith(separator) ? "" : separator}${relative}`, reason: "output-parent-bound-to-project-root" }
}

function canonicalizeCrossReviewDeclaredPath(value, domain) {
  if (typeof value !== "string") return { ok: false, raw: "", canonical: "", domain, reason: "path-not-string" }
  const raw = value
  if (!raw || raw.trim() !== raw) return { ok: false, raw, canonical: "", domain, reason: "path-empty-or-surrounding-whitespace" }
  if (CROSS_REVIEW_UNSAFE_TEXT.test(raw) || raw.includes("%")) return { ok: false, raw, canonical: "", domain, reason: "path-control-or-encoded-character" }
  if (raw.startsWith("~") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || /^[\\/]/.test(raw)) {
    return { ok: false, raw, canonical: "", domain, reason: "path-must-be-relative" }
  }
  const parts = []
  for (const part of raw.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue
    if (part === "..") return { ok: false, raw, canonical: "", domain, reason: "path-traversal" }
    if (CROSS_REVIEW_WINDOWS_ILLEGAL.test(part)) return { ok: false, raw, canonical: "", domain, reason: "path-windows-illegal-character" }
    if (/[. ]$/.test(part) || CROSS_REVIEW_WINDOWS_RESERVED.test(part)) {
      return { ok: false, raw, canonical: "", domain, reason: "path-windows-alias-form" }
    }
    parts.push(part)
  }
  if (parts.length === 0) return { ok: false, raw, canonical: "", domain, reason: "path-empty-after-canonicalization" }
  return { ok: true, raw, canonical: parts.join("/"), domain, reason: "canonical-relative-path" }
}

function crossReviewRunJsonIdentity(value, expectedOutputParent = "", explicitPlatform = "") {
  const absolute = canonicalizeCrossReviewHostRoot(value, explicitPlatform)
  if (!absolute.ok) return { ok: false, raw: typeof value === "string" ? value : "", reason: absolute.reason }
  const separator = absolute.platform === "win32" ? "\\" : "/"
  const segments = value.split(separator).filter(Boolean)
  if (segments[segments.length - 1] !== "run.json") return { ok: false, raw: value, reason: "run-json-exact-basename-required" }
  if (expectedOutputParent) {
    const expected = canonicalizeCrossReviewHostRoot(expectedOutputParent, absolute.platform === "win32" ? "win32" : "linux")
    if (!expected.ok || expected.canonical !== expectedOutputParent) return { ok: false, raw: value, reason: "run-json-expected-output-parent-invalid" }
    const prefix = `${expectedOutputParent}${expectedOutputParent.endsWith(separator) ? "" : separator}`
    if (!value.startsWith(prefix)) return { ok: false, raw: value, reason: "run-json-outside-declared-output-parent" }
    const tail = value.slice(prefix.length).split(separator)
    if (tail.length !== 2 || !tail[0] || tail[1] !== "run.json") return { ok: false, raw: value, reason: "run-json-not-direct-run-child" }
  }
  return { ok: true, raw: value, platform: absolute.platform, reason: `${absolute.platform}-native-absolute` }
}

function buildCrossReviewCommandPlan(changeRef, rawState, projectRoot) {
  const state = rawState || {}
  const claimScope = state.claimScope || {}
  const claimRequired = state.claimRequired === true
  const configMode = String(state.configMode || "unknown")
  const rawClaimSources = Array.isArray(state.explicitClaimSources) ? state.explicitClaimSources : []
  const claimSourcePaths = rawClaimSources.map((value) => canonicalizeCrossReviewDeclaredPath(value, "change-source"))
  const claimSources = claimSourcePaths.filter((entry) => entry.ok).map((entry) => entry.canonical)
  const warnings = []
  const plan = { claimRequired, claimSources: [...new Set(claimSources)], configMode, commands: [], warnings, precondition: null }

  const changePath = canonicalizeCrossReviewDeclaredPath(changeRef, "repo-change")
  if (!changePath.ok) {
    plan.precondition = crossReviewResult("invalid", false, true, "change-reference-invalid", { errors: [`cross-review change reference is invalid: ${changePath.reason}`] })
    return plan
  }
  if (state.configReadStatus === "unreadable" || (state.errors || []).length > 0 || configMode === "unknown") {
    plan.precondition = crossReviewResult("invalid", false, true, "cross-review-config-unreadable", { errors: state.errors || ["cross-review config is unreadable"] })
    return plan
  }
  if (claimRequired !== (rawClaimSources.length > 0)) {
    plan.precondition = crossReviewResult("invalid", false, true, "claim-source-state-mismatch", { errors: ["claimRequired and explicitClaimSources disagree"] })
    return plan
  }
  const claimSourceKeys = claimSources.map(crossReviewCanonicalKey)
  if (claimSourcePaths.some((entry) => !entry.ok) || new Set(claimSourceKeys).size !== claimSources.length) {
    plan.precondition = crossReviewResult("invalid", false, true, "claim-source-state-ambiguous", { errors: ["explicitClaimSources must contain unique canonical change-relative paths"] })
    return plan
  }
  if (!claimRequired && (state.artifactDirs || []).length > 0) {
    warnings.push("unbound-existing-cross-review-artifacts")
  }

  const base = ["steadyspec", "cross-review", "--change", changePath.canonical]
  if (claimRequired) {
    const outputDirPath = canonicalizeCrossReviewDeclaredPath(claimScope.outputDir, "repo-output")
    const outputParent = outputDirPath.ok ? crossReviewExpectedOutputParent(projectRoot, outputDirPath.canonical) : { ok: false, absolute: "", platform: "unknown" }
    const rawArtifactDirs = Array.isArray(state.artifactDirs) ? state.artifactDirs : []
    const artifactDirPaths = rawArtifactDirs.map((value) => canonicalizeCrossReviewDeclaredPath(value, "repo-artifact-parent"))
    const scopeComplete = claimScope.complete === true
      && ["claude", "codex"].includes(claimScope.reviewer)
      && claimScope.mode === "review"
      && claimScope.includeDiff === true
      && typeof claimScope.packetOnly === "boolean"
      && outputDirPath.ok
      && outputParent.ok
      && rawArtifactDirs.length === 1
      && artifactDirPaths.every((entry) => entry.ok)
      && artifactDirPaths.length === 1
      && artifactDirPaths[0].canonical === outputDirPath.canonical
    if (!scopeComplete) {
      plan.precondition = crossReviewResult("claim-blocked", false, true, "claim-scope-unavailable", {
        errors: ["explicit cross-review claim lacks an exact review/include-diff/reviewer/packet-only/output-dir scope"],
      })
      return plan
    }
    const scoped = [
      ...base,
      "--reviewer", claimScope.reviewer,
      "--mode", "review",
      "--include-diff",
      claimScope.packetOnly ? "--packet-only" : "--no-packet-only",
      "--output-dir", outputDirPath.canonical,
    ]
    plan.commands.push({ kind: "check-latest", expectedConfigMode: null, expectedOutputParent: outputParent.absolute, hostPlatform: outputParent.platform, argv: [...scoped, "--check-latest", "--json"] })
    plan.commands.push({ kind: configMode === "gated" ? "gate" : "advice", expectedConfigMode: configMode, expectedOutputParent: outputParent.absolute, hostPlatform: outputParent.platform, argv: [...scoped, configMode === "gated" ? "--gate" : "--advice", "--json"] })
  } else {
    const policyArgv = [...base, "--mode", "review", "--include-diff"]
    plan.commands.push({ kind: configMode === "gated" ? "gate" : "advice", expectedConfigMode: configMode, expectedOutputParent: "", hostPlatform: crossReviewHostPlatform(), argv: [...policyArgv, configMode === "gated" ? "--gate" : "--advice", "--json"] })
  }

  if (plan.commands.some((command) => !crossReviewArgvIsReadOnly(command.argv))) {
    plan.commands = []
    plan.precondition = crossReviewResult("invalid", false, true, "non-read-only-command-plan", { errors: ["cross-review preflight planned a reviewer-launch or mutation flag"] })
  }
  return plan
}

function parseCrossReviewExecution(expectedCommand, execution) {
  const trace = {
    kind: expectedCommand && expectedCommand.kind || "",
    argv: expectedCommand && expectedCommand.argv || [],
    exitCode: execution && execution.exitCode,
    status: "",
    action: "",
    latestStatus: "",
    latestExitCode: null,
    runJson: "",
    parentDir: "",
    moderationPath: "",
    warnings: [],
    errors: [],
  }
  const errors = []
  if (!expectedCommand || !crossReviewArgvIsReadOnly(expectedCommand.argv)) errors.push("invalid-expected-command")
  if (!execution || !crossReviewArgvEqual(expectedCommand && expectedCommand.argv, execution && execution.executedArgv)) errors.push("executed-argv-mismatch")
  if (execution && !crossReviewArgvIsReadOnly(execution.executedArgv)) errors.push("executed-non-read-only-command")
  if (execution && (execution.reviewerLaunched || execution.moderationWritten)) errors.push("cross-review-preflight-side-effect")
  if (execution && String(execution.stderr || "").trim()) errors.push("cross-review-preflight-stderr")
  let json = null
  try {
    json = JSON.parse(String(execution && execution.stdout || ""))
  } catch (error) {
    errors.push("cross-review-json-unparseable")
  }
  if (!json || typeof json !== "object" || Array.isArray(json) || json.schemaVersion !== 1) errors.push("cross-review-json-schema-mismatch")
  if (json && expectedCommand && expectedCommand.kind === "advice") {
    if (execution.exitCode !== 0) errors.push("advice-exit-mismatch")
    if (json.exitCode !== undefined && Number(json.exitCode) !== Number(execution.exitCode)) errors.push("cross-review-json-exit-mismatch")
  } else if (json && Number(json.exitCode) !== Number(execution && execution.exitCode)) {
    errors.push("cross-review-json-exit-mismatch")
  }
  if (json && expectedCommand && ["advice", "gate"].includes(expectedCommand.kind)) {
    if (String(json.configMode || "") !== String(expectedCommand.expectedConfigMode || "")) errors.push("cross-review-config-mode-drift")
    if (expectedCommand.expectedConfigMode === "gated" && ["off", "not-enforced"].includes(String(json.status || ""))) {
      errors.push("gated-policy-observation-not-enforced")
    }
  }
  if (json) {
    trace.status = String(json.status || "")
    trace.action = String(json.action || "")
    const latestObject = json.latest && typeof json.latest === "object" && !Array.isArray(json.latest) ? json.latest : null
    trace.latestStatus = String(latestObject && latestObject.status || "")
    trace.latestExitCode = latestObject && Number.isFinite(latestObject.exitCode) ? latestObject.exitCode : null
    if (expectedCommand && expectedCommand.kind === "check-latest") {
      if (latestObject && Object.prototype.hasOwnProperty.call(latestObject, "runJson")) errors.push("check-latest-nested-run-json-forbidden")
      trace.runJson = String(json.runJson || "")
      trace.parentDir = String(json.parentDir || "")
      trace.moderationPath = String(json.moderationPath || "")
    } else if (expectedCommand && expectedCommand.kind === "gate") {
      if (Object.prototype.hasOwnProperty.call(json, "runJson")) errors.push("gate-top-level-run-json-forbidden")
      trace.runJson = String(latestObject && latestObject.runJson || "")
      trace.parentDir = String(latestObject && latestObject.parentDir || "")
      trace.moderationPath = String(latestObject && latestObject.moderationPath || "")
    }
    trace.warnings = Array.isArray(json.warnings) ? json.warnings.map(String) : []
    trace.errors = Array.isArray(json.errors) ? json.errors.map(String) : []
  }
  if (expectedCommand && expectedCommand.expectedOutputParent && (trace.runJson || trace.parentDir) && trace.parentDir !== expectedCommand.expectedOutputParent) errors.push("cross-review-output-parent-drift")
  if (trace.runJson && !crossReviewRunJsonIdentity(trace.runJson, expectedCommand && expectedCommand.expectedOutputParent || "", expectedCommand && expectedCommand.hostPlatform || "").ok) errors.push("cross-review-run-json-identity-invalid")
  trace.errors.push(...errors)
  return { valid: errors.length === 0, kind: expectedCommand && expectedCommand.kind || "", exitCode: execution && execution.exitCode, json, trace, errors }
}

function mapCrossReviewObservation(parsed) {
  if (!parsed || !parsed.valid) {
    return crossReviewResult("invalid", false, true, "invalid-cross-review-observation", { errors: parsed && parsed.errors || ["missing cross-review observation"], traces: parsed && parsed.trace ? [parsed.trace] : [] })
  }
  const json = parsed.json
  const details = {
    status: String(json.status || ""),
    latestStatus: parsed.trace.latestStatus,
    latestExitCode: parsed.trace.latestExitCode,
    runJson: parsed.trace.runJson,
    moderationPath: parsed.trace.moderationPath,
    warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
    errors: Array.isArray(json.errors) ? json.errors.map(String) : [],
    traces: [parsed.trace],
  }
  if (parsed.kind === "advice") {
    const allowed = ["off", "manual", "manual-recommendation", "recommended", "not-recommended"]
    if (parsed.exitCode !== 0 || !allowed.includes(json.status)) return crossReviewResult("invalid", false, false, "invalid-advice-result", details)
    return crossReviewResult("not-required", false, false, json.recommended ? "advisory-recommended" : "advisory-observed", details)
  }
  if (parsed.kind === "gate") {
    if (json.status === "satisfied" && parsed.exitCode === 0 && details.runJson && details.latestStatus === "pass" && details.latestExitCode === 0) return crossReviewResult("ready", true, false, "gate-satisfied", details)
    if (json.status === "satisfied-with-warning" && parsed.exitCode === 0 && details.runJson && details.latestStatus === "pass-with-warning" && details.latestExitCode === 1) return crossReviewResult("ready-with-warning", true, false, "gate-satisfied-with-warning", details)
    if (json.status === "needs-user" && parsed.exitCode === 5) return crossReviewResult("needs-user", false, true, "user-confirmation-required", details)
    if (json.status === "blocked" && parsed.exitCode === 5 && json.action === "moderation-required") return crossReviewResult("moderation-required", false, true, "moderation-required", details)
    if (json.status === "blocked" && parsed.exitCode === 5) return crossReviewResult("claim-blocked", false, true, "gate-blocked", details)
    if (["off", "not-enforced", "not-required"].includes(json.status) && parsed.exitCode === 0) return crossReviewResult("not-required", false, false, `gate-${json.status}`, details)
    return crossReviewResult("invalid", false, true, "invalid-gate-result", details)
  }
  if (parsed.kind === "check-latest") {
    const needsUser = Number(json.moderationP12NeedsUserRows || 0) > 0
      || Number(json.reviewerP12NeedsUserRows || 0) > 0
      || (json.moderationMissingP12FindingIds || []).length > 0
    if (needsUser) return crossReviewResult("needs-user", false, true, "user-confirmation-required", details)
    if (json.status === "pass" && parsed.exitCode === 0 && details.runJson) return crossReviewResult("ready", true, false, "latest-pass", details)
    if (json.status === "pass-with-warning" && parsed.exitCode === 1 && details.runJson) return crossReviewResult("claim-blocked", false, true, "warning-policy-requires-gate", details)
    if (json.status === "failed" && parsed.exitCode === 4) return crossReviewResult("moderation-required", false, true, "moderation-required", details)
    if (["no-run", "dry-run-only", "skipped"].includes(json.status) && parsed.exitCode === 2) return crossReviewResult("claim-blocked", false, true, "latest-missing-or-unusable", details)
    if (json.status === "failed" && parsed.exitCode === 3) {
      const unstructured = details.errors.some((error) => /unstructured|output format/i.test(error))
      return crossReviewResult("claim-blocked", false, true, unstructured ? "latest-unstructured" : "latest-failed", details)
    }
    return crossReviewResult("invalid", false, true, "invalid-check-latest-result", details)
  }
  return crossReviewResult("invalid", false, true, "unknown-cross-review-command-kind", details)
}

function combineCrossReviewObservations(plan, parsedObservations) {
  if (plan.precondition) return { ...plan.precondition, traces: [], warnings: [...plan.warnings, ...(plan.precondition.warnings || [])] }
  if (!Array.isArray(parsedObservations)
    || parsedObservations.length !== plan.commands.length
    || parsedObservations.some((entry, index) => !entry || entry.kind !== plan.commands[index].kind)) {
    return crossReviewResult("invalid", false, plan.claimRequired || plan.configMode === "gated", "cross-review-observation-set-mismatch", {
      warnings: plan.warnings,
      errors: ["cross-review observations must match the planned command count, order, and kind exactly"],
      traces: Array.isArray(parsedObservations) ? parsedObservations.flatMap((entry) => entry && entry.trace ? [entry.trace] : []) : [],
    })
  }
  const mapped = (parsedObservations || []).map(mapCrossReviewObservation)
  const traces = mapped.flatMap((entry) => entry.traces || [])
  const warnings = [...(plan.warnings || []), ...mapped.flatMap((entry) => entry.warnings || [])]
  const errors = mapped.flatMap((entry) => entry.errors || [])
  const invalid = mapped.find((entry) => entry.readiness === "invalid")
  if (invalid) {
    return crossReviewResult("invalid", false, plan.claimRequired || plan.configMode === "gated", invalid.action, { warnings, errors, traces })
  }
  const needsUser = mapped.find((entry) => entry.readiness === "needs-user")
  if (needsUser) return crossReviewResult("needs-user", false, true, needsUser.action, { ...needsUser, warnings, errors, traces })
  const moderation = mapped.find((entry) => entry.readiness === "moderation-required")
  if (moderation) return crossReviewResult("moderation-required", false, true, moderation.action, { ...moderation, warnings, errors, traces })

  const check = mapped.find((entry, index) => plan.commands[index] && plan.commands[index].kind === "check-latest")
  const gate = mapped.find((entry, index) => plan.commands[index] && plan.commands[index].kind === "gate")
  const policy = gate || mapped.find((entry, index) => plan.commands[index] && plan.commands[index].kind === "advice")

  if (plan.claimRequired) {
    if (check && check.readiness === "claim-blocked") {
      if (gate && ["ready", "ready-with-warning"].includes(gate.readiness) && check.status === "pass-with-warning") {
        if (check.runJson !== gate.runJson) return crossReviewResult("invalid", false, true, "cross-review-observation-trace-drift", { warnings, errors: [...errors, "check-latest and gate observed different run.json identities"], traces })
        return crossReviewResult(gate.readiness, true, false, gate.action, { ...gate, warnings, errors, traces })
      }
      return crossReviewResult("claim-blocked", false, true, check.action, { ...check, warnings, errors, traces })
    }
    if (!check || !check.claimAllowed) return crossReviewResult("claim-blocked", false, true, "claim-check-not-ready", { warnings, errors, traces })
    if (gate && ["claim-blocked", "invalid"].includes(gate.readiness)) return crossReviewResult(gate.readiness, false, true, gate.action, { ...gate, warnings, errors, traces })
    if (gate && ["ready", "ready-with-warning"].includes(gate.readiness)) {
      if (check.runJson !== gate.runJson) return crossReviewResult("invalid", false, true, "cross-review-observation-trace-drift", { warnings, errors: [...errors, "check-latest and gate observed different run.json identities"], traces })
      return crossReviewResult(gate.readiness, true, false, gate.action, { ...gate, warnings, errors, traces })
    }
    return crossReviewResult(check.readiness, true, false, check.action, { ...check, warnings, errors, traces })
  }

  if (!policy) return crossReviewResult("invalid", false, plan.configMode === "gated", "policy-observation-missing", { warnings, errors, traces })
  return crossReviewResult(policy.readiness, policy.claimAllowed, plan.configMode === "gated" && !["ready", "ready-with-warning", "not-required"].includes(policy.readiness), policy.action, { ...policy, warnings, errors, traces })
}

function crossReviewVerifyDecision(preflight, recommendedNext) {
  if (preflight.readiness === "needs-user") return { recommendedNext: "stop", evidenceCredibility: "blocked", gap: "cross-review-needs-user" }
  if (["moderation-required", "invalid"].includes(preflight.readiness)) return { recommendedNext: "stop", evidenceCredibility: "blocked", gap: `cross-review-${preflight.readiness}` }
  if (preflight.mustStopArchive || !preflight.claimAllowed && preflight.readiness === "claim-blocked") {
    return { recommendedNext: recommendedNext === "archive" ? "continue" : recommendedNext, evidenceCredibility: "gap", gap: `cross-review-${preflight.readiness}` }
  }
  return { recommendedNext, evidenceCredibility: null, gap: null }
}

const CROSS_REVIEW_CLAIM_BEGIN = "<!-- steadyspec:cross-review-claim:v1:begin -->"
const CROSS_REVIEW_CLAIM_END = "<!-- steadyspec:cross-review-claim:v1:end -->"

function buildCrossReviewArchiveClaimBlock(preflight, claimRequired) {
  if (claimRequired && (!preflight || !preflight.claimAllowed || !preflight.runJson)) {
    return { ok: false, reason: "required-cross-review-claim-not-ready", envelope: null, markdown: "" }
  }
  const included = claimRequired === true
  const envelope = {
    schemaVersion: 1,
    claimType: "steadyspec.cross-review.readiness",
    included,
    readiness: included ? preflight.readiness : "not-claimed",
    runJson: included ? preflight.runJson : null,
    authority: "auxiliary-evidence-only",
  }
  if (included && (!["ready", "ready-with-warning"].includes(envelope.readiness) || !crossReviewRunJsonIdentity(envelope.runJson).ok)) {
    return { ok: false, reason: "required-cross-review-claim-envelope-invalid", envelope: null, markdown: "" }
  }
  const markdown = [
    CROSS_REVIEW_CLAIM_BEGIN,
    "## Cross-Review Claim",
    `- Claim Type: ${envelope.claimType}`,
    `- Included: ${included ? "yes" : "no"}`,
    `- Readiness: ${envelope.readiness}`,
    `- Run JSON: ${envelope.runJson === null ? "None" : JSON.stringify(envelope.runJson)}`,
    "- Authority: Auxiliary review evidence only; not human acceptance, truth, merge, or release authority.",
    CROSS_REVIEW_CLAIM_END,
  ].join("\n")
  return { ok: true, reason: included ? "claim-bound-to-exact-trace" : "claim-not-included", envelope, markdown }
}
// END CROSS REVIEW PREFLIGHT PURE

// BEGIN EVIDENCE CONTINUITY PURE
const EVIDENCE_REQUIRED_FIELDS = [
  "proofCommand",
  "result",
  "outputSummary",
  "coverageLimit",
  "linkedDecisionIds",
  "fallback",
  "acceptedDebt",
]
const EVIDENCE_RESULT_VALUES = ["pass", "fail", "drift", "fallback", "blocked"]

function validateEvidenceSource(source) {
  const normalized = {
    path: source && typeof source.path === "string" ? source.path : "",
    status: source && typeof source.status === "string" ? source.status : "unreadable",
    content: source && typeof source.content === "string" ? source.content : "",
    complete: Boolean(source && source.complete === true),
    truncated: Boolean(source && source.truncated === true),
    readError: source && typeof source.readError === "string" ? source.readError : "",
  }
  const errors = []
  if (!["absent", "present", "unreadable"].includes(normalized.status)) errors.push("invalid-evidence-source-status")
  if (normalized.status === "absent" && (normalized.content !== "" || !normalized.complete || normalized.truncated)) {
    errors.push("invalid-absent-evidence-source")
  }
  if (normalized.status === "present" && (!normalized.complete || normalized.truncated)) {
    errors.push("incomplete-evidence-source")
  }
  if (normalized.status === "unreadable") errors.push("unreadable-evidence-source")
  return { ok: errors.length === 0, source: normalized, errors }
}

function normalizeEvidencePathIdentity(value) {
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/")
  const prefix = text.match(/^[A-Za-z]:\//) ? text.slice(0, 3) : (text.startsWith("/") ? "/" : "")
  const body = prefix ? text.slice(prefix.length) : text
  const parts = []
  for (const part of body.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) return ""
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const normalized = `${prefix}${parts.join("/")}`
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function evidenceSourcePathPolicy(source, expectedEvidencePath, proposalPath) {
  const sourcePath = normalizeEvidencePathIdentity(source && source.path)
  const expectedPath = normalizeEvidencePathIdentity(expectedEvidencePath)
  const normalizedProposal = normalizeEvidencePathIdentity(proposalPath)
  const derivedPath = /\/proposal\.md$/i.test(normalizedProposal)
    ? normalizedProposal.replace(/\/proposal\.md$/i, "/evidence.md")
    : ""
  const errors = []
  if (!sourcePath) errors.push("evidence-source-path-missing")
  if (!expectedPath) errors.push("expected-evidence-path-missing")
  if (!derivedPath) errors.push("proposal-path-does-not-identify-evidence")
  if (sourcePath && expectedPath && sourcePath !== expectedPath) errors.push("evidence-source-path-mismatch")
  if (expectedPath && derivedPath && expectedPath !== derivedPath) errors.push("evidence-target-path-mismatch")
  return { ok: errors.length === 0, sourcePath, expectedPath, derivedPath, errors }
}

function splitMarkdownRow(line) {
  const text = String(line || "").trim()
  if (!text.startsWith("|") || !text.endsWith("|")) return []
  const cells = []
  let cell = ""
  let escaped = false
  for (let i = 1; i < text.length - 1; i += 1) {
    const character = text[i]
    if (character === "|" && !escaped) {
      cells.push(cell.trim())
      cell = ""
      continue
    }
    cell += character
    if (character === "\\") escaped = !escaped
    else escaped = false
  }
  cells.push(cell.trim())
  return cells
}

function decodeEvidenceCell(value) {
  const text = String(value || "")
  if (!text.startsWith("uri:")) return text
  try {
    return decodeURIComponent(text.slice(4))
  } catch (error) {
    return "evidence-migration-unavailable:invalid-cell-encoding"
  }
}

function encodeEvidenceCell(value) {
  return `uri:${encodeURIComponent(String(value === undefined || value === null || value === "" ? "None" : value))}`
}

function decodeEvidenceCellForView(value, view, location) {
  const text = String(value || "")
  if (!text.startsWith("uri:")) {
    view.gaps.push(`evidence-migration-unavailable:legacy-cell-encoding@${location}`)
    return text
  }
  const decoded = decodeEvidenceCell(text)
  if (decoded.includes("evidence-migration-unavailable:invalid-cell-encoding")) {
    view.blockingErrors.push(`invalid-evidence-cell-encoding@${location}`)
  }
  return decoded
}

function parseEvidenceEvents(text, heading, fields, view) {
  const marker = `## ${heading}`
  const start = text.indexOf(marker)
  if (start < 0) return []
  const bodyStart = start + marker.length
  const remainder = text.slice(bodyStart)
  const nextHeading = remainder.search(/^## /m)
  const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder
  const events = []
  for (const line of section.split(/\r?\n/)) {
    const cells = splitMarkdownRow(line)
    if (!String(line || "").trim().startsWith("|")) continue
    if (cells[0] && (cells[0].toLowerCase() === fields[0].toLowerCase() || /^-+$/.test(cells[0]) || cells[0] === "None")) continue
    if (cells.length !== fields.length) {
      view.blockingErrors.push(`malformed-evidence-event-row:${heading}`)
      continue
    }
    const event = {}
    fields.forEach((field, index) => { event[field] = decodeEvidenceCellForView(cells[index], view, `${heading}:${field}`) })
    events.push(event)
  }
  return events
}

function parsePreservedEvidence(text, view) {
  const pattern = /<!-- steadyspec-preserved-evidence-json-v1 ([\s\S]*?) -->/g
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1])
      if (!parsed || parsed.encoding !== "json-string-v1" || !Array.isArray(parsed.documents)
          || parsed.documents.some((entry) => typeof entry !== "string")) {
        view.blockingErrors.push("invalid-preserved-evidence-carrier")
        continue
      }
      for (const document of parsed.documents) {
        if (!view.preservedSources.includes(document)) view.preservedSources.push(document)
      }
    } catch (error) {
      view.blockingErrors.push("unreadable-preserved-evidence-carrier")
    }
  }
}

function normalizeEvidenceDocument(source) {
  const checked = validateEvidenceSource(source)
  const view = {
    schemaVersion: 1,
    sourceStatus: checked.source.status,
    sourceFormat: checked.source.status === "absent" ? "absent" : "unknown",
    sourceText: checked.source.content,
    sourcePath: checked.source.path,
    slices: [],
    driftEvents: [],
    reSliceEvents: [],
    preservedSources: [],
    gaps: [],
    warnings: [],
    conflicts: [],
    blockingErrors: [...checked.errors],
  }
  if (checked.source.status === "absent") {
    view.gaps.push("evidence-migration-unavailable:no-evidence-source")
    return view
  }
  if (checked.source.status !== "present" || !checked.ok) {
    view.gaps.push("evidence-migration-unavailable:source-unreadable-or-incomplete")
    return view
  }

  const parseText = checked.source.content.replace(/^\uFEFF/, "")
  parsePreservedEvidence(parseText, view)
  const sliceMatches = [...parseText.matchAll(/^## Slice ([^:\r\n]+):[ \t]*(.*)$/gm)]
  const hasCanonicalTable = parseText.includes("| Field | Value |") && sliceMatches.length > 0
  if (!hasCanonicalTable) {
    view.sourceFormat = "legacy-freeform"
    if (!view.preservedSources.includes(checked.source.content)) view.preservedSources.push(checked.source.content)
    view.gaps.push("evidence-migration-unavailable:legacy-freeform-fields")
    return view
  }

  const seenIndices = new Set()
  for (const match of sliceMatches) {
    const sectionStart = match.index + match[0].length
    const remainder = parseText.slice(sectionStart)
    const nextHeading = remainder.search(/^## /m)
    const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder
    const rows = {}
    for (const line of section.split(/\r?\n/)) {
      const cells = splitMarkdownRow(line)
      if (cells.length !== 2 || cells[0] === "Field" || /^-+$/.test(cells[0])) continue
      rows[cells[0]] = decodeEvidenceCellForView(cells[1], view, `slice-${String(match[1]).trim()}:${cells[0]}`)
    }
    const sliceIndex = String(match[1]).trim()
    const entry = {
      sliceIndex,
      behavior: decodeEvidenceCellForView(String(match[2] || "").trim(), view, `slice-${sliceIndex}:behavior`),
      proofCommand: rows["Proof Command"],
      result: rows.Result,
      outputSummary: rows["Output Summary"],
      coverageLimit: rows["Coverage Limit"],
      linkedDecisionIds: rows["Linked Decisions"],
      fallback: rows.Fallback,
      acceptedDebt: rows["Accepted Debt"],
    }
    if (!sliceIndex || seenIndices.has(sliceIndex)) {
      view.blockingErrors.push(`duplicate-or-missing-slice-index:${sliceIndex || "unknown"}`)
      continue
    }
    seenIndices.add(sliceIndex)
    if (!entry.behavior) {
      entry.behavior = "evidence-migration-unavailable"
      view.gaps.push(`evidence-migration-unavailable:behavior@slice-${sliceIndex}`)
      view.blockingErrors.push(`malformed-canonical-slice:${sliceIndex}`)
    }
    for (const field of EVIDENCE_REQUIRED_FIELDS) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) {
        entry[field] = `evidence-migration-unavailable:${field}`
        view.gaps.push(`evidence-migration-unavailable:${field}@slice-${sliceIndex}`)
        view.blockingErrors.push(`malformed-canonical-slice:${sliceIndex}`)
      }
    }
    if (!EVIDENCE_RESULT_VALUES.includes(entry.result)) {
      view.gaps.push(`evidence-migration-unavailable:invalid-result@slice-${sliceIndex}`)
      view.blockingErrors.push(`malformed-canonical-result:${sliceIndex}`)
    }
    view.slices.push(entry)
  }
  view.driftEvents = parseEvidenceEvents(parseText, "Drift Event Log", ["timestamp", "slice", "type", "action"], view)
  view.reSliceEvents = parseEvidenceEvents(parseText, "Re-slice Event Log", ["timestamp", "slice", "type", "risk", "owner", "impact"], view)
  view.sourceFormat = view.preservedSources.length > 0 ? "mixed" : "canonical-v1"
  const changeIdMatch = parseText.match(/^# Evidence Record:\s*(.+)$/m)
  const changeId = changeIdMatch ? changeIdMatch[1].trim() : "change"
  if (renderEvidenceDocument(view, changeId) !== checked.source.content
      && !view.preservedSources.includes(checked.source.content)) {
    view.preservedSources.push(checked.source.content)
    view.gaps.push("evidence-migration-unavailable:unconsumed-source-content")
  }
  view.sourceFormat = view.preservedSources.length > 0 ? "mixed" : "canonical-v1"
  if (view.preservedSources.length > 0 && !view.gaps.includes("evidence-migration-unavailable:preserved-source-fields")) {
    view.gaps.push("evidence-migration-unavailable:preserved-source-fields")
  }
  return view
}

function normalizeEvidenceEntry(entry) {
  const normalized = {
    sliceIndex: String(entry && entry.sliceIndex !== undefined ? entry.sliceIndex : "").trim(),
    behavior: String(entry && entry.behavior !== undefined ? entry.behavior : ""),
  }
  for (const field of EVIDENCE_REQUIRED_FIELDS) {
    normalized[field] = String(entry && entry[field] !== undefined ? entry[field] : "")
  }
  return normalized
}

function evidenceObjectsEqual(left, right, fields) {
  return fields.every((field) => String(left[field]) === String(right[field]))
}

function mergeEvidenceEvents(existing, incoming, fields, keyFields, conflicts, kind) {
  const result = existing.map((entry) => ({ ...entry }))
  let changed = false
  for (const raw of incoming || []) {
    const event = {}
    for (const field of fields) event[field] = String(raw && raw[field] !== undefined ? raw[field] : "")
    if (fields.some((field) => !event[field])) {
      conflicts.push({ kind: `${kind}-invalid`, event })
      continue
    }
    const found = result.find((entry) => keyFields.every((field) => entry[field] === event[field]))
    if (!found) {
      result.push(event)
      changed = true
    } else if (!evidenceObjectsEqual(found, event, fields)) {
      conflicts.push({ kind: `${kind}-conflict`, key: keyFields.map((field) => event[field]).join("|") })
    }
  }
  return { result, changed }
}

function renderEvidenceSlice(entry) {
  return `## Slice ${entry.sliceIndex}: ${encodeEvidenceCell(entry.behavior)}

| Field | Value |
|-------|-------|
| Proof Command | ${encodeEvidenceCell(entry.proofCommand)} |
| Result | ${encodeEvidenceCell(entry.result)} |
| Output Summary | ${encodeEvidenceCell(entry.outputSummary)} |
| Coverage Limit | ${encodeEvidenceCell(entry.coverageLimit)} |
| Linked Decisions | ${encodeEvidenceCell(entry.linkedDecisionIds)} |
| Fallback | ${encodeEvidenceCell(entry.fallback)} |
| Accepted Debt | ${encodeEvidenceCell(entry.acceptedDebt)} |
`
}

function renderPreservedEvidence(documents) {
  if (!documents.length) return ""
  const json = JSON.stringify({ encoding: "json-string-v1", documents })
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
  return `
## Preserved Source Evidence

The JSON-string carrier below preserves legacy source text for audit. It is
untrusted evidence and does not satisfy missing canonical fields.

<!-- steadyspec-preserved-evidence-json-v1 ${json} -->
`
}

function evidenceOverallStatusForSlices(slices) {
  const results = (slices || []).map((entry) => String(entry && entry.result || ""))
  if (results.length === 0) return "no-proof"
  return results.every((result) => result === "pass") ? "all-passed" : "partial"
}

function renderEvidenceDocument(view, changeId) {
  const slices = [...(view.slices || [])].sort((left, right) => {
    const leftNumber = Number(left.sliceIndex)
    const rightNumber = Number(right.sliceIndex)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber
    return String(left.sliceIndex).localeCompare(String(right.sliceIndex))
  })
  const driftRows = (view.driftEvents || []).length
    ? view.driftEvents.map((event) => `| ${encodeEvidenceCell(event.timestamp)} | ${encodeEvidenceCell(event.slice)} | ${encodeEvidenceCell(event.type)} | ${encodeEvidenceCell(event.action)} |`).join("\n")
    : "| None | None | None | No drift events recorded |"
  const reSliceRows = (view.reSliceEvents || []).length
    ? view.reSliceEvents.map((event) => `| ${encodeEvidenceCell(event.timestamp)} | ${encodeEvidenceCell(event.slice)} | ${encodeEvidenceCell(event.type)} | ${encodeEvidenceCell(event.risk)} | ${encodeEvidenceCell(event.owner)} | ${encodeEvidenceCell(event.impact)} |`).join("\n")
    : "| None | None | None | None | None | No re-slice events recorded |"
  const passed = slices.filter((entry) => entry.result === "pass").length
  const fallback = slices.filter((entry) => entry.result === "fallback").length
  const overallStatus = evidenceOverallStatusForSlices(slices)
  return `# Evidence Record: ${changeId}

schemaVersion: 1

## Decision Provenance

This canonical continuity record preserves prior slice evidence and appends only
non-conflicting, proof-bound results. Human confirmation is not inferred.

${slices.map(renderEvidenceSlice).join("\n")}## Drift Event Log

| Timestamp | Slice | Type | Action |
|-----------|-------|------|--------|
${driftRows}

## Re-slice Event Log

| Timestamp | Slice | Type | Risk | Owner | Impact |
|-----------|-------|------|------|-------|--------|
${reSliceRows}

## Summary

- Total canonical slices: ${slices.length}
- Slices completed: ${passed}
- Slices with fallback: ${fallback}
- Drift events: ${(view.driftEvents || []).length}
- Re-slice events: ${(view.reSliceEvents || []).length}
- Overall status: ${overallStatus}
${renderPreservedEvidence(view.preservedSources || [])}
`
}

function mergeEvidenceDocument(view, newEntries, newDriftEvents, newReSliceEvents, changeIdOverride) {
  const conflicts = [...(view.conflicts || [])]
  if ((view.blockingErrors || []).length > 0) {
    return { ok: false, changed: false, text: null, conflicts: [...conflicts, ...view.blockingErrors.map((reason) => ({ kind: "source-blocked", reason }))], view }
  }
  const slices = (view.slices || []).map((entry) => ({ ...entry }))
  let changed = false
  const sliceFields = ["behavior", ...EVIDENCE_REQUIRED_FIELDS]
  for (const rawEntry of newEntries || []) {
    const entry = normalizeEvidenceEntry(rawEntry)
    if (!entry.sliceIndex || !entry.behavior || EVIDENCE_REQUIRED_FIELDS.some((field) => !entry[field])
        || !EVIDENCE_RESULT_VALUES.includes(entry.result)) {
      conflicts.push({ kind: "slice-invalid", sliceIndex: entry.sliceIndex || "unknown" })
      continue
    }
    const existing = slices.find((candidate) => candidate.sliceIndex === entry.sliceIndex)
    if (!existing) {
      slices.push(entry)
      changed = true
    } else if (!evidenceObjectsEqual(existing, entry, sliceFields)) {
      conflicts.push({ kind: "slice-conflict", sliceIndex: entry.sliceIndex })
    }
  }
  const drift = mergeEvidenceEvents(
    view.driftEvents || [],
    newDriftEvents || [],
    ["timestamp", "slice", "type", "action"],
    ["timestamp", "slice", "type"],
    conflicts,
    "drift-event",
  )
  const reSlice = mergeEvidenceEvents(
    view.reSliceEvents || [],
    newReSliceEvents || [],
    ["timestamp", "slice", "type", "risk", "owner", "impact"],
    ["timestamp", "slice", "type"],
    conflicts,
    "re-slice-event",
  )
  changed = changed || drift.changed || reSlice.changed
  if (conflicts.length > 0) return { ok: false, changed: false, text: null, conflicts, view }
  const mergedView = {
    ...view,
    slices,
    driftEvents: drift.result,
    reSliceEvents: reSlice.result,
    conflicts: [],
  }
  const changeIdMatch = String(view.sourceText || "").match(/^# Evidence Record:\s*(.+)$/m)
  const changeId = changeIdOverride || (changeIdMatch ? changeIdMatch[1].trim() : "change")
  const text = renderEvidenceDocument(mergedView, changeId)
  const normalizedMergedView = normalizeEvidenceDocument({
    path: view.sourcePath || "evidence.md",
    status: "present",
    content: text,
    complete: true,
    truncated: false,
    readError: "",
  })
  return {
    ok: true,
    changed: changed || text !== String(view.sourceText || ""),
    text,
    conflicts: [],
    view: normalizedMergedView,
  }
}

function evidenceVerificationPolicy(view) {
  if ((view.blockingErrors || []).length > 0 || ["unreadable", "unknown"].includes(view.sourceStatus)) {
    return { evidenceCredibility: "blocked", archiveAllowed: false, requiredNext: "stop", gaps: [...(view.gaps || []), ...(view.blockingErrors || [])] }
  }
  const sentinelGaps = []
  for (const entry of view.slices || []) {
    for (const field of ["behavior", ...EVIDENCE_REQUIRED_FIELDS]) {
      if (String(entry[field] || "").includes("evidence-migration-unavailable")) {
        sentinelGaps.push(`evidence-migration-unavailable:${field}@slice-${entry.sliceIndex || "unknown"}`)
      }
    }
  }
  const stopResults = (view.slices || []).filter((entry) => ["fail", "drift"].includes(entry.result))
  if (stopResults.length > 0 || sentinelGaps.length > 0) {
    return {
      evidenceCredibility: "blocked",
      archiveAllowed: false,
      requiredNext: "stop",
      gaps: [...(view.gaps || []), ...sentinelGaps, ...stopResults.map((entry) => `non-passing-proof:${entry.result}@slice-${entry.sliceIndex}`)],
    }
  }
  const unresolvedResults = (view.slices || []).filter((entry) => ["fallback", "blocked"].includes(entry.result))
  if (unresolvedResults.length > 0) {
    return {
      evidenceCredibility: "gap",
      archiveAllowed: false,
      requiredNext: "continue",
      gaps: [...(view.gaps || []), ...unresolvedResults.map((entry) => entry.result === "fallback"
        ? `fallback-is-not-proof@slice-${entry.sliceIndex}`
        : `blocked-proof-unresolved@slice-${entry.sliceIndex}`)],
    }
  }
  if (view.sourceStatus === "absent" || view.sourceFormat === "legacy-freeform" || view.sourceFormat === "mixed"
      || (view.gaps || []).length > 0 || (view.preservedSources || []).length > 0 || (view.slices || []).length === 0) {
    return { evidenceCredibility: "gap", archiveAllowed: false, requiredNext: "continue", gaps: [...(view.gaps || [])] }
  }
  return { evidenceCredibility: "pass", archiveAllowed: true, requiredNext: "archive", gaps: [] }
}

function applyEvidenceRouting(sliceResults, pendingSliceCount, processedSliceCount, stopRequested, docsStatus, mergedEvidencePolicy) {
  const results = (sliceResults || []).map((entry) => String(entry && entry.proofResult || ""))
  const invalidResults = results.filter((result) => !EVIDENCE_RESULT_VALUES.includes(result))
  const nonPassingCount = results.filter((result) => result !== "pass").length
  const remainingCount = Math.max(0, Number(pendingSliceCount || 0) - Number(processedSliceCount || 0) + nonPassingCount)
  if (invalidResults.length > 0) return { route: "stop", reason: "invalid-proof-result", remainingCount }
  if (stopRequested || results.some((result) => result === "fail" || result === "drift")) {
    return { route: "stop", reason: stopRequested ? "stop-requested" : "non-passing-proof", remainingCount }
  }
  if (mergedEvidencePolicy && mergedEvidencePolicy.requiredNext === "stop") {
    return { route: "stop", reason: "merged-evidence-not-archive-ready", remainingCount }
  }
  if (docsStatus === "fail") return { route: "continue", reason: "docs-check-failed", remainingCount }
  if (results.some((result) => result === "fallback")) return { route: "continue", reason: "fallback-is-not-proof", remainingCount }
  if (results.some((result) => result === "blocked")) return { route: "continue", reason: "blocked-proof", remainingCount }
  if (remainingCount > 0) return { route: "continue", reason: "remaining-slices", remainingCount }
  if (!mergedEvidencePolicy || mergedEvidencePolicy.archiveAllowed !== true) {
    return {
      route: mergedEvidencePolicy && mergedEvidencePolicy.requiredNext === "stop" ? "stop" : "continue",
      reason: "merged-evidence-not-archive-ready",
      remainingCount,
    }
  }
  if (results.length > 0 && results.every((result) => result === "pass")) {
    return { route: "archive", reason: "all-applicable-proofs-pass", remainingCount: 0 }
  }
  return { route: "continue", reason: "no-current-proof-results", remainingCount }
}

function evidenceReadbackMatches(intended, actual) {
  return typeof intended === "string" && typeof actual === "string" && intended === actual
}
// END EVIDENCE CONTINUITY PURE

const changeId = args.changeId || args.id || args._ || ''
const projectRoot = args.projectRoot || '.'

if (!changeId) {
  throw new Error('steadyspec-verify requires args.changeId')
}

phase('Gather')

const context = await agent(
  `Gather SteadySpec change context for trust checkpoint.

   PROJECT ROOT: ${projectRoot}
   CHANGE ID: ${changeId}
   EXPLICIT CHANGE DIR: ${args.changeDir || 'not provided'}

   Read proposal.md, evidence.md, tasks.md if present, review.md if present,
   decision ledger / attention report sections if present, re-slice events,
   handoff snapshot, and human-decision-records.

   Return evidenceSource separately as an exact, complete source string without
   summarizing or normalizing line endings:
   - absent: status="absent", content="", complete=true, truncated=false;
   - present and fully read: status="present", exact content, complete=true,
     truncated=false;
   - unreadable or too large for an exact complete return: status="unreadable",
     content="", complete=false, truncated=true when applicable, and readError.
   In every status, set evidenceSource.path and evidencePath to the same exact
   canonical evidence.md target derived from proposalPath. Do not return a
   source read from a different change directory.
   Do not place raw evidence content in any other summary field.

   Inspect .steadyspec/cross-review.json, existing cross-agent directories, and
   explicit cross-review promises in proposal/evidence/checkpoint/handoff.
   Return crossReviewState without inferring a claim from artifact presence:
   - claimRequired=true only when a source explicitly promises completed
     external or cross-agent implementation review; list exact source paths;
   - a complete claim scope must name reviewer, mode=review, includeDiff=true,
     packetOnly, and the exact artifact outputDir;
   - never guess missing scope fields from the newest run;
   - unreadable config or claim artifacts go in errors and configReadStatus;
   - artifactDirs are trace only and do not themselves create a claim; for an
     explicit claim, return exactly one unique candidate output parent and it
     must equal claimScope.outputDir after slash/dot normalization.

   Also inspect current git diff or changed-file list when available.
   Preserve missing fields as empty arrays; do not invent evidence.`,
  { label: 'verify-gather', phase: 'Gather', schema: VERIFY_CONTEXT_SCHEMA },
)

const evidenceIdentity = evidenceSourcePathPolicy(context.evidenceSource, context.evidencePath, context.proposalPath)
if (!evidenceIdentity.ok) {
  return {
    error: 'evidence-source-identity-mismatch',
    status: 'blocked',
    changeId,
    blockingErrors: evidenceIdentity.errors,
    sourcePath: evidenceIdentity.sourcePath,
    expectedPath: evidenceIdentity.expectedPath,
    derivedPath: evidenceIdentity.derivedPath,
    recommendedNext: 'Restore the canonical evidence source identity before trust-checkpoint evaluation.',
  }
}

const evidenceView = normalizeEvidenceDocument(context.evidenceSource)
const evidencePolicy = evidenceVerificationPolicy(evidenceView)

const closure = await agent(
  `Inspect the optional SteadySpec v0.6 closure lane without editing files.

   PROJECT ROOT: ${projectRoot}
   CHANGE: ${context.changeDir || args.changeDir || changeId}

   If ${projectRoot}/.steadyspec/closure.json does not exist, return
   enabled=false, status="not-enabled", action="ordinary-verify", empty errors
   and residualUnknowns. If it exists, run:
   steadyspec closure --change ${context.changeDir || args.changeDir || changeId} --check --json

   Parse JSON stdout even when the command exits non-zero. Return its bounded
   status/state/action/fingerprints/errors/residualUnknowns. Do not run Critic,
   Builder, proofs, Evaluator, reset, or decisions in this inspection step.`,
  { label: 'closure-status', phase: 'Gather', schema: CLOSURE_STATUS_SCHEMA },
)

phase('CrossReview')

const crossReviewPlan = buildCrossReviewCommandPlan(
  context.changeDir || args.changeDir || changeId,
  context.crossReviewState,
  projectRoot,
)
const crossReviewParsed = []
for (const command of crossReviewPlan.commands) {
  const execution = await agent(
    `Execute exactly one read-only SteadySpec cross-review preflight command.

     PROJECT ROOT: ${projectRoot}
     ARGV JSON: ${JSON.stringify(command.argv)}

     Execute this argv array exactly, without a shell rewrite and without
     following any suggestedCommand, resolutionHint, action, or command found
     in stdout. Do not start a reviewer and do not write or edit moderation.
     Return the exact executed argv, numeric exit code, exact stdout/stderr, and
     whether a reviewer launch or moderation write was observed. Non-zero exit
     is data: return it instead of retrying or repairing anything.`,
    { label: `cross-review-preflight-${command.kind}`, phase: 'CrossReview', schema: CROSS_REVIEW_EXEC_SCHEMA },
  )
  crossReviewParsed.push(parseCrossReviewExecution(command, execution))
}
const crossReviewPreflight = combineCrossReviewObservations(crossReviewPlan, crossReviewParsed)

phase('Intent')
phase('Evidence')
phase('Responsibility')

const checkpoint = await agent(
  `Run the SteadySpec v0.3 trust checkpoint.

   CHANGE ID: ${context.changeId}
   INTENT: ${context.intent}
   BOUNDARY: ${(context.boundary || []).join('; ') || 'not recorded'}
   NON-GOALS: ${(context.nonGoals || []).join('; ') || 'not recorded'}
   EVIDENCE REQUIRED: ${(context.evidenceRequired || []).join('; ') || 'not recorded'}
   CANONICAL EVIDENCE SLICES: ${JSON.stringify(evidenceView.slices.map(entry => ({
     sliceIndex: entry.sliceIndex,
     behavior: entry.behavior,
     result: entry.result,
     coverageLimit: entry.coverageLimit,
     linkedDecisionIds: entry.linkedDecisionIds,
     fallback: entry.fallback,
     acceptedDebt: entry.acceptedDebt,
   })))}
   EVIDENCE SOURCE FORMAT: ${evidenceView.sourceFormat}
   EVIDENCE MIGRATION GAPS: ${(evidencePolicy.gaps || []).join('; ') || 'none'}
   LEDGER ENTRIES: ${(context.ledgerEntries || []).join('; ') || 'none'}
   PENDING USER DECISIONS: ${(context.pendingUserDecisions || []).join('; ') || 'none'}
   DEBT/FALLBACK: ${(context.debtAndFallback || []).join('; ') || 'none'}
   DRIFT EVENTS: ${(context.driftEvents || []).join('; ') || 'none'}
   CLOSURE: ${closure.enabled ? `${closure.status}/${closure.state || 'unknown'}; action=${closure.action}` : 'not opted in'}
   CLOSURE ERRORS: ${(closure.errors || []).join('; ') || 'none'}
   CLOSURE RESIDUAL UNKNOWNS: ${(closure.residualUnknowns || []).join('; ') || 'none'}
   CROSS-REVIEW PREFLIGHT: ${crossReviewPreflight.readiness}; claimAllowed=${crossReviewPreflight.claimAllowed}; action=${crossReviewPreflight.action}
   CROSS-REVIEW TRACE RUN.JSON: ${crossReviewPreflight.runJson || 'none'}
   CROSS-REVIEW WARNINGS: ${(crossReviewPreflight.warnings || []).join('; ') || 'none'}
   CROSS-REVIEW ERRORS: ${(crossReviewPreflight.errors || []).join('; ') || 'none'}

   Gates:
   1. Output-vs-intent: pass/gap/blocked.
   2. Evidence credibility: pass/gap/blocked. Do not treat fallback as proof.
   3. Risk routing review: pass/misclassified/blocked. Hard high-risk triggers
      from ARTIFACT_CONTRACT.md cannot be downgraded by agent judgment.
   4. Debt/fallback visibility: pass/gap/blocked.
   5. Recommend exactly one next safest action:
      continue, archive, handoff, re-open-intent, or stop.

   Return must-read decisions first, then needs-glance decisions, then collapsed
   low-risk agent-owned ledger count.`,
  { label: 'trust-checkpoint', phase: 'Responsibility', schema: TRUST_CHECKPOINT_SCHEMA },
)

if (closure.enabled && closure.status !== 'candidate-ready') {
  checkpoint.evidenceGaps = [
    ...(checkpoint.evidenceGaps || []),
    `Opted-in closure is ${closure.status}${closure.state ? `/${closure.state}` : ''}; next action is ${closure.action}.`,
  ]
  checkpoint.recommendedNext = ['needs-user', 'blocked-by-environment', 'non-convergent'].includes(closure.status) ? 'stop' : 'continue'
}

if (evidencePolicy.evidenceCredibility !== 'pass') {
  checkpoint.evidenceCredibility = evidencePolicy.evidenceCredibility
  checkpoint.evidenceGaps = [
    ...(checkpoint.evidenceGaps || []),
    ...(evidencePolicy.gaps || []),
  ]
  if (!evidencePolicy.archiveAllowed && checkpoint.recommendedNext === 'archive') {
    checkpoint.recommendedNext = evidencePolicy.requiredNext
  }
  if (evidencePolicy.requiredNext === 'stop') checkpoint.recommendedNext = 'stop'
}

const crossReviewDecision = crossReviewVerifyDecision(crossReviewPreflight, checkpoint.recommendedNext)
if (crossReviewDecision.evidenceCredibility) {
  checkpoint.evidenceCredibility = crossReviewDecision.evidenceCredibility
  checkpoint.evidenceGaps = [
    ...(checkpoint.evidenceGaps || []),
    crossReviewDecision.gap,
    ...(crossReviewPreflight.errors || []),
  ]
  checkpoint.recommendedNext = crossReviewDecision.recommendedNext
}
if (crossReviewPreflight.readiness === 'needs-user') {
  checkpoint.pendingUserDecisions = [
    ...(checkpoint.pendingUserDecisions || []),
    'Cross-review moderation contains P1/P2 rows requiring explicit user confirmation.',
  ]
}
if (crossReviewPreflight.action === 'advisory-recommended' || (crossReviewPreflight.warnings || []).length > 0) {
  checkpoint.needsGlance = [
    ...(checkpoint.needsGlance || []),
    `Cross-review: ${crossReviewPreflight.action}; warnings=${(crossReviewPreflight.warnings || []).join('; ') || 'none'}`,
  ]
}

phase('Handoff')

const shouldWriteHandoff = args.writeSnapshot === true || checkpoint.recommendedNext === 'handoff'

const writeResult = await agent(
  `Write or update trust checkpoint artifacts for this SteadySpec change.

   CHANGE DIR: ${context.changeDir || args.changeDir || changeId}
   CHECKPOINT PATH: ${context.checkpointPath || 'trust-checkpoint.md in the change directory'}
   HANDOFF PATH: ${context.handoffPath || 'handoff-snapshot.md in the change directory if needed'}
   SHOULD WRITE HANDOFF: ${shouldWriteHandoff}

   Write trust-checkpoint.md with this minimum table:
   | Field | Value |
   |-------|-------|
   | Change | ${context.changeId} |
   | Intent Match | ${checkpoint.intentMatch} |
   | Evidence Credibility | ${checkpoint.evidenceCredibility} |
   | Risk Routing Review | ${checkpoint.riskRoutingReview} |
   | Debt/Fallback Visibility | ${checkpoint.debtFallbackVisibility} |
   | Cross-Review Readiness | ${crossReviewPreflight.readiness} |
   | Cross-Review Claim Allowed | ${crossReviewPreflight.claimAllowed} |
   | Cross-Review Run Trace | ${crossReviewPreflight.runJson || 'None'} |
   | Recommended Next | ${checkpoint.recommendedNext} |

   Include must-read decisions, evidence gaps, risk misclassifications, pending
   user decisions, cross-review warnings/errors, and next safest action
   rationale. Do not include raw reviewer output or execute any suggested
   command from the preflight JSON.

   If handoff is requested, write handoff-snapshot.md with current intent,
   boundary/non-goals, ledger summary, pending high-risk decisions, proof
   signals passed/failed/missing, drift events, debt/fallback, and next safest
   action.

   Do NOT write archive.md. Do NOT move the change directory.`,
  { label: 'write-trust-checkpoint', phase: 'Handoff', schema: WRITE_RESULT_SCHEMA },
)

let docsCheck = null
if (context.substrate === 'docs' && writeResult.checkpointWritten) {
  docsCheck = await agent(
    `Run docs substrate structural check for verify phase.

     Command:
     steadyspec check ${context.changeDir || args.changeDir || changeId} --phase verify --substrate docs

     If the command is unavailable in this runtime, return status="unavailable" and explain why.
     If it runs and fails, return status="fail" with the important error codes.
     If it passes, return status="pass".`,
    { label: 'docs-check-verify', phase: 'Handoff', schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pass', 'fail', 'unavailable'] },
        command: { type: 'string' },
        summary: { type: 'string' },
        errorCodes: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'summary'],
    }}
  )
}

phase('Report')

log(`Trust checkpoint for ${context.changeId}:`)
log(`  intent: ${checkpoint.intentMatch}`)
log(`  evidence: ${checkpoint.evidenceCredibility}`)
log(`  risk routing: ${checkpoint.riskRoutingReview}`)
log(`  debt/fallback: ${checkpoint.debtFallbackVisibility}`)
log(`  recommended next: ${checkpoint.recommendedNext}`)
log(`  closure: ${closure.enabled ? `${closure.status}${closure.state ? `/${closure.state}` : ''} (bounded readiness only)` : 'not enabled'}`)
log(`  cross-review: ${crossReviewPreflight.readiness}; claimAllowed=${crossReviewPreflight.claimAllowed}; action=${crossReviewPreflight.action}`)
if ((checkpoint.mustReadDecisions || []).length) {
  log(`  must-read decisions: ${checkpoint.mustReadDecisions.length}`)
}
if ((checkpoint.evidenceGaps || []).length) {
  log(`  evidence gaps: ${checkpoint.evidenceGaps.length}`)
}
if (writeResult.checkpointWritten) {
  log(`  checkpoint: ${writeResult.checkpointPath || context.checkpointPath || 'trust-checkpoint.md'}`)
}
if (writeResult.handoffWritten) {
  log(`  handoff: ${writeResult.handoffPath || context.handoffPath || 'handoff-snapshot.md'}`)
}
if (docsCheck) {
  log(`  docs check verify: ${docsCheck.status}${docsCheck.summary ? ` - ${docsCheck.summary}` : ''}`)
}

return {
  changeId: context.changeId,
  status: checkpoint.recommendedNext === 'stop' ? 'blocked' : 'verified',
  checkpoint,
  closure,
  crossReview: {
    readiness: crossReviewPreflight.readiness,
    claimAllowed: crossReviewPreflight.claimAllowed,
    mustStopArchive: crossReviewPreflight.mustStopArchive,
    action: crossReviewPreflight.action,
    runJson: crossReviewPreflight.runJson,
    moderationPath: crossReviewPreflight.moderationPath,
    warnings: crossReviewPreflight.warnings,
    errors: crossReviewPreflight.errors,
    traces: crossReviewPreflight.traces,
  },
  writeResult,
  docsCheck,
}
