#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const MANAGED_TAG = "steadyspec-cross-agent-hook-v1";
const EVENTS = ["UserPromptSubmit", "Stop"];
const HOSTS = ["claude", "codex"];
const CHANGE_ROOTS = [path.join(".meta", "changes"), path.join("openspec", "changes"), path.join("docs", "changes")];

function usage() {
  return `steadyspec hooks

Usage:
  steadyspec hooks install [--target claude|codex|both] [--dry-run] [--json]
  steadyspec hooks uninstall [--target claude|codex|both] [--dry-run] [--json]
  steadyspec hooks status [--target claude|codex|both] [--json]
  steadyspec hook-event <UserPromptSubmit|Stop> --host <claude|codex>
`;
}

function parseArgs(argv) {
  const args = { command: argv[2] || "status", target: "both", dryRun: false, json: false, event: null, host: null };
  if (args.command === "hook-event") args.event = argv[3] || null;
  const start = args.command === "hook-event" ? 4 : 3;
  for (let i = start; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg === "--host") args.host = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.command = "help";
    else if (arg === "--adapter-id") i += 1;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["install", "uninstall", "status", "hook-event", "help"].includes(args.command)) throw new Error(`Unknown hooks command: ${args.command}`);
  if (!["claude", "codex", "both"].includes(args.target)) throw new Error("--target must be claude, codex, or both");
  if (args.command === "hook-event" && (!EVENTS.includes(args.event) || !HOSTS.includes(args.host))) {
    throw new Error("hook-event requires a supported event and --host claude|codex");
  }
  return args;
}

function configPath(host) {
  const home = process.env.STEADYSPEC_HOME || process.env.HOME || os.homedir();
  if (host === "codex") return path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "hooks.json");
  return path.join(home, ".claude", "settings.json");
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function validateHooksShape(hooks, file) {
  if (hooks === undefined) return;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${file} hooks must be an object`);
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) throw new Error(`${file} hooks.${event} must be an array`);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.hooks)) throw new Error(`${file} hooks.${event} contains an incompatible entry`);
    }
  }
}

function managedHook(hook) {
  return Boolean(hook && typeof hook.command === "string" && hook.command.includes(MANAGED_TAG));
}

function managedEntry(entry) {
  return Boolean(entry && Array.isArray(entry.hooks) && entry.hooks.some(managedHook));
}

function stripManaged(hooks = {}) {
  const next = {};
  for (const [event, entries] of Object.entries(hooks || {})) {
    const kept = Array.isArray(entries)
      ? entries.flatMap((entry) => {
        if (!entry || !Array.isArray(entry.hooks)) return [];
        const remainingHooks = entry.hooks.filter((hook) => !managedHook(hook));
        return remainingHooks.length ? [{ ...entry, hooks: remainingHooks }] : [];
      })
      : [];
    if (kept.length) next[event] = kept;
  }
  return next;
}

function commandFor(event, host) {
  const script = __filename.replace(/\\/g, "/");
  return `node "${script}" hook-event ${event} --host ${host} --adapter-id ${MANAGED_TAG}`;
}

function managedHooks(host) {
  return Object.fromEntries(EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command: commandFor(event, host), timeout: 30 }] }]]));
}

function mergeManaged(existing, host) {
  const clean = stripManaged(existing);
  const managed = managedHooks(host);
  for (const event of EVENTS) clean[event] = [...(clean[event] || []), ...managed[event]];
  return clean;
}

function writeJsonPreserving(file, value, dryRun) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return "unchanged";
  if (dryRun) return current === null ? "would-create" : "would-update";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (current !== null) {
    const backup = `${file}.${MANAGED_TAG}-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, content, "utf8");
  readJson(file);
  return current === null ? "created" : "updated";
}

function selectedHosts(target) {
  return target === "both" ? HOSTS : [target];
}

