const fs = require("node:fs");
const path = require("node:path");

const { canonicalizeRepoPath, configPath, normalizeComparablePath, readJsonFile } = require("../service/common");

function loadConfig(configDir) {
  return normalizeConfig(readJsonFile(configPath(configDir), {}));
}

function saveConfig(configDir, payload) {
  const filePath = configPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  cleanupLegacyAuthArtifacts(configDir);
  fs.writeFileSync(filePath, JSON.stringify(normalizeConfig(payload), null, 2) + "\n", "utf8");
  return filePath;
}

function cleanupLegacyAuthArtifacts(configDir) {
  const secretsDir = path.join(configDir, "secrets");
  if (fs.existsSync(secretsDir)) {
    fs.rmSync(secretsDir, { recursive: true, force: true });
  }
}

function normalizeConfig(payload) {
  return {
    schema_version: "1.0",
    repos: normalizeRepoMappings(payload?.repos || {}),
    machine_id: payload?.machine_id || null,
  };
}

function normalizeRepoMappings(reposPayload) {
  const normalized = {};
  for (const [rawRepoPath, rawRepoState] of Object.entries(reposPayload || {})) {
    const comparableKey = normalizeComparablePath(rawRepoPath);
    const canonicalKey = canonicalizeRepoPath(rawRepoPath);
    if (!comparableKey || !canonicalKey) {
      continue;
    }
    const nextState = normalizeRepoMappingState(rawRepoState, canonicalKey);
    const existingState = normalized[canonicalKey];
    if (!existingState || repoStateUpdatedAt(nextState) >= repoStateUpdatedAt(existingState)) {
      normalized[canonicalKey] = nextState;
      continue;
    }
    normalized[canonicalKey] = {
      ...existingState,
      repo_slug: existingState.repo_slug || nextState.repo_slug,
      summary_mode: existingState.summary_mode || nextState.summary_mode,
      include_raw_threads: existingState.include_raw_threads === true || nextState.include_raw_threads === true,
      git_origin_url: existingState.git_origin_url || nextState.git_origin_url || null,
      git_origin_urls: Array.isArray(existingState.git_origin_urls) && existingState.git_origin_urls.length
        ? existingState.git_origin_urls
        : nextState.git_origin_urls,
      updated_at: existingState.updated_at || nextState.updated_at,
    };
  }
  return normalized;
}

function normalizeRepoMappingState(repoState, canonicalRepoPath) {
  const input = { ...(repoState || {}) };
  return {
    repo_slug: input.repo_slug || null,
    summary_mode: input.summary_mode || "auto",
    include_raw_threads: input.include_raw_threads === true,
    git_origin_url: input.git_origin_url || null,
    git_origin_urls: Array.isArray(input.git_origin_urls) ? input.git_origin_urls.filter(Boolean) : [],
    updated_at: input.updated_at || null,
  };
}

function repoStateUpdatedAt(repoState) {
  const value = Date.parse(repoState?.updated_at || "");
  return Number.isFinite(value) ? value : 0;
}

module.exports = {
  cleanupLegacyAuthArtifacts,
  loadConfig,
  saveConfig,
};
