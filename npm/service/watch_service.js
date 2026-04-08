#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const chokidar = require("chokidar");

const {
  normalizeComparablePath,
  packageVersionFromHere,
  resolveCodexHome,
  resolveConfigDir,
  runtimeDir,
  watchServiceStatePath,
} = require("./common");
const { CursorStore } = require("./cursor_store");
const { loadDefaultR2Profile } = require("../lib/runtime-config");
const { findManagedRepoForCwd, loadManagedRepos } = require("./repo_registry");
const { isRolloutPath, readRolloutLastRecordSummary, readRolloutMeta } = require("./rollout_meta");
const { readIncrementalJsonl } = require("./rollout_incremental");
const { RepoSyncScheduler } = require("./scheduler");
const { extractCanonicalMessages } = require("../lib/summarize");
const { syncChangedThreads } = require("../lib/sync");

const DEFAULT_DEBOUNCE_MS = 1500;
const PACKAGE_VERSION = packageVersionFromHere(__filename);

function parseArgs(argv) {
  const result = {
    codexHome: resolveCodexHome(),
    configDir: resolveConfigDir(),
    debounceMs: DEFAULT_DEBOUNCE_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--codex-home") {
      result.codexHome = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--config-dir") {
      result.configDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--debounce-ms") {
      result.debounceMs = Number(argv[index + 1]) || DEFAULT_DEBOUNCE_MS;
      index += 1;
    }
  }
  return result;
}

function log(message) {
  process.stdout.write(`[watch-service] ${message}\n`);
}

