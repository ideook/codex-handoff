#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const chokidar = require("chokidar");

const root = process.argv[2] || path.join(process.env.HOME || "", ".codex", "sessions");
const cursors = new Map();

console.log(`watching ${root}`);

const watcher = chokidar.watch(root, {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 50,
  },
});

watcher
  .on("all", async (event, changedPath) => {
    console.log(new Date().toISOString(), event, changedPath);
    if (!isRolloutPath(changedPath)) {
      return;
    }
    try {
      const incremental = readIncrementalJsonl(changedPath, cursors.get(changedPath));
      cursors.set(changedPath, incremental.nextState);
      const lastRecord = readLastJsonlRecord(changedPath);
      console.log(
        JSON.stringify(
          {
            ts: new Date().toISOString(),
            path: changedPath,
            mode: incremental.mode,
            appended_lines: incremental.newLines.length,
            last_record: lastRecord,
            appended: incremental.newLines,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(new Date().toISOString(), "read-error", changedPath, error.message);
    }
  })
  .on("error", (error) => {
    console.error(new Date().toISOString(), "error", error.message);
  });

function isRolloutPath(filePath) {
  const base = path.basename(filePath || "");
  return base.startsWith("rollout-") && base.endsWith(".jsonl");
}

function readIncrementalJsonl(filePath, previousState) {
  const stat = fs.statSync(filePath);
  const nextState = {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };

  if (!previousState) {
    return { mode: "bootstrap", newLines: [], nextState };
  }

  if (stat.size < previousState.size) {
    return {
      mode: "rewind",
      newLines: splitNonEmptyLines(fs.readFileSync(filePath, "utf8")),
      nextState,
    };
  }

  if (stat.size === previousState.size) {
    return { mode: "unchanged", newLines: [], nextState };
  }

  const appended = fs.readFileSync(filePath, "utf8").slice(previousState.size);
  return {
    mode: "append",
    newLines: splitNonEmptyLines(appended),
    nextState,
  };
}

function readLastJsonlRecord(filePath) {
  const lines = splitNonEmptyLines(fs.readFileSync(filePath, "utf8"));
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

function splitNonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}
