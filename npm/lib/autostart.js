const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { resolveConfigDir, runtimeDir } = require("../service/common");

const LAUNCH_AGENT_PREFIX = "com.brdg.codex-handoff";

function autostartPlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "unsupported";
}

function taskName(repoSlug) {
  return `codex-handoff-${repoSlug}`;
}

function launchAgentLabel(repoSlug) {
  const safe = String(repoSlug).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return `${LAUNCH_AGENT_PREFIX}.${safe || "repo"}`;
}

function startupFolderPath() {
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  }
  return path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function launchAgentDirectory() {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

function windowsCommandScriptPath(repoSlug, configDir = resolveConfigDir()) {
  return path.join(runtimeDir(configDir), "autostart", `${repoSlug}.vbs`);
}

function macosCommandScriptPath(repoSlug, configDir = resolveConfigDir()) {
  return path.join(runtimeDir(configDir), "autostart", `${repoSlug}.sh`);
}

function launchAgentPlistPath(repoSlug) {
  return path.join(launchAgentDirectory(), `${launchAgentLabel(repoSlug)}.plist`);
}

function autostartLogPath(repoSlug, configDir = resolveConfigDir()) {
  return path.join(configDir, "logs", `${repoSlug}.log`);
}

function enableAutostart({ repoPath, repoSlug, codexHome, configDir = resolveConfigDir() }) {
  const platform = autostartPlatform();
  if (platform === "windows") return enableWindowsAutostart({ repoPath, repoSlug, codexHome, configDir });
  if (platform === "macos") return enableMacosAutostart({ repoPath, repoSlug, codexHome, configDir });
  throw new Error("Autostart registration is supported on Windows and macOS only.");
}

function disableAutostart(repoSlug, configDir = resolveConfigDir()) {
  const platform = autostartPlatform();
  if (platform === "windows") return disableWindowsAutostart(repoSlug, configDir);
  if (platform === "macos") return disableMacosAutostart(repoSlug, configDir);
  throw new Error("Autostart registration is supported on Windows and macOS only.");
}

function autostartStatus(repoSlug, configDir = resolveConfigDir()) {
  const platform = autostartPlatform();
  if (platform === "windows") return windowsAutostartStatus(repoSlug, configDir);
  if (platform === "macos") return macosAutostartStatus(repoSlug, configDir);
  return { task_name: taskName(repoSlug), enabled: false, platform: "unsupported", platform_supported: false };
}

function enableWindowsAutostart({ repoPath, repoSlug, codexHome, configDir }) {
  const scriptPath = writeWindowsAutostartScript({ repoPath, repoSlug, codexHome, configDir });
  const name = taskName(repoSlug);
  const result = spawnSync("schtasks", [
    "/Create",
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/TN",
    name,
    "/TR",
    `wscript.exe //B //NoLogo "${scriptPath}"`,
    "/F",
  ], { encoding: "utf8" });
  if (result.status === 0) {
    const startupPath = path.join(startupFolderPath(), `${repoSlug}.vbs`);
    if (fs.existsSync(startupPath)) fs.rmSync(startupPath, { force: true });
    return {
      task_name: name,
      script_path: scriptPath,
      enabled: true,
      method: "task-scheduler",
      platform: "windows",
      platform_supported: true,
    };
  }
  const startupPath = path.join(startupFolderPath(), `${repoSlug}.vbs`);
  fs.mkdirSync(path.dirname(startupPath), { recursive: true });
  fs.writeFileSync(startupPath, fs.readFileSync(scriptPath, "utf8"), "utf8");
  return {
    task_name: name,
    script_path: scriptPath,
    startup_path: startupPath,
    enabled: true,
    method: "startup-folder",
    platform: "windows",
    platform_supported: true,
    scheduler_error: result.stderr?.trim() || result.stdout?.trim() || "Failed to create scheduled task.",
  };
}

function disableWindowsAutostart(repoSlug, configDir) {
  const name = taskName(repoSlug);
  const result = spawnSync("schtasks", ["/Delete", "/TN", name, "/F"], { encoding: "utf8" });
  const scriptPath = windowsCommandScriptPath(repoSlug, configDir);
  const startupPath = path.join(startupFolderPath(), `${repoSlug}.vbs`);
  if (fs.existsSync(scriptPath)) fs.rmSync(scriptPath, { force: true });
  if (fs.existsSync(startupPath)) fs.rmSync(startupPath, { force: true });
  return {
    task_name: name,
    enabled: false,
    deleted: result.status === 0,
    startup_deleted: !fs.existsSync(startupPath),
    platform: "windows",
    platform_supported: true,
  };
}

function windowsAutostartStatus(repoSlug, configDir) {
  const name = taskName(repoSlug);
  const result = spawnSync("schtasks", ["/Query", "/TN", name], { encoding: "utf8" });
  const startupPath = path.join(startupFolderPath(), `${repoSlug}.vbs`);
  const scriptPath = windowsCommandScriptPath(repoSlug, configDir);
  const startupExists = fs.existsSync(startupPath);
  return {
    task_name: name,
    enabled: result.status === 0 || startupExists,
    method: result.status === 0 ? "task-scheduler" : (startupExists ? "startup-folder" : null),
    script_path: scriptPath,
    startup_path: startupPath,
    platform: "windows",
    platform_supported: true,
  };
}

function enableMacosAutostart({ repoPath, repoSlug, codexHome, configDir }) {
  const scriptPath = writeMacosAutostartScript({ repoPath, repoSlug, codexHome, configDir });
  const plistPath = launchAgentPlistPath(repoSlug);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>` +
    `<key>Label</key><string>${xmlEscape(launchAgentLabel(repoSlug))}</string>` +
    `<key>ProgramArguments</key><array><string>${xmlEscape(scriptPath)}</string></array>` +
    `<key>RunAtLoad</key><true/>` +
    `<key>WorkingDirectory</key><string>${xmlEscape(repoPath)}</string>` +
    `<key>ProcessType</key><string>Background</string>` +
    `</dict></plist>\n`;
  fs.writeFileSync(plistPath, plist, "utf8");
  return {
    task_name: launchAgentLabel(repoSlug),
    launch_agent_path: plistPath,
    script_path: scriptPath,
    enabled: true,
    method: "launchd",
    platform: "macos",
    platform_supported: true,
  };
}

function disableMacosAutostart(repoSlug, configDir) {
  const label = launchAgentLabel(repoSlug);
  const plistPath = launchAgentPlistPath(repoSlug);
  const scriptPath = macosCommandScriptPath(repoSlug, configDir);
  const loaded = macosLaunchAgentLoaded(label);
  if (fs.existsSync(plistPath)) {
    runLaunchctl(["bootout", `gui/${process.getuid?.() || 0}`, plistPath]);
    fs.rmSync(plistPath, { force: true });
  }
  if (fs.existsSync(scriptPath)) fs.rmSync(scriptPath, { force: true });
  return {
    task_name: label,
    enabled: false,
    deleted: true,
    was_loaded: loaded,
    launch_agent_deleted: !fs.existsSync(plistPath),
    platform: "macos",
    platform_supported: true,
  };
}

function macosAutostartStatus(repoSlug, configDir) {
  const label = launchAgentLabel(repoSlug);
  const plistPath = launchAgentPlistPath(repoSlug);
  const scriptPath = macosCommandScriptPath(repoSlug, configDir);
  const enabled = fs.existsSync(plistPath);
  return {
    task_name: label,
    enabled,
    method: enabled ? "launchd" : null,
    script_path: scriptPath,
    launch_agent_path: plistPath,
    loaded: enabled ? macosLaunchAgentLoaded(label) : false,
    platform: "macos",
    platform_supported: true,
  };
}

function writeWindowsAutostartScript({ repoPath, repoSlug, codexHome, configDir }) {
  const scriptPath = windowsCommandScriptPath(repoSlug, configDir);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  const command = buildWatchServiceCommand({ configDir, codexHome });
  const commandLine = windowsQuoteArgs(command);
  const body = [
    "Dim shell",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "${vbscriptEscape(commandLine)}", 0, False`,
    "",
  ].join("\r\n");
  fs.writeFileSync(scriptPath, body, "utf8");
  return scriptPath;
}

