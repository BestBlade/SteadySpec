const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PHASES = new Set(["proposal", "apply", "verify", "archive"]);
const RESULT_VALUES = new Set(["pass", "fail", "drift", "fallback", "blocked"]);
const RECOMMENDED_NEXT_VALUES = new Set(["continue", "archive", "handoff", "re-open-intent", "stop"]);
const DELEGATION_STATUS_VALUES = new Set(["ready", "needs-human"]);
const DELEGATION_REVIEW_VALUES = new Set(["pass", "misclassified", "blocked"]);
const TRUST_FIELD_VALUES = {
  "Intent Match": new Set(["pass", "gap", "blocked"]),
  "Delegation Review": DELEGATION_REVIEW_VALUES,
  "Evidence Credibility": new Set(["pass", "gap", "blocked"]),
  "Risk Routing Review": new Set(["pass", "misclassified", "blocked"]),
  "Debt/Fallback Visibility": new Set(["pass", "gap", "blocked"]),
};

const REQUIRED_PROPOSAL_ANCHORS = [
  "## Intent",
  "## Delegation Boundary",
  "## Challenge Resolution",
  "## Boundary",
  "## Evidence Required",
  "## Stop Conditions",
  "## Decision Ledger",
  "## Risk Routing",
  "## Attention Report",
];

const REQUIRED_DELEGATION_FIELDS = [
  "Authorized Outcome",
  "Hard Constraints",
  "Challengeable Assumptions",
  "Proposed Means",
  "Delegated Decisions",
  "Challenge Resolution",
  "Delegation Status",
];

const REQUIRED_EVIDENCE_FIELDS = [
  "Proof Command",
  "Result",
  "Output Summary",
  "Coverage Limit",
  "Linked Decisions",
  "Fallback",
  "Accepted Debt",
];

const REQUIRED_ARCHIVE_ANCHORS = [
  "## Final Decisions",
  "## Intent Match",
  "## Evidence Summary",
  "## Accepted Debt And Fallback",
  "## Drift And Re-Slice Events",
  "## Human Decisions",
  "## Doc Sync",
  "## Durable Truth Gates",
  "## Follow-Up And Re-Open Triggers",
];

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function result(severity, code, file, message) {
  return { severity, code, file, message };
}

function addError(results, code, file, message) {
  results.push(result("error", code, file, message));
}

function addWarning(results, code, file, message) {
  results.push(result("warning", code, file, message));
}

function hasSchemaVersion(text) {
  return /^schemaVersion:\s*1\s*$/m.test(text);
}

