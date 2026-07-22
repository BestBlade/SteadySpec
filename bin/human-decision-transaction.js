#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { checkDelegationArtifacts, checkDocsChange } = require("./docs-check")

const SCHEMA_VERSION = 1
const CONTRACT_VERSION = 1
const KINDS = new Set(["intent-expansion", "archive-finalize"])
const DECISIONS = new Set(["approve-exact-transaction", "cancel"])
const INTENT_FIELDS = new Set([
  "boundary.inScope",
  "boundary.outOfScope",
  "nonGoals",
  "stopConditions",
  "evidenceRequired",
])
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const DECISION_ID_PATTERN = /^[a-f0-9]{32}$/
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_ILLEGAL = /[<>:"|?*]/
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/
const UNSAFE_MULTILINE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/

class TransactionError extends Error {
  constructor(code, message, status = "invalid", exitCode = 2) {
    super(message)
    this.code = code
    this.status = status
    this.exitCode = exitCode
  }
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`
}

function parseStrictJsonText(text, label) {
  if (typeof text !== "string" || text.charCodeAt(0) === 0xfeff) throw new TransactionError("JSON_BOM", `${label} must be UTF-8 JSON without BOM`)
  let index = 0
  const whitespace = () => { while (/\s/.test(text[index] || "")) index += 1 }
  const parseString = () => {
    const start = index
    if (text[index] !== '"') throw new TransactionError("JSON_STRING", `${label} contains an invalid JSON string`)
    index += 1
    while (index < text.length) {
      const ch = text[index]
      if (ch === '"') {
        index += 1
        try { return JSON.parse(text.slice(start, index)) } catch (error) { throw new TransactionError("JSON_STRING", `${label} contains an invalid JSON string`) }
      }
      if (ch === "\\") {
        index += 1
        const escaped = text[index]
        if (!escaped || !/["\\/bfnrtu]/.test(escaped)) throw new TransactionError("JSON_ESCAPE", `${label} contains an invalid JSON escape`)
        if (escaped === "u") {
          const hex = text.slice(index + 1, index + 5)
          if (!/^[a-fA-F0-9]{4}$/.test(hex)) throw new TransactionError("JSON_ESCAPE", `${label} contains an invalid unicode escape`)
          index += 4
        }
      } else if (ch.charCodeAt(0) < 0x20) {
        throw new TransactionError("JSON_CONTROL", `${label} contains a raw control character`)
      }
      index += 1
    }
    throw new TransactionError("JSON_UNTERMINATED", `${label} contains an unterminated string`)
  }
  const parseValue = () => {
    whitespace()
    const ch = text[index]
    if (ch === '"') return parseString()
    if (ch === "{") {
      index += 1
      const result = {}
      const keys = new Set()
      whitespace()
      if (text[index] === "}") { index += 1; return result }
      while (index < text.length) {
        whitespace()
        const key = parseString()
        if (keys.has(key)) throw new TransactionError("JSON_DUPLICATE_KEY", `${label} contains duplicate key ${key}`)
        keys.add(key)
        whitespace()
        if (text[index] !== ":") throw new TransactionError("JSON_COLON", `${label} contains an invalid object`)
        index += 1
        result[key] = parseValue()
        whitespace()
        if (text[index] === "}") { index += 1; return result }
        if (text[index] !== ",") throw new TransactionError("JSON_COMMA", `${label} contains an invalid object separator`)
        index += 1
      }
      throw new TransactionError("JSON_UNTERMINATED", `${label} contains an unterminated object`)
    }
    if (ch === "[") {
      index += 1
      const result = []
      whitespace()
      if (text[index] === "]") { index += 1; return result }
      while (index < text.length) {
        result.push(parseValue())
        whitespace()
        if (text[index] === "]") { index += 1; return result }
        if (text[index] !== ",") throw new TransactionError("JSON_COMMA", `${label} contains an invalid array separator`)
        index += 1
      }
      throw new TransactionError("JSON_UNTERMINATED", `${label} contains an unterminated array`)
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, index)) { index += token.length; return value }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)/)
    if (number) {
      index += number[0].length
      const value = Number(number[0])
      if (!Number.isSafeInteger(value)) throw new TransactionError("JSON_NUMBER", `${label} numbers must be safe integers`)
      return value
    }
    throw new TransactionError("JSON_VALUE", `${label} contains an invalid JSON value`)
  }
  const value = parseValue()
  whitespace()
  if (index !== text.length) throw new TransactionError("JSON_TRAILING", `${label} contains trailing data`)
  return value
}

function readStrictJson(file, label) {
  return { value: parseStrictJsonText(fs.readFileSync(file, "utf8"), label), bytes: fs.readFileSync(file) }
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TransactionError("CANONICAL_NUMBER", "canonical records accept safe integers only")
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== "object") throw new TransactionError("CANONICAL_TYPE", "canonical record contains an unsupported value")
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key])
  return result
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function recordHash(record, hashField) {
  const copy = { ...record }
  delete copy[hashField]
  return sha256(canonicalJson(copy))
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TransactionError("SCHEMA_OBJECT", `${label} must be an object`)
  const actual = Object.keys(value).sort().join(",")
  const expected = [...keys].sort().join(",")
  if (actual !== expected) throw new TransactionError("SCHEMA_FIELDS", `${label} fields must be exactly ${expected}`)
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || UNSAFE_TEXT.test(value)) throw new TransactionError("SCHEMA_TEXT", `${label} must be non-empty safe text`)
  return value
}

function strictRelativePath(value, label) {
  nonEmpty(value, label)
  if (value.includes("\\") || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.includes("%")) {
    throw new TransactionError("PATH_RELATIVE", `${label} must be a strict slash-separated repository-relative path`)
  }
  const parts = value.split("/")
  if (parts.some((part) => !part || part === "." || part === ".." || WINDOWS_ILLEGAL.test(part) || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part) || UNSAFE_TEXT.test(part))) {
    throw new TransactionError("PATH_SEGMENT", `${label} contains an unsafe or alias path segment`)
  }
  return parts.join("/")
}

function pathKey(value) {
  const normalized = path.resolve(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function insidePath(root, target) {
  const rootKey = pathKey(root)
  const targetKey = pathKey(target)
  return targetKey === rootKey || targetKey.startsWith(`${rootKey}${path.sep}`)
}

function assertNoLinkedComponents(repo, full, allowMissing) {
  const relative = path.relative(repo, full)
  let current = repo
  for (const part of relative.split(path.sep).filter(Boolean)) {
    const parent = current
    current = path.join(current, part)
    if (!fs.existsSync(current)) {
      if (allowMissing) return
      throw new TransactionError("PATH_MISSING", `required path does not exist: ${path.relative(repo, current)}`)
    }
    if (!fs.readdirSync(parent).includes(part)) throw new TransactionError("PATH_CASE_ALIAS", `declared path casing does not match the filesystem entry: ${path.relative(repo, current)}`)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new TransactionError("PATH_LINK", `symlink or junction is not allowed: ${path.relative(repo, current)}`)
    if (!stat.isDirectory() && pathKey(current) !== pathKey(full)) throw new TransactionError("PATH_COMPONENT", `non-directory path component: ${path.relative(repo, current)}`)
  }
}

function resolveRepoPath(repo, relative, options = {}) {
  const canonical = strictRelativePath(relative, options.label || "path")
  const full = path.resolve(repo, ...canonical.split("/"))
  if (!insidePath(repo, full)) throw new TransactionError("PATH_ESCAPE", `${options.label || "path"} escapes the repository`)
  assertNoLinkedComponents(repo, full, options.mustExist !== true)
  if (options.mustExist && !fs.existsSync(full)) throw new TransactionError("PATH_MISSING", `${options.label || "path"} does not exist`)
  if (fs.existsSync(full)) {
    const realRepo = fs.realpathSync(repo)
    const realFull = fs.realpathSync(full)
    if (!insidePath(realRepo, realFull)) throw new TransactionError("PATH_REAL_ESCAPE", `${options.label || "path"} resolves outside the repository`)
    const stat = fs.lstatSync(full)
    if (options.type === "file" && !stat.isFile()) throw new TransactionError("PATH_TYPE", `${options.label || "path"} must be a regular file`)
    if (options.type === "directory" && !stat.isDirectory()) throw new TransactionError("PATH_TYPE", `${options.label || "path"} must be a directory`)
  }
  return { canonical, full }
}

function parseBase64(value, label) {
  if (typeof value !== "string" || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TransactionError("BASE64", `${label} must be canonical non-empty base64`)
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) throw new TransactionError("BASE64", `${label} must be canonical base64`)
  return bytes
}

function assertUtf8(bytes, label) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TransactionError("UTF8_BOM", `${label} must not contain a BOM`)
  const text = bytes.toString("utf8")
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\u0000")) throw new TransactionError("UTF8", `${label} must be exact UTF-8 without NUL`)
  return text
}

function runtimeIdentity() {
  let packageVersion = "unknown"
  try { packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown" } catch (error) { /* reported through identity */ }
  return {
    contractVersion: CONTRACT_VERSION,
    packageVersion,
    helperSha256: sha256(fs.readFileSync(__filename)),
  }
}

function repoIdentity(repo) {
  const real = fs.realpathSync(repo)
  return { rootRealPath: real, rootSha256: sha256(process.platform === "win32" ? real.toLowerCase() : real) }
}

function resolveChange(repo, changeArg) {
  nonEmpty(changeArg, "--change")
  if (changeArg.includes("/") || changeArg.includes("\\")) {
    const resolved = resolveRepoPath(repo, changeArg.replace(/\\/g, "/"), { mustExist: true, type: "directory", label: "change" })
    const parts = resolved.canonical.split("/")
    const id = parts[parts.length - 1]
    if (parts.length < 2 || id.toLowerCase() === "archive") throw new TransactionError("CHANGE_ROOT", "explicit change path must be an active repository directory containing proposal.md")
    resolveRepoPath(repo, `${resolved.canonical}/proposal.md`, { mustExist: true, type: "file", label: "change proposal" })
    return { id, rootPath: resolved.canonical, full: resolved.full }
  }
  const id = strictRelativePath(changeArg, "change id")
  if (id.includes("/")) throw new TransactionError("CHANGE_ID", "change id must be one path segment")
  if (id.toLowerCase() === "archive") throw new TransactionError("CHANGE_ID", "archive is a reserved directory name, not an active change id")
  const candidates = []
  for (const base of ["docs/changes", "openspec/changes", ".meta/changes"]) {
    const relative = `${base}/${id}`
    const full = path.join(repo, ...relative.split("/"))
    if (!fs.existsSync(full)) continue
    const resolved = resolveRepoPath(repo, relative, { mustExist: true, type: "directory", label: "change" })
    const proposal = path.join(resolved.full, "proposal.md")
    if (!fs.existsSync(proposal)) continue
    resolveRepoPath(repo, `${resolved.canonical}/proposal.md`, { mustExist: true, type: "file", label: "change proposal" })
    candidates.push(resolved.canonical)
  }
  if (candidates.length !== 1) throw new TransactionError("CHANGE_RESOLUTION", `change id must resolve to exactly one active directory; found ${candidates.length}`)
  const resolved = resolveRepoPath(repo, candidates[0], { mustExist: true, type: "directory", label: "change" })
  return { id, rootPath: resolved.canonical, full: resolved.full }
}

function deriveFieldSection(before, fieldId, anchors) {
  const lines = []
  let offset = 0
  while (offset < before.length) {
    const newline = before.indexOf(0x0a, offset)
    const end = newline === -1 ? before.length : newline + 1
    const raw = before.subarray(offset, newline === -1 ? before.length : newline)
    const line = assertUtf8(raw.length && raw[raw.length - 1] === 0x0d ? raw.subarray(0, -1) : raw, "proposal line")
    lines.push({ start: offset, end, text: line })
    offset = end
  }
  const matches = []
  for (let index = 0; index < lines.length; index += 1) {
    if (anchors.includes(lines[index].text)) matches.push({ index, anchor: lines[index].text })
  }
  if (matches.length !== 1) throw new TransactionError("INTENT_FIELD", `${fieldId} must have exactly one recognized whole-line anchor`)
  const selected = matches[0]
  const heading = selected.anchor.match(/^(#{1,6})\s+/)
  let end = before.length
  for (let index = selected.index + 1; index < lines.length; index += 1) {
    const candidate = lines[index].text
    if (heading) {
      const next = candidate.match(/^(#{1,6})\s+/)
      if (next && next[1].length <= heading[1].length) { end = lines[index].start; break }
    } else if (/^(?:#{1,2})\s+/.test(candidate) || /^(?:In scope|Out of scope):$/.test(candidate)) {
      end = lines[index].start
      break
    }
  }
  return { start: lines[selected.index].start, contentStart: lines[selected.index].end, end, anchor: selected.anchor }
}

function countPreviewLines(text) {
  if (!text) return 0
  const matches = text.match(/(?:^|\n)/g)
  return Math.max(1, matches ? matches.length - (text.endsWith("\n") ? 1 : 0) : 1)
}

function prefixPreviewLines(text, prefix) {
  if (!text) return ""
  const parts = text.match(/[^\r\n]*(?:\r\n|\n|$)/g).filter((value) => value.length > 0)
  return parts.map((value) => `${prefix}${value}`).join("")
}

function exactIntentPreview(proposalPath, fieldId, section, relativeOffset, addition) {
  const beforeText = assertUtf8(section, "preview before field")
  const prefixText = assertUtf8(section.subarray(0, relativeOffset), "preview prefix")
  const suffixText = assertUtf8(section.subarray(relativeOffset), "preview suffix")
  const additionText = assertUtf8(addition, "preview addition")
  const after = Buffer.concat([section.subarray(0, relativeOffset), addition, section.subarray(relativeOffset)])
  const afterText = assertUtf8(after, "preview after field")
  const beforeLines = countPreviewLines(beforeText)
  const afterLines = countPreviewLines(afterText)
  const unifiedDiffUtf8 = `--- a/${proposalPath}\n+++ b/${proposalPath}\n@@ -1,${beforeLines} +1,${afterLines} @@ ${fieldId}\n${prefixPreviewLines(prefixText, " ")}${prefixPreviewLines(additionText, "+")}${prefixPreviewLines(suffixText, " ")}`
  return {
    format: "steadyspec-exact-unified-insertion-v1",
    fieldBeforeBase64: section.toString("base64"),
    fieldAfterBase64: after.toString("base64"),
    fieldBeforeUtf8: beforeText,
    fieldAfterUtf8: afterText,
    insertionOffsetWithinFieldByte: relativeOffset,
    unifiedDiffUtf8,
  }
}

function manifestFromDirectory(repo, relativeRoot) {
  const root = resolveRepoPath(repo, relativeRoot, { mustExist: true, type: "directory", label: "manifest root" })
  const entries = []
  const visit = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      strictRelativePath(relative, "manifest entry")
      const full = path.join(dir, entry.name)
      const stat = fs.lstatSync(full)
      if (stat.isSymbolicLink()) throw new TransactionError("MANIFEST_LINK", `manifest rejects symlink/junction ${relative}`)
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory" })
        visit(full, relative)
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(full)
        entries.push({ path: relative, type: "file", bytes: bytes.length, sha256: sha256(bytes) })
      } else {
        throw new TransactionError("MANIFEST_SPECIAL", `manifest rejects special file ${relative}`)
      }
    }
  }
  visit(root.full, "")
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type))
  return { entries, manifestHash: sha256(canonicalJson(entries)) }
}

function expectedArchiveTarget(sourceRoot, substrate, changeId) {
  const builtIn = { docs: "docs/changes", openspec: "openspec/changes", meta: ".meta/changes" }
  const matchingBuiltIn = Object.entries(builtIn).find(([, base]) => sourceRoot === `${base}/${changeId}`)
  if (matchingBuiltIn && substrate !== matchingBuiltIn[0]) {
    throw new TransactionError("ARCHIVE_SUBSTRATE_MISMATCH", `sourceRoot belongs to reserved ${matchingBuiltIn[0]} substrate, not ${substrate}`)
  }
  if (substrate === "custom" && Object.values(builtIn).some((base) => sourceRoot === base || sourceRoot.startsWith(`${base}/`))) {
    throw new TransactionError("ARCHIVE_CUSTOM_RESERVED_ROOT", "custom substrate cannot claim a built-in active or archive namespace")
  }
  const base = builtIn[substrate] || (substrate === "custom" ? path.posix.dirname(sourceRoot) : null)
  if (!base || sourceRoot !== `${base}/${changeId}`) throw new TransactionError("ARCHIVE_SOURCE", "sourceRoot does not match the selected substrate/change identity")
  return `${base}/archive/${changeId}`
}

function prepareIntent(repo, change, request) {
  exactKeys(request, ["schemaVersion", "proposalPath", "fieldId", "fieldSectionStartByte", "fieldSectionEndByte", "insertionOffsetByte", "additionBase64"], "intent request")
  if (request.schemaVersion !== 1 || !INTENT_FIELDS.has(request.fieldId)) throw new TransactionError("INTENT_SCHEMA", "intent request schemaVersion/fieldId is invalid")
  const proposal = resolveRepoPath(repo, request.proposalPath, { mustExist: true, type: "file", label: "proposalPath" })
  if (proposal.canonical !== `${change.rootPath}/proposal.md`) throw new TransactionError("INTENT_CHANGE", "proposalPath must be the exact proposal.md of the active change")
  const before = fs.readFileSync(proposal.full)
  assertUtf8(before, "proposal")
  const addition = parseBase64(request.additionBase64, "additionBase64")
  const additionText = assertUtf8(addition, "addition")
  if (UNSAFE_MULTILINE_TEXT.test(additionText)) throw new TransactionError("INTENT_ADDITION_TEXT", "addition contains unsafe control or directionality text")
  for (const key of ["fieldSectionStartByte", "fieldSectionEndByte", "insertionOffsetByte"]) if (!Number.isSafeInteger(request[key]) || request[key] < 0) throw new TransactionError("INTENT_OFFSET", `${key} must be a non-negative safe integer`)
  const start = request.fieldSectionStartByte
  const end = request.fieldSectionEndByte
  const offset = request.insertionOffsetByte
  if (!(start < end && end <= before.length && offset >= start && offset <= end)) throw new TransactionError("INTENT_RANGE", "section and insertion byte ranges are invalid")
  const anchors = {
    "boundary.inScope": ["### In Scope", "In scope:"],
    "boundary.outOfScope": ["### Out Of Scope", "### Out of Scope", "Out of scope:"],
    nonGoals: ["## Non-Goals", "## Non Goals"],
    stopConditions: ["## Stop Conditions"],
    evidenceRequired: ["## Evidence Required", "## Evidence Required For Completion"],
  }[request.fieldId]
  const derived = deriveFieldSection(before, request.fieldId, anchors)
  if (start !== derived.start || end !== derived.end || offset < derived.contentStart || offset > derived.end) throw new TransactionError("INTENT_FIELD", "request section/offset must exactly stay inside the code-derived declared field")
  const section = before.subarray(start, end)
  if (offset > 0 && before[offset - 1] !== 0x0a) throw new TransactionError("INTENT_LINE_BOUNDARY", "insertion offset must be a whole-line boundary inside the declared field")
  if (addition[addition.length - 1] !== 0x0a) throw new TransactionError("INTENT_ADDITION_LINE", "addition must end at a complete line boundary")
  const beforeHasCrlf = before.includes(Buffer.from("\r\n"))
  if (beforeHasCrlf && /(^|[^\r])\n/.test(additionText)) throw new TransactionError("INTENT_LINE_ENDING", "addition must preserve CRLF line endings")
  if (!beforeHasCrlf && additionText.includes("\r\n")) throw new TransactionError("INTENT_LINE_ENDING", "addition must preserve LF line endings")
  const after = Buffer.concat([before.subarray(0, offset), addition, before.subarray(offset)])
  assertUtf8(after, "proposal after-image")
  const exactPreview = exactIntentPreview(proposal.canonical, request.fieldId, section, offset - start, addition)
  return {
    bindingPayload: {
      proposalPath: proposal.canonical,
      sourceFileSha256: sha256(before),
      sourceFileBytes: before.length,
      fieldId: request.fieldId,
      fieldSectionStartByte: start,
      fieldSectionEndByte: end,
      fieldSectionSha256: sha256(section),
      insertionOffsetByte: offset,
      additionBase64: request.additionBase64,
      additionSha256: sha256(addition),
      additionBytes: addition.length,
      afterFileSha256: sha256(after),
      afterFileBytes: after.length,
    },
    preview: {
      type: "exact-insertion",
      proposalPath: proposal.canonical,
      fieldId: request.fieldId,
      insertionOffsetByte: offset,
      beforeSha256: sha256(before),
      afterSha256: sha256(after),
      additionBase64: request.additionBase64,
      additionUtf8: additionText,
      exactUnifiedPreview: exactPreview,
      semanticBoundary: "A human must decide whether this exact insertion is expansion rather than narrowing; the helper proves byte preservation only.",
    },
    expectedPostconditions: {
      proposalSha256: sha256(after),
      proposalBytes: after.length,
      oldBytesPreserved: true,
      onlyBoundInsertion: true,
    },
  }
}

function prepareArchive(repo, change, request) {
  exactKeys(request, ["schemaVersion", "sourceRoot", "targetRoot", "archiveBase64", "substrate", "docsCheckRequired"], "archive request")
  if (request.schemaVersion !== 1 || !["docs", "openspec", "meta", "custom"].includes(request.substrate) || typeof request.docsCheckRequired !== "boolean") throw new TransactionError("ARCHIVE_SCHEMA", "archive request schema is invalid")
  const source = resolveRepoPath(repo, request.sourceRoot, { mustExist: true, type: "directory", label: "sourceRoot" })
  if (source.canonical !== change.rootPath) throw new TransactionError("ARCHIVE_CHANGE", "sourceRoot must equal the resolved active change root")
  const derivedTarget = expectedArchiveTarget(source.canonical, request.substrate, change.id)
  if (request.targetRoot !== derivedTarget) throw new TransactionError("ARCHIVE_TARGET", "targetRoot must equal the code-derived archive target")
  const target = resolveRepoPath(repo, request.targetRoot, { mustExist: false, label: "targetRoot" })
  if (insidePath(source.full, target.full) || insidePath(target.full, source.full)) throw new TransactionError("ARCHIVE_PATH_OVERLAP", "archive source and target must be disjoint directories")
  if (fs.existsSync(target.full)) throw new TransactionError("ARCHIVE_TARGET_EXISTS", "archive target must be absent at prepare", "stale", 3)
  if (request.docsCheckRequired !== (request.substrate === "docs")) throw new TransactionError("ARCHIVE_DOCS_POLICY", "docsCheckRequired must be true exactly for docs substrate")
  const delegationPolicyIdentity = sha256(fs.readFileSync(path.join(__dirname, "docs-check.js")))
  const delegationReport = checkDelegationArtifacts(source.full, { requireReady: true, requireTrustArchive: true })
  if (!delegationReport.ok) {
    const codes = delegationReport.results.filter((item) => item.severity === "error").map((item) => `${item.code}:${item.file}`)
    throw new TransactionError("ARCHIVE_DELEGATION_NOT_READY", `archive delegation/trust artifacts are not ready: ${codes.join(", ")}`, "blocked", 3)
  }
  const archiveBytes = parseBase64(request.archiveBase64, "archiveBase64")
  assertUtf8(archiveBytes, "archive bytes")
  const sourceManifest = manifestFromDirectory(repo, source.canonical)
  if (sourceManifest.entries.some((entry) => entry.path === "archive.md")) throw new TransactionError("ARCHIVE_ALREADY_RENDERED", "active source already contains archive.md")
  const targetEntries = [...sourceManifest.entries, { path: "archive.md", type: "file", bytes: archiveBytes.length, sha256: sha256(archiveBytes) }]
    .sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type))
  const docsCheckPolicyIdentity = request.docsCheckRequired ? sha256(fs.readFileSync(path.join(__dirname, "docs-check.js"))) : null
  return {
    bindingPayload: {
      sourceRoot: source.canonical,
      sourceManifest: sourceManifest.entries,
      sourceManifestHash: sourceManifest.manifestHash,
      targetRoot: target.canonical,
      expectedTargetState: "absent",
      archiveRelativePath: "archive.md",
      archiveBase64: request.archiveBase64,
      archiveSha256: sha256(archiveBytes),
      archiveBytes: archiveBytes.length,
      expectedTargetManifest: targetEntries,
      expectedTargetManifestHash: sha256(canonicalJson(targetEntries)),
      substrate: request.substrate,
      docsCheckRequired: request.docsCheckRequired,
      docsCheckPolicyIdentity,
      delegationPolicyIdentity,
      delegationArtifactFingerprint: delegationReport.artifactFingerprint,
    },
    preview: {
      type: "exact-archive-finalize",
      sourceRoot: source.canonical,
      sourceManifestHash: sourceManifest.manifestHash,
      sourceEntryCount: sourceManifest.entries.length,
      targetRoot: target.canonical,
      archiveSha256: sha256(archiveBytes),
      archiveBytes: archiveBytes.length,
      expectedTargetManifestHash: sha256(canonicalJson(targetEntries)),
      semanticBoundary: "Filesystem archived is not human acceptance, truth, merge, or release authority.",
      delegationArtifactFingerprint: delegationReport.artifactFingerprint,
    },
    expectedPostconditions: {
      targetManifestHash: sha256(canonicalJson(targetEntries)),
      archiveSha256: sha256(archiveBytes),
      activeSourceAbsent: true,
      stagingAbsent: true,
      retiredAbsent: true,
      docsCheckPassed: true,
      delegationCheckPassed: true,
      filesystemState: "archived",
    },
  }
}

function transactionRoot(repo) {
  const full = path.join(repo, ".steadyspec", "human-transactions")
  assertNoLinkedComponents(repo, full, true)
  if (fs.existsSync(full) && !fs.lstatSync(full).isDirectory()) throw new TransactionError("TRANSACTION_ROOT", "transaction root must be a real directory")
  return full
}

function pendingRelative(decisionId) {
  return `.steadyspec/human-transactions/${decisionId}/pending.json`
}

function baseOutput(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    status: "invalid",
    action: "stop",
    exitCode: 2,
    kind: "",
    changeId: "",
    changeRoot: "",
    decisionId: "",
    pendingPath: "",
    bindingHash: "",
    pendingHash: "",
    decisionBindingValid: false,
    domainMutation: "none",
    postconditions: {},
    errors: [],
    warnings: [],
    ...overrides,
  }
}

function pendingOutputIdentity(pending) {
  return { kind: pending.kind, changeId: pending.change.id, changeRoot: pending.change.rootPath, decisionId: pending.decisionId, pendingPath: pendingRelative(pending.decisionId), bindingHash: pending.bindingHash, pendingHash: pending.pendingHash }
}

function readPending(repo, decisionId) {
  if (!DECISION_ID_PATTERN.test(decisionId || "")) throw new TransactionError("DECISION_ID", "decision id must be 32 lowercase hex characters")
  const relative = pendingRelative(decisionId)
  const resolved = resolveRepoPath(repo, relative, { mustExist: true, type: "file", label: "pending record" })
  const { value } = readStrictJson(resolved.full, "pending record")
  const keys = ["schemaVersion", "contractVersion", "recordType", "decisionId", "kind", "createdAt", "runtimeIdentity", "repoIdentity", "change", "requestHash", "binding", "bindingHash", "preview", "expectedDecisionPath", "expectedPostconditions", "pendingHash"]
  exactKeys(value, keys, "pending record")
  if (value.schemaVersion !== 1 || value.contractVersion !== 1 || value.recordType !== "pending" || value.decisionId !== decisionId || !KINDS.has(value.kind) || value.pendingHash !== recordHash(value, "pendingHash") || value.bindingHash !== sha256(canonicalJson(value.binding))) {
    throw new TransactionError("PENDING_INVALID", "pending record identity or hash is invalid", "replay-conflict", 3)
  }
  return { pending: value, relative, full: resolved.full }
}

function atomicWriteNewJson(file, value) {
  const temp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")
  let handle
  try {
    handle = fs.openSync(temp, "wx")
    fs.writeFileSync(handle, bytes)
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temp, file)
  } finally {
    if (handle !== null && handle !== undefined) fs.closeSync(handle)
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true })
  }
}

function findExistingBinding(repo, bindingHash) {
  const root = transactionRoot(repo)
  if (!fs.existsSync(root)) return null
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !DECISION_ID_PATTERN.test(entry.name)) continue
    const file = path.join(root, entry.name, "pending.json")
    if (!fs.existsSync(file)) continue
    const record = readPending(repo, entry.name).pending
    if (record.bindingHash === bindingHash) return record
  }
  return null
}

function outputForPending(repo, pending, status = "needs-user", action = "record-human-decision") {
  assertPendingEnvironment(repo, pending)
  const journal = readJournal(repo, pending)
  if (journal && journal.status === "committed") {
    const { decision } = readDecision(repo, pending, pending.expectedDecisionPath)
    return terminalOutput(repo, pending, decision, journal, true)
  }
  if (journal && journal.status === "cancelled") {
    const { decision } = readDecision(repo, pending, pending.expectedDecisionPath)
    if (decision.decision !== "cancel" || journal.decisionHash !== decision.decisionHash) throw new TransactionError("CANCEL_REPLAY", "cancel journal is not bound to the exact cancel decision", "replay-conflict", 3)
    return baseOutput({ status: "already-cancelled", action: "none", exitCode: 0, decisionBindingValid: true, ...pendingOutputIdentity(pending) })
  }
  if (journal && journal.status === "docs-check-failed") {
    const { decision } = readDecision(repo, pending, pending.expectedDecisionPath)
    if (decision.decision !== "approve-exact-transaction" || journal.decisionHash !== decision.decisionHash) throw new TransactionError("DECISION_REPLAY", "docs-check journal is not bound to the current exact approve decision", "replay-conflict", 3)
    return baseOutput({ status: "docs-check-failed", action: "stop", exitCode: 2, decisionBindingValid: true, errors: journal.docsCheck && journal.docsCheck.errors || ["docs check failed"], ...pendingOutputIdentity(pending) })
  }
  if (journal) return baseOutput({ status: "recovery-required", action: "inspect-journal-then-retry-exact-commit", exitCode: 4, domainMutation: "possible-partial-inspect-journal", postconditions: journal.postconditions || {}, errors: [`transaction stopped at phase ${journal.phase}`], ...pendingOutputIdentity(pending) })
  validateCurrentPreimage(repo, pending)
  return baseOutput({ status, action, exitCode: 2, ...pendingOutputIdentity(pending) })
}

function prepare(repo, args) {
  if (!KINDS.has(args.kind || "")) throw new TransactionError("KIND", "--kind must be intent-expansion or archive-finalize")
  if (!args.request) throw new TransactionError("REQUEST", "prepare requires --request")
  const change = resolveChange(repo, args.change)
  const requestFile = resolveRepoPath(repo, args.request, { mustExist: true, type: "file", label: "request" })
  const requestRead = readStrictJson(requestFile.full, "transaction request")
  const prepared = args.kind === "intent-expansion" ? prepareIntent(repo, change, requestRead.value) : prepareArchive(repo, change, requestRead.value)
  const runtime = runtimeIdentity()
  const repository = repoIdentity(repo)
  const binding = {
    kind: args.kind,
    runtimeIdentity: runtime,
    repoIdentity: repository,
    change: { id: change.id, rootPath: change.rootPath },
    operation: prepared.bindingPayload,
  }
  const bindingHash = sha256(canonicalJson(binding))
  const release = acquireNamedLock(repo, `binding-${bindingHash.slice("sha256:".length)}`)
  try {
    const existing = findExistingBinding(repo, bindingHash)
    if (existing) return outputForPending(repo, existing)
    const decisionId = crypto.randomBytes(16).toString("hex")
    const pending = {
      schemaVersion: SCHEMA_VERSION,
      contractVersion: CONTRACT_VERSION,
      recordType: "pending",
      decisionId,
      kind: args.kind,
      createdAt: new Date().toISOString(),
      runtimeIdentity: runtime,
      repoIdentity: repository,
      change: { id: change.id, rootPath: change.rootPath },
      requestHash: sha256(requestRead.bytes),
      binding,
      bindingHash,
      preview: prepared.preview,
      expectedDecisionPath: `.steadyspec/human-transactions/${decisionId}/decision.json`,
      expectedPostconditions: prepared.expectedPostconditions,
      pendingHash: "",
    }
    pending.pendingHash = recordHash(pending, "pendingHash")
    const root = transactionRoot(repo)
    const dir = path.join(root, decisionId)
    const candidate = path.join(root, `.pending-${decisionId}-${crypto.randomBytes(8).toString("hex")}`)
    try {
      fs.mkdirSync(root, { recursive: true })
      fs.mkdirSync(candidate)
      atomicWriteNewJson(path.join(candidate, "pending.json"), pending)
      maybeFault("prepare-candidate-written")
      fs.renameSync(candidate, dir)
    } catch (error) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true })
      throw error
    }
    return outputForPending(repo, pending)
  } finally {
    release()
  }
}

function status(repo, args) {
  const { pending } = readPending(repo, args.decisionId)
  return outputForPending(repo, pending)
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function assertPendingEnvironment(repo, pending) {
  if (!sameCanonical(pending.runtimeIdentity, runtimeIdentity())) throw new TransactionError("RUNTIME_STALE", "helper/package runtime identity changed after prepare", "stale", 3)
  if (!sameCanonical(pending.repoIdentity, repoIdentity(repo))) throw new TransactionError("REPO_STALE", "repository identity changed after prepare", "stale", 3)
}

function readDecision(repo, pending, relativePath) {
  if (!relativePath) throw new TransactionError("DECISION_MISSING", "--decision-record is required", "needs-user", 2)
  const resolved = resolveRepoPath(repo, relativePath, { mustExist: true, type: "file", label: "decision record" })
  if (resolved.canonical !== pending.expectedDecisionPath) throw new TransactionError("DECISION_PATH", "decision record path does not match the pending transaction", "replay-conflict", 3)
  const { value } = readStrictJson(resolved.full, "decision record")
  const keys = ["schemaVersion", "contractVersion", "recordType", "decisionId", "kind", "pendingHash", "bindingHash", "decision", "reason", "confirmedBy", "confirmedAt", "confirmationRef", "decisionHash"]
  exactKeys(value, keys, "decision record")
  if (value.schemaVersion !== 1 || value.contractVersion !== 1 || value.recordType !== "human-decision" || value.decisionId !== pending.decisionId || value.kind !== pending.kind || value.pendingHash !== pending.pendingHash || value.bindingHash !== pending.bindingHash || !DECISIONS.has(value.decision)) {
    throw new TransactionError("DECISION_BINDING", "decision record does not exactly bind the pending transaction", "replay-conflict", 3)
  }
  for (const field of ["reason", "confirmedBy", "confirmedAt", "confirmationRef"]) nonEmpty(value[field], `decision.${field}`)
  if (!HASH_PATTERN.test(value.decisionHash || "") || value.decisionHash !== recordHash(value, "decisionHash")) throw new TransactionError("DECISION_HASH", "decision record hash is invalid", "replay-conflict", 3)
  return { decision: value, full: resolved.full, relative: resolved.canonical }
}

function journalPath(repo, decisionId) {
  return path.join(transactionRoot(repo), decisionId, "commit.json")
}

function validateJournal(value, pending) {
  const keys = ["schemaVersion", "contractVersion", "recordType", "decisionId", "kind", "pendingHash", "bindingHash", "decisionHash", "status", "phase", "runtimeIdentity", "startedAt", "updatedAt", "completedAt", "lockKey", "workPaths", "beforeObservation", "history", "docsCheck", "postconditions", "commitHash"]
  exactKeys(value, keys, "commit journal")
  if (value.schemaVersion !== 1 || value.contractVersion !== 1 || value.recordType !== "commit" || value.decisionId !== pending.decisionId || value.kind !== pending.kind || value.pendingHash !== pending.pendingHash || value.bindingHash !== pending.bindingHash || !HASH_PATTERN.test(value.commitHash || "") || value.commitHash !== recordHash(value, "commitHash")) {
    throw new TransactionError("JOURNAL_BINDING", "commit journal identity or hash is invalid", "replay-conflict", 3)
  }
  if (!sameCanonical(value.runtimeIdentity, pending.runtimeIdentity)) throw new TransactionError("JOURNAL_RUNTIME", "commit journal runtime identity differs from pending", "replay-conflict", 3)
  const operation = pending.binding.operation
  const cancelled = value.status === "cancelled" && value.phase === "cancelled"
  const expectedWorkPaths = cancelled ? {} : pending.kind === "intent-expansion"
    ? intentWorkPaths(operation, pending.decisionId)
    : archiveWorkPaths(operation, pending.decisionId)
  const expectedBefore = cancelled ? { domainUnchanged: true } : pending.kind === "intent-expansion"
    ? { proposalSha256: operation.sourceFileSha256, proposalBytes: operation.sourceFileBytes }
    : { sourceManifestHash: operation.sourceManifestHash, targetState: "absent" }
  const expectedLockKey = sha256(`${pending.change.rootPath}\n${operation.targetRoot || operation.proposalPath}`)
  if (!sameCanonical(value.workPaths, expectedWorkPaths) || !sameCanonical(value.beforeObservation, expectedBefore) || value.lockKey !== expectedLockKey) {
    throw new TransactionError("JOURNAL_DERIVATION", "commit journal paths or observations are not code-derived from pending", "replay-conflict", 3)
  }
  const allowed = pending.kind === "intent-expansion"
    ? new Set(["in-progress:validated", "in-progress:backup-created", "in-progress:target-installed", "in-progress:readback-passed", "committed:committed", "cancelled:cancelled"])
    : new Set(["in-progress:validated", "in-progress:staging-built", "in-progress:target-committed", "in-progress:source-detached", "in-progress:source-retired", "committed:committed", "docs-check-failed:docs-check-failed", "cancelled:cancelled"])
  if (!allowed.has(`${value.status}:${value.phase}`) || !Array.isArray(value.history) || value.history.length === 0 || value.history[value.history.length - 1].phase !== value.phase) {
    throw new TransactionError("JOURNAL_PHASE", "commit journal status/phase/history is invalid", "replay-conflict", 3)
  }
  return value
}

function readJournal(repo, pending) {
  const file = journalPath(repo, pending.decisionId)
  if (!fs.existsSync(file)) return null
  return validateJournal(readStrictJson(file, "commit journal").value, pending)
}

function atomicReplaceJson(file, value) {
  const next = { ...value, commitHash: "" }
  next.commitHash = recordHash(next, "commitHash")
  const temp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`
  let handle
  try {
    handle = fs.openSync(temp, "wx")
    fs.writeFileSync(handle, Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8"))
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temp, file)
  } finally {
    if (handle !== null && handle !== undefined) fs.closeSync(handle)
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true })
  }
  return next
}

