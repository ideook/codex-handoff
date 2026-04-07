const fs = require("node:fs");
const path = require("node:path");

const { gitOriginUrlFromRepo } = require("./git-config");
const { normalizeCwd } = require("./local-codex");

const MANAGED_BLOCK_START = "<!-- codex-handoff:start -->";
const MANAGED_BLOCK_END = "<!-- codex-handoff:end -->";

function repoStatePath(memoryDir) {
  return path.join(memoryDir, "repo.json");
}

function threadIndexPath(memoryDir) {
  return path.join(memoryDir, "thread-index.json");
}

function currentThreadPath(memoryDir) {
  return path.join(memoryDir, "current-thread.json");
}

function syncStatePath(memoryDir) {
  return path.join(memoryDir, "sync-state.json");
}

function loadRepoState(memoryDir) {
  return readJson(repoStatePath(memoryDir), {});
}

function saveRepoState(memoryDir, payload) {
  ensureMemoryLayout(memoryDir);
  const filePath = repoStatePath(memoryDir);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return filePath;
}

function loadSyncState(memoryDir) {
  return readJson(syncStatePath(memoryDir), {});
}

function saveSyncState(memoryDir, payload) {
  ensureMemoryLayout(memoryDir);
  const filePath = syncStatePath(memoryDir);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return filePath;
}

function ensureMemoryLayout(memoryDir) {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(path.join(memoryDir, "threads"), { recursive: true });
}

function materializedRootPaths(memoryDir) {
  return {
    latest: path.join(memoryDir, "latest.md"),
    handoff: path.join(memoryDir, "handoff.json"),
    transcript: path.join(memoryDir, "transcript.md"),
  };
}

function gitOriginUrl(repoPath) {
  return gitOriginUrlFromRepo(repoPath);
}

function inferRepoSlug(repoPath) {
  const origin = gitOriginUrl(repoPath);
  if (origin) {
    const parsed = slugFromOrigin(origin);
    if (parsed) return parsed;
  }
  return slugify(path.basename(repoPath));
}

function buildRepoState(repoPath, { profileName, machineId, remoteSlug = null, includeRawThreads = false, summaryMode = "auto", matchMode = "auto", matchStatus = "create_new", projectName = null }) {
  const slug = remoteSlug || inferRepoSlug(repoPath);
  return {
    schema_version: "1.0",
    machine_id: machineId,
    project_name: projectName || path.basename(repoPath),
    workspace_root: repoPath,
    codex_project: {
      project_name: projectName || path.basename(repoPath),
      workspace_root: repoPath,
      is_active: false,
      is_saved: false,
      is_in_project_order: false,
      is_in_sidebar_groups: false,
    },
    repo_path: normalizeCwd(repoPath),
    repo_slug: slug,
    remote_profile: profileName,
    remote_prefix: `repos/${slug}/`,
    include_raw_threads: includeRawThreads,
    summary_mode: summaryMode,
    match_mode: matchMode,
    match_status: matchStatus,
    git_origin_url: gitOriginUrl(repoPath),
    updated_at: new Date().toISOString(),
  };
}

function registerRepoMapping(configPayload, repoPath, repoState) {
  const repos = configPayload.repos || (configPayload.repos = {});
  repos[normalizeCwd(repoPath)] = {
    machine_id: repoState.machine_id,
    project_name: repoState.project_name || "",
    workspace_root: repoState.workspace_root || "",
    repo_slug: repoState.repo_slug,
    remote_profile: repoState.remote_profile,
    remote_prefix: repoState.remote_prefix,
    summary_mode: repoState.summary_mode,
    include_raw_threads: repoState.include_raw_threads,
    match_mode: repoState.match_mode,
    match_status: repoState.match_status,
    updated_at: new Date().toISOString(),
  };
  return configPayload;
}