function hasAnchor(text, anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*$`, "m").test(text);
}

function anchorCount(text, anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`^${escaped}\\s*$`, "gm"))].length;
}

function sectionText(text, anchor) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === anchor);
  if (start === -1) return "";
  const level = anchor.match(/^#+/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s+/);
    if (match && match[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

function hasField(text, field) {
  return fieldValues(text, field).length > 0;
}

function fieldValue(text, field) {
  return fieldValues(text, field)[0] || "";
}

function fieldValues(text, field) {
  const expected = String(field || "").trim().toLowerCase();
  return String(text || "")
    .split(/\r?\n/)
    .map(tableCells)
    .filter((cells) => cells.length === 2 && cells[0].toLowerCase() === expected)
    .map((cells) => cells[1].replace(/\\\|/g, "|").trim());
}

function isUnfinishedDelegationValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  if (/^<[^>]+>$/.test(normalized)) return true;
  return /^(?:unresolved|unknown|tbd|todo|pending)(?:\b|\s*:)/i.test(normalized)
    || /^not\s+(?:recorded|yet\s+(?:known|decided|resolved)|determined)\b/i.test(normalized);
}

function authorityRefParts(value) {
  const normalized = String(value || "").trim();
  if (isUnfinishedDelegationValue(normalized) || /^(?:none|n\/a|not-required)$/i.test(normalized)) return null;
  const hash = normalized.indexOf("#");
  if (hash <= 0 || hash !== normalized.lastIndexOf("#")) return null;
  const artifactPath = normalized.slice(0, hash);
  const anchor = normalized.slice(hash + 1);
  const segments = artifactPath.split("/");
  if (!artifactPath.endsWith(".md") || artifactPath.startsWith("/") || artifactPath.includes("\\") || /^[A-Za-z]:/.test(artifactPath)) return null;
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(anchor)) return null;
  return { artifactPath, anchor };
}

function concreteAuthorityRef(value) {
  return authorityRefParts(value) !== null;
}

function markdownHeadingAnchor(heading) {
  return String(heading || "")
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9 _.-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function authorityRefTargetError(value, changeDir) {
  const parsed = authorityRefParts(value);
  if (!parsed) return "authority-ref-shape-invalid";
  const changeRoot = fs.realpathSync(path.resolve(changeDir));
  const target = path.resolve(changeRoot, ...parsed.artifactPath.split("/"));
  const relative = path.relative(changeRoot, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return "authority-ref-outside-change";
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return "authority-ref-target-missing";
  const actual = fs.realpathSync(target);
  const actualRelative = path.relative(changeRoot, actual);
  if (!actualRelative || actualRelative === ".." || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) return "authority-ref-outside-change";
  const source = readIfExists(actual);
  if (source === null) return "authority-ref-target-unreadable";
  const expected = parsed.anchor.toLowerCase();
  const found = source.split(/\r?\n/).some((line) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    return match && markdownHeadingAnchor(match[1]) === expected;
  });
  return found ? null : "authority-ref-anchor-missing";
}

function delegationFieldIsConcrete(field, value) {
  const normalized = String(value || "").trim();
  if (field === "Hard Constraints" && /^none recorded$/i.test(normalized)) return true;
  if (field === "Challengeable Assumptions" && /^none identified(?: after challenge)?$/i.test(normalized)) return true;
  if (field === "Delegated Decisions" && /^none recorded$/i.test(normalized)) return true;
  if (field === "Challenge Resolution" && /^none-raised$/i.test(normalized)) return true;
  return !isUnfinishedDelegationValue(normalized);
}

function tableCells(line) {
  if (!/^\s*\|/.test(line)) return [];
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function unescapeTableCell(value) {
  return String(value || "").replace(/\\\|/g, "|").trim();
}

function challengeResolutionRows(text) {
  const body = sectionText(text, "## Challenge Resolution");
  const lines = body.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  if (lines.length < 2) return [];
  return lines.slice(2).map(tableCells).filter((cells) => cells.length === 8).map((cells) => ({
    findingId: unescapeTableCell(cells[0]),
    finding: unescapeTableCell(cells[1]),
    layer: unescapeTableCell(cells[2]),
    owner: unescapeTableCell(cells[3]),
    status: unescapeTableCell(cells[4]),
    authorityBasis: unescapeTableCell(cells[5]),
    authorityRef: unescapeTableCell(cells[6]),
    resolution: unescapeTableCell(cells[7]),
  }));
}

function delegationBoundaryReadback(proposal) {
  if (proposal === null) return null;
  const boundary = sectionText(proposal, "## Delegation Boundary");
  const list = (field) => fieldValue(boundary, field).split("<br>").map((item) => item.trim()).filter(Boolean);
  const rows = challengeResolutionRows(proposal);
  const challengeResolution = rows.length === 1 && rows[0].findingId === "none" && rows[0].status === "none-raised" ? [] : rows;
  return {
    authorizedOutcome: fieldValue(boundary, "Authorized Outcome"),
    hardConstraints: list("Hard Constraints"),
    challengeableAssumptions: list("Challengeable Assumptions"),
    proposedMeans: list("Proposed Means"),
    delegatedDecisions: list("Delegated Decisions"),
    challengeResolution,
    status: fieldValue(boundary, "Delegation Status"),
  };
}

function challengeResolutionTableErrors(text) {
  const body = sectionText(text, "## Challenge Resolution");
  const lines = body.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  const errors = [];
  const expectedHeader = ["Finding ID", "Finding", "Layer", "Owner", "Status", "Authority Basis", "Authority Ref", "Resolution"];
  if (lines.length < 3) return ["challenge-resolution-table-incomplete"];
  const header = tableCells(lines[0]);
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) errors.push("challenge-resolution-header-invalid");
  const separator = tableCells(lines[1]);
  if (separator.length !== 8 || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) errors.push("challenge-resolution-separator-invalid");
  const findingIds = new Set();
  for (let index = 2; index < lines.length; index += 1) {
    const cells = tableCells(lines[index]);
    if (cells.length !== 8) {
      errors.push(`challenge-resolution-row-${index - 1}-column-count-${cells.length}`);
      continue;
    }
    const findingId = cells[0];
    if (findingIds.has(findingId)) errors.push(`${findingId || "unknown"}:duplicate-finding-id`);
    findingIds.add(findingId);
  }
  return errors;
}

function challengeAuthorityErrors(rows, changeDir) {
  const errors = [];
  const layers = new Set(["authorized-outcome", "hard-constraint", "assumption", "means", "delegated-decision"]);
  const owners = new Set(["user", "agent", "shared"]);
  const statuses = new Set(["resolved", "within-delegation", "unresolved"]);
  const bases = new Set(["human-decision", "prior-delegation", "agent-delegation", "not-required"]);
  if (rows.length === 1 && rows[0].findingId === "none" && rows[0].status === "none-raised") {
    const row = rows[0];
    if (row.layer !== "none" || row.owner !== "none" || row.authorityBasis !== "not-required" || row.authorityRef !== "none" || [row.finding, row.resolution].some(isUnfinishedDelegationValue)) {
      errors.push("none:invalid-none-raised-sentinel");
    }
    return errors;
  }
  if (rows.length === 0) return ["challenge-resolution-rows-missing"];
  for (const row of rows) {
    if (!layers.has(row.layer) || !owners.has(row.owner) || !statuses.has(row.status) || !bases.has(row.authorityBasis)) {
      errors.push(`${row.findingId || "unknown"}:invalid-challenge-resolution-enum`);
      continue;
    }
    if ([row.findingId, row.finding, row.resolution].some(isUnfinishedDelegationValue)) errors.push(`${row.findingId || "unknown"}:unfinished-challenge-resolution`);
    const coreLayer = row.layer === "authorized-outcome" || row.layer === "hard-constraint";
    if (coreLayer && row.status === "resolved") {
      if (!new Set(["user", "shared"]).has(row.owner) || row.authorityBasis !== "human-decision" || !concreteAuthorityRef(row.authorityRef)) {
        errors.push(`${row.findingId}:core-change-without-human-decision`);
      }
    } else if (coreLayer && row.status === "within-delegation") {
      if (row.authorityBasis !== "prior-delegation" || !concreteAuthorityRef(row.authorityRef)) errors.push(`${row.findingId}:core-change-without-prior-delegation`);
    } else if (row.status !== "unresolved") {
      if (row.authorityBasis === "not-required" || !concreteAuthorityRef(row.authorityRef)) errors.push(`${row.findingId}:resolved-challenge-without-authority-ref`);
    }
    if (row.status !== "unresolved" && concreteAuthorityRef(row.authorityRef)) {
      const targetError = authorityRefTargetError(row.authorityRef, changeDir);
      if (targetError) errors.push(`${row.findingId}:${targetError}`);
    }
  }
  return errors;
}

function checkedTaskCount(tasksText) {
  if (!tasksText) return 0;
  return (tasksText.match(/^\s*-\s*\[[xX]\]\s+/gm) || []).length;
}

function checkSchema(text, file, results) {
  if (!hasSchemaVersion(text)) {
    addWarning(results, "DOCS_SCHEMA_MISSING", file, `${file} has no schemaVersion: 1 marker; treating as legacy input.`);
  }
}

function validateDelegationSection(proposal, changeDir, results, requireDelegationReady = false) {
  for (const anchor of ["## Delegation Boundary", "## Challenge Resolution"]) {
    if (anchorCount(proposal, anchor) !== 1) addError(results, "DOCS_PROPOSAL_DELEGATION_SECTION_AMBIGUOUS", "proposal.md", `Delegation heading must appear exactly once: ${anchor}`);
  }
  const boundary = sectionText(proposal, "## Delegation Boundary");
  for (const field of REQUIRED_DELEGATION_FIELDS) {
    const values = fieldValues(boundary, field);
    if (values.length === 0) {
      addError(results, "DOCS_PROPOSAL_MISSING_DELEGATION_FIELD", "proposal.md", `Missing required delegation field: ${field}`);
      continue;
    }
    if (values.length > 1) {
      addError(results, "DOCS_PROPOSAL_DUPLICATE_DELEGATION_FIELD", "proposal.md", `Delegation field must appear exactly once: ${field}`);
      continue;
    }
    if (!values[0]) {
      addError(results, "DOCS_PROPOSAL_EMPTY_DELEGATION_FIELD", "proposal.md", `Delegation field is empty: ${field}`);
    }
  }
  const delegationStatus = fieldValue(boundary, "Delegation Status");
  if (delegationStatus && !DELEGATION_STATUS_VALUES.has(delegationStatus)) {
    addError(results, "DOCS_PROPOSAL_INVALID_DELEGATION_STATUS", "proposal.md", `Delegation Status must be one of: ${Array.from(DELEGATION_STATUS_VALUES).join(", ")}`);
  }
  const challengeRows = challengeResolutionRows(proposal);
  for (const tableError of challengeResolutionTableErrors(proposal)) {
    addError(results, "DOCS_PROPOSAL_INVALID_CHALLENGE_TABLE", "proposal.md", `Invalid challenge table: ${tableError}`);
  }
  const authorityErrors = challengeAuthorityErrors(challengeRows, changeDir);
  for (const authorityError of authorityErrors) {
    addError(results, "DOCS_PROPOSAL_INVALID_CHALLENGE_AUTHORITY", "proposal.md", `Invalid challenge authority: ${authorityError}`);
  }
  if (delegationStatus === "ready") {
    for (const field of REQUIRED_DELEGATION_FIELDS.filter((item) => item !== "Delegation Status")) {
      const value = fieldValue(boundary, field);
      if (!delegationFieldIsConcrete(field, value)) {
        addError(results, "DOCS_PROPOSAL_DELEGATION_NOT_CONCRETE", "proposal.md", `Delegation Status cannot be ready while ${field} is unfinished or still a template placeholder.`);
      }
    }
  }
  if (delegationStatus === "ready" && challengeRows.some((row) => row.status === "unresolved")) {
    addError(results, "DOCS_PROPOSAL_UNRESOLVED_CHALLENGE", "proposal.md", "Delegation Status cannot be ready while Challenge Resolution is unresolved.");
  }
  if (requireDelegationReady && delegationStatus !== "ready") {
    addError(results, "DOCS_APPLY_DELEGATION_NOT_READY", "proposal.md", "Apply/verify requires Delegation Status: ready; classify or resolve the delegation boundary first.");
  }
  return { delegationStatus, challengeRows };
}

function validateProposal(changeDir, results, requireDelegationReady = false) {
  const proposalPath = path.join(changeDir, "proposal.md");
  const proposal = readIfExists(proposalPath);
  if (proposal === null) {
    addError(results, "DOCS_PROPOSAL_MISSING_FILE", "proposal.md", "proposal.md is required.");
    return;
  }
  checkSchema(proposal, "proposal.md", results);
  for (const anchor of REQUIRED_PROPOSAL_ANCHORS) {
    if (!hasAnchor(proposal, anchor)) {
      addError(results, "DOCS_PROPOSAL_MISSING_ANCHOR", "proposal.md", `Missing required anchor: ${anchor}`);
      continue;
    }
    if (!sectionText(proposal, anchor)) {
      addError(results, "DOCS_PROPOSAL_EMPTY_SECTION", "proposal.md", `Required section is empty: ${anchor}`);
    }
  }
  validateDelegationSection(proposal, changeDir, results, requireDelegationReady);
}

function validateApply(changeDir, results) {
  validateProposal(changeDir, results, true);
  const tasks = readIfExists(path.join(changeDir, "tasks.md"));
  if (tasks !== null) checkSchema(tasks, "tasks.md", results);
  if (checkedTaskCount(tasks) === 0) return;

  const evidence = readIfExists(path.join(changeDir, "evidence.md"));
  if (evidence === null) {
    addError(results, "DOCS_EVIDENCE_MISSING_FILE", "evidence.md", "Completed tasks require evidence.md.");
    return;
  }
  checkSchema(evidence, "evidence.md", results);
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!hasField(evidence, field)) {
      addError(results, "DOCS_EVIDENCE_MISSING_FIELD", "evidence.md", `Missing required evidence field: ${field}`);
    }
  }
  const evidenceResult = fieldValue(evidence, "Result");
  if (evidenceResult && !RESULT_VALUES.has(evidenceResult)) {
    addError(results, "DOCS_EVIDENCE_INVALID_RESULT", "evidence.md", `Evidence Result must be one of: ${Array.from(RESULT_VALUES).join(", ")}`);
  }
}

function validateTrustCheckpointSection(changeDir, trustSection, results, codePrefix, requireArchiveReady = false) {
  const expectedChangeId = path.basename(fs.realpathSync(path.resolve(changeDir)));
  const changeValues = fieldValues(trustSection, "Change");
  if (changeValues.length === 0) {
    addError(results, `${codePrefix}_MISSING_CHANGE`, "trust-checkpoint.md", "Trust checkpoint must bind the active Change identity.");
  } else if (changeValues.length > 1) {
    addError(results, `${codePrefix}_DUPLICATE_CHANGE`, "trust-checkpoint.md", "Trust checkpoint must contain exactly one Change field.");
  } else if (changeValues[0] !== expectedChangeId) {
    addError(results, `${codePrefix}_CHANGE_MISMATCH`, "trust-checkpoint.md", `Trust checkpoint Change must equal the active change id ${expectedChangeId}, observed: ${changeValues[0]}`);
  }

  const observed = {};
  for (const [field, allowed] of Object.entries(TRUST_FIELD_VALUES)) {
    const values = fieldValues(trustSection, field);
    if (values.length === 0) {
      addError(results, `${codePrefix}_MISSING_GATE_FIELD`, "trust-checkpoint.md", `Trust checkpoint must include ${field}.`);
      observed[field] = "missing";
    } else if (values.length > 1) {
      addError(results, `${codePrefix}_DUPLICATE_GATE_FIELD`, "trust-checkpoint.md", `Trust checkpoint must contain exactly one ${field} field.`);
      observed[field] = "ambiguous";
    } else {
      observed[field] = values[0];
      if (!allowed.has(values[0])) addError(results, `${codePrefix}_INVALID_GATE_VALUE`, "trust-checkpoint.md", `${field} has invalid value: ${values[0]}`);
    }
  }

  const recommendedNextValues = fieldValues(trustSection, "Recommended Next");
  if (recommendedNextValues.length === 0) {
    addError(results, `${codePrefix}_MISSING_RECOMMENDED_NEXT`, "trust-checkpoint.md", "Trust checkpoint must include Recommended Next.");
    observed["Recommended Next"] = "missing";
  } else if (recommendedNextValues.length > 1) {
    addError(results, `${codePrefix}_DUPLICATE_RECOMMENDED_NEXT`, "trust-checkpoint.md", "Trust checkpoint must contain exactly one Recommended Next field.");
    observed["Recommended Next"] = "ambiguous";
  } else {
    observed["Recommended Next"] = recommendedNextValues[0];
    if (!RECOMMENDED_NEXT_VALUES.has(recommendedNextValues[0])) addError(results, `${codePrefix}_INVALID_RECOMMENDED_NEXT`, "trust-checkpoint.md", `Recommended Next has invalid value: ${recommendedNextValues[0]}`);
  }

  const blockerFields = Object.entries(observed)
    .filter(([field, value]) => field !== "Recommended Next" && (value === "blocked" || value === "misclassified"))
    .map(([field]) => field);
  if (blockerFields.length > 0 && !["re-open-intent", "stop"].includes(observed["Recommended Next"])) {
    addError(results, `${codePrefix}_BLOCKER_ROUTE_CONFLICT`, "trust-checkpoint.md", `Blocked or misclassified gates (${blockerFields.join(", ")}) must route to re-open-intent or stop.`);
  }
  if (observed["Recommended Next"] === "archive") {
    const nonPassing = Object.entries(TRUST_FIELD_VALUES)
      .filter(([field]) => observed[field] !== "pass")
      .map(([field]) => field);
    if (nonPassing.length > 0) addError(results, `${codePrefix}_ARCHIVE_WITH_NONPASSING_GATE`, "trust-checkpoint.md", `Archive requires every trust gate to pass; non-passing: ${nonPassing.join(", ")}`);
  }
  if (requireArchiveReady && observed["Recommended Next"] !== "archive") {
    addError(results, `${codePrefix}_NEXT_NOT_ARCHIVE`, "trust-checkpoint.md", `Archive requires Recommended Next=archive, observed: ${observed["Recommended Next"]}`);
  }
  return { expectedChangeId, observed };
}

function validateVerify(changeDir, results) {
  validateApply(changeDir, results);
  const trust = readIfExists(path.join(changeDir, "trust-checkpoint.md"));
  if (trust === null) {
    addError(results, "DOCS_TRUST_MISSING_FILE", "trust-checkpoint.md", "trust-checkpoint.md is required for verify/archive.");
    return;
  }
  checkSchema(trust, "trust-checkpoint.md", results);
  const trustSection = sectionText(trust, "## Trust Checkpoint");
  if (anchorCount(trust, "## Trust Checkpoint") !== 1 || !trustSection) addError(results, "DOCS_TRUST_MISSING_SECTION", "trust-checkpoint.md", "Trust checkpoint must contain exactly one non-empty ## Trust Checkpoint section.");
  validateTrustCheckpointSection(changeDir, trustSection, results, "DOCS_TRUST", false);
}

function checkDelegationArtifacts(changeDir, options = {}) {
  const requireTrustArchive = options.requireTrustArchive !== false;
  const requireTrust = options.requireTrust === true || requireTrustArchive;
  const requireReady = options.requireReady !== false;
  const results = [];
  const proposalPath = path.join(changeDir, "proposal.md");
  const trustPath = path.join(changeDir, "trust-checkpoint.md");
  const proposal = readIfExists(proposalPath);
  const authorityArtifacts = [];
  if (proposal === null) {
    addError(results, "DELEGATION_PROPOSAL_MISSING", "proposal.md", "The active change must contain proposal.md.");
  } else {
    for (const anchor of ["## Delegation Boundary", "## Challenge Resolution"]) {
      const count = anchorCount(proposal, anchor);
      if (count !== 1 || !sectionText(proposal, anchor)) {
        addError(results, "DELEGATION_PROPOSAL_SECTION_MISSING", "proposal.md", `Required delegation section must appear exactly once and be non-empty: ${anchor}; observed ${count}`);
      }
    }
    validateDelegationSection(proposal, changeDir, results, requireReady);
    const seenAuthorityPaths = new Set();
    for (const row of challengeResolutionRows(proposal)) {
      const parsed = authorityRefParts(row.authorityRef);
      if (!parsed || seenAuthorityPaths.has(parsed.artifactPath)) continue;
      const changeRoot = fs.realpathSync(path.resolve(changeDir));
      const target = path.resolve(changeRoot, ...parsed.artifactPath.split("/"));
      const relative = path.relative(changeRoot, target);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      const actual = fs.realpathSync(target);
      const actualRelative = path.relative(changeRoot, actual);
      if (!actualRelative || actualRelative === ".." || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) continue;
      seenAuthorityPaths.add(parsed.artifactPath);
      authorityArtifacts.push({
        path: parsed.artifactPath,
        sha256: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(actual)).digest("hex")}`,
      });
    }
    authorityArtifacts.sort((a, b) => a.path.localeCompare(b.path));
  }

  let delegationReview = "missing";
  let recommendedNext = "missing";
  let trustGates = null;
  let trust = null;
  if (requireTrust) {
    trust = readIfExists(trustPath);
    if (trust === null) {
      addError(results, "DELEGATION_TRUST_MISSING", "trust-checkpoint.md", "Archive requires the active change's trust-checkpoint.md.");
    } else {
      const trustSection = sectionText(trust, "## Trust Checkpoint");
      if (anchorCount(trust, "## Trust Checkpoint") !== 1 || !trustSection) addError(results, "DELEGATION_TRUST_SECTION_MISSING", "trust-checkpoint.md", "Archive trust must be recorded under exactly one non-empty ## Trust Checkpoint section.");
      const trustValidation = validateTrustCheckpointSection(changeDir, trustSection, results, "DELEGATION_TRUST", requireTrustArchive);
      delegationReview = trustValidation.observed["Delegation Review"];
      recommendedNext = trustValidation.observed["Recommended Next"];
      trustGates = {
        change: fieldValues(trustSection, "Change").length === 1 ? fieldValue(trustSection, "Change") : "ambiguous",
        intentMatch: trustValidation.observed["Intent Match"],
        delegationReview,
        evidenceCredibility: trustValidation.observed["Evidence Credibility"],
        riskRoutingReview: trustValidation.observed["Risk Routing Review"],
        debtFallbackVisibility: trustValidation.observed["Debt/Fallback Visibility"],
        recommendedNext,
      };
    }
  }

  const proposalSha256 = proposal === null ? null : `sha256:${crypto.createHash("sha256").update(Buffer.from(proposal, "utf8")).digest("hex")}`;
  const trustSha256 = trust === null ? null : `sha256:${crypto.createHash("sha256").update(Buffer.from(trust, "utf8")).digest("hex")}`;
  const delegationBoundary = delegationBoundaryReadback(proposal);
  const artifactFingerprint = `sha256:${crypto.createHash("sha256").update(JSON.stringify({
    proposalSha256,
    trustSha256,
    authorityArtifacts,
    activeChangeId: path.basename(fs.realpathSync(path.resolve(changeDir))),
    requireReady,
    requireTrust,
    requireTrustArchive,
    resultCodes: results.map((item) => `${item.severity}:${item.code}:${item.file}`),
  })).digest("hex")}`;

  return {
    ok: !hasErrors(results),
    changeDir: path.resolve(changeDir),
    proposalPath,
    proposalContent: proposal,
    proposalSha256,
    delegationBoundary,
    trustPath: requireTrust ? trustPath : null,
    trustSha256,
    delegationReview,
    recommendedNext,
    trustGates,
    authorityArtifacts,
    artifactFingerprint,
    results,
    boundary: "model-independent artifact readback; structural lineage only, not actor authentication or semantic authority",
  };
}

