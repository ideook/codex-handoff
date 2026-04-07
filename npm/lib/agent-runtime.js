const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { readJsonFile, watchServiceStatePath } = require("../service/common");

function serviceState(configDir) {
  return readJsonFile(watchServiceStatePath(configDir), null);
}

function clearServiceState(configDir) {
  try {
    fs.rmSync(watchServiceStatePath(configDir), { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return watchServiceCommandMatches(pid);
  } catch {
    return false;
  }
}

function startWatchService({ repoPath, configDir, codexHome }) {
  clearServiceState(configDir);
  const packageRoot = path.resolve(__dirname, "..", "..");
  const command = process.execPath;
  const args = [path.join(packageRoot, "npm", "service", "watch_service.js"), "--config-dir", configDir, "--codex-home", codexHome];
  const child = spawn(command, args, {
    cwd: repoPath,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { command, args, pid: child.pid };
}

function stopWatchService(configDir) {
  const state = serviceState(configDir);
  if (!state?.pid) return { stopped: false, running: false };
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // Ignore already-dead processes.
  }
  forceTerminateIfNeeded(state.pid);
  clearServiceState(configDir);
  return { stopped: true, running: false, pid: state.pid };
}

function watchServiceCommandMatches(pid) {
  const packageRoot = path.resolve(__dirname, "..", "..");
  const watchScript = path.join(packageRoot, "npm", "service", "watch_service.js");
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.includes(watchScript);
}

function forceTerminateIfNeeded(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const script = `
    for i in 1 2 3 4 5; do
      kill -0 ${pid} 2>/dev/null || exit 0
      sleep 0.1
    done
    kill -9 ${pid} 2>/dev/null || true
  `;
  spawnSync("/bin/sh", ["-c", script], { encoding: "utf8" });
}

module.exports = {
  isRunning,
  clearServiceState,
  serviceState,
  startWatchService,
  stopWatchService,
};
