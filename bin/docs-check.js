const fs = require("fs");
const path = require("path");

const PHASES = new Set(["proposal", "apply", "verify", "archive"]);
const RESULT_VALUES = new Set(["pass", "fail", "drift", "fallback", "blocked"]);
const RECOMMENDED_NEXT_VALUES = new Set(["continue", "archive", "handoff", "re-open-intent", "stop"]);

const REQUIRED_PROPOSAL_ANCHORS = [
  "## Intent",
  "## Boundary",
  "## Evidence Required",
  "## Stop Conditions",
  "## Decision Ledger",
  "## Risk Routing",
  "## Attention Report",
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
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\|\\s*${escaped}\\s*\\|`, "i").test(text);
}

function fieldValue(text, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "im"));
  return match ? match[1].trim() : "";
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

function validateProposal(changeDir, results) {
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
}

function validateApply(changeDir, results) {
  validateProposal(changeDir, results);
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

function validateVerify(changeDir, results) {
  validateApply(changeDir, results);
  const trust = readIfExists(path.join(changeDir, "trust-checkpoint.md"));
  if (trust === null) {
    addError(results, "DOCS_TRUST_MISSING_FILE", "trust-checkpoint.md", "trust-checkpoint.md is required for verify/archive.");
    return;
  }
  checkSchema(trust, "trust-checkpoint.md", results);
  if (!hasField(trust, "Recommended Next")) {
    addError(results, "DOCS_TRUST_MISSING_RECOMMENDED_NEXT", "trust-checkpoint.md", "Trust checkpoint must include Recommended Next.");
    return;
  }
  const recommendedNext = fieldValue(trust, "Recommended Next");
  if (recommendedNext && !RECOMMENDED_NEXT_VALUES.has(recommendedNext)) {
    addError(results, "DOCS_TRUST_INVALID_RECOMMENDED_NEXT", "trust-checkpoint.md", `Recommended Next must be one of: ${Array.from(RECOMMENDED_NEXT_VALUES).join(", ")}`);
  }
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
      ok: !hasErrors(report.results),
      phase: report.phase,
      changeDir: report.changeDir,
      results: report.results,
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
  checkDocsChange,
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