function validateArchive(changeDir, results) {
  validateVerify(changeDir, results);
  const archive = readIfExists(path.join(changeDir, "archive.md"));
  if (archive === null) {
    addError(results, "DOCS_ARCHIVE_MISSING_FILE", "archive.md", "archive.md is required for archive.");
    return;
  }
  checkSchema(archive, "archive.md", results);
  for (const anchor of REQUIRED_ARCHIVE_ANCHORS) {
    if (!hasAnchor(archive, anchor)) {
      addError(results, "DOCS_ARCHIVE_MISSING_ANCHOR", "archive.md", `Missing required anchor: ${anchor}`);
    }
  }

  const evidenceSummary = sectionText(archive, "## Evidence Summary");
  const debtAsProof = evidenceSummary
    .split(/\r?\n/)
    .some((line) => /\b(fallback|accepted debt|debt)\b/i.test(line) && /\b(proof|proved|proves|verified|pass|passed)\b/i.test(line));
  if (debtAsProof) {
    addError(
      results,
      "DOCS_ARCHIVE_DEBT_AS_PROOF",
      "archive.md",
      "Evidence Summary must not convert fallback, accepted debt, or debt into proof.",
    );
  }
}

function resolveDocsChangeDir(project, target) {
  if (!target) return project;
  const absoluteTarget = path.resolve(project, target);
  if (fs.existsSync(absoluteTarget) && fs.statSync(absoluteTarget).isDirectory()) {
    return absoluteTarget;
  }
  return path.join(project, "docs", "changes", target);
}