function ensureSingleton(statePath) {
  if (!fs.existsSync(statePath)) {
    return false;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (payload.pid === process.pid) {
      return false;
    }
    if (payload.pid && processAlive(payload.pid)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeState(statePath, payload) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function removeState(statePath) {
  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionsRoot = path.join(options.codexHome, "sessions");
  const statePath = watchServiceStatePath(options.configDir);
  const serviceStartAt = new Date().toISOString();
  const eventLogPath = path.join(options.configDir, "logs", "watch-events.log");
  const rawEventLogPath = path.join(options.configDir, "logs", "watch-raw-events.log");
  const changedFilesLogPath = path.join(options.configDir, "logs", "watch-changed-files.log");
  const contentLogPath = path.join(options.configDir, "logs", "watch-content.log");
  if (ensureSingleton(statePath)) {
    log("watch service already running");
    return;
  }

  const r2Profile = loadDefaultR2Profile(options.configDir);
  const cursorStore = new CursorStore(options.configDir);
  const scheduler = new RepoSyncScheduler({
    debounceMs: options.debounceMs,
    runSync: (repo, payload) =>
      syncChangedThreads(repo.repoPath, path.join(repo.repoPath, ".codex-handoff"), r2Profile, {
        codexHome: options.codexHome,
        includeRawThreads: repo.includeRawThreads === true,
        prefix: repo.remotePrefix,
        changes: payload?.changes || [],
      }),
    logger: log,
  });

  let nativeWatcher;
  let batch = [];
  let flushTimer = null;
  const stop = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (nativeWatcher) {
      try {
        await nativeWatcher.close();
      } catch {
        // Ignore watcher close failures during shutdown.
      }
    }
    await scheduler.dispose();
    cursorStore.save();
    removeState(statePath);
  };

  process.on("SIGINT", async () => {
    await stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await stop();
    process.exit(0);
  });
  process.on("exit", () => {
    removeState(statePath);
  });

  nativeWatcher = chokidar.watch(sessionsRoot, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });
  nativeWatcher.on("all", (eventType, changedPath) => {
    void handleFsEvent(eventType, changedPath);
  });
  nativeWatcher.on("error", (error) => {
    log(`watcher error: ${error.message}`);
  });

  writeState(statePath, {
    ...readExistingState(statePath),
    pid: process.pid,
    started_at: serviceStartAt,
    package_version: PACKAGE_VERSION,
    config_dir: options.configDir,
    codex_home: options.codexHome,
    watch_root: sessionsRoot,
    debounce_ms: options.debounceMs,
    event_log_path: eventLogPath,
    raw_event_log_path: rawEventLogPath,
    changed_files_log_path: changedFilesLogPath,
    content_log_path: contentLogPath,
    watched_directory_count: 1,
    watched_rollout_file_count: 0,
  });

  async function handleFsEvent(eventType, changedPath) {
    const normalizedType = normalizeWatcherEventType(eventType);
    const resolvedPath = path.resolve(changedPath);
    appendWatchEventLog(rawEventLogPath, {
      eventType: normalizedType,
      filePath: resolvedPath,
      action: "raw",
    });

    let meta = null;
    let changePayload = null;
    if ((normalizedType === "create" || normalizedType === "update") && isRolloutPath(resolvedPath)) {
      meta = await readRolloutMeta(resolvedPath);
      const previousCursor = cursorStore.get(resolvedPath) || null;
      const incremental = await readIncrementalJsonl(resolvedPath, previousCursor);
      const parser = extractCanonicalMessages(
        (incremental.newLines || []).map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean),
        {
          sessionId: previousCursor?.sessionId || meta?.threadId || null,
          currentTurnId: previousCursor?.currentTurnId || null,
        },
      );
      const nextCursor = {
        ...incremental.nextState,
        sessionId: parser.state.sessionId || meta?.threadId || null,
        currentTurnId: parser.state.currentTurnId || null,
      };
      cursorStore.set(resolvedPath, nextCursor);
      cursorStore.save();
      const lastRecord = await readRolloutLastRecordSummary(resolvedPath);
      if (lastRecord) {
        appendContentLog(contentLogPath, {
          eventType: normalizedType,
          filePath: resolvedPath,
          threadId: meta?.threadId || "",
          cwd: meta?.cwd || "",
          incrementalMode: incremental.mode,
          appendedLineCount: incremental.newLines.length,
          appendedJsonl: incremental.newLines,
          ...lastRecord,
        });
      }
      changePayload = {
        rolloutPath: resolvedPath,
        threadId: meta?.threadId || null,
        cwd: meta?.cwd || null,
        newLines: incremental.newLines || [],
        parserState: {
          sessionId: previousCursor?.sessionId || meta?.threadId || null,
          currentTurnId: previousCursor?.currentTurnId || null,
        },
      };
      appendChangedFileLog(changedFilesLogPath, {
        eventType: normalizedType,
        filePath: resolvedPath,
        threadId: meta?.threadId || "",
        cwd: meta?.cwd || "",
        repoPath: "",
      });
    }

    batch.push({ type: normalizedType, path: resolvedPath, meta, changePayload });
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(() => {
      const events = batch;
      batch = [];
      flushTimer = null;
      void processEvents(events);
    }, options.debounceMs);
  }

  async function processEvents(events) {
      const managedRepos = loadManagedRepos(options.configDir);
      const queued = new Map();
      for (const event of events) {
        if (event.type !== "create" && event.type !== "update") {
          continue;
        }
        if (!isRolloutPath(event.path)) {
          continue;
        }
        const meta = event.meta || await readRolloutMeta(event.path);
        if (managedRepos.length === 0) {
          appendWatchEventLog(eventLogPath, {
            eventType: event.type,
            filePath: event.path,
            action: "skip",
            reason: "no_managed_repos",
          });
          continue;
        }
        if (!meta?.cwd) {
          appendWatchEventLog(eventLogPath, {
            eventType: event.type,
            filePath: event.path,
            action: "skip",
            reason: "missing_session_meta",
          });
          continue;
        }
        const repo = findManagedRepoForCwd(meta.cwd, managedRepos);
        if (!repo) {
          appendWatchEventLog(eventLogPath, {
            eventType: event.type,
            filePath: event.path,
            threadId: meta.threadId,
            cwd: meta.cwd,
            action: "skip",
            reason: "unmanaged_repo",
          });
          continue;
        }
        const key = normalizeComparablePath(repo.repoPath);
        appendChangedFileLog(changedFilesLogPath, {
          eventType: event.type,
          filePath: event.path,
          threadId: meta.threadId,
          cwd: meta.cwd,
          repoPath: repo.repoPath,
        });
        if (queued.has(key)) {
          const existing = queued.get(key);
          if (event.changePayload?.threadId) {
            existing.changes.push(event.changePayload);
          }
          appendWatchEventLog(eventLogPath, {
            eventType: event.type,
            filePath: event.path,
            threadId: meta.threadId,
            cwd: meta.cwd,
            repoPath: repo.repoPath,
            action: "dedupe",
          });
          continue;
        }
        queued.set(key, {
          repo,
          changes: event.changePayload?.threadId ? [event.changePayload] : [],
        });
        appendWatchEventLog(eventLogPath, {
          eventType: event.type,
          filePath: event.path,
          threadId: meta.threadId,
          cwd: meta.cwd,
          repoPath: repo.repoPath,
          action: "enqueue",
        });
        scheduler.enqueue(repo, queued.get(key));
      }

      writeState(statePath, {
        ...readExistingState(statePath),
        pid: process.pid,
        started_at: serviceStartAt,
        package_version: PACKAGE_VERSION,
        config_dir: options.configDir,
        codex_home: options.codexHome,
        watch_root: sessionsRoot,
        debounce_ms: options.debounceMs,
        event_log_path: eventLogPath,
        raw_event_log_path: rawEventLogPath,
        changed_files_log_path: changedFilesLogPath,
        content_log_path: contentLogPath,
        watched_directory_count: 1,
        watched_rollout_file_count: 0,
        managed_repo_count: managedRepos.length,
        scheduler: scheduler.snapshot(),
        updated_at: new Date().toISOString(),
      });
  }

  log(`watching ${sessionsRoot}`);
  await new Promise(() => {});
}

