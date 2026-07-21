#!/usr/bin/env node

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  protocolVersion: "0.7",
  ok: true,
  assuranceState: "ready-for-human",
  acceptedSequence: 999,
  resultFingerprint: `sha256:${"0".repeat(64)}`,
})}\n`);
