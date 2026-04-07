function summarizeRollout(repoPath, thread, rolloutRecords) {
  const { messages } = extractCanonicalMessages(rolloutRecords, {});
  return summarizeHeuristically(repoPath, thread, messages);
}

function summarizeHeuristically(repoPath, thread, transcript) {
  const firstUser = transcript.find((item) => item.role === "user") || null;
  const lastUser = [...transcript].reverse().find((item) => item.role === "user") || null;
  const lastAssistant = [...transcript].reverse().find((item) => item.role === "assistant") || null;
  const lastRecord = transcript.length ? transcript[transcript.length - 1] : null;

  const currentGoal = firstUser ? firstUser.message : thread.title;
  const relatedFiles = [...new Set(transcript.flatMap((item) => [...findRelatedFiles(item.message || "")]))].sort();
  const searchHints = tokenizeSearchHints(
    [thread.title, currentGoal, lastUser?.message || "", lastAssistant?.message || ""].filter(Boolean).join(" "),
  ).slice(0, 12);

  const statusBits = [];
  if (lastAssistant) statusBits.push(`Last assistant message: ${shorten(lastAssistant.message)}`);
  if (lastUser && lastUser !== firstUser) statusBits.push(`Most recent user ask: ${shorten(lastUser.message)}`);
  if (lastRecord?.timestamp) statusBits.push(`Last activity: ${lastRecord.timestamp}`);
  const statusSummary = statusBits.join(" ") || "Thread bundle exported from the local Codex conversation transcript.";

  const latestLines = [
    "# Current State",
    "",
    `- Source thread title: ${thread.title}`,
    `- Current goal: ${shorten(currentGoal, 180)}`,
  ];
  if (lastAssistant) latestLines.push(`- Last assistant message: ${shorten(lastAssistant.message, 180)}`);
  if (lastRecord?.timestamp) latestLines.push(`- Last activity at: ${lastRecord.timestamp}`);
  latestLines.push("", "## Recent Conversation", "");
  latestLines.push(...renderRecentConversation(transcript, 8));
  latestLines.push("", "# Immediate Goal", "", currentGoal, "");

  return {
    latestMd: `${latestLines.join("\n").trim()}\n`,
    transcriptMd: renderTranscriptMarkdown(thread, transcript),
    handoffJson: {
      schema_version: "1.0",
      project_id: repoPath.split("/").pop() || "repo",
      updated_at: new Date().toISOString(),
      active_branch: "",
      current_goal: currentGoal,
      status_summary: statusSummary,
      next_prompt: lastUser ? lastUser.message : currentGoal,
      search_hints: searchHints,
      related_files: relatedFiles,
      recent_messages: transcript.slice(-20).map((item) => ({
        timestamp: item.timestamp,
        turn_id: item.turn_id,
        role: item.role,
        phase: item.phase || null,
        message: item.message,
      })),
      decisions: [],
      todos: [],
      recent_commands: [],
      notes: [
        `Generated from local Codex thread ${thread.threadId}.`,
        "Conversation transcript was derived from canonical user/assistant message records only.",
      ],
    },
    rawRecords: transcript,
  };
}

function normalizeRolloutRecords(records) {
  return extractCanonicalMessages(records, {}).messages;
}

function extractCanonicalMessages(records, state = {}) {
  let sessionId = state.sessionId || null;
  let currentTurnId = state.currentTurnId || null;
  const candidates = [];

  records.forEach((item, index) => {
    const recordType = item.type;
    const payload = item.payload || {};
    const timestamp = item.timestamp || null;

    if (recordType === "session_meta") {
      sessionId = payload.id || sessionId;
      return;
    }
    if (recordType === "turn_context" && payload.turn_id) {
      currentTurnId = payload.turn_id;
      return;
    }
    if (recordType === "event_msg" && payload.type === "task_started" && payload.turn_id) {
      currentTurnId = payload.turn_id;
      return;
    }

    if (recordType === "response_item" && payload.type === "message") {
      const role = payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : null;
      const message = extractMessageText(payload.content);
      if (!role || !message || isSyntheticUserMarker(message) || isSyntheticPromptWrapper(role, message)) {
        return;
      }
      candidates.push({
        order: index,
        priority: 1,
        session_id: sessionId,
        turn_id: currentTurnId,
        timestamp,
        role,
        phase: payload.phase || null,
        message,
        source_type: "response_item.message",
      });
      return;
    }

    if (recordType === "event_msg" && payload.type === "user_message" && payload.message) {
      const message = cleanMessage(payload.message);
      if (!message || isSyntheticUserMarker(message)) {
        return;
      }
      candidates.push({
        order: index,
        priority: 2,
        session_id: sessionId,
        turn_id: currentTurnId,
        timestamp,
        role: "user",
        phase: null,
        message,
        source_type: "event_msg.user_message",
      });
      return;
    }

    if (recordType === "event_msg" && payload.type === "agent_message" && payload.message) {
      const message = cleanMessage(payload.message);
      if (!message) {
        return;
      }
      candidates.push({
        order: index,
        priority: 2,
        session_id: sessionId,
        turn_id: currentTurnId,
        timestamp,
        role: "assistant",
        phase: payload.phase || null,
        message,
        source_type: "event_msg.agent_message",
      });
    }
  });

  const deduped = new Map();
  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    const existing = deduped.get(key);
    if (!existing || candidate.priority > existing.priority) {
      deduped.set(key, candidate);
    }
  }

  const messages = [...deduped.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order, priority, source_type, ...item }) => item);

  return {
    messages,
    state: {
      sessionId,
      currentTurnId,
    },
  };
}

