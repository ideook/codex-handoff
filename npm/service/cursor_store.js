const fs = require("node:fs");
const path = require("node:path");

const { watchCursorStatePath } = require("./common");

class CursorStore {
  constructor(configDir) {
    this.configDir = configDir;
    this.path = watchCursorStatePath(configDir);
    this.state = readJson(this.path, {});
  }

  get(filePath) {
    return this.state[filePath] || null;
  }

  set(filePath, value) {
    this.state[filePath] = value;
  }

  delete(filePath) {
    delete this.state[filePath];
  }

  save() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

module.exports = {
  CursorStore,
};
