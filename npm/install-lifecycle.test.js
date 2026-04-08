const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { clearRestartState, readRestartState, writeRestartState } = require("./install-lifecycle");

test("install lifecycle restart state can be written and cleared", () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-install-state-"));
  const payload = {
    config_dir: configDir,
    codex_home: "/tmp/codex-home",
    agent_was_running: true,
  };

  writeRestartState(configDir, payload);
  assert.deepEqual(readRestartState(configDir), payload);

  clearRestartState(configDir);
  assert.equal(readRestartState(configDir), null);
});
