#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const catalogPath = path.join(root, "protocol", "conformance", "cases.jsonl");
const resultSchemaPath = path.join(root, "protocol", "schemas", "assurance-result-v1.schema.json");
const resultSchema = JSON.parse(fs.readFileSync(resultSchemaPath, "utf8"));
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;

function usage() {
  return `SteadySpec Assurance conformance runner

Usage:
  node tests/assurance-conformance.js
  node tests/assurance-conformance.js --implementation <executable> [--arg <argv>]... [--include-v06-projection]

Custom processes run the model-independent core profile by default and must
implement reduce plus fingerprint. --include-v06-projection additionally tests
the optional SteadySpec v0.6 compatibility extension. Each --arg is passed
before the subcommand.
`;
}

function parseArgs(argv) {
  const result = { executable: process.execPath, args: [path.join(root, "bin", "assurance.js")], custom: false, help: false, includeV06Projection: false };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      result.help = true;
    } else if (argv[index] === "--implementation") {
      if (!argv[index + 1]) throw new Error("--implementation requires an executable");
      result.executable = argv[index + 1];
      result.args = [];
      result.custom = true;
      index += 1;
    } else if (argv[index] === "--arg") {
      if (!result.custom || !argv[index + 1]) throw new Error("--arg requires a preceding --implementation and a value");
      result.args.push(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--include-v06-projection") {
      result.includeV06Projection = true;
    } else {
      throw new Error(`unknown option: ${argv[index]}`);
    }
  }
  return result;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadCatalog() {
  const lines = fs.readFileSync(catalogPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const header = lines.shift();
  if (header.schemaVersion !== 1 || header.protocolVersion !== "0.7" || header.kind !== "steadyspec-assurance-conformance-header" || header.profiles?.join(",") !== "core,v06-projection") throw new Error("conformance catalog header is invalid");
  if (!lines.length || lines.some((entry) => !entry.id || !entry.command || !entry.expect || !new Set(header.profiles).has(entry.profile))) throw new Error("conformance catalog cases are invalid");
  return { ...header, cases: lines };
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("result contains a non-canonical number");
    return String(value);
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) throw new Error("result contains an unpaired surrogate");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  if (keys.some(hasUnpairedSurrogate)) throw new Error("result contains an unpaired surrogate in an object key");
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function protocolFingerprint(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(Buffer.from(`steadyspec-assurance/0.7/${domain}\0`, "utf8")).update(Buffer.from(canonical(value), "utf8")).digest("hex")}`;
}

function resolveLocalRef(schemaRoot, ref) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported schema reference ${ref}`);
  return ref.slice(2).split("/").reduce((value, segment) => value[segment.replace(/~1/g, "/").replace(/~0/g, "~")], schemaRoot);
}