function writeMacosAutostartScript({ repoPath, repoSlug, codexHome, configDir }) {
  const scriptPath = macosCommandScriptPath(repoSlug, configDir);
  const logPath = autostartLogPath(repoSlug, configDir);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const command = buildWatchServiceCommand({ configDir, codexHome });
  const lines = [
    "#!/bin/sh",
    `export CODEX_HANDOFF_CONFIG_DIR=${shellQuote(configDir)}`,
    `export CODEX_HOME=${shellQuote(codexHome)}`,
    `cd ${shellQuote(repoPath)}`,
    `exec ${command.map((part) => shellQuote(part)).join(" ")} >> ${shellQuote(logPath)} 2>&1`,
    "",
  ];
  fs.writeFileSync(scriptPath, lines.join("\n"), "utf8");
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function buildWatchServiceCommand({ configDir, codexHome }) {
  const packageRoot = path.resolve(__dirname, "..", "..");
  return [
    process.execPath,
    path.join(packageRoot, "npm", "service", "watch_service.js"),
    "--config-dir",
    configDir,
    "--codex-home",
    codexHome,
  ];
}

function runLaunchctl(args) {
  return spawnSync("launchctl", args, { encoding: "utf8" });
}

function macosLaunchAgentLoaded(label) {
  const uid = process.getuid?.() || 0;
  const result = runLaunchctl(["print", `gui/${uid}/${label}`]);
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function windowsQuoteArgs(parts) {
  return parts.map((part) => {
    const text = String(part);
    if (!/[\s"]/u.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
  }).join(" ");
}

function vbscriptEscape(value) {
  return String(value).replace(/"/g, '""');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  autostartStatus,
  disableAutostart,
  enableAutostart,
};
