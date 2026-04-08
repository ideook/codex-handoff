const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildRepoState, removeAgentsBlock, removeMemoryDirGitignoreEntry, unregisterRepoMapping } = require("./workspace");

test("buildRepoState excludes raw thread archives by default", () => {
  const repoState = buildRepoState("/tmp/codex-handoff-fixture", {
    profileName: "default",
    machineId: "machine-1",
  });

  assert.equal(repoState.include_raw_threads, false);
});

test("buildRepoState can opt into raw thread archives", () => {
  const repoState = buildRepoState("/tmp/codex-handoff-fixture", {
    profileName: "default",
    machineId: "machine-1",
    includeRawThreads: true,
  });

  assert.equal(repoState.include_raw_threads, true);
});

test("unregisterRepoMapping removes the normalized repo entry", () => {
  const payload = {
    repos: {
      "/workspace/project": { repo_slug: "project" },
      "/workspace/other": { repo_slug: "other" },
    },
  };

  const result = unregisterRepoMapping(payload, "/workspace/project");

  assert.equal(result.removed, true);
  assert.equal(result.remaining_repo_count, 1);
  assert.deepEqual(Object.keys(result.config.repos), ["/workspace/other"]);
});

test("removeAgentsBlock strips the managed block and preserves user content", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-agents-"));
  const agentsPath = path.join(repoDir, "AGENTS.md");
  fs.writeFileSync(
    agentsPath,
    [
      "# Local instructions",
      "",
      "Keep tests green.",
      "",
      "<!-- codex-handoff:start -->",
      "managed block",
      "<!-- codex-handoff:end -->",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = removeAgentsBlock(repoDir);

  assert.equal(result.removed, true);
  assert.match(fs.readFileSync(agentsPath, "utf8"), /# Local instructions/);
  assert.doesNotMatch(fs.readFileSync(agentsPath, "utf8"), /codex-handoff:start/);
});

test("removeMemoryDirGitignoreEntry removes the codex-handoff entry", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-ignore-"));
  const memoryDir = path.join(repoDir, ".codex-handoff");
  const gitignorePath = path.join(repoDir, ".gitignore");
  fs.writeFileSync(gitignorePath, "node_modules/\n.codex-handoff/\n", "utf8");

  const result = removeMemoryDirGitignoreEntry(repoDir, memoryDir);

  assert.equal(result.removed, true);
  assert.equal(fs.readFileSync(gitignorePath, "utf8"), "node_modules/\n");
});
