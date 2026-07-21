#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const { TextDecoder } = require("util");

const SCHEMA_VERSION = 1;
const PROTOCOL_VERSION = "0.7";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_TIME = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?Z$/;
const EVIDENCE_OUTCOMES = new Set(["pass", "fail", "blocked", "unknown", "not-run", "fallback"]);
const CRITERION_RESULTS = new Set(["pass", "fail", "blocked", "unknown", "not-applicable"]);
const ASSESSMENT_OUTCOMES = new Set(["ready-for-human", "remediation-required", "needs-human", "blocked"]);
const DECISIONS = new Set(["authorize-assessment-retry", "accept-current", "reject-current", "defer-current", "abandon"]);
const FINGERPRINT_DOMAINS = new Set(["target", "candidate", "evidence", "assessment", "event", "trace", "result"]);
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;
const MAX_EVENTS = 10000;

class ProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.path = details.path || null;
    this.eventId = details.eventId || null;
    this.sequence = Number.isInteger(details.sequence) ? details.sequence : null;
  }
}

function protocolError(code, message, details) {
  throw new ProtocolError(code, message, details);
}

function validUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = DATE_TIME.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor.index])) cursor.index += 1;
}

function scanString(text, cursor, pathLabel) {
  const start = cursor.index;
  if (text[cursor.index] !== '"') protocolError("E_JSON_SYNTAX", `expected string at ${pathLabel}`, { path: pathLabel });
  cursor.index += 1;
  while (cursor.index < text.length) {
    const code = text.charCodeAt(cursor.index);
    if (code === 0x22) {
      cursor.index += 1;
      const raw = text.slice(start, cursor.index);
      try {
        return JSON.parse(raw);
      } catch (_error) {
        protocolError("E_JSON_SYNTAX", `invalid string at ${pathLabel}`, { path: pathLabel });
      }
    }
    if (code < 0x20) protocolError("E_JSON_SYNTAX", `control character in string at ${pathLabel}`, { path: pathLabel });
    if (code === 0x5c) {
      cursor.index += 1;
      if (cursor.index >= text.length) protocolError("E_JSON_SYNTAX", `unterminated escape at ${pathLabel}`, { path: pathLabel });
      const escape = text[cursor.index];
      if (escape === "u") {
        const digits = text.slice(cursor.index + 1, cursor.index + 5);
        if (!/^[a-fA-F0-9]{4}$/.test(digits)) protocolError("E_JSON_SYNTAX", `invalid unicode escape at ${pathLabel}`, { path: pathLabel });
        cursor.index += 5;
        continue;
      }
      if (!/["\\/bfnrt]/.test(escape)) protocolError("E_JSON_SYNTAX", `invalid escape at ${pathLabel}`, { path: pathLabel });
    }
    cursor.index += 1;
  }
  protocolError("E_JSON_SYNTAX", `unterminated string at ${pathLabel}`, { path: pathLabel });
}

function scanValue(text, cursor, pathLabel, depth = 0) {
  if (depth > MAX_JSON_DEPTH) protocolError("E_JSON_DEPTH", `JSON nesting exceeds ${MAX_JSON_DEPTH}`, { path: pathLabel });
  skipWhitespace(text, cursor);
  const char = text[cursor.index];
  if (char === "{") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    const keys = new Set();
    if (text[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      const key = scanString(text, cursor, pathLabel);
      if (keys.has(key)) protocolError("E_JSON_DUPLICATE_KEY", `duplicate object key ${JSON.stringify(key)}`, { path: pathLabel });
      keys.add(key);
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") protocolError("E_JSON_SYNTAX", `expected colon at ${pathLabel}`, { path: pathLabel });
      cursor.index += 1;
      scanValue(text, cursor, `${pathLabel}.${key}`, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") protocolError("E_JSON_SYNTAX", `expected comma at ${pathLabel}`, { path: pathLabel });
      cursor.index += 1;
      skipWhitespace(text, cursor);
    }
    protocolError("E_JSON_SYNTAX", `unterminated object at ${pathLabel}`, { path: pathLabel });
  }
  if (char === "[") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    let item = 0;
    while (cursor.index < text.length) {
      scanValue(text, cursor, `${pathLabel}[${item}]`, depth + 1);
      item += 1;
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") protocolError("E_JSON_SYNTAX", `expected comma at ${pathLabel}`, { path: pathLabel });
      cursor.index += 1;
    }
    protocolError("E_JSON_SYNTAX", `unterminated array at ${pathLabel}`, { path: pathLabel });
  }
  if (char === '"') {
    scanString(text, cursor, pathLabel);
    return;
  }
  const rest = text.slice(cursor.index);
  const token = rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
  if (!token) protocolError("E_JSON_SYNTAX", `invalid value at ${pathLabel}`, { path: pathLabel });
  cursor.index += token.length;
}

function parseJsonStrict(text) {
  const transport = String(text).replace(/^\uFEFF/, "");
  const cursor = { index: 0 };
  scanValue(transport, cursor, "$");
  skipWhitespace(transport, cursor);
  if (cursor.index !== transport.length) protocolError("E_JSON_SYNTAX", "trailing JSON content", { path: "$" });
  try {
    return JSON.parse(transport);
  } catch (error) {
    protocolError("E_JSON_SYNTAX", error.message, { path: "$" });
  }
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function canonicalJson(value, pathLabel = "$", depth = 0) {
  if (depth > MAX_JSON_DEPTH) protocolError("E_JSON_DEPTH", `JSON nesting exceeds ${MAX_JSON_DEPTH}`, { path: pathLabel });
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) protocolError("E_CANONICAL_NUMBER", `non-safe integer at ${pathLabel}`, { path: pathLabel });
    return String(value);
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) protocolError("E_CANONICAL_UNICODE", `unpaired surrogate at ${pathLabel}`, { path: pathLabel });
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson(entry, `${pathLabel}[${index}]`, depth + 1)).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    protocolError("E_CANONICAL_TYPE", `unsupported value at ${pathLabel}`, { path: pathLabel });
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (hasUnpairedSurrogate(key)) protocolError("E_CANONICAL_UNICODE", `unpaired surrogate in key at ${pathLabel}`, { path: pathLabel });
  }
  keys.sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${pathLabel}.${key}`, depth + 1)}`).join(",")}}`;
}

function fingerprint(domain, value) {
  const prefix = Buffer.from(`steadyspec-assurance/${PROTOCOL_VERSION}/${domain}\0`, "utf8");
  const body = Buffer.from(canonicalJson(value), "utf8");
  return `sha256:${crypto.createHash("sha256").update(prefix).update(body).digest("hex")}`;
}

function object(value, pathLabel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) protocolError("E_SCHEMA_TYPE", `${pathLabel} must be an object`, { path: pathLabel });
  return value;
}

function exactKeys(value, keys, pathLabel) {
  object(value, pathLabel);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) protocolError("E_SCHEMA_FIELDS", `${pathLabel} fields must be exactly ${expected.join(",")}`, { path: pathLabel });
}

function nonEmptyString(value, pathLabel) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) protocolError("E_SCHEMA_STRING", `${pathLabel} must be a trimmed non-empty string`, { path: pathLabel });
}

function id(value, pathLabel) {
  if (typeof value !== "string" || !ID.test(value)) protocolError("E_SCHEMA_ID", `${pathLabel} is not a valid ID`, { path: pathLabel });
}

function digest(value, pathLabel) {
  if (typeof value !== "string" || !SHA256.test(value)) protocolError("E_SCHEMA_DIGEST", `${pathLabel} is not a SHA-256 fingerprint`, { path: pathLabel });
}

function uniqueById(values, pathLabel) {
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    id(values[index]?.id, `${pathLabel}[${index}].id`);
    if (seen.has(values[index].id)) protocolError("E_SCHEMA_DUPLICATE_ID", `duplicate ID ${values[index].id}`, { path: pathLabel });
    seen.add(values[index].id);
  }
}

function stringArray(value, pathLabel, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) protocolError("E_SCHEMA_ARRAY", `${pathLabel} must be ${options.nonEmpty ? "a non-empty" : "an"} array`, { path: pathLabel });
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    nonEmptyString(value[index], `${pathLabel}[${index}]`);
    if (seen.has(value[index])) protocolError("E_SCHEMA_DUPLICATE_ID", `duplicate value ${value[index]}`, { path: pathLabel });
    seen.add(value[index]);
  }
}

function validateArtifact(value, pathLabel) {
  exactKeys(value, ["id", "locator", "contentDigest", "byteLength"], pathLabel);
  id(value.id, `${pathLabel}.id`);
  nonEmptyString(value.locator, `${pathLabel}.locator`);
  digest(value.contentDigest, `${pathLabel}.contentDigest`);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0) protocolError("E_SCHEMA_INTEGER", `${pathLabel}.byteLength must be a non-negative safe integer`, { path: `${pathLabel}.byteLength` });
}

function validateArtifacts(value, pathLabel, nonEmpty = true) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) protocolError("E_SCHEMA_ARRAY", `${pathLabel} must be ${nonEmpty ? "a non-empty" : "an"} array`, { path: pathLabel });
  value.forEach((entry, index) => validateArtifact(entry, `${pathLabel}[${index}]`));
  uniqueById(value, pathLabel);
}

function validateTarget(value, pathLabel) {
  exactKeys(value, ["targetId", "artifacts", "criteria", "authority"], pathLabel);
  id(value.targetId, `${pathLabel}.targetId`);
  validateArtifacts(value.artifacts, `${pathLabel}.artifacts`);
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) protocolError("E_TARGET_EMPTY", "target criteria must be non-empty", { path: `${pathLabel}.criteria` });
  uniqueById(value.criteria, `${pathLabel}.criteria`);
  let requiredCount = 0;
  const requiredEvidenceIds = new Set();
  value.criteria.forEach((criterion, index) => {
    const itemPath = `${pathLabel}.criteria[${index}]`;
    exactKeys(criterion, ["id", "required", "requiredEvidence"], itemPath);
    if (typeof criterion.required !== "boolean") protocolError("E_SCHEMA_TYPE", `${itemPath}.required must be boolean`, { path: `${itemPath}.required` });
    if (!Array.isArray(criterion.requiredEvidence)) protocolError("E_SCHEMA_ARRAY", `${itemPath}.requiredEvidence must be an array`, { path: `${itemPath}.requiredEvidence` });
    uniqueById(criterion.requiredEvidence, `${itemPath}.requiredEvidence`);
    criterion.requiredEvidence.forEach((requirement, requirementIndex) => {
      const requirementPath = `${itemPath}.requiredEvidence[${requirementIndex}]`;
      exactKeys(requirement, ["id", "allowedSourceClasses"], requirementPath);
      stringArray(requirement.allowedSourceClasses, `${requirementPath}.allowedSourceClasses`);
    });
    if (criterion.required) {
      requiredCount += 1;
      if (!criterion.requiredEvidence.length) protocolError("E_TARGET_EVIDENCE_EMPTY", "required criterion must declare required evidence", { path: `${itemPath}.requiredEvidence` });
      for (const requirement of criterion.requiredEvidence) {
        if (requiredEvidenceIds.has(requirement.id)) protocolError("E_TARGET_EVIDENCE_DUPLICATE", `required evidence ID ${requirement.id} is reused across criteria`, { path: `${itemPath}.requiredEvidence` });
        requiredEvidenceIds.add(requirement.id);
      }
    }
  });
  if (!requiredCount) protocolError("E_TARGET_REQUIRED_EMPTY", "target must contain at least one required criterion", { path: `${pathLabel}.criteria` });
  exactKeys(value.authority, ["finalDecision"], `${pathLabel}.authority`);
  if (value.authority.finalDecision !== "human") protocolError("E_TARGET_AUTHORITY", "finalDecision must be human", { path: `${pathLabel}.authority.finalDecision` });
}

function validateCandidate(value, pathLabel) {
  exactKeys(value, ["candidateId", "targetFingerprint", "artifacts"], pathLabel);
  id(value.candidateId, `${pathLabel}.candidateId`);
  digest(value.targetFingerprint, `${pathLabel}.targetFingerprint`);
  validateArtifacts(value.artifacts, `${pathLabel}.artifacts`);
}

function validateUnknown(value, pathLabel) {
  exactKeys(value, ["id", "statement", "status"], pathLabel);
  id(value.id, `${pathLabel}.id`);
  nonEmptyString(value.statement, `${pathLabel}.statement`);
  if (value.status !== "unresolved") protocolError("E_SCHEMA_ENUM", `${pathLabel}.status must be unresolved`, { path: `${pathLabel}.status` });
}

function validateCoverage(value, pathLabel) {
  exactKeys(value, ["id", "statement"], pathLabel);
  id(value.id, `${pathLabel}.id`);
  nonEmptyString(value.statement, `${pathLabel}.statement`);
}

function validateFallback(value, pathLabel) {
  exactKeys(value, ["id", "statement", "forEvidenceId"], pathLabel);
  id(value.id, `${pathLabel}.id`);
  nonEmptyString(value.statement, `${pathLabel}.statement`);
  if (value.forEvidenceId !== null) id(value.forEvidenceId, `${pathLabel}.forEvidenceId`);
}

function validateEvidence(value, pathLabel) {
  exactKeys(value, ["evidenceId", "targetFingerprint", "candidateFingerprint", "observations", "unresolvedUnknowns", "coverageLimits", "fallbacks"], pathLabel);
  id(value.evidenceId, `${pathLabel}.evidenceId`);
  digest(value.targetFingerprint, `${pathLabel}.targetFingerprint`);
  digest(value.candidateFingerprint, `${pathLabel}.candidateFingerprint`);
  if (!Array.isArray(value.observations)) protocolError("E_SCHEMA_ARRAY", `${pathLabel}.observations must be an array`, { path: `${pathLabel}.observations` });
  uniqueById(value.observations, `${pathLabel}.observations`);
  value.observations.forEach((observation, index) => {
    const itemPath = `${pathLabel}.observations[${index}]`;
    exactKeys(observation, ["id", "criterionId", "sourceClass", "outcome", "claim", "artifacts", "coverageLimitIds"], itemPath);
    id(observation.criterionId, `${itemPath}.criterionId`);
    nonEmptyString(observation.sourceClass, `${itemPath}.sourceClass`);
    if (!EVIDENCE_OUTCOMES.has(observation.outcome)) protocolError("E_SCHEMA_ENUM", `${itemPath}.outcome is invalid`, { path: `${itemPath}.outcome` });
    nonEmptyString(observation.claim, `${itemPath}.claim`);
    validateArtifacts(observation.artifacts, `${itemPath}.artifacts`, false);
    stringArray(observation.coverageLimitIds, `${itemPath}.coverageLimitIds`);
  });
  for (const [field, validator] of [["unresolvedUnknowns", validateUnknown], ["coverageLimits", validateCoverage], ["fallbacks", validateFallback]]) {
    if (!Array.isArray(value[field])) protocolError("E_SCHEMA_ARRAY", `${pathLabel}.${field} must be an array`, { path: `${pathLabel}.${field}` });
    uniqueById(value[field], `${pathLabel}.${field}`);
    value[field].forEach((entry, index) => validator(entry, `${pathLabel}.${field}[${index}]`));
  }
  const limitIds = new Set(value.coverageLimits.map((entry) => entry.id));
  for (const observation of value.observations) {
    for (const limitId of observation.coverageLimitIds) {
      if (!limitIds.has(limitId)) protocolError("E_EVIDENCE_LIMIT_REF", `unknown coverage limit ${limitId}`, { path: `${pathLabel}.observations` });
    }
  }
}

function validateInvocation(value, pathLabel) {
  exactKeys(value, ["invocationId", "targetFingerprint", "candidateFingerprint", "evidenceFingerprint", "assessor", "transport"], pathLabel);
  id(value.invocationId, `${pathLabel}.invocationId`);
  for (const field of ["targetFingerprint", "candidateFingerprint", "evidenceFingerprint"]) digest(value[field], `${pathLabel}.${field}`);
  exactKeys(value.assessor, ["kind", "label", "independence"], `${pathLabel}.assessor`);
  if (!new Set(["agent", "human", "tool", "mixed"]).has(value.assessor.kind)) protocolError("E_SCHEMA_ENUM", `${pathLabel}.assessor.kind is invalid`, { path: `${pathLabel}.assessor.kind` });
  nonEmptyString(value.assessor.label, `${pathLabel}.assessor.label`);
  if (!new Set(["same-context", "same-family", "external", "unknown"]).has(value.assessor.independence)) protocolError("E_SCHEMA_ENUM", `${pathLabel}.assessor.independence is invalid`, { path: `${pathLabel}.assessor.independence` });
  nonEmptyString(value.transport, `${pathLabel}.transport`);
}

function validateAssessment(value, pathLabel) {
  exactKeys(value, ["assessmentId", "invocationId", "targetFingerprint", "candidateFingerprint", "evidenceFingerprint", "proposedOutcome", "criterionResults", "findings", "unresolvedUnknowns", "coverageLimits"], pathLabel);
  id(value.assessmentId, `${pathLabel}.assessmentId`);
  id(value.invocationId, `${pathLabel}.invocationId`);
  for (const field of ["targetFingerprint", "candidateFingerprint", "evidenceFingerprint"]) digest(value[field], `${pathLabel}.${field}`);
  if (!ASSESSMENT_OUTCOMES.has(value.proposedOutcome)) protocolError("E_SCHEMA_ENUM", `${pathLabel}.proposedOutcome is invalid`, { path: `${pathLabel}.proposedOutcome` });
  if (!Array.isArray(value.criterionResults)) protocolError("E_SCHEMA_ARRAY", `${pathLabel}.criterionResults must be an array`, { path: `${pathLabel}.criterionResults` });
  uniqueById(value.criterionResults, `${pathLabel}.criterionResults`);
  value.criterionResults.forEach((result, index) => {
    const itemPath = `${pathLabel}.criterionResults[${index}]`;
    exactKeys(result, ["id", "result", "basisEvidenceIds"], itemPath);
    if (!CRITERION_RESULTS.has(result.result)) protocolError("E_SCHEMA_ENUM", `${itemPath}.result is invalid`, { path: `${itemPath}.result` });
    stringArray(result.basisEvidenceIds, `${itemPath}.basisEvidenceIds`);
  });
  if (!Array.isArray(value.findings)) protocolError("E_SCHEMA_ARRAY", `${pathLabel}.findings must be an array`, { path: `${pathLabel}.findings` });
  uniqueById(value.findings, `${pathLabel}.findings`);
  value.findings.forEach((finding, index) => {
    const itemPath = `${pathLabel}.findings[${index}]`;
    exactKeys(finding, ["id", "statement", "blocksReadiness", "status"], itemPath);
    nonEmptyString(finding.statement, `${itemPath}.statement`);
    if (typeof finding.blocksReadiness !== "boolean") protocolError("E_SCHEMA_TYPE", `${itemPath}.blocksReadiness must be boolean`, { path: `${itemPath}.blocksReadiness` });
    if (!new Set(["open", "resolved"]).has(finding.status)) protocolError("E_SCHEMA_ENUM", `${itemPath}.status is invalid`, { path: `${itemPath}.status` });
  });
  for (const [field, validator] of [["unresolvedUnknowns", validateUnknown], ["coverageLimits", validateCoverage]]) {
    if (!Array.isArray(value[field])) protocolError("E_SCHEMA_ARRAY", `${pathLabel}.${field} must be an array`, { path: `${pathLabel}.${field}` });
    uniqueById(value[field], `${pathLabel}.${field}`);
    value[field].forEach((entry, index) => validator(entry, `${pathLabel}.${field}[${index}]`));
  }
}

function validateDecision(value, pathLabel) {
  exactKeys(value, ["decisionId", "action", "claimedActorClass", "authentication", "reason", "invocationId", "bindings"], pathLabel);
  id(value.decisionId, `${pathLabel}.decisionId`);
  if (!DECISIONS.has(value.action)) protocolError("E_SCHEMA_ENUM", `${pathLabel}.action is invalid`, { path: `${pathLabel}.action` });
  if (value.claimedActorClass !== "human" || value.authentication !== "unverified") protocolError("E_DECISION_AUTHORITY", "decision actor must be claimed human with unverified authentication", { path: pathLabel });
  nonEmptyString(value.reason, `${pathLabel}.reason`);
  if (value.invocationId !== null) id(value.invocationId, `${pathLabel}.invocationId`);
  exactKeys(value.bindings, ["targetFingerprint", "candidateFingerprint", "evidenceFingerprint", "assessmentFingerprint"], `${pathLabel}.bindings`);
  for (const field of Object.keys(value.bindings)) if (value.bindings[field] !== null) digest(value.bindings[field], `${pathLabel}.bindings.${field}`);
}

function validateEvent(value, index, lineageId) {
  const pathLabel = `$.events[${index}]`;
  exactKeys(value, ["schemaVersion", "protocolVersion", "lineageId", "eventId", "sequence", "priorEventFingerprint", "occurredAt", "type", "payload"], pathLabel);
  if (value.schemaVersion !== SCHEMA_VERSION) protocolError("E_SCHEMA_VERSION", "event schemaVersion must be 1", { path: `${pathLabel}.schemaVersion`, eventId: value.eventId, sequence: value.sequence });
  if (value.protocolVersion !== PROTOCOL_VERSION) protocolError("E_PROTOCOL_VERSION", "event protocolVersion is unsupported", { path: `${pathLabel}.protocolVersion`, eventId: value.eventId, sequence: value.sequence });
  if (value.lineageId !== lineageId) protocolError("E_LINEAGE_MISMATCH", "event lineageId differs from trace", { path: `${pathLabel}.lineageId`, eventId: value.eventId, sequence: value.sequence });
  id(value.eventId, `${pathLabel}.eventId`);
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) protocolError("E_SCHEMA_INTEGER", "event sequence must be a positive safe integer", { path: `${pathLabel}.sequence`, eventId: value.eventId, sequence: value.sequence });
  if (value.priorEventFingerprint !== null) digest(value.priorEventFingerprint, `${pathLabel}.priorEventFingerprint`);
  if (!validUtcTimestamp(value.occurredAt)) protocolError("E_SCHEMA_DATETIME", "event occurredAt must be a calendar-valid RFC3339 UTC timestamp", { path: `${pathLabel}.occurredAt`, eventId: value.eventId, sequence: value.sequence });
  if (!new Set(["target-bound", "candidate-bound", "evidence-recorded", "assessment-started", "assessment-completed", "decision-recorded"]).has(value.type)) protocolError("E_EVENT_TYPE", `unknown event type ${value.type}`, { path: `${pathLabel}.type`, eventId: value.eventId, sequence: value.sequence });
  exactKeys(value.payload, [value.type === "target-bound" ? "target" : value.type === "candidate-bound" ? "candidate" : value.type === "evidence-recorded" ? "evidence" : value.type === "assessment-started" ? "invocation" : value.type === "assessment-completed" ? "assessment" : "decision"], `${pathLabel}.payload`);
  if (value.type === "target-bound") validateTarget(value.payload.target, `${pathLabel}.payload.target`);
  if (value.type === "candidate-bound") validateCandidate(value.payload.candidate, `${pathLabel}.payload.candidate`);
  if (value.type === "evidence-recorded") validateEvidence(value.payload.evidence, `${pathLabel}.payload.evidence`);
  if (value.type === "assessment-started") validateInvocation(value.payload.invocation, `${pathLabel}.payload.invocation`);
  if (value.type === "assessment-completed") validateAssessment(value.payload.assessment, `${pathLabel}.payload.assessment`);
  if (value.type === "decision-recorded") validateDecision(value.payload.decision, `${pathLabel}.payload.decision`);
}

function requiredEvidenceMap(target) {
  const result = new Map();
  for (const criterion of target.criteria) {
    if (!criterion.required) continue;
    for (const requirement of criterion.requiredEvidence) result.set(requirement.id, { criterionId: criterion.id, allowedSourceClasses: requirement.allowedSourceClasses });
  }
  return result;
}

function evidenceGate(target, evidence) {
  const required = requiredEvidenceMap(target);
  const observations = new Map(evidence.observations.map((entry) => [entry.id, entry]));
  const requiredFallbacks = new Set();
  const criterionIds = new Set(target.criteria.map((entry) => entry.id));
  for (const observation of evidence.observations) {
    if (!criterionIds.has(observation.criterionId)) protocolError("E_EVIDENCE_CRITERION_REF", `evidence ${observation.id} references unknown criterion ${observation.criterionId}`, { path: "$.events" });
  }
  for (const fallback of evidence.fallbacks) {
    if (fallback.forEvidenceId !== null && !observations.has(fallback.forEvidenceId)) protocolError("E_EVIDENCE_FALLBACK_REF", `fallback ${fallback.id} references unknown evidence ${fallback.forEvidenceId}`, { path: "$.events" });
    if (fallback.forEvidenceId !== null && required.has(fallback.forEvidenceId)) requiredFallbacks.add(fallback.forEvidenceId);
  }
  let state = "assessment-required";
  for (const [evidenceId, requirement] of required) {
    const observation = observations.get(evidenceId);
    if (!observation || observation.outcome === "not-run") return { state: "evidence-required", nextAction: "record-required-evidence" };
    if (observation.criterionId !== requirement.criterionId) protocolError("E_EVIDENCE_CRITERION_REF", `evidence ${evidenceId} references the wrong criterion`, { path: "$.events" });
    if (requirement.allowedSourceClasses.length && !requirement.allowedSourceClasses.includes(observation.sourceClass)) protocolError("E_EVIDENCE_SOURCE_CLASS", `evidence ${evidenceId} uses a disallowed source class`, { path: "$.events" });
    if (observation.outcome === "blocked") state = "blocked";
    else if (state !== "blocked" && observation.outcome === "unknown") state = "needs-human";
    else if (!new Set(["blocked", "needs-human"]).has(state) && new Set(["fail", "fallback"]).has(observation.outcome)) state = "remediation-required";
  }
  if (state === "assessment-required" && evidence.unresolvedUnknowns.length) state = "needs-human";
  if (state === "assessment-required" && requiredFallbacks.size) state = "remediation-required";
  const nextAction = state === "assessment-required" ? "start-assessment"
    : state === "evidence-required" ? "record-required-evidence"
      : state === "blocked" ? "resolve-evidence-block"
        : state === "needs-human" ? "resolve-evidence-unknown"
          : "repair-evidence-failure";
  return { state, nextAction };
}

function currentBindings(state) {
  return {
    targetFingerprint: state.targetFingerprint,
    candidateFingerprint: state.candidateFingerprint,
    evidenceFingerprint: state.evidenceFingerprint,
    assessmentFingerprint: state.assessmentFingerprint,
  };
}

function assertBinding(actual, expected, code, label, event) {
  if (actual !== expected) protocolError(code, `${label} does not match the current binding`, { path: "$.events", eventId: event.eventId, sequence: event.sequence });
}

function recordInvalidation(state, layer, previousFingerprint, event) {
  if (!previousFingerprint) return;
  state.invalidations.push({
    layer,
    previousFingerprint,
    causedByEventId: event.eventId,
    causedBySequence: event.sequence,
  });
}

function markInvocationStale(state, event) {
  if (!state.activeInvocation) return false;
  state.activeInvocation = { ...state.activeInvocation, status: "stale-active", invalidatedByEventId: event.eventId };
  return true;
}

function assessmentState(state, assessment, event) {
  const target = state.target;
  const evidence = state.evidence;
  const gate = evidenceGate(target, evidence);
  if (gate.state !== "assessment-required") return gate;
  const results = new Map(assessment.criterionResults.map((entry) => [entry.id, entry]));
  const criterionIds = new Set(target.criteria.map((entry) => entry.id));
  const observationIds = new Set(evidence.observations.map((entry) => entry.id));
  for (const result of assessment.criterionResults) {
    if (!criterionIds.has(result.id)) protocolError("E_ASSESSMENT_CRITERION_REF", `assessment references unknown criterion ${result.id}`, { path: "$.events", eventId: event.eventId, sequence: event.sequence });
    for (const evidenceId of result.basisEvidenceIds) {
      if (!observationIds.has(evidenceId)) protocolError("E_ASSESSMENT_EVIDENCE_REF", `assessment references unknown evidence ${evidenceId}`, { path: "$.events", eventId: event.eventId, sequence: event.sequence });
    }
  }
  for (const criterion of target.criteria.filter((entry) => entry.required)) {
    const result = results.get(criterion.id);
    if (!result) protocolError("E_ASSESSMENT_INCOMPLETE", `missing required criterion result ${criterion.id}`, { path: "$.events", eventId: event.eventId, sequence: event.sequence });
    for (const requirement of criterion.requiredEvidence) {
      if (!result.basisEvidenceIds.includes(requirement.id)) protocolError("E_ASSESSMENT_EVIDENCE_BASIS", `criterion ${criterion.id} omits required evidence basis ${requirement.id}`, { path: "$.events", eventId: event.eventId, sequence: event.sequence });
    }
    if (result.result === "blocked") return { state: "blocked", nextAction: "resolve-assessment-block" };
    if (new Set(["unknown", "not-applicable"]).has(result.result)) return { state: "needs-human", nextAction: "resolve-assessment-unknown" };
    if (result.result === "fail") return { state: "remediation-required", nextAction: "repair-assessment-findings" };
  }
  if (assessment.unresolvedUnknowns.length) return { state: "needs-human", nextAction: "resolve-assessment-unknown" };
  if (assessment.findings.some((finding) => finding.status === "open" && finding.blocksReadiness)) return { state: "remediation-required", nextAction: "repair-assessment-findings" };
  if (assessment.proposedOutcome === "blocked") return { state: "blocked", nextAction: "resolve-assessment-block" };
  if (assessment.proposedOutcome === "needs-human") return { state: "needs-human", nextAction: "human-decision-required" };
  if (assessment.proposedOutcome === "remediation-required") return { state: "remediation-required", nextAction: "repair-assessment-findings" };
  return { state: "ready-for-human", nextAction: "human-trust-checkpoint" };
}

function setState(state, derived) {
  state.assuranceState = derived.state;
  state.nextAction = derived.nextAction;
}

function currentRequiredState(state) {
  if (!state.target) return { state: "target-required", nextAction: "bind-target" };
  if (!state.candidate) return { state: "candidate-required", nextAction: "bind-candidate" };
  if (!state.evidence) return { state: "evidence-required", nextAction: "record-required-evidence" };
  return evidenceGate(state.target, state.evidence);
}

function applyDecisionEvent(state, event) {
  const value = event.payload.decision;
  const bindings = currentBindings(state);
  for (const field of Object.keys(bindings)) assertBinding(value.bindings[field], bindings[field], "E_DECISION_BINDING", `decision ${field}`, event);
  if (state.decisions.some((decision) => decision.decisionId === value.decisionId)) protocolError("E_DECISION_ID_REUSED", "decisionId was already used", { eventId: event.eventId, sequence: event.sequence });
  const record = { ...value, current: true, recordedByEventId: event.eventId };
  const deferredReady = state.assuranceState === "needs-human"
    && Boolean(state.assessmentFingerprint)
    && state.decisions.some((decision) => decision.current && decision.action === "defer-current")
    && assessmentState(state, state.assessment, event).state === "ready-for-human";
  if (new Set(["accept-current", "reject-current", "defer-current"]).has(value.action) && value.invocationId !== null) {
    protocolError("E_DECISION_INVOCATION", `${value.action} must use invocationId null`, { eventId: event.eventId, sequence: event.sequence });
  }
  if (value.action === "abandon") {
    const expectedInvocationId = state.activeInvocation?.invocationId || null;
    if (value.invocationId !== expectedInvocationId) protocolError("E_DECISION_INVOCATION", "abandon must bind the active invocation ID, or null when none is active", { eventId: event.eventId, sequence: event.sequence });
  }
  if (value.action === "authorize-assessment-retry") {
    if (!state.activeInvocation || !new Set(["live", "stale-active"]).has(state.activeInvocation.status)) protocolError("E_RECOVERY_INVOCATION", "retry authorization requires a live or stale-active invocation", { eventId: event.eventId, sequence: event.sequence });
    if (value.invocationId !== state.activeInvocation.invocationId) protocolError("E_RECOVERY_INVOCATION", "retry authorization invocationId mismatch", { eventId: event.eventId, sequence: event.sequence });
    state.invocationHistory.push({ ...state.activeInvocation, status: "retry-authorized", decisionId: value.decisionId });
    state.activeInvocation = null;
    state.assessment = null;
    state.assessmentFingerprint = null;
    setState(state, currentRequiredState(state));
  } else if (value.action === "accept-current") {
    if ((state.assuranceState !== "ready-for-human" && !deferredReady) || !state.assessmentFingerprint) protocolError("E_DECISION_STATE", "accept-current requires ready-for-human or its exact deferred decision", { eventId: event.eventId, sequence: event.sequence });
    state.assuranceState = "ready-for-human";
    state.nextAction = "external-action-remains-human-owned";
  } else if (value.action === "reject-current") {
    if (state.assuranceState !== "ready-for-human" && !deferredReady) protocolError("E_DECISION_STATE", "reject-current requires ready-for-human or its exact deferred decision", { eventId: event.eventId, sequence: event.sequence });
    setState(state, { state: "remediation-required", nextAction: "repair-after-human-rejection" });
  } else if (value.action === "defer-current") {
    const preTarget = state.assuranceState === "target-required"
      && Object.values(bindings).every((binding) => binding === null);
    if (state.assuranceState !== "ready-for-human" && !preTarget) protocolError("E_DECISION_STATE", "defer-current requires ready-for-human or an all-null pre-target state", { eventId: event.eventId, sequence: event.sequence });
    setState(state, { state: "needs-human", nextAction: "resume-human-decision" });
  } else if (value.action === "abandon") {
    if (state.activeInvocation) state.invocationHistory.push({ ...state.activeInvocation, status: "abandoned", decisionId: value.decisionId });
    state.activeInvocation = null;
    setState(state, { state: "abandoned", nextAction: "none" });
  }
  state.decisions = state.decisions.map((decision) => ({ ...decision, current: false }));
  state.decisions.push(record);
}

function applyEvent(state, event) {
  if (state.assuranceState === "abandoned") protocolError("E_LINEAGE_ABANDONED", "no new event is allowed after abandonment", { eventId: event.eventId, sequence: event.sequence });
  if (event.type === "decision-recorded") {
    applyDecisionEvent(state, event);
    return;
  }
  if (event.type === "target-bound") {
    const value = event.payload.target;
    const observed = fingerprint("target", value);
    if (observed === state.targetFingerprint) return;
    const staleActive = markInvocationStale(state, event);
    recordInvalidation(state, "target", state.targetFingerprint, event);
    recordInvalidation(state, "candidate", state.candidateFingerprint, event);
    recordInvalidation(state, "evidence", state.evidenceFingerprint, event);
    recordInvalidation(state, "assessment", state.assessmentFingerprint, event);
    state.target = value;
    state.targetFingerprint = observed;
    state.candidate = null;
    state.candidateFingerprint = null;
    state.evidence = null;
    state.evidenceFingerprint = null;
    state.assessment = null;
    state.assessmentFingerprint = null;
    state.decisions = state.decisions.map((decision) => ({ ...decision, current: false }));
    setState(state, staleActive ? { state: "needs-human", nextAction: "resolve-stale-assessment-invocation" } : { state: "candidate-required", nextAction: "bind-candidate" });
    return;
  }
  if (!state.target) protocolError("E_TARGET_REQUIRED", "target must be bound first", { eventId: event.eventId, sequence: event.sequence });
  if (event.type === "candidate-bound") {
    const value = event.payload.candidate;
    assertBinding(value.targetFingerprint, state.targetFingerprint, "E_CANDIDATE_TARGET_BINDING", "candidate targetFingerprint", event);
    const observed = fingerprint("candidate", value);
    if (observed === state.candidateFingerprint) return;
    const staleActive = markInvocationStale(state, event);
    recordInvalidation(state, "candidate", state.candidateFingerprint, event);
    recordInvalidation(state, "evidence", state.evidenceFingerprint, event);
    recordInvalidation(state, "assessment", state.assessmentFingerprint, event);
    state.candidate = value;
    state.candidateFingerprint = observed;
    state.evidence = null;
    state.evidenceFingerprint = null;
    state.assessment = null;
    state.assessmentFingerprint = null;
    state.decisions = state.decisions.map((decision) => ({ ...decision, current: false }));
    setState(state, staleActive ? { state: "needs-human", nextAction: "resolve-stale-assessment-invocation" } : { state: "evidence-required", nextAction: "record-required-evidence" });
    return;
  }
  if (!state.candidate) protocolError("E_CANDIDATE_REQUIRED", "candidate must be bound first", { eventId: event.eventId, sequence: event.sequence });
  if (event.type === "evidence-recorded") {
    const value = event.payload.evidence;
    assertBinding(value.targetFingerprint, state.targetFingerprint, "E_EVIDENCE_TARGET_BINDING", "evidence targetFingerprint", event);
    assertBinding(value.candidateFingerprint, state.candidateFingerprint, "E_EVIDENCE_CANDIDATE_BINDING", "evidence candidateFingerprint", event);
    const observed = fingerprint("evidence", value);
    if (observed === state.evidenceFingerprint) return;
    const staleActive = markInvocationStale(state, event);
    recordInvalidation(state, "evidence", state.evidenceFingerprint, event);
    recordInvalidation(state, "assessment", state.assessmentFingerprint, event);
    state.evidence = value;
    state.evidenceFingerprint = observed;
    state.assessment = null;
    state.assessmentFingerprint = null;
    state.decisions = state.decisions.map((decision) => ({ ...decision, current: false }));
    setState(state, staleActive ? { state: "needs-human", nextAction: "resolve-stale-assessment-invocation" } : evidenceGate(state.target, value));
    return;
  }
  if (event.type === "assessment-completed" && (!state.activeInvocation || state.activeInvocation.status !== "live")) {
    protocolError("E_INVOCATION_NOT_ACTIVE", "no matching live assessment invocation", { eventId: event.eventId, sequence: event.sequence });
  }
  if (!state.evidence) protocolError("E_EVIDENCE_REQUIRED", "evidence must be recorded first", { eventId: event.eventId, sequence: event.sequence });
  if (event.type === "assessment-started") {
    const value = event.payload.invocation;
    if (state.activeInvocation) protocolError("E_INVOCATION_ACTIVE", "an assessment invocation is already active", { eventId: event.eventId, sequence: event.sequence });
    const gate = evidenceGate(state.target, state.evidence);
    if (gate.state !== "assessment-required") protocolError("E_EVIDENCE_INCOMPLETE", `evidence gate is ${gate.state}`, { eventId: event.eventId, sequence: event.sequence });
    if (state.assuranceState !== "assessment-required") protocolError("E_ASSESSMENT_STATE", `assessment cannot start from ${state.assuranceState}`, { eventId: event.eventId, sequence: event.sequence });
    assertBinding(value.targetFingerprint, state.targetFingerprint, "E_INVOCATION_TARGET_BINDING", "invocation targetFingerprint", event);
    assertBinding(value.candidateFingerprint, state.candidateFingerprint, "E_INVOCATION_CANDIDATE_BINDING", "invocation candidateFingerprint", event);
    assertBinding(value.evidenceFingerprint, state.evidenceFingerprint, "E_INVOCATION_EVIDENCE_BINDING", "invocation evidenceFingerprint", event);
    if (state.invocationHistory.some((entry) => entry.invocationId === value.invocationId)) protocolError("E_INVOCATION_ID_REUSED", "invocationId was already used", { eventId: event.eventId, sequence: event.sequence });
    state.activeInvocation = { ...value, status: "live", startedByEventId: event.eventId };
    setState(state, { state: "assessment-running", nextAction: "complete-or-explicitly-resolve-assessment" });
    return;
  }
  if (event.type === "assessment-completed") {
    const value = event.payload.assessment;
    if (!state.activeInvocation || state.activeInvocation.status !== "live") protocolError("E_INVOCATION_NOT_ACTIVE", "no matching live assessment invocation", { eventId: event.eventId, sequence: event.sequence });
    if (value.invocationId !== state.activeInvocation.invocationId) protocolError("E_INVOCATION_MISMATCH", "assessment invocationId mismatch", { eventId: event.eventId, sequence: event.sequence });
    assertBinding(value.targetFingerprint, state.targetFingerprint, "E_ASSESSMENT_TARGET_BINDING", "assessment targetFingerprint", event);
    assertBinding(value.candidateFingerprint, state.candidateFingerprint, "E_ASSESSMENT_CANDIDATE_BINDING", "assessment candidateFingerprint", event);
    assertBinding(value.evidenceFingerprint, state.evidenceFingerprint, "E_ASSESSMENT_EVIDENCE_BINDING", "assessment evidenceFingerprint", event);
    const observed = fingerprint("assessment", value);
    state.assessment = value;
    state.assessmentFingerprint = observed;
    state.invocationHistory.push({ ...state.activeInvocation, status: "completed", completedByEventId: event.eventId, assessmentFingerprint: observed });
    state.activeInvocation = null;
    setState(state, assessmentState(state, value, event));
    return;
  }
  protocolError("E_EVENT_TYPE", `unsupported event type ${event.type}`, { eventId: event.eventId, sequence: event.sequence });
}

function initialState(lineageId) {
  return {
    lineageId,
    assuranceState: "target-required",
    nextAction: "bind-target",
    target: null,
    targetFingerprint: null,
    candidate: null,
    candidateFingerprint: null,
    evidence: null,
    evidenceFingerprint: null,
    assessment: null,
    assessmentFingerprint: null,
    activeInvocation: null,
    invocationHistory: [],
    invalidations: [],
    decisions: [],
    acceptedEvents: [],
    acceptedSequence: 0,
    headEventFingerprint: null,
    seenEvents: new Map(),
  };
}

function validResult(state) {
  const evidenceUnknowns = state.evidence?.unresolvedUnknowns || [];
  const assessmentUnknowns = state.assessment?.unresolvedUnknowns || [];
  const evidenceLimits = state.evidence?.coverageLimits || [];
  const assessmentLimits = state.assessment?.coverageLimits || [];
  const result = {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    lineageId: state.lineageId,
    assuranceState: state.assuranceState,
    nextAction: state.nextAction,
    acceptedSequence: state.acceptedSequence,
    headEventFingerprint: state.headEventFingerprint,
    traceFingerprint: fingerprint("trace", { lineageId: state.lineageId, events: state.acceptedEvents }),
    bindings: currentBindings(state),
    activeInvocation: state.activeInvocation,
    invalidations: state.invalidations,
    unresolvedUnknowns: [...evidenceUnknowns, ...assessmentUnknowns],
    coverageLimits: [...evidenceLimits, ...assessmentLimits],
    fallbacks: state.evidence?.fallbacks || [],
    findings: state.assessment?.findings || [],
    decisions: state.decisions,
    authorityBoundary: {
      finalDecision: "human",
      actorAuthentication: "unverified",
      grantsExternalAuthority: false,
    },
  };
  result.resultFingerprint = fingerprint("result", result);
  return result;
}

function reduceTrace(trace) {
  exactKeys(trace, ["schemaVersion", "protocolVersion", "lineageId", "events"], "$");
  if (trace.schemaVersion !== SCHEMA_VERSION) protocolError("E_SCHEMA_VERSION", "trace schemaVersion must be 1", { path: "$.schemaVersion" });
  if (trace.protocolVersion !== PROTOCOL_VERSION) protocolError("E_PROTOCOL_VERSION", "trace protocolVersion is unsupported", { path: "$.protocolVersion" });
  id(trace.lineageId, "$.lineageId");
  if (!Array.isArray(trace.events)) protocolError("E_SCHEMA_ARRAY", "events must be an array", { path: "$.events" });
  if (trace.events.length > MAX_EVENTS) protocolError("E_EVENT_LIMIT", `events exceeds ${MAX_EVENTS}`, { path: "$.events" });
  const state = initialState(trace.lineageId);
  for (let index = 0; index < trace.events.length; index += 1) {
    const event = trace.events[index];
    try {
      validateEvent(event, index, trace.lineageId);
      const canonicalEvent = canonicalJson(event);
      const seen = state.seenEvents.get(event.eventId);
      if (seen) {
        if (seen.canonical !== canonicalEvent) protocolError("E_EVENT_ID_CONFLICT", "eventId was reused with different content", { eventId: event.eventId, sequence: event.sequence });
        continue;
      }
      const expectedSequence = state.acceptedSequence + 1;
      if (event.sequence !== expectedSequence) {
        const code = event.sequence < expectedSequence ? "E_SEQUENCE_CONFLICT" : "E_SEQUENCE_GAP";
        protocolError(code, `event sequence ${event.sequence} does not equal ${expectedSequence}`, { eventId: event.eventId, sequence: event.sequence });
      }
      if (event.priorEventFingerprint !== state.headEventFingerprint) protocolError("E_EVENT_CHAIN", "priorEventFingerprint does not match current head", { eventId: event.eventId, sequence: event.sequence });
      applyEvent(state, event);
      const eventFingerprint = fingerprint("event", event);
      state.seenEvents.set(event.eventId, { canonical: canonicalEvent, fingerprint: eventFingerprint });
      state.acceptedEvents.push(event);
      state.acceptedSequence = event.sequence;
      state.headEventFingerprint = eventFingerprint;
    } catch (error) {
      if (error instanceof ProtocolError) {
        error.acceptedSequence = state.acceptedSequence;
        error.lastValidState = state.assuranceState;
      }
      throw error;
    }
  }
  return validResult(state);
}

function invalidResult(error) {
  const result = {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: {
      code: error.code || "E_PROTOCOL",
      path: error.path || null,
      eventId: error.eventId || null,
      sequence: Number.isInteger(error.sequence) ? error.sequence : null,
      message: error.message || "invalid protocol input",
    },
  };
  if (Number.isInteger(error.acceptedSequence)) {
    result.diagnosticContext = {
      nonAuthoritative: true,
      acceptedSequence: error.acceptedSequence,
      lastValidState: error.lastValidState || null,
    };
  }
  return result;
}

function projectV06(value) {
  object(value, "$legacy");
  if (value.schemaVersion !== 1) protocolError("E_LEGACY_SCHEMA_VERSION", "legacy schemaVersion must be 1", { path: "$legacy.schemaVersion" });
  if (value.contractVersion !== "0.6") protocolError("E_LEGACY_VERSION", "only legacy contractVersion 0.6 is supported", { path: "$legacy.contractVersion" });
  const mapping = {
    "proofs-required": "evidence-required",
    "evaluator-required": "assessment-required",
    "evaluator-running": "assessment-running",
    "fix-required": "remediation-required",
    "blocked-by-environment": "blocked",
    abandoned: "abandoned",
  };
  const known = new Set(["idle", "critic-required", "builder-required", "builder-in-progress", "proofs-required", "evaluator-required", "evaluator-running", "candidate-ready", "fix-required", "needs-user", "blocked-by-environment", "non-convergent", "abandoned"]);
  if (!known.has(value.state)) protocolError("E_LEGACY_STATE", "legacy state is unsupported", { path: "$legacy.state" });
  if (typeof value.nextAction !== "string" || !value.nextAction) protocolError("E_LEGACY_NEXT_ACTION", "legacy nextAction must be non-empty", { path: "$legacy.nextAction" });
  const warnings = [{ code: "legacy-state-projection-lossy", coverageLimit: "State-only projection does not reconstruct or validate legacy cycle artifacts." }];
  if (value.state === "candidate-ready") warnings.push({ code: "legacy-ready-claim-unverified", coverageLimit: "Legacy readiness is not v0.7 four-binding readiness." });
  return {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    projectionKind: "lossy",
    protocolConformant: false,
    legacyContractVersion: value.contractVersion,
    legacyState: value.state,
    legacyNextAction: value.nextAction,
    assuranceState: mapping[value.state] || "needs-human",
    warnings,
    authorityBoundary: {
      grantsV07Readiness: false,
      grantsExternalAuthority: false,
    },
  };
}

function parseCli(argv) {
  const command = argv[2];
  const flag = command === "reduce" ? "--trace" : command === "project-v06" ? "--state" : command === "fingerprint" ? "--input" : null;
  if (!flag) throw new Error("usage: assurance reduce --trace <file> --json | assurance project-v06 --state <file> --json | assurance fingerprint --domain <name> --input <file> --json");
  let file = null;
  let json = false;
  let domain = null;
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      if (!argv[index + 1]) throw new Error(`${flag} requires a file`);
      file = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--json") {
      json = true;
    } else if (argv[index] === "--domain") {
      if (!argv[index + 1]) throw new Error("--domain requires a value");
      domain = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown option: ${argv[index]}`);
    }
  }
  if (!file || !json) throw new Error(`${flag} and --json are required`);
  if (command === "fingerprint" && !FINGERPRINT_DOMAINS.has(domain)) throw new Error(`--domain must be one of ${[...FINGERPRINT_DOMAINS].join(", ")}`);
  return { command, file, domain };
}