function newJournal(pending, decision, workPaths, beforeObservation) {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    contractVersion: 1,
    recordType: "commit",
    decisionId: pending.decisionId,
    kind: pending.kind,
    pendingHash: pending.pendingHash,
    bindingHash: pending.bindingHash,
    decisionHash: decision.decisionHash,
    status: "in-progress",
    phase: "validated",
    runtimeIdentity: pending.runtimeIdentity,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    lockKey: sha256(`${pending.change.rootPath}\n${pending.binding.operation.targetRoot || pending.binding.operation.proposalPath}`),
    workPaths,
    beforeObservation,
    history: [{ phase: "validated", at: now }],
    docsCheck: null,
    postconditions: { passed: false },
    commitHash: "",
  }
}

function advanceJournal(repo, journal, phase, changes = {}) {
  const now = new Date().toISOString()
  const next = {
    ...journal,
    ...changes,
    phase,
    updatedAt: now,
    history: [...journal.history, { phase, at: now }],
  }
  return atomicReplaceJson(journalPath(repo, journal.decisionId), next)
}

function processIsLive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return !!(error && error.code === "EPERM") }
}

function lockOwner(lockName) {
  const owner = {
    schemaVersion: 1,
    recordType: "transaction-lock-owner",
    lockName,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    runtimeIdentity: runtimeIdentity(),
    token: crypto.randomBytes(16).toString("hex"),
    ownerHash: "",
  }
  owner.ownerHash = recordHash(owner, "ownerHash")
  return owner
}

