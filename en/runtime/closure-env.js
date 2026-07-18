"use strict";

const PROOF_BASELINE_KEYS = [
  "PATH",
  "Path",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
];

const REVIEWER_EXTRA_KEYS = ["SHELL", "LANG", "LC_ALL", "TERM"];

function findActualKey(sourceEnv, requested) {
  return Object.keys(sourceEnv || {}).find((candidate) => candidate.toLowerCase() === String(requested).toLowerCase()) || null;
}

function copyNamedKey(target, sourceEnv, requested, source, records) {
  const actual = findActualKey(sourceEnv, requested);
  if (!actual || sourceEnv[actual] === undefined) return false;
  target[actual] = sourceEnv[actual];
  if (records && !records.some((entry) => entry.name.toLowerCase() === actual.toLowerCase())) {
    records.push({ name: actual, source });
  }
  return true;
}

function buildScrubbedEnv(options = {}) {
  const sourceEnv = options.sourceEnv || process.env;
  const explicitKeys = [...new Set((options.explicitKeys || []).map(String).filter(Boolean))];
  const includeReviewerExtras = options.includeReviewerExtras === true;
  const requireExplicit = options.requireExplicit === true;
  const env = {};
  const records = [];

  for (const key of PROOF_BASELINE_KEYS) copyNamedKey(env, sourceEnv, key, "baseline", records);
  if (includeReviewerExtras) {
    for (const key of REVIEWER_EXTRA_KEYS) copyNamedKey(env, sourceEnv, key, "reviewer-baseline", records);
  }
  const missingExplicitKeys = [];
  for (const key of explicitKeys) {
    if (!copyNamedKey(env, sourceEnv, key, "policy", records)) missingExplicitKeys.push(key);
  }
  if (options.childMarker && options.childMarker.name) {
    env[options.childMarker.name] = String(options.childMarker.value === undefined ? "1" : options.childMarker.value);
    records.push({ name: options.childMarker.name, source: "runtime-marker" });
  }
  if (requireExplicit && missingExplicitKeys.length) {
    const error = new Error(`requested environment keys are missing: ${missingExplicitKeys.join(", ")}`);
    error.code = "MISSING_ENV_KEYS";
    error.missingKeys = missingExplicitKeys;
    throw error;
  }
  return {
    env,
    keys: Object.keys(env).sort(),
    explicitKeys: [...explicitKeys].sort(),
    missingExplicitKeys,
    inspection: records.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

module.exports = {
  PROOF_BASELINE_KEYS,
  REVIEWER_EXTRA_KEYS,
  buildScrubbedEnv,
};
