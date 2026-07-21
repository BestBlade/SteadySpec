#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathInsideOrSame: closurePathInsideOrSame, repoRelative: closureRepoRelative, validateSchemaPackage } = require("../bin/closure");
const { crossReviewOutputIdentity } = require("../bin/cross-review");

function copySchemas(root, transform) {
  const source = path.resolve(__dirname, "..", "schemas");
  const target = path.join(root, "schemas");
  fs.mkdirSync(target, { recursive: true });
  for (const name of [
    "closure-state-v1.schema.json",
    "acceptance-profile-v1.schema.json",
    "closure-config-v1.schema.json",
  ]) {
    const text = fs.readFileSync(path.join(source, name), "utf8");
    fs.writeFileSync(path.join(target, name), transform(text, name), "utf8");
  }
}

function schemaLineEndingContracts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-portability-"));
  try {
    copySchemas(root, (text) => text.replace(/\r?\n/g, "\r\n"));
    assert.deepStrictEqual(
      validateSchemaPackage(root),
      [],
      "CRLF transport must not invalidate semantically unchanged package schemas",
    );

    const state = path.join(root, "schemas", "closure-state-v1.schema.json");
    fs.appendFileSync(state, " ", "utf8");
    assert(
      validateSchemaPackage(root).some((error) => error.includes("state schema package-integrity mismatch")),
      "schema content mutation must still fail package integrity",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function repositoryLineEndingContract() {
  const attributes = fs.readFileSync(path.resolve(__dirname, "..", ".gitattributes"), "utf8");
  for (const required of ["*.js text eol=lf", "*.json text eol=lf", "*.jsonl text eol=lf", "*.md text eol=lf", "*.yml text eol=lf", "*.yaml text eol=lf"]) {
    assert(attributes.includes(required), `.gitattributes missing ${required}`);
  }
}

function outputPathIdentityContracts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steadyspec-path-identity-"));
  const repo = path.join(root, "repo");
  const outside = path.join(root, "outside");
  const parent = path.join(repo, "docs", "changes", "001", "cross-agent");
  const runJson = path.join(parent, "run-001", "run.json");
  try {
    fs.mkdirSync(path.dirname(runJson), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(runJson, "{}\n", "utf8");

    const identity = crossReviewOutputIdentity(repo, parent, runJson);
    assert.strictEqual(identity.pathIdentityValid, true, identity.pathIdentityReason);
    assert.strictEqual(identity.parentDirRelative, "docs/changes/001/cross-agent");
    assert.strictEqual(identity.runJsonRelative, "docs/changes/001/cross-agent/run-001/run.json");

    const nonDirect = path.join(parent, "run-001", "nested", "run.json");
    fs.mkdirSync(path.dirname(nonDirect), { recursive: true });
    fs.writeFileSync(nonDirect, "{}\n", "utf8");
    assert.strictEqual(crossReviewOutputIdentity(repo, parent, nonDirect).pathIdentityValid, false, "nested run.json must be rejected");

    const prefixCollision = path.join(root, "repo-outside", "run", "run.json");
    fs.mkdirSync(path.dirname(prefixCollision), { recursive: true });
    fs.writeFileSync(prefixCollision, "{}\n", "utf8");
    assert.strictEqual(crossReviewOutputIdentity(repo, path.dirname(path.dirname(prefixCollision)), prefixCollision).pathIdentityValid, false, "repo prefix collision must be rejected");

    const link = path.join(repo, "escaped-output");
    let linkCreated = false;
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      linkCreated = true;
    } catch (error) {
      console.warn(`[portability] SKIP junction/symlink escape fixture: ${error.message}`);
    }
    if (linkCreated) {
      const escapedRun = path.join(link, "run-001", "run.json");
      fs.mkdirSync(path.dirname(escapedRun), { recursive: true });
      fs.writeFileSync(escapedRun, "{}\n", "utf8");
      assert.strictEqual(crossReviewOutputIdentity(repo, link, escapedRun).pathIdentityValid, false, "junction/symlink escape must be rejected");
      assert.strictEqual(closurePathInsideOrSame(repo, escapedRun), false, "closure path containment must reject junction/symlink escape");
    }

    const parentBackLink = path.join(parent, "run-parent-alias");
    let parentBackLinkCreated = false;
    try {
      fs.writeFileSync(path.join(repo, "run.json"), "{}\n", "utf8");
      fs.symlinkSync(repo, parentBackLink, process.platform === "win32" ? "junction" : "dir");
      parentBackLinkCreated = true;
    } catch (error) {
      console.warn(`[portability] SKIP parent-junction direct-child fixture: ${error.message}`);
    }
    if (parentBackLinkCreated) {
      const aliasedParentRun = path.join(parentBackLink, "run.json");
      assert.strictEqual(
        crossReviewOutputIdentity(repo, parent, aliasedParentRun).pathIdentityValid,
        false,
        "a run directory junction that resolves above the output parent must not be a direct run child",
      );
    }

    if (process.platform === "win32") {
      const caseAndSlashIdentity = crossReviewOutputIdentity(
        repo.toUpperCase().replace(/\\/g, "/"),
        parent.toUpperCase().replace(/\\/g, "/"),
        runJson.toUpperCase().replace(/\\/g, "/"),
      );
      assert.deepStrictEqual(
        caseAndSlashIdentity,
        identity,
        "Windows path case and separator aliases must produce the same realpath identity",
      );

      const shortHelper = path.join(root, "short-path.cmd");
      fs.writeFileSync(shortHelper, "@for %%I in (\"%~1\") do @echo %%~sI\r\n", "utf8");
      const short = require("child_process").spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "call", shortHelper, parent], { encoding: "utf8", windowsHide: true });
      const alias = String(short.stdout || "").trim();
      if (short.status === 0 && alias && alias.toLowerCase() !== parent.toLowerCase()) {
        const aliasRun = path.join(alias, "run-001", "run.json");
        assert.deepStrictEqual(
          crossReviewOutputIdentity(repo, alias, aliasRun),
          identity,
          "Windows 8.3 and long paths must produce the same logical identity",
        );
        assert.strictEqual(closurePathInsideOrSame(repo, aliasRun), true, "closure containment must accept the same directory through a Windows 8.3 alias");
        assert.strictEqual(
          closureRepoRelative(repo, aliasRun),
          "docs/changes/001/cross-agent/run-001/run.json",
          "closure repo-relative identity must canonicalize Windows 8.3 aliases",
        );
        console.log(`[portability] PASS real Windows short-path alias: ${alias}`);
      } else {
        console.warn("[portability] SKIP real Windows short-path alias: 8.3 alias unavailable on this volume");
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  schemaLineEndingContracts();
  repositoryLineEndingContract();
  outputPathIdentityContracts();
  console.log("Portability fixtures passed: schema line endings, repository LF policy, and realpath-contained output identity.");
}

main();
