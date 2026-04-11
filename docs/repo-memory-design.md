# Repo Memory Design

This document defines the placement and lifecycle rules for repo-level memory in
`codex-handoff`.

## Decision

Use root-only repo memory:

- `.codex-handoff/memory.md`
- `.codex-handoff/memory-state.json`

These files are repo-level rolling summary state.
They are not thread payload files and they are not role-specific caches.

## Why Memory Is Different

Repo memory is a compact working summary.

Unlike `repo.json`, it is not control-plane configuration.
Unlike `latest.md`, `handoff.json`, `thread-index.json`, and `threads/**`, it is
not a role-specific restore payload that must stay separated between reader and
producer stores.

The system is allowed to read a locally generated repo memory file again on the
same machine.

That behavior is intentional because:

- repo memory is designed to be a rolling summary
- new sessions benefit from a single stable bootstrap location
- dual memory copies create more ambiguity than they remove

## Hard Invariants

1. The only canonical local memory files are `.codex-handoff/memory.md` and `.codex-handoff/memory-state.json`.
2. `synced-threads` must not contain `memory.md` or `memory-state.json` in any case.
3. `local-threads` must not contain `memory.md` or `memory-state.json` in any case.
4. Memory summarization must always write to the repo-local root.
5. Pull must not download repo memory from remote.
6. Push must not upload repo memory to remote.
7. Repo memory may be used as an input to later local repo memory summarization runs.

## Local Layout

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

## Read Rules

Default bootstrap may read:

- root `memory.md`
- `synced-threads/latest.md`
- `synced-threads/handoff.json`
- `synced-threads/thread-index.json`
- `synced-threads/threads/**` when deeper evidence is needed

This is an intentional mixed model:

- repo memory is root-only
- thread payload restore data remains role-separated

## Write Rules

### Memory summarization

Memory summarization writes only:

- root `memory.md`
- root `memory-state.json`

The summarizer may read prior root memory plus a selected thread payload source.

Typical input source:

- `synced-threads` for consumer-side local memory refresh

### Pull

Pull writes:

- remote thread payloads into `synced-threads`

Pull does not write repo memory.

### Push

Push uploads:

- thread payloads from `local-threads`

Push does not upload repo memory.

## Non-Goals

This design does not treat repo memory as immutable evidence.

Thread bundles remain the deeper evidence source.
Repo memory is a compact, rolling summary optimized for fast continuation.
