const fs = require("node:fs");
const path = require("node:path");

const {
  isSameOrDescendantPath,
  normalizeComparablePath,
} = require("./common");
const { loadConfig, saveConfig } = require("../lib/runtime-config");
const { buildRepoState, loadRepoState, refreshRepoStateForCurrentRepo, registerRepoMapping, saveRepoState } = require("../lib/workspace");

function loadManagedRepos(configDir) {
  const payload = loadConfig(configDir);
  const repos = payload.repos || {};
  return Object.entries(repos)
    .map(([repoPath, repoState]) => {
      const normalizedPath = normalizeComparablePath(repoPath);
      if (!normalizedPath) {
        return null;
      }
      return {
        repoPath,
        normalizedPath,
        repoSlug: repoState.repo_slug || path.basename(repoPath),
        machineId: repoState.machine_id || payload.machine_id || null,
        remotePrefix: `repos/${repoState.repo_slug || path.basename(repoPath)}/`,
        remoteAuthType: "global_dotenv",
        remoteAuthPath: "~/.codex-handoff/.env.local",
        summaryMode: repoState.summary_mode || "auto",
        includeRawThreads: repoState.include_raw_threads === true,
        matchMode: "auto",
        matchStatus: "existing_local",
        projectName: repoState.project_name || path.basename(repoPath),
        gitOriginUrl: repoState.git_origin_url || null,
        gitOriginUrls: Array.isArray(repoState.git_origin_urls) ? repoState.git_origin_urls : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.normalizedPath.length - a.normalizedPath.length);
}

function findManagedRepoForCwd(cwd, managedRepos) {
  const normalizedCwd = normalizeComparablePath(cwd);
  if (!normalizedCwd) {
    return null;
  }
  return (
    managedRepos.find((repo) => isSameOrDescendantPath(normalizedCwd, repo.normalizedPath)) || null
  );
}

function hasManagedRepos(configDir) {
  return loadManagedRepos(configDir).length > 0;
}

function syncManagedRepoConfig(configDir, repoPath, repoState) {
  if (!configDir || !repoState?.repo_slug) {
    return;
  }
  const config = loadConfig(configDir);
  registerRepoMapping(config, repoPath, repoState);
  saveConfig(configDir, config);
}

function buildManagedRepoSeedState(repoPath, managedRepo, repoState = {}) {
  if (!managedRepo) {
    return repoState;
  }
  return {
    ...repoState,
    machine_id: managedRepo.machineId || repoState.machine_id || null,
    project_name: managedRepo.projectName || path.basename(repoPath),
    repo_slug: managedRepo.repoSlug || repoState.repo_slug || null,
    summary_mode: managedRepo.summaryMode || repoState.summary_mode || "auto",
    include_raw_threads: managedRepo.includeRawThreads === true || repoState.include_raw_threads === true,
    git_origin_url: managedRepo.gitOriginUrl || repoState.git_origin_url || null,
    git_origin_urls: managedRepo.gitOriginUrls || repoState.git_origin_urls || [],
  };
}

function ensureManagedRepoState(repoPathOrMemoryDir, managedRepo, { configDir = null } = {}) {
  const memoryDir = path.basename(repoPathOrMemoryDir) === ".codex-handoff"
    ? repoPathOrMemoryDir
    : path.join(repoPathOrMemoryDir, ".codex-handoff");
  const repoState = loadRepoState(memoryDir);
  const repoPath = managedRepo?.repoPath || repoState.repo_path || repoPathOrMemoryDir;
  const seedState = buildManagedRepoSeedState(repoPath, managedRepo, repoState);
  if (seedState?.repo_slug) {
    const refreshed = refreshRepoStateForCurrentRepo(repoPath, seedState);
    saveRepoState(memoryDir, refreshed);
    syncManagedRepoConfig(configDir, repoPath, refreshed);
    return refreshed;
  }
  const rebuilt = buildRepoState(managedRepo.repoPath, {
    machineId: managedRepo.machineId,
    remoteSlug: managedRepo.repoSlug,
    includeRawThreads: managedRepo.includeRawThreads === true,
    summaryMode: managedRepo.summaryMode || "auto",
    matchMode: managedRepo.matchMode || "auto",
    matchStatus: managedRepo.matchStatus || "existing_local",
    projectName: managedRepo.projectName || path.basename(managedRepo.repoPath),
    previousRepoState: {
      git_origin_url: managedRepo.gitOriginUrl || null,
      git_origin_urls: managedRepo.gitOriginUrls || [],
    },
  });
  saveRepoState(memoryDir, rebuilt);
  syncManagedRepoConfig(configDir, managedRepo.repoPath, rebuilt);
  return rebuilt;
}

module.exports = {
  ensureManagedRepoState,
  findManagedRepoForCwd,
  hasManagedRepos,
  loadManagedRepos,
  syncManagedRepoConfig,
};
