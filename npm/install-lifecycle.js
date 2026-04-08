const fs = require("node:fs");

const { startAgentService, serviceState, stopAgentService } = require("./lib/agent-runtime");
const { isWatchServiceRunning, stopWatchService, watchServiceState } = require("./lib/watch-runtime");
const { installRestartStatePath, resolveCodexHome, resolveConfigDir } = require("./service/common");

function readRestartState(configDir = resolveConfigDir()) {
  const filePath = installRestartStatePath(configDir);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeRestartState(configDir, payload) {
  const filePath = installRestartStatePath(configDir);
  fs.mkdirSync(require("node:path").dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return filePath;
}

function clearRestartState(configDir = resolveConfigDir()) {
  try {
    fs.rmSync(installRestartStatePath(configDir), { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

async function stopServicesForPackageInstall({ configDir = resolveConfigDir(), codexHome = resolveCodexHome(), logger = console } = {}) {
  const agentState = serviceState(configDir);
  const watchState = watchServiceState(configDir);
  const agentWasRunning = Boolean(agentState?.pid);
  const watchWasRunning = isWatchServiceRunning(configDir);

  writeRestartState(configDir, {
    config_dir: configDir,
    codex_home: codexHome,
    agent_was_running: agentWasRunning,
    watch_was_running: watchWasRunning,
    created_at: new Date().toISOString(),
  });

  if (watchWasRunning) {
    const stoppedWatch = await stopWatchService(configDir);
    logger.log?.(`[codex-handoff] Stopped watch service for package install${stoppedWatch.stopped_pids ? ` (${stoppedWatch.stopped_pids.join(", ")})` : ""}`);
  }
  if (agentWasRunning) {
    const stoppedAgent = await stopAgentService(configDir);
    logger.log?.(`[codex-handoff] Stopped agent service for package install${stoppedAgent.stopped_pids ? ` (${stoppedAgent.stopped_pids.join(", ")})` : ""}`);
  }
}

async function restartServicesAfterPackageInstall({ configDir = resolveConfigDir(), logger = console } = {}) {
  const state = readRestartState(configDir);
  if (!state) {
    return { restarted: false, reason: "no_restart_state" };
  }

  const shouldRestartAgent = Boolean(state.agent_was_running || state.watch_was_running);
  clearRestartState(configDir);
  if (!shouldRestartAgent) {
    return { restarted: false, reason: "services_were_not_running" };
  }

  const current = serviceState(configDir);
  if (current?.pid) {
    return { restarted: false, reason: "agent_already_running", pid: current.pid };
  }

  const started = startAgentService({
    configDir,
    codexHome: state.codex_home || resolveCodexHome(),
  });
  logger.log?.(`[codex-handoff] Restarted agent service after package install (pid=${started.pid})`);
  return {
    restarted: true,
    pid: started.pid,
    command: [started.command, ...started.args],
  };
}

module.exports = {
  clearRestartState,
  readRestartState,
  restartServicesAfterPackageInstall,
  stopServicesForPackageInstall,
  writeRestartState,
};
