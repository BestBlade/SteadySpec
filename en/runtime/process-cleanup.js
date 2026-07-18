"use strict";

const { spawnSync } = require("child_process");

function terminateProcessTree(child, signal, options = {}) {
  const warnings = [];
  if (!child || !child.pid) return warnings;
  const label = options.label || "process";
  if (process.platform === "win32") {
    const args = ["/PID", String(child.pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    const result = spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true, timeout: 30000 });
    if (result.status === 0) return warnings;
    const directResult = spawnSync("taskkill", ["/PID", String(child.pid), "/F"], { stdio: "ignore", windowsHide: true, timeout: 30000 });
    if (directResult.status === 0) {
      warnings.push(`Windows taskkill /T failed for ${label} pid ${child.pid} with status ${result.status}; forced direct taskkill /F /PID succeeded.`);
      return warnings;
    }
    warnings.push(`Windows taskkill /T failed for ${label} pid ${child.pid} with status ${result.status}; forced direct taskkill /F /PID failed with status ${directResult.status}; falling back to direct process cleanup.`);
    try {
      child.kill(signal);
    } catch (error) {
      warnings.push(`Direct child ${signal} failed for ${label} pid ${child.pid}: ${error.message}.`);
    }
    return warnings;
  }
  try {
    process.kill(-child.pid, signal);
    return warnings;
  } catch (error) {
    warnings.push(`POSIX process-group ${signal} failed for ${label} pid ${child.pid}: ${error.message}; falling back to direct child kill.`);
  }
  try {
    child.kill(signal);
  } catch (error) {
    warnings.push(`Direct child ${signal} failed for ${label} pid ${child.pid}: ${error.message}.`);
  }
  return warnings;
}

module.exports = { terminateProcessTree };
