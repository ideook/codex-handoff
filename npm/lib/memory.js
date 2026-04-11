const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadThreadTranscript, resolveThreadBundlePath, resolveThreadBundleRelPath } = require("./thread-bundles");
const { syncedThreadsDir, repoStatePath } = require("./workspace");

const DEFAULT_MAX_THREAD_BYTES = 32768;
const DEFAULT_MAX_DIGEST_THREADS = 100;

function memoryPath(memoryDir) {
  return path.join(memoryDir, "memory.md");
}

function memoryStatePath(memoryDir) {
  return path.join(memoryDir, "memory-state.json");
}

function summarizeMemoryWithCodex(repoPath, memoryDir, options = {}) {
  const normalized = normalizeOptions(options);
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedMemoryDir = path.resolve(memoryDir);
  const resolvedInputMemoryDir = path.resolve(normalized.inputMemoryDir || syncedThreadsDir(resolvedMemoryDir));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-handoff-memory-"));
  const inputDir = path.join(tmpRoot, "input");
  const outputDir = path.join(tmpRoot, "output");
  const outputPath = path.join(outputDir, "memory.next.md");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    const manifest = prepareMemoryInputs(resolvedRepoPath, resolvedMemoryDir, resolvedInputMemoryDir, inputDir, normalized);
    const manifestPath = path.join(inputDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const prompt = buildMemoryPrompt({
      goal: normalized.goal,
      inputDir,
      manifestPath,
      maxWords: normalized.maxWords,
    });
    const codexBin = resolveCodexBin(normalized.codexBin);
    const codexArgs = buildCodexArgs({
      model: normalized.model,
      outputPath,
      reasoningEffort: normalized.reasoningEffort,
      tmpRoot,
    });
    const result = spawnSync(codexBin, codexArgs, {
      cwd: tmpRoot,
      encoding: "utf8",
      input: prompt,
      killSignal: "SIGTERM",
      maxBuffer: normalized.maxBuffer,
      timeout: normalized.timeoutMs,
    });
    assertCodexResult(result, outputPath, normalized.timeoutMs);
    const summary = fs.readFileSync(outputPath, "utf8").trimEnd() + "\n";
    const state = {
      schema_version: "1.0",
      updated_at: new Date().toISOString(),
      generator: "codex exec",
      codex_bin: codexBin,
    goal: normalized.goal,
    max_digest_threads: normalized.maxDigestThreads,
    max_words: normalized.maxWords,
      max_threads: normalized.maxThreads,
      max_thread_bytes: normalized.maxThreadBytes,
      dry_run: normalized.dryRun,
      input_manifest: manifest,
    };
    if (!normalized.dryRun) {
      atomicWriteFile(memoryPath(resolvedMemoryDir), summary);
      atomicWriteJson(memoryStatePath(resolvedMemoryDir), state);
    }
    return {
      memory_path: memoryPath(resolvedMemoryDir),
      memory_state_path: memoryStatePath(resolvedMemoryDir),
      dry_run: normalized.dryRun,
      wrote_memory: !normalized.dryRun,
      summary,
      state,
      temp_dir: normalized.keepTemp ? tmpRoot : null,
    };
  } finally {
    if (!normalized.keepTemp) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

function refreshLocalMemory(repoPath, memoryDir, options = {}) {
  const resolvedMemoryDir = path.resolve(memoryDir);
  const inputMemoryDir = path.resolve(options.inputMemoryDir || syncedThreadsDir(resolvedMemoryDir));
  if (!options.force && !memoryNeedsRefresh(resolvedMemoryDir, inputMemoryDir)) {
    return {
      refreshed: false,
      skipped: true,
      reason: "not_needed",
      memory_path: memoryPath(resolvedMemoryDir),
      memory_state_path: memoryStatePath(resolvedMemoryDir),
      input_memory_dir: inputMemoryDir,
    };
  }
  const result = summarizeMemoryWithCodex(repoPath, resolvedMemoryDir, {
    ...options,
    inputMemoryDir,
  });
  return {
    ...result,
    refreshed: true,
    skipped: false,
    reason: "refreshed",
    input_memory_dir: inputMemoryDir,
  };
}

function normalizeOptions(options) {
  return {
    codexBin: options.codexBin || process.env.CODEX_HANDOFF_CODEX_BIN || null,
    dryRun: options.dryRun === true,
    goal: options.goal || "Create a concise local repo memory summary from synced thread payloads.",
    inputMemoryDir: options.inputMemoryDir || null,
    keepTemp: options.keepTemp === true,
    maxBuffer: positiveIntegerOr(options.maxBuffer, 1024 * 1024 * 16),
    maxDigestThreads: nonNegativeIntegerOr(options.maxDigestThreads, DEFAULT_MAX_DIGEST_THREADS),
    maxThreadBytes: positiveIntegerOr(options.maxThreadBytes, DEFAULT_MAX_THREAD_BYTES),
    maxThreads: nonNegativeIntegerOr(options.maxThreads, 0),
    maxWords: positiveIntegerOr(options.maxWords, 900),
    model: options.model || null,
    reasoningEffort: options.reasoningEffort || "low",
    timeoutMs: positiveIntegerOr(options.timeoutMs, 180000),
  };
}

function prepareMemoryInputs(repoPath, memoryDir, inputMemoryDir, inputDir, options) {
  const copied = [];
  const skipped = [];
  copyFileByPath(repoStatePath(memoryDir), "repo.json", path.join(inputDir, "repo.json"), copied, skipped, { inputDir });
  copyMemoryFile(memoryDir, "memory.md", path.join(inputDir, "previous-memory.md"), copied, skipped, { inputDir });
  for (const name of ["latest.md", "handoff.json", "thread-index.json", "current-thread.json"]) {
    copyMemoryFile(inputMemoryDir, name, path.join(inputDir, name), copied, skipped, { inputDir });
  }

  const threadIndex = readJson(path.join(inputMemoryDir, "thread-index.json"), []);
  const generated = [];
  const threadDigest = buildThreadDigest(inputMemoryDir, threadIndex, options.maxDigestThreads);
  const digestPath = path.join(inputDir, "thread-digest.json");
  fs.writeFileSync(digestPath, JSON.stringify(threadDigest, null, 2) + "\n", "utf8");
  generated.push({
    path: "thread-digest.json",
    bytes: fs.statSync(digestPath).size,
    thread_count: threadDigest.threads.length,
    omitted_thread_count: threadDigest.omitted_thread_count,
  });
  const selectedThreads = [];
  if (options.maxThreads > 0 && Array.isArray(threadIndex)) {
    const threadsDir = path.join(inputDir, "threads");
    fs.mkdirSync(threadsDir, { recursive: true });
    for (const entry of [...threadIndex].sort(compareThreadIndex).slice(0, options.maxThreads)) {
      const threadId = entry?.thread_id;
      if (!threadId) continue;
      const sourcePath = resolveThreadBundlePath(inputMemoryDir, threadId, entry?.bundle_path || null);
      const targetPath = path.join(threadsDir, path.basename(sourcePath));
      const copiedThread = copyMemoryFile(inputMemoryDir, path.relative(inputMemoryDir, sourcePath), targetPath, copied, skipped, {
        inputDir,
        maxBytes: options.maxThreadBytes,
      });
      selectedThreads.push({
        thread_id: threadId,
        title: entry.title || entry.thread_name || "",
        bundle_copied: copiedThread,
        bundle_path: copiedThread ? path.relative(inputDir, targetPath).split(path.sep).join("/") : null,
      });
    }
  }

  return {
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    repo_path: repoPath,
    memory_dir: memoryDir,
    input_memory_dir: inputMemoryDir,
    input_dir: inputDir,
    copied_files: copied,
    generated_files: generated,
    skipped_files: skipped,
    selected_threads: selectedThreads,
  };
}

function buildThreadDigest(memoryDir, threadIndex, maxDigestThreads) {
  const entries = Array.isArray(threadIndex) ? [...threadIndex].sort(compareThreadIndex) : [];
  const selected = entries.slice(0, maxDigestThreads);
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    source: "thread-index.json plus compact deterministic thread bundle digests",
    thread_count: entries.length,
    included_thread_count: selected.length,
    omitted_thread_count: Math.max(0, entries.length - selected.length),
    threads: selected.map((entry) => summarizeThreadEntry(memoryDir, entry)),
  };
}

function memoryNeedsRefresh(memoryDir, inputMemoryDir) {
  if (!hasMemorySourceData(inputMemoryDir)) {
    return false;
  }
  const memoryFile = memoryPath(memoryDir);
  const stateFile = memoryStatePath(memoryDir);
  if (!fs.existsSync(memoryFile) || !fs.existsSync(stateFile)) {
    return true;
  }
  const state = readJson(stateFile, {});
  const priorInputMemoryDir = state?.input_manifest?.input_memory_dir
    ? path.resolve(String(state.input_manifest.input_memory_dir))
    : null;
  if (priorInputMemoryDir !== inputMemoryDir) {
    return true;
  }
  const stateUpdatedAt = Date.parse(String(state.updated_at || ""));
  if (!Number.isFinite(stateUpdatedAt)) {
    return true;
  }
  const sourceNewestMtimeMs = newestSourceMtime(inputMemoryDir);
  return sourceNewestMtimeMs > stateUpdatedAt;
}

function hasMemorySourceData(inputMemoryDir) {
  const candidates = [
    path.join(inputMemoryDir, "latest.md"),
    path.join(inputMemoryDir, "handoff.json"),
    path.join(inputMemoryDir, "thread-index.json"),
    path.join(inputMemoryDir, "current-thread.json"),
    path.join(inputMemoryDir, "threads"),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function newestSourceMtime(rootDir) {
  const stack = [rootDir];
  let latest = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    const stat = fs.statSync(current);
    latest = Math.max(latest, stat.mtimeMs);
    if (!stat.isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      stack.push(path.join(current, entry.name));
    }
  }
  return latest;
}

function summarizeThreadEntry(memoryDir, entry) {
  const threadId = entry?.thread_id || "";
  const bundlePath = threadId ? resolveThreadBundlePath(memoryDir, threadId, entry?.bundle_path || null) : null;
  const transcript = threadId ? loadThreadTranscript(memoryDir, threadId, entry?.bundle_path || null) : null;
  const rows = Array.isArray(transcript) ? transcript : [];
  const lastUser = [...rows].reverse().find((item) => item?.role === "user") || null;
  const lastAssistant = [...rows].reverse().find((item) => item?.role === "assistant") || null;
  const lastRecord = rows[rows.length - 1] || null;
  return {
    thread_id: threadId,
    title: entry?.title || entry?.thread_name || threadId,
    thread_name: entry?.thread_name || null,
    updated_at: entry?.updated_at || null,
    source_session_relpath: entry?.source_session_relpath || null,
    bundle_path: entry?.bundle_path || (threadId ? resolveThreadBundleRelPath(memoryDir, threadId) : null),
    bundle_present: Boolean(transcript),
    message_count: rows.length,
    last_activity_at: lastRecord?.timestamp || entry?.updated_at || null,
    last_turn_id: lastRecord?.turn_id || null,
    last_user_turn_id: lastUser?.turn_id || null,
    last_user: shorten(lastUser?.message || "", 220),
    last_assistant_turn_id: lastAssistant?.turn_id || null,
    last_assistant: shorten(lastAssistant?.message || "", 260),
  };
}

function copyMemoryFile(memoryDir, relPath, targetPath, copied, skipped, { inputDir = null, maxBytes = null } = {}) {
  const sourcePath = path.join(memoryDir, relPath);
  const normalizedRelPath = relPath.split(path.sep).join("/");
  return copyFileByPath(sourcePath, normalizedRelPath, targetPath, copied, skipped, { inputDir, maxBytes });
}

function copyFileByPath(sourcePath, normalizedRelPath, targetPath, copied, skipped, { inputDir = null, maxBytes = null } = {}) {
  if (!fs.existsSync(sourcePath)) {
    skipped.push({ path: normalizedRelPath, reason: "missing" });
    return false;
  }
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) {
    skipped.push({ path: normalizedRelPath, reason: "not_file" });
    return false;
  }
  if (maxBytes !== null && stat.size > maxBytes) {
    skipped.push({ path: normalizedRelPath, reason: "too_large", bytes: stat.size, max_bytes: maxBytes });
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  const inputPath = inputDir ? path.relative(inputDir, targetPath).split(path.sep).join("/") : path.basename(targetPath);
  copied.push({ path: normalizedRelPath, input_path: inputPath, bytes: stat.size });
  return true;
}

function buildCodexArgs({ model, outputPath, reasoningEffort, tmpRoot }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
    "--color",
    "never",
    "-C",
    tmpRoot,
    "-o",
    outputPath,
    "-",
  ];
  if (model) {
    args.splice(1, 0, "--model", model);
  }
  return args;
}

function buildMemoryPrompt({ goal, inputDir, manifestPath, maxWords }) {
  return [
    "You are a child Codex process invoked by codex-handoff to write repo-level memory.",
    "",
    "Task:",
    `- Return a concise Markdown memory summary under ${maxWords} words.`,
    `- User goal: ${goal}`,
    "",
    "Input policy:",
    `- Read only files under this isolated input directory: ${inputDir}`,
    `- Start with this manifest: ${manifestPath}`,
    "- Do not inspect the original repository checkout.",
    "- Do not inspect raw session logs.",
    "- Prefer thread-digest.json over copied full thread bundles when writing the memory.",
    "- Do not enumerate historical thread bundles beyond files copied into the input directory.",
    "- Use previous-memory.md to preserve durable project context when it is still consistent with the latest thread inputs.",
    "- Prioritize the newest synced thread activity when describing recent work.",
    "- If previous-memory.md conflicts with the latest synced thread inputs, correct it rather than preserving it.",
    "",
    "Output exactly these Markdown sections:",
    "1. Recent Work",
    "2. Repo Overview",
    "3. Durable Decisions",
    "4. Active Notes",
    "5. Next Steps",
    "6. Thread Links",
    "",
    "Section expectations:",
    "- Recent Work: summarize the latest meaningful implementation or debugging activity.",
    "- Repo Overview: keep a compact durable overview of what this repo does and what the current effort is about.",
    "- Durable Decisions: include rules or design choices that should survive across sessions.",
    "- Active Notes: include important current constraints, risks, or caveats.",
    "- Next Steps: list the most likely immediate follow-up actions.",
    "- Thread Links must include thread_id and turn_id when available. If turn_id is unavailable, say unavailable.",
  ].join("\n");
}

function assertCodexResult(result, outputPath, timeoutMs) {
  if (result.error || result.status !== 0) {
    const reason = result.error?.code === "ETIMEDOUT"
      ? `timed out after ${timeoutMs}ms`
      : `failed with status ${result.status}`;
    throw new Error(
      `codex exec ${reason}; suppressed child logs ` +
        `(stdout_bytes=${byteLength(result.stdout)}, stderr_bytes=${byteLength(result.stderr)})`,
    );
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `codex exec completed without writing ${outputPath}; suppressed child logs ` +
        `(stdout_bytes=${byteLength(result.stdout)}, stderr_bytes=${byteLength(result.stderr)})`,
    );
  }
}

function resolveCodexBin(explicit = null, env = process.env, platform = process.platform) {
  if (explicit) return explicit;
  const fromPath = findOnPath("codex", env, platform);
  if (fromPath) return fromPath;
  const candidates = [];
  if (platform === "darwin") {
    candidates.push("/Applications/Codex.app/Contents/Resources/codex");
  } else if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    candidates.push(
      path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(localAppData, "OpenAI", "Codex", "bin", "codex.cmd"),
    );
  }
  return candidates.find((item) => fs.existsSync(item)) || "codex";
}

function findOnPath(command, env = process.env, platform = process.platform) {
  const pathValue = env.PATH || env.Path || "";
  const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function atomicWriteFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function atomicWriteJson(filePath, payload) {
  atomicWriteFile(filePath, JSON.stringify(payload, null, 2) + "\n");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function shorten(text, limit) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function compareThreadIndex(a, b) {
  return String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""));
}

function positiveIntegerOr(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

module.exports = {
  buildMemoryPrompt,
  buildThreadDigest,
  memoryPath,
  memoryNeedsRefresh,
  memoryStatePath,
  prepareMemoryInputs,
  refreshLocalMemory,
  resolveCodexBin,
  summarizeMemoryWithCodex,
};
