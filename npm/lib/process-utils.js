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

function forceTerminateProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    return;
  }
  spawnSync("kill", ["-KILL", String(pid)], { encoding: "utf8" });
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

function listProcessDetails() {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
          "$items = Get-CimInstance Win32_Process | Select-Object ProcessId, Name, CommandLine; " +
          "$items | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      return [];
    }
    try {
      const payload = JSON.parse(result.stdout || "[]");
      const items = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      return items
        .map((item) => ({
          pid: Number(item.ProcessId),
          name: path.basename(String(item.Name || "")).toLowerCase(),
          command: String(item.CommandLine || "").trim(),
        }))
        .filter((item) => Number.isInteger(item.pid) && item.pid > 0);
    } catch {
      return [];
    }
  }
  const result = spawnSync("ps", ["-axo", "pid=,comm=,command="], { encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        name: path.basename(match[2]).toLowerCase(),
        command: String(match[3] || "").trim(),
      };
    })
    .filter((item) => item && Number.isInteger(item.pid) && item.pid > 0);
}

function findScriptProcessPids(scriptName, { configDir = null } = {}) {
  const needle = String(scriptName || "").trim();
  if (!needle) {
    return [];
  }
  return listProcessDetails()
    .filter((item) => item.command.includes(needle))
    .filter((item) => (configDir ? item.command.includes(`--config-dir ${configDir}`) : true))
    .map((item) => item.pid);
}

function detectCodexProcesses(processes = null) {
  const candidates = Array.isArray(processes) ? processes : listProcessDetails();
  return candidates.filter((item) => isCodexAppProcess(item));
}

function isCodexProcessName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "codex" || normalized === "codex.exe";
}

function isCodexAppProcess(processInfo) {
  const normalizedName = String(processInfo?.name || "").trim().toLowerCase();
  const normalizedCommand = String(processInfo?.command || "").trim().toLowerCase();

  if (!normalizedCommand) {
    return isCodexProcessName(normalizedName);
  }

  if (normalizedCommand.includes("/applications/codex.app/contents/macos/codex")) {
    return (
      !normalizedCommand.includes("codex helper") &&
      !normalizedCommand.includes("app-server") &&
      !normalizedCommand.includes("chrome_crashpad_handler")
    );
  }

  const windowsCommand = normalizedCommand.replace(/\//g, "\\");
  if (windowsCommand.includes("\\codex.exe")) {
    return (
      !windowsCommand.includes("app-server") &&
      !windowsCommand.includes("helper") &&
      !windowsCommand.includes("crashpad")
    );
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessesExit(pids, { timeoutMs = 5000, pollMs = 100 } = {}) {
  const targets = [...new Set((pids || []).filter((pid) => Number.isInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const remaining = targets.filter((pid) => isProcessRunning(pid));
    if (!remaining.length) {
      return { exited: true, remaining: [] };
    }
    await sleep(pollMs);
  }
  const remaining = targets.filter((pid) => isProcessRunning(pid));
  return { exited: remaining.length === 0, remaining };
}

module.exports = {
  detectCodexProcesses,
  findScriptProcessPids,
  forceTerminateProcess,
  isCodexAppProcess,
  isCodexProcessName,
  isProcessRunning,
  listProcessDetails,
  listProcesses,
  terminateProcess,
  waitForProcessesExit,
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