function readLockOwner(lock, lockName) {
  if (!fs.existsSync(lock) || !fs.lstatSync(lock).isDirectory() || fs.lstatSync(lock).isSymbolicLink()) throw new TransactionError("LOCK_FORMAT", "transaction lock is not a real owner directory", "recovery-required", 4)
  const file = path.join(lock, "owner.json")
  if (!fs.existsSync(file)) throw new TransactionError("LOCK_OWNER_MISSING", "published transaction lock has no owner record", "recovery-required", 4)
  const value = readStrictJson(file, "lock owner").value
  exactKeys(value, ["schemaVersion", "recordType", "lockName", "pid", "createdAt", "runtimeIdentity", "token", "ownerHash"], "lock owner")
  if (value.schemaVersion !== 1 || value.recordType !== "transaction-lock-owner" || value.lockName !== lockName || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !/^[a-f0-9]{32}$/.test(value.token || "") || value.ownerHash !== recordHash(value, "ownerHash")) {
    throw new TransactionError("LOCK_OWNER_INVALID", "transaction lock owner record is invalid", "recovery-required", 4)
  }
  return value
}

function publishLock(lockRoot, lock, owner) {
  const candidate = path.join(lockRoot, `.candidate-${owner.token}`)
  fs.mkdirSync(candidate)
  try {
    atomicWriteNewJson(path.join(candidate, "owner.json"), owner)
    try { fs.renameSync(candidate, lock); return true } catch (error) {
      if (fs.existsSync(lock)) return false
      throw error
    }
  } finally {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true })
  }
}

