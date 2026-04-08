const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { readJsonFile, watchServiceStatePath } = require("../service/common");
const { isProcessRunning, terminateProcess } = require("./process-utils");

function watchServiceState(configDir) {
  return readJsonFile(watchServiceStatePath(configDir), null);
}

function clearWatchServiceState(configDir) {
  try {
    fs.rmSync(watchServiceStatePath(configDir), { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function startWatchService({ configDir, codexHome, cwd = process.cwd() }) {
  clearWatchServiceState(configDir);
  const packageRoot = path.resolve(__dirname, "..", "..");
  const command = process.execPath;
  const args = [path.join(packageRoot, "npm", "service", "watch_service.js"), "--config-dir", configDir, "--codex-home", codexHome];
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { command, args, pid: child.pid };
}

function stopWatchService(configDir) {
  const state = watchServiceState(configDir);
  if (!state?.pid) return { stopped: false, running: false };
  terminateProcess(state.pid);
  clearWatchServiceState(configDir);
  return { stopped: true, running: false, pid: state.pid };
}

function isWatchServiceRunning(configDir) {
  const state = watchServiceState(configDir);
  return Boolean(state?.pid && isProcessRunning(state.pid));
}

module.exports = {
  clearWatchServiceState,
  isWatchServiceRunning,
  startWatchService,
  stopWatchService,
  watchServiceState,
};
