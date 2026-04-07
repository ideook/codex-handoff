const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeRolloutRecords, summarizeRollout } = require("./summarize");

test("normalizeRolloutRecords keeps canonical user and assistant messages and drops noisy records", () => {
  const records = [
    {
      type: "session_meta",
      payload: { id: "thread-1" },
      timestamp: "2026-04-08T00:00:00.000Z",
    },
    {
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
      timestamp: "2026-04-08T00:00:00.001Z",
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello user" }],
      },
      timestamp: "2026-04-08T00:00:00.002Z",
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "hello user" },
      timestamp: "2026-04-08T00:00:00.002Z",
    },
    {
      type: "event_msg",
      payload: { type: "token_count" },
      timestamp: "2026-04-08T00:00:00.003Z",
    },
    {
      type: "response_item",
      payload: { type: "reasoning", encrypted_content: "blob" },
      timestamp: "2026-04-08T00:00:00.004Z",
    },
    {
      type: "event_msg",
      payload: { type: "agent_message", message: "hello assistant", phase: "final_answer" },
      timestamp: "2026-04-08T00:00:00.005Z",
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "hello assistant" }],
      },
      timestamp: "2026-04-08T00:00:00.005Z",
    },
    {
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "hello assistant" },
      timestamp: "2026-04-08T00:00:00.006Z",
    },
  ];

  const transcript = normalizeRolloutRecords(records);
  assert.deepEqual(transcript, [
    {
      session_id: "thread-1",
      turn_id: "turn-1",
      timestamp: "2026-04-08T00:00:00.002Z",
      role: "user",
      phase: null,
      message: "hello user",
    },
    {
      session_id: "thread-1",
      turn_id: "turn-1",
      timestamp: "2026-04-08T00:00:00.005Z",
      role: "assistant",
      phase: "final_answer",
      message: "hello assistant",
    },
  ]);
});

test("summarizeRollout builds transcript-first handoff fields", () => {
  const thread = {
    threadId: "thread-1",
    title: "Example Thread",
  };
  const records = [
    {
      type: "session_meta",
      payload: { id: "thread-1" },
      timestamp: "2026-04-08T00:00:00.000Z",
    },
    {
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
      timestamp: "2026-04-08T00:00:00.001Z",
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Please continue work on npm/lib/summarize.js" }],
      },
      timestamp: "2026-04-08T00:00:00.002Z",
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "I updated npm/lib/summarize.js and npm/lib/sync.js." }],
      },
      timestamp: "2026-04-08T00:00:00.003Z",
    },
  ];

  const summary = summarizeRollout("/workspace/repo", thread, records);
  assert.match(summary.latestMd, /Recent Conversation/);
  assert.match(summary.transcriptMd, /Conversation Transcript/);
  assert.equal(summary.rawRecords.length, 2);
  assert.equal(summary.handoffJson.current_goal, "Please continue work on npm/lib/summarize.js");
  assert.equal(summary.handoffJson.recent_messages.length, 2);
  assert.ok(summary.handoffJson.related_files.includes("npm/lib/summarize.js"));
  assert.ok(summary.handoffJson.related_files.includes("npm/lib/sync.js"));
});