function acquireNamedLock(repo, lockName) {
  if (!/^[a-z0-9-]{1,160}$/.test(lockName)) throw new TransactionError("LOCK_KEY", "internal lock key is invalid")
  const lockRoot = path.join(transactionRoot(repo), ".locks")
  fs.mkdirSync(lockRoot, { recursive: true })
  assertNoLinkedComponents(repo, lockRoot, false)
  const lock = path.join(lockRoot, `${lockName}.lock`)
  const owner = lockOwner(lockName)
  let quarantine = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (publishLock(lockRoot, lock, owner)) {
      return () => {
        if (fs.existsSync(lock)) {
          const current = readLockOwner(lock, lockName)
          if (current.token !== owner.token) throw new TransactionError("LOCK_RELEASE_OWNER", "refusing to release a replacement lock", "recovery-required", 4)
          fs.rmSync(lock, { recursive: true })
        }
        if (quarantine && fs.existsSync(quarantine)) fs.rmSync(quarantine, { recursive: true, force: true })
      }
    }
    const existing = readLockOwner(lock, lockName)
    if (processIsLive(existing.pid)) throw new TransactionError("LOCK_CONTENTION", "transaction lock owner process is still live", "recovery-required", 4)
    const stale = `${lock}.stale-${existing.token}`
    try {
      fs.renameSync(lock, stale)
      quarantine = stale
    } catch (error) {
      if (!fs.existsSync(lock) || fs.existsSync(stale)) continue
      throw error
    }
  }
  throw new TransactionError("LOCK_RECLAIM", "stale transaction lock could not be safely reclaimed", "recovery-required", 4)
}