function readExistingState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function appendWatchEventLog(logPath, details) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fields = [
    `ts=${new Date().toISOString()}`,
    `event=${details.eventType}`,
    `action=${details.action}`,
  ];
  if (details.reason) {
    fields.push(`reason=${details.reason}`);
  }
  if (details.threadId) {
    fields.push(`thread_id=${details.threadId}`);
  }
  if (details.repoPath) {
    fields.push(`repo=${details.repoPath}`);
  }
  if (details.cwd) {
    fields.push(`cwd=${details.cwd}`);
  }
  fields.push(`path=${details.filePath}`);
  fs.appendFileSync(logPath, `${fields.join(" | ")}\n`, "utf8");
}

function normalizeWatcherEventType(eventType) {
  if (eventType === "change" || eventType === "add") {
    return eventType === "add" ? "create" : "update";
  }
  if (eventType === "addDir") {
    return "create";
  }
  if (eventType === "unlink" || eventType === "unlinkDir") {
    return "delete";
  }
  if (eventType === "ready") {
    return "ready";
  }
  if (eventType === "raw") {
    return "update";
  }
  return eventType || "update";
}

function appendChangedFileLog(logPath, details) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fields = [
    `ts=${new Date().toISOString()}`,
    `event=${details.eventType}`,
    `thread_id=${details.threadId || ""}`,
    `repo=${details.repoPath || ""}`,
    `cwd=${details.cwd || ""}`,
    `path=${details.filePath}`,
  ];
  fs.appendFileSync(logPath, `${fields.join(" | ")}\n`, "utf8");
}

function appendContentLog(logPath, details) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fields = [
    `ts=${new Date().toISOString()}`,
    `event=${details.eventType}`,
    `thread_id=${details.threadId || ""}`,
    `repo=${details.repoPath || ""}`,
    `cwd=${details.cwd || ""}`,
    `mode=${details.incrementalMode || ""}`,
    `appended_lines=${details.appendedLineCount ?? 0}`,
    `record_ts=${details.timestamp || ""}`,
    `record_type=${details.recordType || ""}`,
    `payload_type=${details.payloadType || ""}`,
    `path=${details.filePath}`,
  ];
  if (details.recordJson) {
    fields.push(`record=${details.recordJson}`);
  }
  if (details.appendedJsonl && details.appendedJsonl.length > 0) {
    fields.push(`appended=${JSON.stringify(details.appendedJsonl)}`);
  }
  fs.appendFileSync(logPath, `${fields.join(" | ")}\n`, "utf8");
}

main().catch((error) => {
  process.stderr.write(`[watch-service] fatal: ${error.stack || error.message}\n`);
  process.exit(1);
});
