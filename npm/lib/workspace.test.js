const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRepoState } = require("./workspace");

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
