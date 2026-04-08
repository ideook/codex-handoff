class AgentController {
  constructor({
    detectCodexProcesses,
    performStartupSync,
    activateWatcher,
    deactivateWatcher,
    recordEvent,
    writeState,
    logger,
  }) {
    this.detectCodexProcesses = detectCodexProcesses;
    this.performStartupSync = performStartupSync;
    this.activateWatcher = activateWatcher;
    this.deactivateWatcher = deactivateWatcher;
    this.recordEvent = recordEvent || (async () => {});
    this.writeState = writeState;
    this.logger = logger || (() => {});
    this.codexRunning = false;
    this.busy = false;
    this.watcher = null;
  }

  async initialize() {
    const codexProcesses = await this.detectCodexProcesses();
    this.codexRunning = false;
    await this.enterIdleState({
      phase: "idle",
      codex_processes: codexProcesses,
      watcher: this.watcher,
      codex_running: codexProcesses.length > 0,
    });
  }

  async tick() {
    if (this.busy) {
      return;
    }
    const codexProcesses = await this.detectCodexProcesses();
    const running = codexProcesses.length > 0;
    if (running && !this.codexRunning) {
      this.busy = true;
      try {
        await this.handleCodexStart(codexProcesses);
      } finally {
        this.busy = false;
      }
      return;
    }
    if (!running && this.codexRunning) {
      this.busy = true;
      try {
        await this.handleCodexStop();
      } finally {
        this.busy = false;
      }
      return;
    }
    await this.handleSteadyState(codexProcesses, running);
  }

  async handleCodexStart(codexProcesses) {
    this.logger(`Codex detected (${codexProcesses.length} process(es))`);
    await this.recordEvent("codex_detected", { process_count: codexProcesses.length });
    this.codexRunning = true;
    await this.enterSyncingState({
      phase: "syncing",
      codex_processes: codexProcesses,
      watcher: this.watcher,
      codex_running: true,
    });
    this.logger("starting initial sync");
    const syncResult = await this.performStartupSync();
    this.logger("initial sync finished");
    const codexProcessesAfterSync = await this.detectCodexProcesses();
    if (codexProcessesAfterSync.length > 0) {
      this.watcher = await this.startWatching();
      await this.enterWatchingState({
        phase: "watching",
        codex_processes: codexProcessesAfterSync,
        watcher: this.watcher,
        codex_running: true,
        last_sync: syncResult,
      });
      return;
    }
    this.codexRunning = false;
    await this.enterIdleState({
      phase: "idle",
      codex_processes: [],
      watcher: this.watcher,
      codex_running: false,
      last_sync: syncResult,
    });
  }

  async handleCodexStop() {
    this.logger("Codex no longer detected");
    await this.recordEvent("codex_stopped", {});
    if (this.watcher) {
      await this.stopWatching();
      this.watcher = null;
    }
    this.codexRunning = false;
    await this.enterIdleState({
      phase: "idle",
      codex_processes: [],
      watcher: null,
      codex_running: false,
    });
  }

  async handleSteadyState(codexProcesses, running) {
    if (running && this.watcher) {
      await this.enterWatchingState({
        phase: "watching",
        codex_processes: codexProcesses,
        watcher: this.watcher,
        codex_running: true,
      });
      return;
    }
    await this.enterIdleState({
      phase: "idle",
      codex_processes: codexProcesses,
      watcher: this.watcher,
      codex_running: running,
    });
  }

  async startWatching() {
    return this.activateWatcher();
  }

  async stopWatching() {
    return this.deactivateWatcher();
  }

  async enterIdleState(payload) {
    await this.writeState(payload);
  }

  async enterSyncingState(payload) {
    await this.writeState(payload);
  }

  async enterWatchingState(payload) {
    await this.writeState(payload);
  }
}

module.exports = {
  AgentController,
};
