const fs = require("node:fs");
const path = require("node:path");

const { normalizeCwd } = require("./local-codex");

function globalStatePath(codexHome) {
  return path.join(path.resolve(codexHome), ".codex-global-state.json");
}

function loadGlobalState(codexHome) {
  const filePath = globalStatePath(codexHome);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function describeCurrentProject(repoPath, codexHome) {
  const payload = loadGlobalState(codexHome);
  const normalizedRepo = normalizeCwd(repoPath);
  const atomState = payload["electron-persisted-atom-state"] || {};
  const labels = atomState["electron-workspace-root-labels"] || {};
  const saved = payload["electron-saved-workspace-roots"] || [];
  const active = payload["active-workspace-roots"] || [];
  const order = payload["project-order"] || [];
  const sidebarGroups = Object.keys(atomState["sidebar-collapsed-groups"] || {});

  const contains = (items) => Array.isArray(items) && items.some((item) => normalizeCwd(item) === normalizedRepo);
  const labelKey = Object.keys(labels).find((key) => normalizeCwd(key) === normalizedRepo);
  const displayName = labels[repoPath] || (labelKey ? labels[labelKey] : null) || path.basename(repoPath);

  return {
    project_name: displayName,
    workspace_root: repoPath,
    is_active: contains(active),
    is_saved: contains(saved),
    is_in_project_order: contains(order),
    is_in_sidebar_groups: contains(sidebarGroups),
  };
}

module.exports = {
  describeCurrentProject,
  globalStatePath,
  loadGlobalState,
};
