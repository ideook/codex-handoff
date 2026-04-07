const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseArgs } = require("./cli");
const { buildRepoState } = require("./lib/workspace");

const cliPath = path.join(__dirname, "bin", "codex-handoff.js");

function makeFixtureRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-cli-"));
  const memoryDir = path.join(repoDir, ".codex-handoff");
  const threadsDir = path.join(memoryDir, "threads");
  fs.mkdirSync(threadsDir, { recursive: true });
  fs.writeFileSync(
    path.join(threadsDir, "thread-1.json"),
    JSON.stringify(
      [
        {
          session_id: "sess-1",
          turn_id: "turn-0",
          timestamp: "2026-04-07T00:00:00+09:00",
          role: "user",
          phase: null,
          message: "Validate restore output.",
        },
        {
          session_id: "sess-1",
          turn_id: "turn-1",
          timestamp: "2026-04-07T00:00:01+09:00",
          role: "assistant",
          phase: "final_answer",
          message: "reader CLI should build a restore pack from scene-evidence notes",
        },
        {
          session_id: "sess-1",
          turn_id: "turn-2",
          timestamp: "2026-04-07T00:00:02+09:00",
          role: "assistant",
          phase: "commentary",
          message: "unrelated output",
        },
      ],
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(memoryDir, "repo.json"),
    JSON.stringify(
      {
        repo_path: repoDir,
        repo_slug: "fixture-remote",
        remote_profile: "default",
        remote_prefix: "repos/fixture-remote/",
        summary_mode: "heuristic",
        include_raw_threads: false,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(memoryDir, "sync-state.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        repo: repoDir,
        repo_slug: "fixture-remote",
        remote_profile: "default",
        remote_prefix: "repos/fixture-remote/",
        last_sync_at: "2026-04-07T00:00:00Z",
        last_sync_direction: "push",
        last_sync_command: "now",
        current_thread: "thread-1",
        thread_count: 1,
        thread_ids: ["thread-1"],
        materialized_root: {
          current_thread_present: true,
          thread_index_present: true,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(memoryDir, "thread-index.json"),
    JSON.stringify([{
      thread_id: "thread-1",
      title: "Fixture Thread",
      thread_name: "Fixture Thread",
      created_at: 1,
      updated_at: 1,
      source_session_relpath: "sessions/2026/04/07/rollout-thread-1.jsonl",
      bundle_path: "threads/thread-1.json"
    }], null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(memoryDir, "current-thread.json"),
    JSON.stringify({ thread_id: "thread-1" }, null, 2) + "\n",
    "utf8",
  );
  return repoDir;
}

test("CLI defaults to skipping raw thread archives and allows explicit opt-in", () => {
  const defaults = parseArgs(["threads", "export"]);
  assert.equal(defaults.includeRawThreads, null);

  const skipped = parseArgs(["threads", "export", "--skip-raw-threads"]);
  assert.equal(skipped.includeRawThreads, false);

  const included = parseArgs(["threads", "export", "--include-raw-threads"]);
  assert.equal(included.includeRawThreads, true);
});

test("new repo state defaults to raw thread archives disabled", () => {
  const repoState = buildRepoState("/tmp/codex-handoff-cli-fixture", {
    profileName: "default",
    machineId: "machine-1",
  });

  assert.equal(repoState.include_raw_threads, false);
});

function runCli(repoDir, ...args) {
  return execFileSync(process.execPath, [cliPath, "--repo", repoDir, ...args], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });
}

test("CLI status/search/resume/sync status work through the Node entrypoint", () => {
  const repoDir = makeFixtureRepo();

  const status = runCli(repoDir, "status");
  assert.match(status, /current-thread\.json: present/);
  assert.match(status, /current thread bundle: present/);
  assert.match(status, /thread files: 1/);
  assert.match(status, /transcript records: 3/);

  const search = runCli(repoDir, "search", "scene-evidence");
  assert.match(search, /matches: 1/);
  assert.match(search, /turn=turn-1/);

  const resume = runCli(repoDir, "resume", "--goal", "scene-evidence restore context");
  assert.match(resume, /# Codex Restore Pack/);
  assert.match(resume, /Validate restore output/);

  const syncStatus = runCli(repoDir, "sync", "status");
  const payload = JSON.parse(syncStatus);
  assert.equal(payload.repo_slug, "fixture-remote");
  assert.equal(payload.thread_count, 1);
  assert.equal(payload.sync_health.status, "ok");
});
