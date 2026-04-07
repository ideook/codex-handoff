const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { updateThreadBundleFromRolloutChange } = require("./sync");

function makeThread(overrides = {}) {
  return {
    threadId: "thread-123",
    title: "Incremental Thread",
    cwd: "/workspace/project",
    rolloutPath: "/tmp/rollout-thread-123.jsonl",
    createdAt: 1,
    updatedAt: 2,
    row: {
      id: "thread-123",
      source: "vscode",
      model_provider: "openai",
      model: "gpt-5.4",
      reasoning_effort: "xhigh",
      cwd: "/workspace/project",
      rollout_path: "/tmp/rollout-thread-123.jsonl",
    },
    sessionIndexEntry: {
      id: "thread-123",
      thread_name: "Incremental Thread",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("updateThreadBundleFromRolloutChange creates a bundle from appended canonical messages only", () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-sync-"));
  const thread = makeThread();

  const newLines = [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-123" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello user" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "hello user" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "hello assistant", phase: "final_answer" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "hello assistant" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{}" } }),
  ];

  const result = updateThreadBundleFromRolloutChange("/workspace/project", memoryDir, thread, {
    newLines,
    parserState: null,
    includeRawThreads: false,
  });

  assert.equal(result.touched, true);
  assert.equal(result.transcript.length, 2);
  assert.deepEqual(
    result.transcript.map((item) => ({ role: item.role, message: item.message, phase: item.phase })),
    [
      { role: "user", message: "hello user", phase: null },
      { role: "assistant", message: "hello assistant", phase: "final_answer" },
    ],
  );
  assert.equal(fs.existsSync(path.join(memoryDir, "threads", "thread-123.json")), true);
});

test("updateThreadBundleFromRolloutChange ignores noise-only appended lines for new threads", () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-sync-noise-"));
  const thread = makeThread({ threadId: "thread-noise", row: { id: "thread-noise", source: "vscode", model_provider: "openai", cwd: "/workspace/project", rollout_path: "/tmp/rollout-thread-noise.jsonl" } });

  const result = updateThreadBundleFromRolloutChange("/workspace/project", memoryDir, thread, {
    newLines: [
      JSON.stringify({ type: "session_meta", payload: { id: "thread-noise" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
      JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{}" } }),
    ],
    parserState: null,
    includeRawThreads: false,
  });

  assert.equal(result.touched, false);
  assert.equal(result.transcript, null);
  assert.equal(fs.existsSync(path.join(memoryDir, "threads", "thread-noise.json")), false);
});

test("updateThreadBundleFromRolloutChange appends new canonical messages to an existing bundle", () => {
  const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-sync-append-"));
  const thread = makeThread();

  updateThreadBundleFromRolloutChange("/workspace/project", memoryDir, thread, {
    newLines: [
      JSON.stringify({ type: "session_meta", payload: { id: "thread-123" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "hello user" } }),
    ],
    parserState: null,
    includeRawThreads: false,
  });

  const result = updateThreadBundleFromRolloutChange("/workspace/project", memoryDir, thread, {
    newLines: [
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "second reply", phase: "commentary" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
    ],
    parserState: { sessionId: "thread-123", currentTurnId: "turn-1" },
    includeRawThreads: false,
  });

  assert.equal(result.touched, true);
  assert.deepEqual(
    result.transcript.map((item) => item.message),
    ["hello user", "second reply"],
  );
});
