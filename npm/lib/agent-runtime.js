const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { agentServiceStatePath, readJsonFile } = require("../service/common");
const { isProcessRunning, terminateProcess } = require("./process-utils");

function serviceState(configDir) {
  return readJsonFile(agentServiceStatePath(configDir), null);
}

function clearServiceState(configDir) {
  try {
    fs.rmSync(agentServiceStatePath(configDir), { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function startAgentService({ configDir, codexHome, cwd = process.cwd() }) {
  clearServiceState(configDir);
  const packageRoot = path.resolve(__dirname, "..", "..");
  const command = process.execPath;
  const args = [path.join(packageRoot, "npm", "service", "agent_service.js"), "--config-dir", configDir, "--codex-home", codexHome];
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { command, args, pid: child.pid };
}

function stopAgentService(configDir) {
  const state = serviceState(configDir);
  if (!state?.pid) return { stopped: false, running: false };
  terminateProcess(state.pid);
  clearServiceState(configDir);
  return { stopped: true, running: false, pid: state.pid };
}

module.exports = {
  clearServiceState,
  isRunning: isProcessRunning,
  serviceState,
  startAgentService,
  stopAgentService,
};
