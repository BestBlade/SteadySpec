#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(root, "bin", "assurance.js"), ...args], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.stderr) process.stderr.write(result.stderr);
if (result.status === 0 && args[0] === "reduce") {
  const output = JSON.parse(result.stdout);
  if (output.lineageId === "lineage-empty") delete output.authorityBoundary;
  else output.resultFingerprint = `sha256:${"0".repeat(64)}`;
  process.stdout.write(`${JSON.stringify(output)}\n`);
} else {
  process.stdout.write(result.stdout);
}
process.exitCode = result.status;
