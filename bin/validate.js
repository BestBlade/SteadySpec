#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ALLOWED_ROOT_FILES = new Set(["README.md", "METHOD.md", "CHANGELOG.md", "manifest.json", "package.json"]);
const ALLOWED_ROOT_DIRS = new Set(["bin", "en", "recipes"]);
const IGNORED_DEV_DIRS = new Set([".git"]);
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

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory() && !IGNORED_DEV_DIRS.has(entry.name)) walk(full, out);
  }
  return out;
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function frontmatter(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n")) fail(`${rel(process.cwd(), file)} missing YAML frontmatter`);
  const end = text.indexOf("\n---", 4);
  if (end === -1) fail(`${rel(process.cwd(), file)} has unterminated YAML frontmatter`);
  return text.slice(4, end);
}

function validateSkill(file) {
  const yaml = frontmatter(file);
  if (!/^name:\s*.+$/m.test(yaml)) fail(`${rel(process.cwd(), file)} missing name`);
  if (!/^description:\s*.+$/m.test(yaml)) fail(`${rel(process.cwd(), file)} missing description`);
}

function frontmatterName(file) {
  const match = frontmatter(file).match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const manifestPath = path.join(root, "manifest.json");
  const packagePath = path.join(root, "package.json");
  const methodPath = path.join(root, "METHOD.md");
  const changelogPath = path.join(root, "CHANGELOG.md");
  if (!fs.existsSync(manifestPath)) fail("manifest.json is missing");
  if (!fs.existsSync(packagePath)) fail("package.json is missing");
  if (!fs.existsSync(methodPath)) fail("METHOD.md is required");
  if (!fs.existsSync(changelogPath)) fail("CHANGELOG.md is required");

  const manifest = readJson(manifestPath);
  const pkg = readJson(packagePath);
  if (manifest.description !== pkg.description) fail("manifest description must match package.json description");
  if (!pkg.files || pkg.files.includes("scripts/")) fail("scripts/ must not be published; use bin/validate.js");
  if (pkg.name !== "steadyspec") fail("package name must be steadyspec");
  if (!pkg.bin || pkg.bin.steadyspec !== "bin/init.js") fail("package bin must expose steadyspec -> bin/init.js");

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DEV_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && !ALLOWED_ROOT_DIRS.has(entry.name)) fail(`unexpected package root directory: ${entry.name}`);
    if (entry.isFile() && !ALLOWED_ROOT_FILES.has(entry.name)) fail(`unexpected package root file: ${entry.name}`);
  }

  for (const file of walk(root)) {
    const parts = rel(root, file).split("/");
    if (parts.some((part) => FORBIDDEN_NAMES.has(part))) fail(`forbidden dev/runtime artifact: ${rel(root, file)}`);
  }

  const languages = manifest.languages || [];
  if (languages.join(",") !== "en") fail("manifest languages must be ['en']");

  const skillMappings = manifest.skills || [];
  if (!Array.isArray(skillMappings) || !skillMappings.length) fail("manifest.skills must be a non-empty array");

  for (const lang of languages) {
    for (const sourceDir of skillMappings) {
      const runtimeName = path.basename(sourceDir);
      const skillPath = path.join(root, lang, sourceDir, "SKILL.md");
      if (!fs.existsSync(skillPath)) fail(`missing skill: ${lang}/${sourceDir}/SKILL.md`);
      validateSkill(skillPath);
      if (frontmatterName(skillPath) !== runtimeName) {
        fail(`${lang}/${sourceDir}/SKILL.md name must be ${runtimeName}`);
      }
    }
    for (const file of walk(path.join(root, lang)).filter((item) => path.basename(item) === "SKILL.md")) {
      validateSkill(file);
    }
  }

  console.log("Package is valid.");
}

main();