function ensureAgentsBlock(repoPath, repoState) {
  const agentsPath = path.join(repoPath, "AGENTS.md");
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8") : "";
  const block = renderAgentsBlock(repoState);
  let updated;
  if (existing.includes(MANAGED_BLOCK_START) && existing.includes(MANAGED_BLOCK_END)) {
    updated = existing.replace(new RegExp(`${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}`), block);
  } else if (existing.trim()) {
    updated = `${existing.trimEnd()}\n\n${block}\n`;
  } else {
    updated = `${block}\n`;
  }
  fs.writeFileSync(agentsPath, updated, "utf8");
  return agentsPath;
}

function ensureMemoryDirGitignored(repoPath, memoryDir) {
  const relative = path.relative(repoPath, memoryDir).split(path.sep).join("/");
  if (!relative || relative.startsWith("..")) {
    return null;
  }
  const entry = `${relative.replace(/\/+$/, "")}/`;
  const gitignorePath = path.join(repoPath, ".gitignore");
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(entry)) {
    const next = existing && !existing.endsWith("\n") ? `${existing}\n${entry}\n` : `${existing}${entry}\n`;
    fs.writeFileSync(gitignorePath, next, "utf8");
  }
  return gitignorePath;
}

function renderAgentsBlock(repoState) {
  return [
    MANAGED_BLOCK_START,
    "## Codex Handoff Sync",
    "",
    "This repository is attached to codex-handoff sync.",
    `- local project name: \`${repoState.project_name || ""}\``,
    `- local workspace root: \`${repoState.workspace_root || ""}\``,
    `- remote profile: \`${repoState.remote_profile}\``,
    `- remote repo slug: \`${repoState.repo_slug}\``,
    `- remote prefix: \`${repoState.remote_prefix}\``,
    `- summary mode: \`${repoState.summary_mode}\``,
    `- include raw threads: \`${String(repoState.include_raw_threads).toLowerCase()}\``,
    `- match status: \`${repoState.match_status}\``,
    `- installed skill path: \`${repoState.installed_skill_path || ""}\``,
    "",
    "Before doing substantive work in this repository:",
    "0. If the local `codex-handoff` skill is installed, use it for sync, pull, import, and resume orchestration.",
    "1. Read `.codex-handoff/latest.md` first if it exists.",
    "2. If the user asks to continue previous work, run `codex-handoff --repo . resume --goal \"<user-goal>\"`.",
    "3. If the bootstrap summary is insufficient, inspect `.codex-handoff/handoff.json`.",
    "4. Never load raw session jsonl files wholesale. Use `codex-handoff --repo . search`, `codex-handoff --repo . extract`, or `codex-handoff --repo . context-pack` to retrieve only relevant evidence.",
    MANAGED_BLOCK_END,
  ].join("\n");
}

function slugify(value) {
  const slug = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").toLowerCase();
  return slug || "repo";
}

function slugFromOrigin(origin) {
  let normalized = String(origin || "").trim();
  if (normalized.endsWith(".git")) normalized = normalized.slice(0, -4);
  let parts;
  if (normalized.includes("://")) parts = normalized.split("://", 2)[1].split("/");
  else if (normalized.includes("@") && normalized.includes(":")) parts = normalized.split(":", 2)[1].split("/");
  else parts = normalized.split("/");
  if (parts.length < 2) return null;
  const owner = slugify(parts[parts.length - 2]);
  const repo = slugify(parts[parts.length - 1]);
  return owner ? `${owner}-${repo}` : repo;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

module.exports = {
  currentThreadPath,
  buildRepoState,
  ensureMemoryLayout,
  ensureAgentsBlock,
  ensureMemoryDirGitignored,
  gitOriginUrl,
  inferRepoSlug,
  loadRepoState,
  loadSyncState,
  materializedRootPaths,
  registerRepoMapping,
  saveRepoState,
  repoStatePath,
  saveSyncState,
  syncStatePath,
  threadIndexPath,
};
