# Global Watcher Architecture

## Goal

Replace per-repo polling watchers with one global watcher process.

The watcher monitors the Codex sessions store and routes rollout changes to
managed `codex-handoff` repos on the current machine.

## Design principles

- One watcher process per user config directory.
- No polling of repo state every N seconds.
- Watch only `~/.codex/sessions/**`.
- Do not watch `session_index.jsonl`, `.codex-global-state.json`, or SQLite
  files.
- Do not use SQLite for project routing when rollout files already contain the
  required metadata.
- Treat imported cross-machine rollout files with foreign `cwd` values as
  non-local and do not route them unless they match a managed local path.
- Reuse existing `sync now` behavior for post-processing in the first
  implementation.

## Inputs

### Watched input

- `~/.codex/sessions/**/rollout-*.jsonl`

### Read-only lookup input

- `~/.codex-handoff/config.json`

The watcher reads managed repo roots from `config.json.repos`.

## Why rollout files are enough

Each rollout file starts with a `session_meta` record that already includes:

- `payload.id`
- `payload.cwd`
- `payload.git.repository_url`

For local routing, `payload.cwd` is sufficient. The watcher intentionally uses
exact-or-descendant local path matching instead of Git origin fallback so that
imported foreign-machine sessions do not immediately re-trigger sync.

## Routing model

1. A session rollout file is created or updated.
2. The watcher debounces and coalesces raw file events.
3. For each changed rollout file:
   - read the first non-empty JSONL record
   - require `type == "session_meta"`
   - extract `payload.cwd`
4. Normalize the rollout `cwd`.
5. Load managed repos from `config.json`.
6. Find the longest managed repo path that is:
   - exactly equal to the rollout `cwd`, or
   - an ancestor of the rollout `cwd`
7. If no managed repo matches, ignore the event.
8. If a managed repo matches, enqueue that repo for sync.

## Scheduler model

The watcher maintains one scheduler entry per managed repo:

- `pendingPaths`: changed rollout paths observed for that repo
- `debounceTimer`: waits for a quiet period before running sync
- `running`: whether a sync is currently active
- `dirty`: whether more changes arrived while a sync was active

Behavior:

1. Changes for the same repo reset the debounce timer.
2. When the timer fires, the watcher starts one `sync now` subprocess for that
   repo.
3. If more changes arrive while sync is running, set `dirty = true`.
4. When the subprocess exits:
   - if `dirty == true`, clear it and run one more sync
   - otherwise go idle

This gives repo-level single-flight execution with burst coalescing.

## Process model

### Global watch service

Implemented in Node.

Responsibilities:

- subscribe to `~/.codex/sessions`
- debounce/coalesce file events
- route rollout changes to managed repos
- launch repo sync subprocesses
- maintain a single global PID/state file

### Existing sync engine

The first implementation reuses the current `codex-handoff --repo <repo> sync now`
command as the sync worker.

This keeps remote sync semantics unchanged while removing the per-repo polling
watch loop.

## Cross-platform watcher choice

Use `@parcel/watcher`:

- recursive native watching on macOS and Windows
- event coalescing/throttling built in
- good behavior on large directory trees

Do not use raw `fs.watch()` directly as the primary backend because Node
documents cross-platform caveats and inconsistent event behavior.

## Service state

Use one global runtime state file:

- `~/.codex-handoff/runtime/watch-service.json`

It stores:

- PID
- start time
- config dir
- codex home
- watch root
- currently managed repo count

The service enforces singleton behavior by checking the state file and live PID
before starting.

## Agent and autostart compatibility

- `agent start/status/stop` become wrappers around the global watch service.
- Existing repo-specific autostart entry points may remain, but duplicate starts
  are harmless because the watch service is singleton.

## Non-goals for the first watcher rewrite

- file watching on SQLite databases
- Git-origin fallback routing
- automatic sync triggered by imported foreign-machine sessions
- resumable historical event replay

Those can be added later if they prove necessary.