function acquireLock(repo, pending) {
  const operation = pending.binding.operation
  const targetIdentity = operation.targetRoot || operation.proposalPath
  const lockKey = sha256(`${pending.change.rootPath}\n${targetIdentity}`).slice("sha256:".length)
  return acquireNamedLock(repo, `target-${lockKey}`)
}

function maybeFault(phase) {
  if (process.env.STEADYSPEC_INTERNAL_TRANSACTION_CRASH === phase) process.exit(86)
  if (process.env.STEADYSPEC_INTERNAL_TRANSACTION_FAULT === phase) throw new TransactionError("FAULT_INJECTED", `fault injected after ${phase}`, "recovery-required", 4)
}

function bufferAt(file, expectedHash, expectedBytes) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null
  const bytes = fs.readFileSync(file)
  return bytes.length === expectedBytes && sha256(bytes) === expectedHash ? bytes : null
}

function validateCurrentPreimage(repo, pending) {
  const operation = pending.binding.operation
  if (pending.kind === "intent-expansion") {
    const proposal = resolveRepoPath(repo, operation.proposalPath, { mustExist: true, type: "file", label: "proposal preimage" })
    const before = bufferAt(proposal.full, operation.sourceFileSha256, operation.sourceFileBytes)
    if (!before) throw new TransactionError("SOURCE_STALE", "proposal bytes changed after prepare", "stale", 3)
    const section = before.subarray(operation.fieldSectionStartByte, operation.fieldSectionEndByte)
    if (sha256(section) !== operation.fieldSectionSha256) throw new TransactionError("SECTION_STALE", "proposal field section changed after prepare", "stale", 3)
    return { proposal, before }
  }
  const source = resolveRepoPath(repo, operation.sourceRoot, { mustExist: true, type: "directory", label: "archive source" })
  const manifest = manifestFromDirectory(repo, source.canonical)
  if (manifest.manifestHash !== operation.sourceManifestHash || !sameCanonical(manifest.entries, operation.sourceManifest)) throw new TransactionError("SOURCE_STALE", "archive source manifest changed after prepare", "stale", 3)
  const delegationCheck = delegationCheckForLocation(repo, operation, source.canonical)
  if (!delegationCheck.passed) throw new TransactionError("ARCHIVE_DELEGATION_STALE", `archive delegation/trust artifacts no longer match prepare: ${delegationCheck.errors.join(", ")}`, "stale", 3)
  const target = resolveRepoPath(repo, operation.targetRoot, { mustExist: false, label: "archive target" })
  if (fs.existsSync(target.full)) throw new TransactionError("TARGET_STALE", "archive target is no longer absent", "stale", 3)
  return { source, target, manifest }
}