const DELEGATION_BUILT_IN_BASES = {
  openspec: "openspec/changes",
  docs: "docs/changes",
  meta: ".meta/changes",
};

function canonicalDelegationPath(value, options = {}) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim() || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return null;
  const segments = raw.split("/");
  if (segments.some((segment) => !segment
    || segment === "."
    || segment === ".."
    || segment.endsWith(".")
    || segment.endsWith(" ")
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    || !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  if (options.single === true && segments.length !== 1) return null;
  return segments.join("/");
}

function containedRelative(root, candidate, allowEqual = false) {
  const relative = path.relative(root, candidate);
  if (!relative) return allowEqual ? "" : null;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, "/");
}

function pathIdentityKey(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function equalOrInside(parent, candidate) {
  const parentKey = pathIdentityKey(parent);
  const candidateKey = pathIdentityKey(candidate);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${path.sep}`);
}

function resolveDelegationPathPlan(project, options = {}) {
  const results = [];
  const changeId = canonicalDelegationPath(options.changeId, { single: true });
  const substrate = String(options.substrate || "");
  if (!changeId) addError(results, "DELEGATION_PATH_CHANGE_ID_INVALID", ".", "--change-id must be one portable path segment.");
  if (![...Object.keys(DELEGATION_BUILT_IN_BASES), "custom"].includes(substrate)) addError(results, "DELEGATION_PATH_SUBSTRATE_INVALID", ".", "--substrate must be openspec, docs, meta, or custom.");

  const builtInBase = DELEGATION_BUILT_IN_BASES[substrate];
  const changeBase = canonicalDelegationPath(substrate === "custom" ? options.changeBase : builtInBase);
  if (!changeBase) addError(results, "DELEGATION_PATH_BASE_INVALID", ".", "The active change base must be an explicit portable repository-relative path.");
  if (substrate === "custom" && changeBase && Object.values(DELEGATION_BUILT_IN_BASES).some((reserved) => {
    const lower = changeBase.toLowerCase();
    const reservedLower = reserved.toLowerCase();
    return lower === reservedLower || lower.startsWith(`${reservedLower}/`);
  })) addError(results, "DELEGATION_PATH_CUSTOM_BASE_RESERVED", changeBase, "A custom change base cannot impersonate a built-in namespace.");

  const activeRoot = changeBase && changeId ? `${changeBase}/${changeId}` : null;
  const observedRoot = canonicalDelegationPath(options.changeRoot);
  if (!observedRoot || observedRoot !== activeRoot) addError(results, "DELEGATION_PATH_ACTIVE_ROOT_MISMATCH", String(options.changeRoot || "."), "--change-root must equal the code-derived active change root.");

  let projectRoot = null;
  if (results.length === 0) {
    try {
      projectRoot = fs.realpathSync(path.resolve(project));
      const baseCandidate = path.resolve(projectRoot, ...changeBase.split("/"));
      const activeCandidate = path.resolve(projectRoot, ...activeRoot.split("/"));
      if (containedRelative(projectRoot, baseCandidate) === null || containedRelative(projectRoot, activeCandidate) === null) {
        addError(results, "DELEGATION_PATH_ESCAPES_PROJECT", activeRoot, "The active change path escapes or equals the real project root.");
      }

      const prefixes = [];
      let cursor = projectRoot;
      for (const segment of activeRoot.split("/")) {
        cursor = path.join(cursor, segment);
        prefixes.push(cursor);
      }
      for (const prefix of prefixes) {
        if (!fs.existsSync(prefix)) continue;
        const stat = fs.lstatSync(prefix);
        if (stat.isSymbolicLink()) {
          addError(results, "DELEGATION_PATH_LINKED_COMPONENT", path.relative(projectRoot, prefix).replace(/\\/g, "/"), "Linked/junction components are forbidden in active change paths before proposal writes.");
          break;
        }
        if (!stat.isDirectory()) {
          addError(results, "DELEGATION_PATH_COMPONENT_NOT_DIRECTORY", path.relative(projectRoot, prefix).replace(/\\/g, "/"), "Every existing active change path component must be a directory.");
          break;
        }
        const actualPrefix = fs.realpathSync(prefix);
        if (containedRelative(projectRoot, actualPrefix, true) === null) {
          addError(results, "DELEGATION_PATH_REALPATH_ESCAPES_PROJECT", path.relative(projectRoot, prefix).replace(/\\/g, "/"), "An existing active change path component resolves outside the project.");
          break;
        }
      }

      if (substrate === "custom" && results.length === 0) {
        const existingCustom = [baseCandidate, activeCandidate].filter((candidate) => fs.existsSync(candidate));
        const reservedActual = Object.values(DELEGATION_BUILT_IN_BASES).map((relative) => path.resolve(projectRoot, ...relative.split("/")));
        for (const customCandidate of existingCustom) {
          const customActual = fs.realpathSync(customCandidate);
          if (reservedActual.some((reservedCandidate) => {
            const reserved = fs.existsSync(reservedCandidate) ? fs.realpathSync(reservedCandidate) : reservedCandidate;
            return equalOrInside(reserved, customActual);
          })) {
            addError(results, "DELEGATION_PATH_CUSTOM_REALPATH_RESERVED", path.relative(projectRoot, customCandidate).replace(/\\/g, "/"), "The custom active path resolves into a built-in namespace.");
            break;
          }
        }
      }
    } catch (error) {
      addError(results, "DELEGATION_PATH_PREFLIGHT_ERROR", activeRoot || ".", error.message);
    }
  }

  const ok = !hasErrors(results);
  const fingerprintInput = {
    changeId,
    substrate,
    changeBase,
    activeRoot,
    projectRoot: projectRoot ? pathIdentityKey(projectRoot) : null,
    resultCodes: results.map((item) => `${item.severity}:${item.code}:${item.file}`),
  };
  return {
    ok,
    changeId,
    substrate,
    changeBase,
    activeRoot,
    linkedComponents: results.filter((item) => item.code === "DELEGATION_PATH_LINKED_COMPONENT").map((item) => item.file),
    pathIdentityFingerprint: `sha256:${crypto.createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex")}`,
    results,
    boundary: "model-independent pre-write lexical, containment, and link-component path identity; not a defense against post-check filesystem races or a hostile host",
  };
}

function runDelegationPathCheckCommand(options) {
  const report = resolveDelegationPathPlan(options.project || process.cwd(), options);
  printCheckResult({ ...report, phase: "path-preflight", changeDir: report.activeRoot }, options.json === true);
  return report.ok ? 0 : 2;
}

function resolveDelegationChangeDir(project, target) {
  const raw = String(target || "").trim();
  if (!raw || path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw new Error("--change must be an explicit repository-relative active change path");
  const portable = raw.replace(/\\/g, "/");
  if (portable.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("--change must not contain empty, dot, or traversal segments");
  const projectRoot = fs.realpathSync(path.resolve(project));
  const candidate = path.resolve(projectRoot, ...portable.split("/"));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) throw new Error("active change directory does not exist");
  const actual = fs.realpathSync(candidate);
  const relative = path.relative(projectRoot, actual);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("active change directory escapes or equals the project root");
  return actual;
}

function runDelegationCheckCommand(options) {
  const phase = options.phase || "apply";
  if (!new Set(["proposal", "apply", "verify", "archive"]).has(phase)) throw new Error("delegation-check phase must be proposal, apply, verify, or archive");
  let changeDir;
  try {
    changeDir = resolveDelegationChangeDir(options.project || process.cwd(), options.target);
  } catch (error) {
    const report = { ok: false, phase, changeDir: null, changePath: null, results: [result("error", "DELEGATION_CHANGE_PATH_INVALID", ".", error.message)] };
    printCheckResult(report, options.json === true);
    return 2;
  }
  const report = checkDelegationArtifacts(changeDir, {
    requireReady: phase !== "proposal",
    requireTrust: phase === "verify" || phase === "archive",
    requireTrustArchive: phase === "archive",
  });
  report.phase = phase;
  report.changePath = path.relative(fs.realpathSync(path.resolve(options.project || process.cwd())), changeDir).replace(/\\/g, "/");
  printCheckResult(report, options.json === true);
  return report.ok ? 0 : 1;
}

function checkDocsChange(changeDir, phase) {
  if (!PHASES.has(phase)) throw new Error(`Unsupported phase: ${phase}`);
  const results = [];
  if (!fs.existsSync(changeDir) || !fs.statSync(changeDir).isDirectory()) {
    addError(results, "DOCS_CHANGE_DIR_MISSING", ".", `Change directory not found: ${changeDir}`);
    return { changeDir, phase, results };
  }
  if (phase === "proposal") validateProposal(changeDir, results);
  if (phase === "apply") validateApply(changeDir, results);
  if (phase === "verify") validateVerify(changeDir, results);
  if (phase === "archive") validateArchive(changeDir, results);
  return { changeDir, phase, results };
}

function hasErrors(results) {
  return results.some((item) => item.severity === "error");
}

function printCheckResult(report, json) {
  if (json) {
    console.log(JSON.stringify({
      ...report,
      ok: !hasErrors(report.results),
    }, null, 2));
    return;
  }
  const status = hasErrors(report.results) ? "FAIL" : "PASS";
  console.log(`${status} ${report.phase} ${report.changeDir}`);
  for (const item of report.results) {
    console.log(`${item.severity.toUpperCase()} ${item.code} ${item.file}: ${item.message}`);
  }
}

function runDocsCheckCommand(options) {
  const phase = options.phase || "proposal";
  const changeDir = resolveDocsChangeDir(options.project || process.cwd(), options.target);
  const report = checkDocsChange(changeDir, phase);
  printCheckResult(report, options.json === true);
  return hasErrors(report.results) ? 1 : 0;
}

module.exports = {
  checkDelegationArtifacts,
  checkDocsChange,
  resolveDelegationPathPlan,
  resolveDelegationChangeDir,
  runDelegationPathCheckCommand,
  runDelegationCheckCommand,
  runDocsCheckCommand,
  resolveDocsChangeDir,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args[0];
  const phaseIndex = args.indexOf("--phase");
  const phase = phaseIndex === -1 ? "proposal" : args[phaseIndex + 1];
  const json = args.includes("--json");
  process.exit(runDocsCheckCommand({ target, phase, json, project: process.cwd() }));
}