function schemaErrors(value, schema, schemaRoot = schema, pathLabel = "$") {
  if (schema.$ref) return schemaErrors(value, resolveLocalRef(schemaRoot, schema.$ref), schemaRoot, pathLabel);
  if (schema.oneOf) {
    const branches = schema.oneOf.map((branch) => schemaErrors(value, branch, schemaRoot, pathLabel));
    const passing = branches.filter((errors) => errors.length === 0).length;
    return passing === 1 ? [] : [`${pathLabel} must match exactly one schema branch (matched ${passing})`];
  }
  const errors = [];
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) errors.push(`${pathLabel} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${pathLabel} is outside the enum`);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    if (!allowed.includes(actual)) return [...errors, `${pathLabel} type ${actual} is not ${allowed.join("|")}`];
  }
  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${pathLabel} is shorter than minLength`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${pathLabel} does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${pathLabel} is below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${pathLabel} exceeds maximum`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => errors.push(...schemaErrors(entry, schema.items, schemaRoot, `${pathLabel}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${pathLabel}.${required} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${pathLabel}.${key} is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) errors.push(...schemaErrors(value[key], childSchema, schemaRoot, `${pathLabel}.${key}`));
    }
  }
  return errors;
}

function exactOutputKeys(output, expected, label) {
  const actual = Object.keys(output).sort().join("\0");
  const wanted = [...expected].sort().join("\0");
  return actual === wanted ? [] : [`${label} output fields are not exact`];
}

function strictOutputFailures(entry, output) {
  if (!output.ok || entry.command === "reduce") {
    const errors = schemaErrors(output, resultSchema);
    if (errors.length) return [`result schema mismatch: ${errors.slice(0, 4).join("; ")}`];
    if (output.ok) {
      const unsigned = { ...output };
      delete unsigned.resultFingerprint;
      const expected = protocolFingerprint("result", unsigned);
      if (output.resultFingerprint !== expected) return [`resultFingerprint=${output.resultFingerprint}, recomputed=${expected}`];
    }
    return [];
  }
  if (entry.command === "fingerprint") {
    const failures = exactOutputKeys(output, ["schemaVersion", "protocolVersion", "ok", "domain", "fingerprint"], "fingerprint");
    if (output.domain !== entry.domain) failures.push(`fingerprint domain=${output.domain}, expected ${entry.domain}`);
    if (!fingerprintPattern.test(output.fingerprint || "")) failures.push("fingerprint output is malformed");
    return failures;
  }
  const failures = exactOutputKeys(output, ["schemaVersion", "protocolVersion", "ok", "projectionKind", "protocolConformant", "legacyContractVersion", "legacyState", "legacyNextAction", "assuranceState", "warnings", "authorityBoundary"], "project-v06");
  if (!Array.isArray(output.warnings) || output.warnings.some((warning) => Object.keys(warning).sort().join(",") !== "code,coverageLimit" || typeof warning.code !== "string" || typeof warning.coverageLimit !== "string")) failures.push("project-v06 warnings are malformed");
  if (!output.authorityBoundary || Object.keys(output.authorityBoundary).sort().join(",") !== "grantsExternalAuthority,grantsV07Readiness" || output.authorityBoundary.grantsExternalAuthority !== false || output.authorityBoundary.grantsV07Readiness !== false) failures.push("project-v06 authority boundary is malformed");
  return failures;
}

function invoke(implementation, entry, inputFile) {
  const inputFlag = entry.command === "project-v06" ? "--state" : entry.command === "fingerprint" ? "--input" : "--trace";
  const commandArgs = entry.command === "fingerprint" ? ["fingerprint", "--domain", entry.domain] : [entry.command];
  return spawnSync(
    implementation.executable,
    [...implementation.args, ...commandArgs, inputFlag, inputFile, "--json"],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
}

function inspectCase(entry, result, beforeHash, afterHash) {
  const failures = [];
  if (result.error) failures.push(`spawn error: ${result.error.message}`);
  if (result.status !== entry.expect.exitCode) failures.push(`exit ${result.status}, expected ${entry.expect.exitCode}`);
  if (result.stderr !== "") failures.push("stderr must be empty for --json protocol results");
  if (!/^\{[\s\S]*\}\r?\n$/.test(result.stdout || "")) failures.push("stdout must contain exactly one JSON object plus LF");

  let output = null;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`stdout JSON parse failed: ${error.message}`);
  }
  if (output) {
    failures.push(...strictOutputFailures(entry, output));
    if (output.schemaVersion !== 1 || output.protocolVersion !== "0.7") failures.push("output version envelope mismatch");
    if (output.ok !== entry.expect.ok) failures.push(`ok=${output.ok}, expected ${entry.expect.ok}`);
    if (entry.expect.state && output.assuranceState !== entry.expect.state) failures.push(`state=${output.assuranceState}, expected ${entry.expect.state}`);
    if (Number.isInteger(entry.expect.acceptedSequence) && output.acceptedSequence !== entry.expect.acceptedSequence) failures.push(`acceptedSequence=${output.acceptedSequence}, expected ${entry.expect.acceptedSequence}`);
    if (entry.expect.errorCode && output.error?.code !== entry.expect.errorCode) failures.push(`error code=${output.error?.code}, expected ${entry.expect.errorCode}`);
    if (entry.expect.noAssuranceState && Object.prototype.hasOwnProperty.call(output, "assuranceState")) failures.push("invalid result exposed assuranceState");
    if (entry.expect.projectionKind && output.projectionKind !== entry.expect.projectionKind) failures.push("projectionKind mismatch");
    if (typeof entry.expect.protocolConformant === "boolean" && output.protocolConformant !== entry.expect.protocolConformant) failures.push("protocolConformant mismatch");
    if (entry.expect.warningCode && !output.warnings?.some((warning) => warning.code === entry.expect.warningCode)) failures.push(`missing warning ${entry.expect.warningCode}`);
    if (entry.expect.fingerprint && output.fingerprint !== entry.expect.fingerprint) failures.push(`fingerprint=${output.fingerprint}, expected ${entry.expect.fingerprint}`);
    if (entry.expect.bindings) {
      for (const [field, expected] of Object.entries(entry.expect.bindings)) {
        if (output.bindings?.[field] !== expected) failures.push(`binding ${field}=${output.bindings?.[field]}, expected ${expected}`);
      }
    }
    if (entry.expect.activeInvocationStatus && output.activeInvocation?.status !== entry.expect.activeInvocationStatus) failures.push(`active invocation status=${output.activeInvocation?.status}, expected ${entry.expect.activeInvocationStatus}`);
    if (entry.expect.activeInvocationId && output.activeInvocation?.invocationId !== entry.expect.activeInvocationId) failures.push(`active invocation id=${output.activeInvocation?.invocationId}, expected ${entry.expect.activeInvocationId}`);
    if (entry.expect.invalidationLayers) {
      const actual = (output.invalidations || []).map((item) => item.layer);
      if (actual.join(",") !== entry.expect.invalidationLayers.join(",")) failures.push(`invalidation layers=${actual.join(",")}, expected ${entry.expect.invalidationLayers.join(",")}`);
    }
    if (entry.expect.coverageLimitIds) {
      const actual = (output.coverageLimits || []).map((item) => item.id);
      if (actual.join(",") !== entry.expect.coverageLimitIds.join(",")) failures.push(`coverage limits=${actual.join(",")}, expected ${entry.expect.coverageLimitIds.join(",")}`);
    }
    if (output.ok && entry.command === "reduce" && !fingerprintPattern.test(output.resultFingerprint || "")) failures.push("valid reduce resultFingerprint missing or malformed");
    if (!output.ok && Object.prototype.hasOwnProperty.call(output, "resultFingerprint")) failures.push("invalid result must not expose resultFingerprint");
  }
  if (beforeHash !== afterHash) failures.push("implementation mutated the input file");
  return failures;
}

function runSuite(label, implementation, catalog) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-assurance-conformance-"));
  const failures = [];
  const outputs = new Map();
  try {
    for (const entry of catalog.cases) {
      const inputFile = path.join(fixtureRoot, `${entry.id}.json`);
      if (Object.prototype.hasOwnProperty.call(entry, "rawInputBase64")) {
        fs.writeFileSync(inputFile, Buffer.from(entry.rawInputBase64, "base64"));
      } else {
        const text = Object.prototype.hasOwnProperty.call(entry, "rawInput")
          ? entry.rawInput
          : JSON.stringify(entry.input, null, 2);
        fs.writeFileSync(inputFile, text, "utf8");
      }
      const beforeHash = sha256(inputFile);
      const result = invoke(implementation, entry, inputFile);
      const afterHash = sha256(inputFile);
      const caseFailures = inspectCase(entry, result, beforeHash, afterHash);
      for (const detail of caseFailures) failures.push(`${entry.id}: ${detail}`);
      outputs.set(entry.id, result.stdout);
      if (entry.expect.sameOutputAs && outputs.has(entry.expect.sameOutputAs) && result.stdout !== outputs.get(entry.expect.sameOutputAs)) {
        failures.push(`${entry.id}: stdout differs from ${entry.expect.sameOutputAs}`);
      }
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return { label, failures };
}

function main() {
  const implementation = parseArgs(process.argv);
  if (implementation.help) {
    process.stdout.write(usage());
    return;
  }
  const catalog = loadCatalog();
  const coreCatalog = { ...catalog, cases: catalog.cases.filter((entry) => entry.profile === "core") };
  const primaryCatalog = !implementation.custom || implementation.includeV06Projection ? catalog : coreCatalog;
  const primary = runSuite("implementation", implementation, primaryCatalog);
  if (primary.failures.length) {
    for (const failure of primary.failures) console.error(`[assurance-conformance] FAIL ${failure}`);
    process.exit(1);
  }

  if (!implementation.custom) {
    const mutant = runSuite("always-ready-mutant", {
      executable: process.execPath,
      args: [path.join(root, "tests", "fixtures", "assurance", "always-ready.js")],
    }, coreCatalog);
    if (!mutant.failures.length) {
      console.error("[assurance-conformance] FAIL mandatory cases did not reject the always-ready mutant");
      process.exit(1);
    }
    const incompleteResultMutant = runSuite("incomplete-result-mutant", {
      executable: process.execPath,
      args: [path.join(root, "tests", "fixtures", "assurance", "incomplete-result.js")],
    }, coreCatalog);
    if (!incompleteResultMutant.failures.some((failure) => failure.includes("result schema mismatch")) || !incompleteResultMutant.failures.some((failure) => failure.includes("recomputed="))) {
      console.error("[assurance-conformance] FAIL mandatory cases did not reject incomplete shape and forged result fingerprints");
      process.exit(1);
    }
  }

  const profiles = [...new Set(primaryCatalog.cases.map((entry) => entry.profile))].join(",");
  console.log(`[assurance-conformance] PASS protocol=0.7 schema=1 profiles=${profiles} cases=${primaryCatalog.cases.length} implementation=${JSON.stringify([implementation.executable, ...implementation.args])}`);
}

try {
  main();
} catch (error) {
  console.error(`[assurance-conformance] FAIL ${error && error.stack ? error.stack : error}`);
  process.exit(1);
}
