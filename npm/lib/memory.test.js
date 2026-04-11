const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { memoryPath, memoryStatePath, refreshLocalMemory, summarizeMemoryWithCodex } = require("./memory");

function makeRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-memory-repo-"));
  const memoryDir = path.join(repoDir, ".codex-handoff");
  const syncedThreadsDir = path.join(memoryDir, "synced-threads");
  fs.mkdirSync(path.join(syncedThreadsDir, "threads"), { recursive: true });
  fs.writeFileSync(path.join(syncedThreadsDir, "latest.md"), "# Latest\n\nCurrent work.\n", "utf8");
  fs.writeFileSync(path.join(syncedThreadsDir, "handoff.json"), JSON.stringify({ current_goal: "memory tests" }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(memoryDir, "repo.json"), JSON.stringify({ workspace_root: repoDir }, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(syncedThreadsDir, "thread-index.json"),
    JSON.stringify([
      { thread_id: "thread-1", title: "First", updated_at: "2026-01-02T00:00:00.000Z" },
      { thread_id: "thread-2", title: "Second", updated_at: "2026-01-01T00:00:00.000Z" },
    ], null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(path.join(syncedThreadsDir, "threads", "thread-1.jsonl"), `${JSON.stringify({ role: "user", message: "hello" })}\n`, "utf8");
  fs.writeFileSync(path.join(syncedThreadsDir, "threads", "thread-2.jsonl"), `${JSON.stringify({ role: "user", message: "old" })}\n`, "utf8");
  return { repoDir, memoryDir };
}

function makeFakeCodex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-fake-codex-"));
  const binPath = path.join(dir, "codex");
  fs.writeFileSync(
    binPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const output = args[args.indexOf('-o') + 1];",
      "const prompt = fs.readFileSync(0, 'utf8');",
      "if (!output) process.exit(2);",
      "fs.writeFileSync(output, ['# Fake Memory', '', `cwd=${process.cwd()}`, `isolated=${prompt.includes('Do not inspect the original repository checkout.')}`].join('\\n') + '\\n', 'utf8');",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

test("summarizeMemoryWithCodex writes memory from an isolated child Codex run", () => {
  const { repoDir, memoryDir } = makeRepo();
  const fakeCodex = makeFakeCodex();
  const result = summarizeMemoryWithCodex(repoDir, memoryDir, {
    codexBin: fakeCodex,
    keepTemp: true,
    maxThreads: 1,
    timeoutMs: 5000,
  });

  assert.equal(result.wrote_memory, true);
  assert.equal(fs.existsSync(memoryPath(memoryDir)), true);
  assert.equal(fs.existsSync(memoryStatePath(memoryDir)), true);
  assert.match(fs.readFileSync(memoryPath(memoryDir), "utf8"), /# Fake Memory/);
  assert.match(fs.readFileSync(memoryPath(memoryDir), "utf8"), /isolated=true/);
  assert.notEqual(result.temp_dir, repoDir);
  assert.equal(result.state.input_manifest.generated_files[0].path, "thread-digest.json");
  assert.equal(result.state.input_manifest.generated_files[0].thread_count, 2);
  assert.equal(result.state.input_manifest.selected_threads.length, 1);
  assert.equal(result.state.input_manifest.selected_threads[0].thread_id, "thread-1");

  fs.rmSync(result.temp_dir, { recursive: true, force: true });
});

test("summarizeMemoryWithCodex dry run returns summary without writing root memory", () => {
  const { repoDir, memoryDir } = makeRepo();
  const fakeCodex = makeFakeCodex();
  const result = summarizeMemoryWithCodex(repoDir, memoryDir, {
    codexBin: fakeCodex,
    dryRun: true,
    maxThreads: 0,
    timeoutMs: 5000,
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.wrote_memory, false);
  assert.match(result.summary, /# Fake Memory/);
  assert.equal(fs.existsSync(memoryPath(memoryDir)), false);
  assert.equal(fs.existsSync(memoryStatePath(memoryDir)), false);
});

test("refreshLocalMemory writes root memory from synced threads when missing", () => {
  const { repoDir, memoryDir } = makeRepo();
  const fakeCodex = makeFakeCodex();
  const result = refreshLocalMemory(repoDir, memoryDir, {
    codexBin: fakeCodex,
    timeoutMs: 5000,
  });

  assert.equal(result.refreshed, true);
  assert.equal(result.skipped, false);
  assert.equal(fs.existsSync(memoryPath(memoryDir)), true);
  assert.equal(fs.existsSync(memoryStatePath(memoryDir)), true);
});

test("refreshLocalMemory skips when root memory is already current", () => {
  const { repoDir, memoryDir } = makeRepo();
  const fakeCodex = makeFakeCodex();
  const first = refreshLocalMemory(repoDir, memoryDir, {
    codexBin: fakeCodex,
    timeoutMs: 5000,
  });
  const second = refreshLocalMemory(repoDir, memoryDir, {
    codexBin: fakeCodex,
    timeoutMs: 5000,
  });

  assert.equal(first.refreshed, true);
  assert.equal(second.refreshed, false);
  assert.equal(second.reason, "not_needed");
});

test("refreshLocalMemory regenerates when the prior memory used a different input source", () => {
  const { repoDir, memoryDir } = makeRepo();
  const fakeCodex = makeFakeCodex();
  const first = refreshLocalMemory(repoDir, memoryDir, {
    codexBin: fakeCodex,
    timeoutMs: 5000,
  });
  const statePath = memoryStatePath(memoryDir);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.input_manifest.input_memory_dir = path.join(memoryDir, "local-threads");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  const second = refreshLocalMemory(repoDir, memoryDir, {
    codexBin: fakeCodex,
    timeoutMs: 5000,
  });

  assert.equal(first.refreshed, true);
  assert.equal(second.refreshed, true);
  assert.equal(second.skipped, false);
});
