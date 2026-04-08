#!/usr/bin/env node

const { stopServicesForPackageInstall } = require("./install-lifecycle");

async function main() {
  try {
    await stopServicesForPackageInstall();
  } catch (error) {
    console.warn(`[codex-handoff] preinstall warning: ${error.message}`);
  }
}

void main();