function printHelp() {
  process.stdout.write(`steadyspec assurance\n\nExperimental protocol-candidate reference process.\n\nUsage:\n  steadyspec assurance reduce --trace <file> --json\n  steadyspec assurance fingerprint --domain <target|candidate|evidence|assessment|event|trace|result> --input <file> --json\n  steadyspec assurance project-v06 --state <file> --json\n\nExit 0 means valid input, not ready-for-human or external authority.\n`);
}

function main() {
  if (!process.argv[2] || process.argv[2] === "--help" || process.argv[2] === "-h") {
    printHelp();
    return;
  }
  let args;
  try {
    args = parseCli(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  let input;
  try {
    const bytes = fs.readFileSync(args.file);
    if (bytes.length > MAX_INPUT_BYTES) protocolError("E_INPUT_TOO_LARGE", `input exceeds ${MAX_INPUT_BYTES} bytes`, { path: "$" });
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      protocolError("E_JSON_UTF8", "input is not valid UTF-8", { path: "$" });
    }
    input = parseJsonStrict(text);
    const result = args.command === "reduce" ? reduceTrace(input)
      : args.command === "project-v06" ? projectV06(input)
        : {
          schemaVersion: SCHEMA_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          ok: true,
          domain: args.domain,
          fingerprint: fingerprint(args.domain, input),
        };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof ProtocolError) {
      process.stdout.write(`${JSON.stringify(invalidResult(error))}\n`);
      process.exitCode = 2;
      return;
    }
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