function renderRecentConversation(transcript, limit = 8) {
  const rows = transcript.slice(-limit).map((item) => {
    const role = item.role === "assistant" ? "Assistant" : "User";
    const phase = item.phase ? ` (${item.phase})` : "";
    const stamp = item.timestamp ? `[${item.timestamp}] ` : "";
    return `- ${stamp}${role}${phase}: ${shorten(item.message, 220)}`;
  });
  return rows.length ? rows : ["- none"];
}

function renderTranscriptMarkdown(thread, transcript) {
  const lines = [
    "# Conversation Transcript",
    "",
    `- Thread: ${thread.title}`,
    `- Thread ID: ${thread.threadId}`,
    "",
  ];
  if (!transcript.length) {
    lines.push("_No canonical conversation messages found._");
    return `${lines.join("\n").trim()}\n`;
  }
  transcript.forEach((item) => {
    const role = item.role === "assistant" ? "Assistant" : "User";
    const phase = item.phase ? ` (${item.phase})` : "";
    lines.push(`## ${role}${phase}`);
    if (item.timestamp) lines.push(`- timestamp: ${item.timestamp}`);
    if (item.turn_id) lines.push(`- turn_id: ${item.turn_id}`);
    lines.push("", item.message, "");
  });
  return `${lines.join("\n").trim()}\n`;
}

function extractMessageText(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return cleanMessage(
    content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        return item.text || item.input_text || item.output_text || "";
      })
      .filter(Boolean)
      .join("\n"),
  );
}

function cleanMessage(message) {
  return String(message || "").replace(/\r\n/g, "\n").trim();
}

function isSyntheticUserMarker(message) {
  const normalized = cleanMessage(message);
  return normalized.startsWith("<turn_aborted>") && normalized.endsWith("</turn_aborted>");
}

function isSyntheticPromptWrapper(role, message) {
  if (role !== "user") {
    return false;
  }
  const normalized = cleanMessage(message);
  return normalized.includes("# AGENTS.md instructions for") && normalized.includes("<environment_context>");
}

function dedupeKey(item) {
  if (item.turn_id) {
    return [
      item.turn_id,
      item.role || "",
      item.phase || "",
    ].join("::");
  }
  return [
    item.role || "",
    item.phase || "",
    cleanMessage(item.message).replace(/\s+/g, " "),
  ].join("::");
}

function findRelatedFiles(text) {
  const matches = new Set();
  const patterns = [
    /[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+\.[A-Za-z0-9]+/g,
    /\/(?:[^/\s]+\/)*[^/\s]+\.[A-Za-z0-9]+/g,
    /\b(?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+\b/g,
    /\b[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|toml|yml|yaml|sh|css|html|sql|txt|xml)\b/g,
  ];
  const source = String(text || "");
  for (const pattern of patterns) {
    for (const match of source.match(pattern) || []) {
      const cleaned = match.trim().replace(/^[`'"\[(]+|[`'")\],.]+$/g, "");
      if (cleaned.length >= 4) {
        matches.add(cleaned);
      }
    }
  }
  return matches;
}

function tokenizeSearchHints(text) {
  const tokens = [];
  const seen = new Set();
  for (const token of String(text || "").toLowerCase().match(/[A-Za-z0-9._/-]+/g) || []) {
    if (token.length < 3 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function shorten(text, limit = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

module.exports = {
  extractCanonicalMessages,
  normalizeRolloutRecords,
  summarizeHeuristically,
  summarizeTranscriptBundle,
  summarizeRollout,
};

function summarizeTranscriptBundle(repoPath, bundle) {
  const thread = {
    threadId: bundle.thread_id,
    title: bundle.thread_title || bundle.thread_name || bundle.thread_id || "thread",
  };
  return summarizeHeuristically(repoPath, thread, Array.isArray(bundle.transcript) ? bundle.transcript : []);
}
