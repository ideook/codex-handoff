const fs = require("node:fs");
const path = require("node:path");

function gitOriginUrlFromRepo(repoPath) {
  const gitDir = resolveGitDir(repoPath);
  if (!gitDir) {
    return null;
  }
  for (const configPath of iterGitConfigPaths(gitDir)) {
    const value = readOriginUrlFromConfig(configPath);
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveGitDir(repoPath) {
  const directGit = path.join(repoPath, ".git");
  if (!fs.existsSync(directGit)) {
    return null;
  }
  const stat = fs.statSync(directGit);
  if (stat.isDirectory()) {
    return directGit;
  }
  const text = fs.readFileSync(directGit, "utf8");
  const match = text.match(/^gitdir:\s*(.+)\s*$/m);
  if (!match) {
    return null;
  }
  const gitDir = path.resolve(repoPath, match[1].trim());
  return fs.existsSync(gitDir) ? gitDir : null;
}

function iterGitConfigPaths(gitDir) {
  const paths = [];
  add(paths, path.join(gitDir, "config"));
  const commonDir = resolveCommonGitDir(gitDir);
  if (commonDir) {
    add(paths, path.join(commonDir, "config"));
  }
  return paths;
}

function add(list, filePath) {
  if (fs.existsSync(filePath) && !list.includes(filePath)) {
    list.push(filePath);
  }
}

function resolveCommonGitDir(gitDir) {
  const commonPath = path.join(gitDir, "commondir");
  if (!fs.existsSync(commonPath)) {
    return null;
  }
  const value = fs.readFileSync(commonPath, "utf8").trim();
  if (!value) {
    return null;
  }
  const resolved = path.resolve(gitDir, value);
  return fs.existsSync(resolved) ? resolved : null;
}

function readOriginUrlFromConfig(configPath) {
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    const section = line.match(/^\s*\[(.+?)\]\s*$/);
    if (section) {
      inOrigin = section[1].trim().toLowerCase() === 'remote "origin"';
      continue;
    }
    if (!inOrigin) {
      continue;
    }
    const match = line.match(/^\s*url\s*=\s*(.+?)\s*$/i);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

module.exports = {
  gitOriginUrlFromRepo,
};
