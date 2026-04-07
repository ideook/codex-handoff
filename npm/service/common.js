const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveConfigDir() {
  if (process.env.CODEX_HANDOFF_CONFIG_DIR) {
    return path.resolve(process.env.CODEX_HANDOFF_CONFIG_DIR);
  }
  return path.join(os.homedir(), ".codex-handoff");
}

function resolveCodexHome() {
  if (process.env.CODEX_HOME) {
    return path.resolve(process.env.CODEX_HOME);
  }
  return path.join(os.homedir(), ".codex");
}

function configPath(configDir = resolveConfigDir()) {
  return path.join(configDir, "config.json");
}

function runtimeDir(configDir = resolveConfigDir()) {
  return path.join(configDir, "runtime");
}

function watchServiceStatePath(configDir = resolveConfigDir()) {
  return path.join(runtimeDir(configDir), "watch-service.json");
}

function watchCursorStatePath(configDir = resolveConfigDir()) {
  return path.join(runtimeDir(configDir), "watch-cursors.json");
}

function packageRootFromHere(filename) {
  return path.resolve(path.dirname(filename), "..", "..");
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function stripWindowsPrefix(value) {
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

function isWindowsStylePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeComparablePath(value) {
  const raw = stripWindowsPrefix(String(value || "").trim());
  if (!raw) {
    return "";
  }
  if (isWindowsStylePath(raw)) {
    return path.win32.normalize(raw).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  return path.posix.normalize(raw.replace(/\\/g, "/")).replace(/\/+$/, "");
}

function isSameOrDescendantPath(candidatePath, parentPath) {
  if (!candidatePath || !parentPath) {
    return false;
  }
  if (candidatePath === parentPath) {
    return true;
  }
  return candidatePath.startsWith(`${parentPath}/`);
}

module.exports = {
  configPath,
  isSameOrDescendantPath,
  normalizeComparablePath,
  packageRootFromHere,
  readJsonFile,
  resolveCodexHome,
  resolveConfigDir,
  runtimeDir,
  watchCursorStatePath,
  watchServiceStatePath,
};
