const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readSecret(secretBackend, secretRef, profileName, configDir) {
  if (secretBackend === "macos-keychain") {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-a", profileName, "-s", secretRef, "-w"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to read macOS keychain secret");
    }
    return result.stdout.trim();
  }
  if (secretBackend === "plaintext-file") {
    return fs.readFileSync(secretRef, "utf8");
  }
  if (secretBackend === "windows-dpapi") {
    throw new Error("windows-dpapi secret reading is not yet implemented in Node runtime.");
  }
  throw new Error(`Unsupported secret backend: ${secretBackend}`);
}

function storeSecret(profileName, secret, configDir) {
  if (process.platform === "darwin") {
    const service = `codex-handoff:r2:${profileName}`;
    const result = spawnSync(
      "security",
      ["add-generic-password", "-a", profileName, "-s", service, "-w", secret, "-U"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to store macOS keychain secret");
    }
    return { secret_backend: "macos-keychain", secret_ref: service };
  }
  if (process.platform === "win32") {
    throw new Error("windows-dpapi secret storage is not yet implemented in Node runtime.");
  }
  const secretsDir = path.join(configDir, "secrets");
  fs.mkdirSync(secretsDir, { recursive: true });
  const secretPath = path.join(secretsDir, `${profileName.replaceAll("/", "_")}.txt`);
  fs.writeFileSync(secretPath, secret, "utf8");
  return { secret_backend: "plaintext-file", secret_ref: secretPath };
}

function deleteSecret(secretBackend, secretRef, profileName) {
  if (secretBackend === "macos-keychain") {
    spawnSync("security", ["delete-generic-password", "-a", profileName, "-s", secretRef], { encoding: "utf8" });
    return;
  }
  if (fs.existsSync(secretRef)) {
    fs.rmSync(secretRef, { force: true });
  }
}

module.exports = {
  deleteSecret,
  readSecret,
  storeSecret,
};