function adapterAction(args) {
  const results = [];
  for (const host of selectedHosts(args.target)) {
    const file = configPath(host);
    const data = readJson(file, {});
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} must contain a JSON object`);
    validateHooksShape(data.hooks, file);
    const before = data.hooks || {};
    const installed = Object.values(before).some((entries) => Array.isArray(entries) && entries.some(managedEntry));
    if (args.command === "status") {
      results.push({ host, file, installed, events: Object.entries(before).filter(([, entries]) => Array.isArray(entries) && entries.some(managedEntry)).map(([event]) => event) });
      continue;
    }
    const hooks = args.command === "install" ? mergeManaged(before, host) : stripManaged(before);
    const action = writeJsonPreserving(file, { ...data, hooks }, args.dryRun);
    results.push({ host, file, installed: args.command === "install", action, events: args.command === "install" ? EVENTS : [] });
    if (host === "codex" && args.command === "install") results[results.length - 1].note = "Restart/open a new Codex task and trust the reported hooks file before relying on Codex-host dispatch.";
  }
  if (args.json) console.log(JSON.stringify({ schemaVersion: 1, command: args.command, results }, null, 2));
  else for (const result of results) {
    console.log(`[steadyspec hooks] ${result.host}: ${result.action || (result.installed ? "installed" : "not-installed")} ${result.file}`);
    if (result.note) console.warn(`[steadyspec hooks] WARN: ${result.note}`);
  }
}

function repoRoot(startPath = process.cwd()) {
  const result = spawnSync("git", ["-C", startPath, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function hookConfig(repo) {
  const file = path.join(repo, ".steadyspec", "cross-review.json");
  if (!fs.existsSync(file)) return null;
  try {
    const config = readJson(file);
    const mode = config && config.hooks && config.hooks.mode;
    return ["ask", "auto"].includes(mode) ? { ...config, file } : null;
  } catch {
    return null;
  }
}

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").replace(/^\uFEFF/u, "");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function firstString(input, keys) {
  for (const key of keys) if (typeof input[key] === "string" && input[key].trim()) return input[key].trim();
  return "";
}

function hookScope(input) {
  const value = firstString(input, ["run_id", "session_id", "transcript_path"]);
  return value || null;
}

function activation(prompt) {
  const phaseMatch = prompt.match(/steadyspec(?::|-)(propose|apply|verify|archive|explore)(?:-flow)?/i);
  const explicitMarker = /--cross-review\b|\/(cross-review|debate|grill)\b/i.test(prompt);
  const discussionOnly = /\b(how\s+(?:do|can|should)\s+i|what\s+is|explain|tell\s+me\s+about|want\s+to\s+understand)\b[^\r\n]{0,120}\b(cross[- ]?review|cross[- ]?agent|debate|grill|multi[- ]?agent|steadyspec(?::|-)(?:propose|apply|verify|archive|explore))\b|(?:如何|什么是|解释|介绍|想了解)[^\r\n]{0,60}(?:交叉审查|交叉评审|多\s*agent|多代理|辩论|质询|steadyspec)/i.test(prompt);
  const imperativeCrossAgent = /\b(use|run|start|invoke|perform|enable|launch)\b[^\r\n]{0,80}\b(cross[- ]?review|cross[- ]?agent|debate|grill|multi[- ]?agent)\b|(?:使用|运行|启动|进行|开启|调用)[^\r\n]{0,40}(?:交叉审查|交叉评审|多\s*agent|多代理|辩论|质询)/i.test(prompt);
  if (discussionOnly) return null;
  const crossAgent = explicitMarker || imperativeCrossAgent;
  if (!phaseMatch && !crossAgent) return null;
  const phase = phaseMatch ? phaseMatch[1].toLowerCase() : "cross-review";
  const mode = /\bdebate\b|辩论/i.test(prompt) ? "debate" : ["apply", "verify", "archive"].includes(phase) ? "review" : "design";
  const changeMatch = prompt.match(/--change\s+([A-Za-z0-9._-]+)|\bfor\s+([A-Za-z0-9._-]+)|(?:变更|更改|change)\s*[：:]?\s*([A-Za-z0-9._-]+)/i);
  return { phase, mode, requestedChange: changeMatch ? (changeMatch[1] || changeMatch[2] || changeMatch[3]) : null };
}

function statePath(repo, scope) {
  const key = scope ? crypto.createHash("sha256").update(scope).digest("hex").slice(0, 20) : "default";
  return path.join(repo, ".steadyspec", "runtime", "cross-review-hook-state", `${key}.json`);
}

function writeState(repo, state) {
  const file = statePath(repo, state.scope);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function clearState(repo, scope) {
  const file = statePath(repo, scope);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

function emitContext(event, context) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

function emitBlock(reason) {
  console.log(JSON.stringify({ decision: "block", reason }));
}

function peerForHost(config, host) {
  const configured = config?.hooks?.reviewer;
  if (["claude", "codex"].includes(configured)) return configured;
  return host === "claude" ? "codex" : "claude";
}

function reviewCommand(repo, config, state, change = "<change-id-or-path>") {
  const runner = path.join(__dirname, "cross-review.js").replace(/\\/g, "/");
  const args = [
    `node "${runner}"`,
    `--repo "${repo.replace(/\\/g, "/")}"`,
    `--change "${String(change).replace(/\\/g, "/")}"`,
    `--primary ${state.host}`,
    `--reviewer ${state.reviewer}`,
    `--mode ${state.mode}`,
  ];
  if (state.mode === "review") args.push("--include-diff");
  if (config.packetOnly) args.push("--packet-only");
  if (state.reviewer === "codex") args.push("--experimental-codex");
  if (state.mode === "debate") args.push("--experimental-debate");
  args.push("--run-if-needed --json");
  return args.join(" ");
}

function recordPending(repo, state, status, detail) {
  writeState(repo, { ...state, pendingStatus: status, pendingDetail: detail, updatedAt: Date.now() });
}

function stopDecision(host, repo, state, reason, pendingStatus) {
  recordPending(repo, state, pendingStatus, reason);
  emitBlock(reason);
}

function latestMtime(dir, depth = 20, seen = new Set()) {
  if (depth < 0) return 0;
  let real;
  try { real = fs.realpathSync(dir); } catch { return 0; }
  if (seen.has(real)) return 0;
  seen.add(real);
  let latest = 0;
  try { latest = fs.statSync(dir).mtimeMs; } catch { return 0; }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return latest; }
  for (const entry of entries) {
    if (entry.name === "cross-agent" || entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) latest = Math.max(latest, latestMtime(file, depth - 1, seen));
    else {
      try { latest = Math.max(latest, fs.statSync(file).mtimeMs); } catch { /* skip unreadable entries */ }
    }
  }
  return latest;
}

function resolveChange(repo, state) {
  const candidates = [];
  for (const rootRel of CHANGE_ROOTS) {
    const root = path.join(repo, rootRel);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue;
      const dir = path.join(root, entry.name);
      candidates.push({ id: entry.name, dir });
    }
  }
  if (state.requestedChange) {
    return candidates.find((candidate) => candidate.id.toLowerCase() === state.requestedChange.toLowerCase()) || { missing: state.requestedChange };
  }
  const named = candidates.filter((candidate) => state.prompt.toLowerCase().includes(candidate.id.toLowerCase()));
  if (named.length === 1) return named[0];
  const recent = candidates
    .map((candidate) => ({ ...candidate, modifiedAt: latestMtime(candidate.dir) }))
    .filter((candidate) => candidate.modifiedAt >= state.startedAt - 5000)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (recent.length > 1) return { ambiguous: recent.map((candidate) => candidate.id) };
  return recent[0] || null;
}

function checkCrossReview(repo, change, state, config) {
  const runner = path.join(__dirname, "cross-review.js");
  const args = [runner, "--repo", repo, "--change", change.dir, "--primary", state.host, "--reviewer", state.reviewer, "--mode", state.mode];
  if (state.mode === "review") args.push("--include-diff");
  if (state.mode === "debate") args.push("--experimental-debate");
  if (config.packetOnly) args.push("--packet-only");
  args.push("--check-latest", "--json");
  const result = spawnSync(process.execPath, args, {
    cwd: repo,
    env: buildRunnerEnv(config),
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 16 * 1024 * 1024,
  });
  let json = null;
  try { json = JSON.parse((result.stdout || "").trim()); } catch { /* reported below */ }
  return { status: result.status, json, stderr: result.stderr || "", error: result.error ? result.error.message : null };
}

function buildRunnerEnv(config) {
  const env = {};
  const names = ["PATH", "Path", "TEMP", "TMP", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "SHELL", "LANG", "LC_ALL", "TERM", ...(config.passEnv || [])];
  for (const name of names) {
    const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
    if (key && process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function handlePrompt(repo, config, input, host) {
  const prompt = firstString(input, ["prompt", "user_prompt", "user_message", "message", "input"]);
  const scope = hookScope(input);
  const trigger = activation(prompt);
  if (!trigger) { clearState(repo, scope); return; }
  const now = Date.now();
  const reviewer = peerForHost(config, host);
  if (reviewer === host) {
    emitBlock(`[SteadySpecCrossAgent] Invalid cross-agent route: primary and reviewer are both ${host}. Set hooks.reviewer to auto or the opposite agent family.`);
    return;
  }
  const state = {
    schemaVersion: 2,
    active: true,
    host,
    reviewer,
    sameFamily: false,
    scope,
    phase: trigger.phase,
    mode: trigger.mode,
    requestedChange: trigger.requestedChange,
    prompt,
    startedAt: now,
    expiresAt: now + (Number(config.hooks.activationTtlMs) || 6 * 60 * 60 * 1000),
  };
  writeState(repo, state);
  if (config.hooks.mode === "ask") {
    emitContext("UserPromptSubmit", `[steadyspec:cross-agent] This project-scoped turn is eligible for ${trigger.mode}. Ask the user to choose solo, grill, cross-review, or debate. Cross-review means ${host} -> ${state.reviewer}; a same-host second pass must be labeled same-agent and cannot satisfy cross-agent evidence.`);
    return;
  }
  const change = trigger.requestedChange || "<change-id-or-path-after-you-create-or-update-it>";
  emitContext("UserPromptSubmit", `[steadyspec:cross-agent] REQUIRED for this explicitly activated turn: primary host=${host}; independent peer=${state.reviewer}; mode=${trigger.mode}. Hooks do not run long model processes. After the change artifact exists, execute this peer command yourself in the same task:\n${reviewCommand(repo, config, state, change)}\nThen inspect raw.md, complete every row in moderation.md, and run the same command with --check-latest instead of --run-if-needed. Do not claim cross-agent completion until it passes. If the peer CLI is unavailable, report unavailable evidence; do not substitute a ${host} second pass.`);
}

function handleStop(repo, config, input, host) {
  // Keep hooks bounded. Reintroducing reviewer launch here requires a per-turn
  // spend/loop limit as well as a host-lifecycle timeout contract.
  if (input.stop_hook_active === true || input.subagent_stop_hook_active === true) return;
  const scope = hookScope(input);
  const file = statePath(repo, scope);
  if (!fs.existsSync(file)) return;
  let state;
  try { state = readJson(file); } catch { clearState(repo, scope); return; }
  if (!state.active || Date.now() > state.expiresAt) { clearState(repo, scope); return; }
  if (state.scope && scope && state.scope !== scope) return;
  const change = resolveChange(repo, state);
  if (!change) {
    stopDecision(host, repo, state, "[SteadySpecCrossAgent] Cross-agent work was requested, but no current change directory could be resolved. Name or create the change and run the injected peer command before completion.", "change-unresolved");
    return;
  }
  if (change.missing) {
    stopDecision(host, repo, state, `[SteadySpecCrossAgent] Requested change ${change.missing} does not exist under a configured change root. Correct it and run the injected peer command.`, "change-missing");
    return;
  }
  if (change.ambiguous) {
    stopDecision(host, repo, state, `[SteadySpecCrossAgent] Multiple changes are eligible (${change.ambiguous.join(", ")}). Name one and run the injected peer command.`, "change-ambiguous");
    return;
  }
  if (config.hooks.mode === "ask") {
    clearState(repo, scope);
    emitBlock(`[SteadySpecCrossAgent] Change ${change.id} is eligible for ${state.mode}. Ask the user whether to run solo, grill, cross-review, or debate.`);
    return;
  }
  if (state.mode === "debate" && config.hooks.allowExperimentalDebate !== true) {
    stopDecision(host, repo, state, "[SteadySpecCrossAgent] Debate is not enabled. Ask for confirmation or use cross-review.", "debate-disabled");
    return;
  }
  const latest = checkCrossReview(repo, change, state, config);
  if (latest.json && ["pass", "pass-with-warning"].includes(latest.json.status)) { clearState(repo, scope); return; }
  if (latest.json && latest.json.exitCode === 4) {
    stopDecision(host, repo, state, `[SteadySpecCrossAgent] ${state.reviewer} review exists but moderation is incomplete. Complete ${latest.json.moderationPath || "the latest moderation.md"} before finishing.`, "moderation-required");
    return;
  }
  stopDecision(host, repo, state, `[SteadySpecCrossAgent] Required ${state.host} -> ${state.reviewer} peer evidence is missing or unusable for ${change.id}. Run:\n${reviewCommand(repo, config, state, change.dir)}\nThen moderate and check-latest. Hooks never launch the long reviewer process.`, "peer-run-required");
}

function hookEvent(args) {
  if (process.env.STEADYSPEC_CROSS_REVIEW_CHILD === "1") return;
  const input = readHookInput();
  const hintedRoot = firstString(input, ["cwd", "project_root", "projectRoot"]);
  const repo = repoRoot(hintedRoot || process.cwd());
  if (!repo) return;
  const config = hookConfig(repo);
  if (!config || config.mode === "off") return;
  if (args.event === "UserPromptSubmit") handlePrompt(repo, config, input, args.host);
  else handleStop(repo, config, input, args.host);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.command === "help") { console.log(usage()); return; }
  if (args.command === "hook-event") hookEvent(args);
  else adapterAction(args);
}

try { main(); } catch (error) {
  console.error(`[steadyspec hooks] ${error.message}`);
  process.exitCode = 1;
}
