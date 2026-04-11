# Thread Sync Design

This document defines the current thread sync architecture for `codex-handoff`.

## Scope

This document covers thread payload sync only.

Repo memory is defined separately in
[Repo Memory Design](repo-memory-design.md).

## Local Layout

Thread payloads are split by role under `.codex-handoff/`:

```text
.codex-handoff/
  repo.json
  memory.md
  memory-state.json
  sync-state.json
  synced-threads/
    latest.md
    handoff.json
    thread-index.json
    current-thread.json
    threads/
      <thread-id>.jsonl
      <thread-id>.rollout.jsonl.gz
  local-threads/
    latest.md
    handoff.json
    thread-index.json
    current-thread.json
    threads/
      <thread-id>.jsonl
      <thread-id>.rollout.jsonl.gz
```

Meaning:

- `synced-threads` stores pulled thread payloads used for restore reads.
- `local-threads` stores locally produced thread payloads used for push.
- root files store repo control-plane state and repo memory.

## Remote Layout

The remote bucket remains repo-oriented:

```text
repos/<repo-slug>/
  repo.json
  sync-state.json
  machine-sources/
    <machine-id>/
      threads/
        <thread-id>.jsonl
        <thread-id>.rollout.jsonl.gz
```

Meaning:

- remote root stores repo-level control state
- machine-specific thread payloads live under `machine-sources/<machine-id>/`

## Push Model

On the producing machine:

1. Discover repo-related Codex threads from local SQLite and session index data.
2. Export normalized transcript bundles into `.codex-handoff/local-threads/threads/`.
3. Update `.codex-handoff/local-threads/thread-index.json` and `.codex-handoff/local-threads/current-thread.json`.
4. Upload local thread payloads to `repos/<repo-slug>/machine-sources/<machine-id>/threads/`.
5. Do not summarize or upload repo memory during sender-side thread sync.

## Pull Model

On the consuming machine:

1. Push existing local thread payloads to remote as startup recovery.
2. Pull remote thread payloads from all machines into `.codex-handoff/synced-threads/`.
3. Rebuild `synced-threads/thread-index.json` and `synced-threads/current-thread.json`.
4. Import the selected thread into local Codex state when requested by the flow.

## Reader Model

Default restore reads use:

- root `memory.md`
- `synced-threads/thread-index.json`
- specific files under `synced-threads/threads/` when deeper evidence is needed

Default restore reads must not depend on `local-threads`.

## Non-Goals

This design does not:

- sync arbitrary repo files
- use SQLite as the remote source of truth
- treat repo memory as thread payload data
