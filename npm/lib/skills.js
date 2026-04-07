const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL_NAME = "codex-handoff";

function packageRoot() {
  return path.resolve(__dirname, "..", "..");
}

function bundledSkillPath(repoRoot = null) {
  const candidates = [path.join(packageRoot(), "skills", SKILL_NAME)];
  if (repoRoot) candidates.push(path.join(repoRoot, "skills", SKILL_NAME));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Bundled skill not found: ${candidates.join(", ")}`);
}

function defaultSkillsDir() {
  return process.env.CODEX_HANDOFF_SKILLS_DIR
    ? path.resolve(process.env.CODEX_HANDOFF_SKILLS_DIR)
    : path.join(os.homedir(), ".codex", "skills");
}

function installedSkillPath(skillsDir = null) {
  return path.join(skillsDir || defaultSkillsDir(), SKILL_NAME);
}

function installSkill(repoRoot, skillsDir = null) {
  const source = bundledSkillPath(repoRoot);
  const destination = installedSkillPath(skillsDir);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

module.exports = {
  bundledSkillPath,
  defaultSkillsDir,
  installSkill,
  installedSkillPath,
};