function intentBuffers(operation, before) {
  const addition = Buffer.from(operation.additionBase64, "base64")
  const after = Buffer.concat([before.subarray(0, operation.insertionOffsetByte), addition, before.subarray(operation.insertionOffsetByte)])
  if (sha256(after) !== operation.afterFileSha256 || after.length !== operation.afterFileBytes) throw new TransactionError("PENDING_AFTER", "pending intent after-image is internally inconsistent", "replay-conflict", 3)
  return { addition, after }
}

function intentWorkPaths(operation, decisionId) {
  const directory = path.posix.dirname(operation.proposalPath)
  const base = path.posix.basename(operation.proposalPath)
  const prefix = directory === "." ? "" : `${directory}/`
  return {
    proposal: operation.proposalPath,
    temp: `${prefix}.${base}.steadyspec-${decisionId}.after.tmp`,
    backup: `${prefix}.${base}.steadyspec-${decisionId}.before.bak`,
  }
}

function intentPostconditions(repo, pending, decision, journal) {
  const operation = pending.binding.operation
  const proposal = resolveRepoPath(repo, operation.proposalPath, { mustExist: true, type: "file", label: "proposal postcondition" })
  const work = journal.workPaths
  const passed = !!bufferAt(proposal.full, operation.afterFileSha256, operation.afterFileBytes)
    && !fs.existsSync(path.join(repo, ...work.temp.split("/")))
    && !fs.existsSync(path.join(repo, ...work.backup.split("/")))
    && readPending(repo, pending.decisionId).pending.pendingHash === pending.pendingHash
    && readDecision(repo, pending, pending.expectedDecisionPath).decision.decisionHash === decision.decisionHash
  return {
    passed,
    proposalPath: operation.proposalPath,
    proposalSha256: operation.afterFileSha256,
    proposalBytes: operation.afterFileBytes,
    oldBytesPreserved: passed,
    onlyBoundInsertion: passed,
    filesystemState: "proposal-expanded",
  }
}

function commitIntent(repo, pending, decision, journal) {
  const operation = pending.binding.operation
  let work
  if (!journal) {
    const current = validateCurrentPreimage(repo, pending)
    work = intentWorkPaths(operation, pending.decisionId)
    const temp = resolveRepoPath(repo, work.temp, { mustExist: false, label: "intent temp" })
    const backup = resolveRepoPath(repo, work.backup, { mustExist: false, label: "intent backup" })
    if (fs.existsSync(temp.full) || fs.existsSync(backup.full)) throw new TransactionError("INTENT_WORK_CONFLICT", "intent temp/backup path already exists", "recovery-required", 4)
    journal = newJournal(pending, decision, work, { proposalSha256: operation.sourceFileSha256, proposalBytes: operation.sourceFileBytes })
    journal = atomicReplaceJson(journalPath(repo, pending.decisionId), journal)
    maybeFault("intent-validated")
  } else {
    work = journal.workPaths
  }
  const proposal = path.join(repo, ...work.proposal.split("/"))
  const temp = path.join(repo, ...work.temp.split("/"))
  const backup = path.join(repo, ...work.backup.split("/"))
  const beforeAt = (file) => !!bufferAt(file, operation.sourceFileSha256, operation.sourceFileBytes)
  const afterAt = (file) => !!bufferAt(file, operation.afterFileSha256, operation.afterFileBytes)
  if (journal.phase === "validated" && beforeAt(proposal) && !fs.existsSync(backup)) {
    if (fs.existsSync(temp) && !afterAt(temp)) fs.rmSync(temp, { force: true })
    if (!fs.existsSync(temp)) {
      const { after } = intentBuffers(operation, fs.readFileSync(proposal))
      const handle = fs.openSync(temp, "wx")
      try { fs.writeFileSync(handle, after); fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
    }
    if (!afterAt(temp)) throw new TransactionError("INTENT_TEMP_READBACK", "intent temp readback failed", "recovery-required", 4)
  }
  if (journal.phase === "validated" && !fs.existsSync(proposal) && beforeAt(backup) && afterAt(temp)) journal = advanceJournal(repo, journal, "backup-created")
  if (journal.phase === "validated") {
    if (!beforeAt(proposal) || !afterAt(temp) || fs.existsSync(backup)) throw new TransactionError("INTENT_CONSTELLATION", "validated intent file constellation is not recoverable", "recovery-required", 4)
    fs.renameSync(proposal, backup)
    journal = advanceJournal(repo, journal, "backup-created")
    maybeFault("intent-backup-created")
  }
  if (journal.phase === "backup-created" && afterAt(proposal) && beforeAt(backup) && !fs.existsSync(temp)) journal = advanceJournal(repo, journal, "target-installed")
  if (journal.phase === "backup-created") {
    if (fs.existsSync(proposal) || !beforeAt(backup) || !afterAt(temp)) throw new TransactionError("INTENT_CONSTELLATION", "backup-created intent file constellation is not recoverable", "recovery-required", 4)
    fs.renameSync(temp, proposal)
    journal = advanceJournal(repo, journal, "target-installed")
    maybeFault("intent-target-installed")
  }
  if (journal.phase === "target-installed" && afterAt(proposal) && !fs.existsSync(backup) && !fs.existsSync(temp)) journal = advanceJournal(repo, journal, "readback-passed")
  if (journal.phase === "target-installed") {
    if (!afterAt(proposal) || !beforeAt(backup) || fs.existsSync(temp)) throw new TransactionError("INTENT_CONSTELLATION", "target-installed intent file constellation is not recoverable", "recovery-required", 4)
    fs.rmSync(backup)
    journal = advanceJournal(repo, journal, "readback-passed")
    maybeFault("intent-readback-passed")
  }
  if (journal.phase !== "readback-passed") throw new TransactionError("INTENT_PHASE", `unsupported intent journal phase ${journal.phase}`, "recovery-required", 4)
  const postconditions = intentPostconditions(repo, pending, decision, journal)
  if (!postconditions.passed) throw new TransactionError("INTENT_POSTCONDITION", "intent postcondition readback failed", "recovery-required", 4)
  const completedAt = new Date().toISOString()
  journal = advanceJournal(repo, journal, "committed", { status: "committed", completedAt, postconditions })
  return { journal, postconditions }
}

function copyTreeExact(source, target) {
  fs.mkdirSync(target)
  const copy = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const sourcePath = path.join(from, entry.name)
      const targetPath = path.join(to, entry.name)
      const stat = fs.lstatSync(sourcePath)
      if (stat.isSymbolicLink()) throw new TransactionError("ARCHIVE_COPY_LINK", "archive copy rejects symlinks/junctions", "recovery-required", 4)
      if (stat.isDirectory()) { fs.mkdirSync(targetPath); copy(sourcePath, targetPath) }
      else if (stat.isFile()) fs.copyFileSync(sourcePath, targetPath)
      else throw new TransactionError("ARCHIVE_COPY_SPECIAL", "archive copy rejects special files", "recovery-required", 4)
    }
  }
  copy(source, target)
}

function archiveWorkPaths(operation, decisionId) {
  const parent = path.posix.dirname(operation.targetRoot)
  const sourceParent = path.posix.dirname(operation.sourceRoot)
  return {
    source: operation.sourceRoot,
    target: operation.targetRoot,
    staging: `${parent}/.${path.posix.basename(operation.targetRoot)}.steadyspec-${decisionId}.staging`,
    retired: `${sourceParent}/.${path.posix.basename(operation.sourceRoot)}.steadyspec-${decisionId}.retired`,
  }
}

function manifestMatches(repo, relativeRoot, expectedEntries, expectedHash) {
  if (!fs.existsSync(path.join(repo, ...relativeRoot.split("/")))) return false
  try {
    const actual = manifestFromDirectory(repo, relativeRoot)
    return actual.manifestHash === expectedHash && sameCanonical(actual.entries, expectedEntries)
  } catch (error) {
    return false
  }
}

function docsCheckForStaging(repo, operation, stagingRelative) {
  if (!operation.docsCheckRequired) return { required: false, passed: true, policyIdentity: null, errors: [] }
  if (sha256(fs.readFileSync(path.join(__dirname, "docs-check.js"))) !== operation.docsCheckPolicyIdentity) throw new TransactionError("DOCS_POLICY_STALE", "docs-check policy identity changed after prepare", "stale", 3)
  const report = checkDocsChange(path.join(repo, ...stagingRelative.split("/")), "archive")
  const errors = report.results.filter((item) => item.severity === "error").map((item) => `${item.code}:${item.file}`)
  return { required: true, passed: errors.length === 0, policyIdentity: operation.docsCheckPolicyIdentity, errors }
}

