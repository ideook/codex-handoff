const fs = require("node:fs");
const path = require("node:path");

const { writeUtf8FileIfChanged } = require("./file-ops");

const THREADS_DIRNAME = "threads";
const CANONICAL_THREAD_BUNDLE_EXTENSION = ".jsonl";

function canonicalThreadBundleRelPath(threadId) {
  return path.posix.join(THREADS_DIRNAME, `${threadId}${CANONICAL_THREAD_BUNDLE_EXTENSION}`);
}

function canonicalThreadBundlePath(memoryDir, threadId) {
  return path.join(memoryDir, THREADS_DIRNAME, `${threadId}${CANONICAL_THREAD_BUNDLE_EXTENSION}`);
}

function resolveThreadBundlePath(memoryDir, threadId, preferredRelPath = null) {
  if (preferredRelPath) {
    const preferredPath = path.join(memoryDir, preferredRelPath.split("/").join(path.sep));
    if (fs.existsSync(preferredPath)) {
      return preferredPath;
    }
  }
  return canonicalThreadBundlePath(memoryDir, threadId);
}

function resolveThreadBundleRelPath(memoryDir, threadId, preferredRelPath = null) {
  return path.relative(memoryDir, resolveThreadBundlePath(memoryDir, threadId, preferredRelPath)).split(path.sep).join("/");
}

function listThreadBundleFiles(memoryDir) {
  const threadsDir = path.join(memoryDir, THREADS_DIRNAME);
  if (!fs.existsSync(threadsDir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(threadsDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== CANONICAL_THREAD_BUNDLE_EXTENSION) {
      continue;
    }
    files.push(path.join(threadsDir, entry.name));
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function loadThreadTranscript(memoryDir, threadId, preferredRelPath = null) {
  const filePath = resolveThreadBundlePath(memoryDir, threadId, preferredRelPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readTranscriptFile(filePath);
}

function readTranscriptFile(filePath) {
  const rows = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    rows.push(JSON.parse(line));
  }
  return rows;
}

function writeThreadTranscript(memoryDir, threadId, transcript) {
  const filePath = canonicalThreadBundlePath(memoryDir, threadId);
  const relPath = canonicalThreadBundleRelPath(threadId);
  const changed = writeUtf8FileIfChanged(filePath, serializeTranscript(transcript));
  return {
    filePath,
    relPath,
    changed,
    removedPaths: [],
  };
}

function appendThreadTranscript(memoryDir, threadId, messages, { existingTranscript = null } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      filePath: resolveThreadBundlePath(memoryDir, threadId),
      relPath: resolveThreadBundleRelPath(memoryDir, threadId),
      changed: false,
      removedPaths: [],
      mode: "unchanged",
    };
  }
  const canonicalPath = canonicalThreadBundlePath(memoryDir, threadId);
  if (fs.existsSync(canonicalPath)) {
    fs.appendFileSync(canonicalPath, serializeTranscript(messages), "utf8");
    return {
      filePath: canonicalPath,
      relPath: canonicalThreadBundleRelPath(threadId),
      changed: true,
      removedPaths: [],
      mode: "append",
    };
  }
  const baseTranscript = Array.isArray(existingTranscript)
    ? existingTranscript
    : (loadThreadTranscript(memoryDir, threadId) || []);
  const result = writeThreadTranscript(memoryDir, threadId, [...baseTranscript, ...messages]);
  return {
    ...result,
    mode: "create",
  };
}

function transcriptMessageKey(item) {
  return JSON.stringify([
    item.turn_id || "",
    item.role || "",
    item.phase || "",
    String(item.message || "").replace(/\s+/g, " "),
  ]);
}

function serializeTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return "";
  }
  return transcript.map((item) => `${JSON.stringify(item)}\n`).join("");
}

module.exports = {
  CANONICAL_THREAD_BUNDLE_EXTENSION,
  appendThreadTranscript,
  canonicalThreadBundlePath,
  canonicalThreadBundleRelPath,
  listThreadBundleFiles,
  loadThreadTranscript,
  readTranscriptFile,
  resolveThreadBundlePath,
  resolveThreadBundleRelPath,
  transcriptMessageKey,
  writeThreadTranscript,
};
