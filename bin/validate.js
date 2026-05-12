#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ALLOWED_ROOT_FILES = new Set([
  "README.md",
  "METHOD.md",
  "SCOPE.md",
  "QUICKSTART.md",
  "CHANGELOG.md",
  "manifest.json",
  "package.json",
  ".gitignore",
  "LICENSE",
]);
const ALLOWED_ROOT_DIRS = new Set(["bin", "en", "recipes"]);
const IGNORED_DEV_DIRS = new Set([".git", ".meta", "node_modules"]);
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
  "SCOPE.md",
  "QUICKSTART.md",
  "CHANGELOG.md",
  "manifest.json",
  "package.json",
  ".gitignore",
  "LICENSE",
];

const CJK_REGEX = /[一-鿿　-〿＀-￯]/;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) walk(full, out);
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
        "v0.2-alpha CON-7 forbids editing existing SKILLs. " +
        "Commit the change first if it is intentional, or revert.",
    );
  }
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const manifestPath = path.join(root, "manifest.json");
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath)) fail("manifest.json is missing");
  if (!fs.existsSync(packagePath)) fail("package.json is missing");

  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  if (manifest.description !== pkg.description) {
    fail("manifest description must match package.json description");
  }
  if (!pkg.files || pkg.files.includes("scripts/")) {
    fail("scripts/ must not be published; use bin/validate.js");
  }
  if (pkg.name !== "steadyspec") fail("package name must be steadyspec");
  if (!pkg.bin || pkg.bin.steadyspec !== "bin/init.js") {
    fail("package bin must expose steadyspec -> bin/init.js");
  }

  // Existing root layout checks
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && !ALLOWED_ROOT_DIRS.has(entry.name)) {
      fail(`unexpected package root directory: ${entry.name}`);
    }
    if (entry.isFile() && !ALLOWED_ROOT_FILES.has(entry.name)) {
      fail(`unexpected package root file: ${entry.name}`);
    }
  }

  // Existing forbidden-name walk
  for (const file of walk(root)) {
    const parts = rel(root, file).split("/");
    if (parts.some((part) => FORBIDDEN_NAMES.has(part))) {
      fail(`forbidden dev/runtime artifact: ${rel(root, file)}`);
    }
  }

  const languages = manifest.languages || [];
  if (languages.join(",") !== "en") fail("manifest languages must be ['en']");

  const skillMappings = manifest.skills || [];
  if (!Array.isArray(skillMappings) || !skillMappings.length) {
    fail("manifest.skills must be a non-empty array");
  }

  // Existing per-skill checks (frontmatter name matches dir basename)
  for (const lang of languages) {
    for (const sourceDir of skillMappings) {
      const runtimeName = path.basename(sourceDir);
      const skillPath = path.join(root, lang, sourceDir, "SKILL.md");
      if (!fs.existsSync(skillPath)) fail(`missing skill: ${lang}/${sourceDir}/SKILL.md`);
      validateSkillFrontmatter(skillPath, root);
      if (frontmatterName(skillPath) !== runtimeName) {
        fail(`${lang}/${sourceDir}/SKILL.md name must be ${runtimeName}`);
      }
    }
    for (const file of walk(path.join(root, lang)).filter((item) => path.basename(item) === "SKILL.md")) {
      validateSkillFrontmatter(file, root);
    }
  }

  // v0.2-alpha rules
  checkCjkBan(root);
  checkRequiredRootFiles(root);
  checkFlowsReferencePrimitives(root, manifest);
  checkPrimitiveByteEquivalence(root);

  console.log("Package is valid.");
}

main();