function delegationCheckForLocation(repo, operation, relativeRoot) {
  const currentPolicyIdentity = sha256(fs.readFileSync(path.join(__dirname, "docs-check.js")))
  if (!HASH_PATTERN.test(operation.delegationPolicyIdentity || "") || operation.delegationPolicyIdentity !== currentPolicyIdentity) {
    throw new TransactionError("DELEGATION_POLICY_STALE", "delegation-check policy is missing or changed after archive prepare", "stale", 3)
  }
  if (!HASH_PATTERN.test(operation.delegationArtifactFingerprint || "")) {
    throw new TransactionError("DELEGATION_BINDING_MISSING", "archive pending state predates the required delegation artifact binding", "stale", 3)
  }
  const report = checkDelegationArtifacts(path.join(repo, ...relativeRoot.split("/")), { requireReady: true, requireTrustArchive: true })
  const errors = report.results.filter((item) => item.severity === "error").map((item) => `${item.code}:${item.file}`)
  const fingerprintMatch = report.artifactFingerprint === operation.delegationArtifactFingerprint
  return {
    required: true,
    passed: report.ok && fingerprintMatch,
    policyIdentity: currentPolicyIdentity,
    artifactFingerprint: report.artifactFingerprint,
    fingerprintMatch,
    errors: fingerprintMatch ? errors : [...errors, "delegation-artifact-fingerprint-drift"],
  }
}

function archivePostconditions(repo, pending, decision, journal) {
  const operation = pending.binding.operation
  const work = journal.workPaths
  const targetMatches = manifestMatches(repo, work.target, operation.expectedTargetManifest, operation.expectedTargetManifestHash)
  const archiveFile = path.join(repo, ...work.target.split("/"), "archive.md")
  const archiveMatches = !!bufferAt(archiveFile, operation.archiveSha256, operation.archiveBytes)
  const docsCheck = targetMatches ? docsCheckForStaging(repo, operation, work.target) : { required: operation.docsCheckRequired, passed: false, errors: ["target manifest unavailable"] }
  const delegationCheck = targetMatches ? delegationCheckForLocation(repo, operation, work.target) : { required: true, passed: false, errors: ["target manifest unavailable"] }
  const passed = targetMatches && archiveMatches
    && !fs.existsSync(path.join(repo, ...work.source.split("/")))
    && !fs.existsSync(path.join(repo, ...work.staging.split("/")))
    && !fs.existsSync(path.join(repo, ...work.retired.split("/")))
    && docsCheck.passed
    && delegationCheck.passed
    && readPending(repo, pending.decisionId).pending.pendingHash === pending.pendingHash
    && readDecision(repo, pending, pending.expectedDecisionPath).decision.decisionHash === decision.decisionHash
  return {
    passed,
    targetRoot: work.target,
    targetManifestHash: operation.expectedTargetManifestHash,
    archiveSha256: operation.archiveSha256,
    activeSourceAbsent: !fs.existsSync(path.join(repo, ...work.source.split("/"))),
    stagingAbsent: !fs.existsSync(path.join(repo, ...work.staging.split("/"))),
    retiredAbsent: !fs.existsSync(path.join(repo, ...work.retired.split("/"))),
    docsCheckPassed: docsCheck.passed,
    delegationCheckPassed: delegationCheck.passed,
    filesystemState: "archived",
    authority: "filesystem-state-only-not-acceptance-merge-or-release",
  }
}

function commitArchive(repo, pending, decision, journal) {
  const operation = pending.binding.operation
  if (!HASH_PATTERN.test(operation.delegationPolicyIdentity || "") || !HASH_PATTERN.test(operation.delegationArtifactFingerprint || "")) {
    throw new TransactionError("DELEGATION_BINDING_MISSING", "archive pending state predates the required delegation/trust binding; abandon and prepare a new archive transaction", "stale", 3)
  }
  let work
  if (!journal) {
    validateCurrentPreimage(repo, pending)
    work = archiveWorkPaths(operation, pending.decisionId)
    const staging = resolveRepoPath(repo, work.staging, { mustExist: false, label: "archive staging" })
    if (fs.existsSync(staging.full)) throw new TransactionError("ARCHIVE_STAGING_CONFLICT", "archive staging path already exists", "recovery-required", 4)
    fs.mkdirSync(path.dirname(staging.full), { recursive: true })
    journal = newJournal(pending, decision, work, { sourceManifestHash: operation.sourceManifestHash, targetState: "absent" })
    journal = atomicReplaceJson(journalPath(repo, pending.decisionId), journal)
    maybeFault("archive-validated")
  } else {
    work = journal.workPaths
  }
  const source = path.join(repo, ...work.source.split("/"))
  const target = path.join(repo, ...work.target.split("/"))
  const staging = path.join(repo, ...work.staging.split("/"))
  const retired = path.join(repo, ...work.retired.split("/"))
  const stagingMatches = () => manifestMatches(repo, work.staging, operation.expectedTargetManifest, operation.expectedTargetManifestHash)
  const targetMatches = () => manifestMatches(repo, work.target, operation.expectedTargetManifest, operation.expectedTargetManifestHash)
  if (journal) {
    const recoveryDelegationRoot = ["target-committed", "source-detached", "source-retired"].includes(journal.phase)
      ? work.target
      : work.source
    const recoveryDelegation = delegationCheckForLocation(repo, operation, recoveryDelegationRoot)
    if (!recoveryDelegation.passed) {
      throw new TransactionError("ARCHIVE_DELEGATION_STALE", `archive recovery delegation/trust artifacts no longer match prepare: ${recoveryDelegation.errors.join(", ")}`, "stale", 3)
    }
  }
  if (["target-committed", "source-detached", "source-retired"].includes(journal.phase) && !docsCheckForStaging(repo, operation, work.target).passed) {
    throw new TransactionError("DOCS_TARGET_RECHECK", "bound docs check does not pass on the committed archive target; both sides are preserved when still available", "recovery-required", 4)
  }
  if (journal.phase === "validated" && stagingMatches() && !fs.existsSync(target)) {
    const docsCheck = docsCheckForStaging(repo, operation, work.staging)
    if (!docsCheck.passed) {
      fs.rmSync(staging, { recursive: true, force: true })
      journal = advanceJournal(repo, journal, "docs-check-failed", { status: "docs-check-failed", docsCheck })
      return { journal, docsCheckFailed: true }
    }
    journal = advanceJournal(repo, journal, "staging-built", { docsCheck })
  }
  if (journal.phase === "validated") {
    if (fs.existsSync(staging) && !stagingMatches() && fs.existsSync(source) && !fs.existsSync(target)) {
      const sourceManifest = manifestFromDirectory(repo, operation.sourceRoot)
      if (sourceManifest.manifestHash !== operation.sourceManifestHash || !sameCanonical(sourceManifest.entries, operation.sourceManifest)) throw new TransactionError("ARCHIVE_SOURCE_DRIFT_DURING_STAGING", "source changed while recovering partial staging", "recovery-required", 4)
      fs.rmSync(staging, { recursive: true, force: true })
    }
    if (!fs.existsSync(source) || fs.existsSync(staging) || fs.existsSync(target)) throw new TransactionError("ARCHIVE_CONSTELLATION", "validated archive file constellation is not recoverable", "recovery-required", 4)
    copyTreeExact(source, staging)
    fs.writeFileSync(path.join(staging, "archive.md"), Buffer.from(operation.archiveBase64, "base64"), { flag: "wx" })
    if (!stagingMatches()) throw new TransactionError("ARCHIVE_STAGING_READBACK", "archive staging manifest readback failed", "recovery-required", 4)
    const docsCheck = docsCheckForStaging(repo, operation, work.staging)
    if (!docsCheck.passed) {
      fs.rmSync(staging, { recursive: true, force: true })
      journal = advanceJournal(repo, journal, "docs-check-failed", { status: "docs-check-failed", docsCheck })
      return { journal, docsCheckFailed: true }
    }
    journal = advanceJournal(repo, journal, "staging-built", { docsCheck })
    maybeFault("archive-staging-built")
  }
  if (journal.phase === "staging-built" && targetMatches() && !fs.existsSync(staging)) journal = advanceJournal(repo, journal, "target-committed")
  if (journal.phase === "staging-built") {
    if (!stagingMatches() || fs.existsSync(target) || !fs.existsSync(source)) throw new TransactionError("ARCHIVE_CONSTELLATION", "staging-built archive file constellation is not recoverable", "recovery-required", 4)
    const docsCheck = docsCheckForStaging(repo, operation, work.staging)
    if (!docsCheck.passed) {
      fs.rmSync(staging, { recursive: true, force: true })
      journal = advanceJournal(repo, journal, "docs-check-failed", { status: "docs-check-failed", docsCheck })
      return { journal, docsCheckFailed: true }
    }
    if (!sameCanonical(journal.docsCheck, docsCheck)) journal = advanceJournal(repo, journal, "staging-built", { docsCheck })
    fs.renameSync(staging, target)
    journal = advanceJournal(repo, journal, "target-committed")
    maybeFault("archive-target-committed")
  }
  if (journal.phase === "target-committed" && targetMatches() && !fs.existsSync(source) && fs.existsSync(retired)) journal = advanceJournal(repo, journal, "source-detached")
  if (journal.phase === "target-committed") {
    if (!targetMatches() || fs.existsSync(staging) || !fs.existsSync(source) || fs.existsSync(retired)) throw new TransactionError("ARCHIVE_CONSTELLATION", "target-committed archive file constellation is not recoverable", "recovery-required", 4)
    if (!docsCheckForStaging(repo, operation, work.target).passed) throw new TransactionError("DOCS_TARGET_RECHECK", "bound docs check failed on archive target; source and target are both preserved", "recovery-required", 4)
    const sourceManifest = manifestFromDirectory(repo, operation.sourceRoot)
    if (sourceManifest.manifestHash !== operation.sourceManifestHash || !sameCanonical(sourceManifest.entries, operation.sourceManifest)) throw new TransactionError("ARCHIVE_SOURCE_DRIFT_AFTER_TARGET", "active source changed after target commit; both sides are preserved", "recovery-required", 4)
    maybeFault("archive-before-source-retire")
    fs.renameSync(source, retired)
    journal = advanceJournal(repo, journal, "source-detached")
    maybeFault("archive-source-detached")
  }
  if (journal.phase === "source-detached") {
    if (!targetMatches() || fs.existsSync(source) || fs.existsSync(staging)) throw new TransactionError("ARCHIVE_CONSTELLATION", "source-detached archive file constellation is not recoverable", "recovery-required", 4)
    if (fs.existsSync(retired)) fs.rmSync(retired, { recursive: true })
    journal = advanceJournal(repo, journal, "source-retired")
    maybeFault("archive-source-retired")
  }
  if (journal.phase !== "source-retired") throw new TransactionError("ARCHIVE_PHASE", `unsupported archive journal phase ${journal.phase}`, "recovery-required", 4)
  const postconditions = archivePostconditions(repo, pending, decision, journal)
  if (!postconditions.passed) throw new TransactionError("ARCHIVE_POSTCONDITION", "archive postcondition readback failed", "recovery-required", 4)
  const completedAt = new Date().toISOString()
  journal = advanceJournal(repo, journal, "committed", { status: "committed", completedAt, postconditions })
  return { journal, postconditions }
}

