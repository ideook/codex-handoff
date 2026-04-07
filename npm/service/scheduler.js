class RepoSyncScheduler {
  constructor({ debounceMs, runSync, logger }) {
    this.debounceMs = debounceMs;
    this.runSync = runSync;
    this.logger = logger;
    this.entries = new Map();
  }

  enqueue(repo, payload = null) {
    const key = repo.normalizedPath;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        repo,
        timer: null,
        running: false,
        dirty: false,
        pending: null,
      };
      this.entries.set(key, entry);
    } else {
      entry.repo = repo;
    }

    entry.pending = mergePayload(entry.pending, payload);

    if (entry.running) {
      entry.dirty = true;
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.#runEntry(entry);
    }, this.debounceMs);
  }

  snapshot() {
    return Array.from(this.entries.values()).map((entry) => ({
      repoPath: entry.repo.repoPath,
      repoSlug: entry.repo.repoSlug,
      running: entry.running,
      dirty: entry.dirty,
      waiting: Boolean(entry.timer),
      pendingChanges: Array.isArray(entry.pending?.changes) ? entry.pending.changes.length : 0,
    }));
  }

  async dispose() {
    for (const entry of this.entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.entries.clear();
  }

  async #runEntry(entry) {
    if (entry.running) {
      entry.dirty = true;
      return;
    }
    entry.running = true;
    entry.dirty = false;
    const pending = entry.pending;
    entry.pending = null;
    try {
      this.logger?.(`sync start ${entry.repo.repoPath}`);
      await this.runSync(entry.repo, pending);
      this.logger?.(`sync finish ${entry.repo.repoPath}`);
    } catch (error) {
      this.logger?.(`sync error ${entry.repo.repoPath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      entry.running = false;
      if (entry.dirty) {
        entry.dirty = false;
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void this.#runEntry(entry);
        }, this.debounceMs);
      }
    }
  }
}

module.exports = {
  RepoSyncScheduler,
};

function mergePayload(existing, incoming) {
  if (!existing) return clonePayload(incoming);
  if (!incoming) return existing;
  const next = {
    changes: [...(existing.changes || [])],
  };
  for (const change of incoming.changes || []) {
    next.changes.push(change);
  }
  return next;
}

function clonePayload(payload) {
  if (!payload) return null;
  return {
    changes: [...(payload.changes || [])],
  };
}
