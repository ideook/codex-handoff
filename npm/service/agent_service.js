#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const { serviceState, clearServiceState } = require("../lib/agent-runtime");
const { detectCodexProcesses } = require("../lib/process-utils");
const { AgentController } = require("./agent_controller");
const { agentServiceStatePath, resolveCodexHome, resolveConfigDir, watchServiceStatePath } = require("./common");
const { loadManagedRepos } = require("./repo_registry");

const DEFAULT_POLL_INTERVAL_MS = 2000;

function parseArgs(argv) {
  const result = {
    codexHome: resolveCodexHome(),
    configDir: resolveConfigDir(),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--codex-home") {
      result.codexHome = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--config-dir") {
      result.configDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--poll-interval-ms") {
      result.pollIntervalMs = Number(argv[index + 1]) || DEFAULT_POLL_INTERVAL_MS;
      index += 1;
    }
  }
  return result;
}

function createLogger(configDir) {
  const logPath = path.join(configDir, "logs", "agent-service.log");
  return {
    logPath,
    write(message) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `[agent-service] ${new Date().toISOString()} ${message}\n`, "utf8");
    },
  };
}

function writeState(configDir, payload) {
  const statePath = agentServiceStatePath(configDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const previous = serviceState(configDir) || {};
  fs.writeFileSync(statePath, JSON.stringify({ ...previous, ...payload }, null, 2) + "\n", "utf8");
}

function writeWatchState(configDir, payload) {
  const statePath = watchServiceStatePath(configDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function clearWatchState(configDir) {
  try {
    fs.rmSync(watchServiceStatePath(configDir), { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function ensureSingleton(configDir) {
  const existing = serviceState(configDir);
  if (!existing?.pid) {
    return false;
  }
  if (existing.pid === process.pid) {
    return false;
  }
  try {
    process.kill(existing.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const logger = createLogger(options.configDir);
  const statePath = agentServiceStatePath(options.configDir);
  const startedAt = new Date().toISOString();

  if (ensureSingleton(options.configDir)) {
    logger.write("helper already running");
    return;
  }

  logger.write(`starting helper for ${options.codexHome}`);
  recordManagedRepoEvent(options.configDir, "helper_started", {
    codex_home: options.codexHome,
    pid: process.pid,
  });
  writeState(options.configDir, {
    pid: process.pid,
    started_at: startedAt,
    config_dir: options.configDir,
    codex_home: options.codexHome,
    poll_interval_ms: options.pollIntervalMs,
    phase: "idle",
    watcher: null,
    implementation_mode: "stub",
  });

  const controller = new AgentController({
    detectCodexProcesses: async () => detectCodexProcesses(),
    logger: (message) => logger.write(message),
    recordEvent: async (eventName, details) => {
      recordManagedRepoEvent(options.configDir, eventName, details);
    },
    activateWatcher: async () => {
      const watcher = {
        placeholder: true,
        started_at: new Date().toISOString(),
      };
      logger.write("watcher placeholder started");
      recordManagedRepoEvent(options.configDir, "watch_started", watcher);
      writeWatchState(options.configDir, {
        pid: process.pid,
        placeholder: true,
        started_at: watcher.started_at,
        config_dir: options.configDir,
        codex_home: options.codexHome,
      });
      return watcher;
    },
    deactivateWatcher: async () => {
      logger.write("watcher placeholder stopped");
      recordManagedRepoEvent(options.configDir, "watch_stopped", {
        stopped_at: new Date().toISOString(),
      });
      clearWatchState(options.configDir);
      return { stopped: true, placeholder: true };
    },
    performStartupSync: async () => runStartupSyncStub(options.configDir, options.codexHome, logger),
    writeState: async (payload) => {
      writeState(options.configDir, payload);
    },
  });

  const shutdown = async () => {
    logger.write("shutting down helper");
    recordManagedRepoEvent(options.configDir, "helper_stopped", {
      stopped_at: new Date().toISOString(),
    });
    clearWatchState(options.configDir);
    clearServiceState(options.configDir);
  };

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("exit", () => {
    if (!fs.existsSync(statePath)) {
      clearServiceState(options.configDir);
    }
  });

  await controller.initialize();
  await controller.tick();
  setInterval(() => {
    void controller.tick().catch((error) => {
      logger.write(`tick error: ${error.stack || error.message}`);
      writeState(options.configDir, {
        phase: "error",
        last_error: error.message,
      });
    });
  }, options.pollIntervalMs);
  await new Promise(() => {});
}

async function runStartupSyncStub(configDir, codexHome, logger) {
  const managedRepos = loadManagedRepos(configDir).filter((repo) => fs.existsSync(repo.repoPath));
  const startedAt = new Date().toISOString();
  logger.write(`sync placeholder invoked for codex_home=${codexHome}`);
  recordManagedRepoEvent(configDir, "startup_sync_started", {
    started_at: startedAt,
    codex_home: codexHome,
    managed_repo_count: managedRepos.length,
  });
  const repos = managedRepos.map((repo) => ({
    repo: repo.repoPath,
    repo_slug: repo.repoSlug,
    status: "placeholder",
  }));
  for (const repo of repos) {
    recordManagedRepoEvent(configDir, "startup_sync_repo", repo, [repo.repo]);
  }
  const completedAt = new Date().toISOString();
  recordManagedRepoEvent(configDir, "startup_sync_completed", {
    completed_at: completedAt,
    managed_repo_count: managedRepos.length,
  });
  return {
    placeholder: true,
    synced_repo_count: 0,
    skipped_repo_count: 0,
    synced_repos: repos,
    errors: [],
    completed_at: completedAt,
  };
}

function recordManagedRepoEvent(configDir, eventName, details = {}, repoPaths = null) {
  const timestamp = new Date().toISOString();
  const targets = Array.isArray(repoPaths) && repoPaths.length
    ? repoPaths
    : loadManagedRepos(configDir).map((repo) => repo.repoPath);
  const line = [
    `ts=${timestamp}`,
    `event=${eventName}`,
    ...Object.entries(details).map(([key, value]) => `${key}=${serializeEventValue(value)}`),
  ].join(" | ");
  for (const repoPath of targets) {
    const memoryDir = path.join(repoPath, ".codex-handoff");
    try {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.appendFileSync(path.join(memoryDir, "agent-events.log"), `${line}\n`, "utf8");
    } catch {
      // Ignore event log write failures for individual repos.
    }
  }
}

function serializeEventValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

main().catch((error) => {
  const configDir = resolveConfigDir();
  const logger = createLogger(configDir);
  logger.write(`fatal: ${error.stack || error.message}`);
  writeState(configDir, {
    phase: "error",
    last_error: error.message,
  });
  process.exit(1);
});
