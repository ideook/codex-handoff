const fs = require("node:fs");
const { configPath, readJsonFile } = require("../service/common");
const { readSecret } = require("./secrets");

function loadConfig(configDir) {
  return readJsonFile(configPath(configDir), {
    schema_version: "1.0",
    default_profile: "default",
    profiles: {},
    repos: {},
    machine_id: null,
  });
}

function loadDefaultR2Profile(configDir) {
  const config = loadConfig(configDir);
  const profileName = config.default_profile || "default";
  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new Error(`Remote profile not found: ${profileName}`);
  }
  return {
    account_id: profile.account_id,
    access_key_id: profile.access_key_id,
    secret_access_key: readSecret(profile.secret_backend, profile.secret_ref, profileName, configDir),
    bucket: profile.bucket,
    endpoint: profile.endpoint,
    region: profile.region || "auto",
    memory_prefix: profile.memory_prefix || "projects/",
  };
}

function saveConfig(configDir, payload) {
  const filePath = configPath(configDir);
  fs.mkdirSync(require("node:path").dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return filePath;
}

module.exports = {
  loadConfig,
  loadDefaultR2Profile,
  saveConfig,
};
