const test = require("node:test");
const assert = require("node:assert/strict");

const { detectCodexProcesses, isCodexAppProcess } = require("./process-utils");

test("detectCodexProcesses falls back to simple name matching when no command is available", () => {
  const detected = detectCodexProcesses([
    { pid: 101, name: "codex" },
    { pid: 102, name: "node" },
  ]);

  assert.deepEqual(detected, [{ pid: 101, name: "codex" }]);
});

test("isCodexAppProcess keeps the main macOS app process and rejects helper processes", () => {
  assert.equal(
    isCodexAppProcess({
      pid: 1,
      name: "codex",
      command: "/Applications/Codex.app/Contents/MacOS/Codex",
    }),
    true,
  );

  assert.equal(
    isCodexAppProcess({
      pid: 2,
      name: "codex",
      command: "/Applications/Codex.app/Contents/Resources/codex app-server --analytics-default-enabled",
    }),
    false,
  );

  assert.equal(
    isCodexAppProcess({
      pid: 3,
      name: "codex helper",
      command: "/Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=renderer",
    }),
    false,
  );
});

test("isCodexAppProcess rejects non-app codex binaries such as extension app-server processes", () => {
  assert.equal(
    isCodexAppProcess({
      pid: 4,
      name: "codex",
      command: "/Users/test/.cursor/extensions/openai.chatgpt/bin/macos-aarch64/codex app-server --analytics-default-enabled",
    }),
    false,
  );
});