function terminalOutput(repo, pending, decision, journal, already) {
  if (decision.decision !== "approve-exact-transaction" || journal.decisionHash !== decision.decisionHash) throw new TransactionError("DECISION_REPLAY", "committed journal is not bound to the current exact approve decision", "replay-conflict", 3)
  let postconditions
  if (pending.kind === "intent-expansion") postconditions = intentPostconditions(repo, pending, decision, journal)
  else postconditions = archivePostconditions(repo, pending, decision, journal)
  if (!postconditions.passed) throw new TransactionError("POSTCOMMIT_DRIFT", "committed transaction postcondition no longer holds", "stale", 3)
  return baseOutput({
    status: already ? "already-committed" : "committed",
    action: pending.kind === "archive-finalize" ? "archived" : "proposal-readback-passed-write-drift-evidence",
    exitCode: 0,
    decisionBindingValid: true,
    domainMutation: pending.kind === "archive-finalize" ? "archive-finalized" : "proposal-insertion-committed",
    postconditions,
    ...pendingOutputIdentity(pending),
  })
}

function commit(repo, args) {
  const { pending } = readPending(repo, args.decisionId)
  assertPendingEnvironment(repo, pending)
  const { decision } = readDecision(repo, pending, args.decisionRecord)
  if (decision.decision !== "approve-exact-transaction") throw new TransactionError("DECISION_ACTION", "commit requires approve-exact-transaction", "replay-conflict", 3)
  let journal = readJournal(repo, pending)
  if (journal && journal.decisionHash !== decision.decisionHash) throw new TransactionError("DECISION_REPLAY", "journal is bound to a different decision record", "replay-conflict", 3)
  if (journal && journal.status === "committed") return terminalOutput(repo, pending, decision, journal, true)
  if (journal && journal.status === "cancelled") return outputForPending(repo, pending)
  if (journal && journal.status === "docs-check-failed") return outputForPending(repo, pending)
  const release = acquireLock(repo, pending)
  try {
    const freshPending = readPending(repo, pending.decisionId).pending
    if (freshPending.pendingHash !== pending.pendingHash) throw new TransactionError("PENDING_REPLAY", "pending record changed after lock", "replay-conflict", 3)
    const freshDecision = readDecision(repo, pending, args.decisionRecord).decision
    if (freshDecision.decisionHash !== decision.decisionHash || freshDecision.decision !== "approve-exact-transaction") throw new TransactionError("DECISION_TOCTOU", "decision record changed after lock acquisition", "replay-conflict", 3)
    journal = readJournal(repo, pending)
    const result = pending.kind === "intent-expansion" ? commitIntent(repo, pending, freshDecision, journal) : commitArchive(repo, pending, freshDecision, journal)
    if (result.docsCheckFailed) return outputForPending(repo, pending)
    return terminalOutput(repo, pending, decision, result.journal, false)
  } finally {
    release()
  }
}

function cancel(repo, args) {
  const { pending } = readPending(repo, args.decisionId)
  assertPendingEnvironment(repo, pending)
  const { decision } = readDecision(repo, pending, args.decisionRecord)
  if (decision.decision !== "cancel") throw new TransactionError("DECISION_ACTION", "cancel requires decision=cancel", "replay-conflict", 3)
  let journal = readJournal(repo, pending)
  if (journal && journal.decisionHash !== decision.decisionHash) throw new TransactionError("DECISION_REPLAY", "journal is bound to a different decision record", "replay-conflict", 3)
  if (journal && journal.status === "cancelled") return outputForPending(repo, pending)
  if (journal) throw new TransactionError("CANCEL_AFTER_COMMIT_START", "cancel is forbidden after domain commit starts", "recovery-required", 4)
  validateCurrentPreimage(repo, pending)
  const release = acquireLock(repo, pending)
  try {
    if (readJournal(repo, pending)) throw new TransactionError("CANCEL_RACE", "commit journal appeared after lock", "recovery-required", 4)
    const freshDecision = readDecision(repo, pending, args.decisionRecord).decision
    if (freshDecision.decisionHash !== decision.decisionHash || freshDecision.decision !== "cancel") throw new TransactionError("DECISION_TOCTOU", "cancel decision record changed after lock acquisition", "replay-conflict", 3)
    validateCurrentPreimage(repo, pending)
    journal = newJournal(pending, freshDecision, {}, { domainUnchanged: true })
    const completedAt = new Date().toISOString()
    journal.status = "cancelled"
    journal.phase = "cancelled"
    journal.completedAt = completedAt
    journal.postconditions = { passed: true, domainUnchanged: true }
    journal.history = [{ phase: "cancelled", at: completedAt }]
    journal.updatedAt = completedAt
    atomicReplaceJson(journalPath(repo, pending.decisionId), journal)
    return baseOutput({ status: "cancelled", action: "none", exitCode: 0, decisionBindingValid: true, postconditions: { passed: true, domainUnchanged: true }, ...pendingOutputIdentity(pending) })
  } finally {
    release()
  }
}

function parseArgs(argv) {
  const args = { action: argv[2] || "", kind: "", change: "", request: "", decisionId: "", decisionRecord: "", json: false }
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") { args.json = true; continue }
    const field = { "--kind": "kind", "--change": "change", "--request": "request", "--decision-id": "decisionId", "--decision-record": "decisionRecord" }[arg]
    if (!field || !argv[index + 1]) throw new TransactionError("ARGUMENT", `unknown or incomplete argument: ${arg}`)
    args[field] = argv[index + 1]
    index += 1
  }
  if (!["prepare", "status", "commit", "cancel"].includes(args.action)) throw new TransactionError("ACTION", "action must be prepare, status, commit, or cancel")
  if (!args.json) throw new TransactionError("JSON_MODE", "internal human-transaction requires --json")
  return args
}

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 2
}

function main() {
  const repo = fs.realpathSync(process.cwd())
  let args = null
  try {
    args = parseArgs(process.argv)
    if (args.action === "prepare") return emit(prepare(repo, args))
    if (args.action === "status") return emit(status(repo, args))
    if (args.action === "commit") return emit(commit(repo, args))
    if (args.action === "cancel") return emit(cancel(repo, args))
  } catch (error) {
    const known = error instanceof TransactionError
    let pending = null
    let journal = null
    if (args && args.decisionId && DECISION_ID_PATTERN.test(args.decisionId)) {
      try {
        pending = readPending(repo, args.decisionId).pending
        journal = readJournal(repo, pending)
      } catch (inspectionError) { /* original failure remains authoritative */ }
    }
    const possiblePartial = !!journal || known && error.code === "POSTCOMMIT_DRIFT"
    emit(baseOutput({
      status: known ? error.status : "blocked",
      action: possiblePartial ? "inspect-status-and-journal" : "stop",
      exitCode: known ? error.exitCode : 2,
      kind: pending && pending.kind || args && args.kind || "",
      changeId: pending && pending.change.id || "",
      changeRoot: pending && pending.change.rootPath || "",
      decisionId: args && args.decisionId || "",
      pendingPath: pending ? pendingRelative(pending.decisionId) : "",
      bindingHash: pending && pending.bindingHash || "",
      pendingHash: pending && pending.pendingHash || "",
      domainMutation: possiblePartial ? "possible-partial-inspect-journal" : "none",
      postconditions: journal && journal.postconditions || {},
      errors: [`${known ? error.code : "UNEXPECTED"}: ${error.message}`],
    }))
  }
}

if (require.main === module) main()

module.exports = {
  canonicalJson,
  parseStrictJsonText,
  recordHash,
  sha256,
}
