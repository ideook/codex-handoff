const { spawnSync } = require("node:child_process");
const path = require("node:path");

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    if (result.status !== 0) {
      return false;
    }
    return parseTasklist(result.stdout).some((item) => item.pid === pid);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    return;
  }
  spawnSync("kill", ["-TERM", String(pid)], { encoding: "utf8" });
}

function listProcesses() {
  if (process.platform === "win32") {
    const result = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
    if (result.status !== 0) {
      return [];
    }
    return parseTasklist(result.stdout);
  }
  const result = spawnSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        name: path.basename(match[2]).toLowerCase(),
      };
    })
    .filter(Boolean);
}

function detectCodexProcesses(processes = listProcesses()) {
  return processes.filter((item) => isCodexProcessName(item.name));
}

function isCodexProcessName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "codex" || normalized === "codex.exe";
}

module.exports = {
  detectCodexProcesses,
  isCodexProcessName,
  isProcessRunning,
  listProcesses,
  terminateProcess,
};

function parseTasklist(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!line.startsWith('"')) return null;
      const parts = line.slice(1, -1).split('","');
      if (parts.length < 2) return null;
      return {
        name: String(parts[0] || "").trim().toLowerCase(),
        pid: Number(parts[1]),
      };
    })
    .filter((item) => item && Number.isInteger(item.pid) && item.pid > 0);
}
