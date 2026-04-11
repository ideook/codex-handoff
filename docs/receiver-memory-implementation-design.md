# Receiver-Side Memory Implementation Design

This document defines the implementation plan for `codex-handoff` runtime sync
and memory behavior.

## Final Decision

`codex-handoff` keeps real-time thread payload uploads on the sending machine,
but repo memory becomes a local consumer cache.

The Codex app staying alive in the background still counts as running.
Only actual process exit ends the active sender session.

## Keep

- watcher-driven incremental extraction into `.codex-handoff/local-threads/`
- watcher-driven remote upload of thread payloads into
  `repos/<repo-slug>/machine-sources/<machine-id>/threads/*.jsonl`
- machine-specific remote storage for thread payloads
- root-only local `memory.md` and `memory-state.json`
- startup pull of remote thread payloads into `.codex-handoff/synced-threads/`

## Remove

- producer-side memory summarization during shutdown
- producer-side memory upload to remote
- remote shared-root memory as a source of truth
- shutdown logic that depends on memory summarize completing before exit
- migration and compatibility code for older thread bundle formats and layouts

## Add

- startup recovery push of existing local thread payloads before pull
- pull of all machine thread payloads, including the current machine, into
  `synced-threads`
- consumer-side local memory refresh from `synced-threads`
- explicit memory refresh on consumer flows such as:
  - `receive`
  - `sync pull`
  - `setup` when it performs a pull

## Runtime Rules

### During conversation

- local thread payloads may be updated continuously
- watcher may upload thread payloads continuously
- repo memory must not be summarized
- repo memory must not be uploaded

### On Codex app stop

- stop the watcher
- do not rewrite `local-threads`
- do not summarize repo memory
- do not upload repo memory

### On OS shutdown or forced process termination

- the system must not block shutdown
- no shutdown path may depend on memory summarize
- unsent local thread payloads remain in `local-threads`

### On next startup

- push any existing local thread payloads to remote as recovery
- pull remote thread payloads into `synced-threads`
- do not summarize memory inside background startup sync
- refresh memory only in explicit pull flows

## Memory Semantics

- `memory.md` is a local consumer cache
- `memory.md` is generated from `synced-threads`
- `memory.md` is not a remote shared artifact
- `memory.md` may be regenerated whenever consumer-side read flows require it

## Verification Targets

1. watcher still uploads thread payloads to `machine-sources`
2. shutdown no longer summarizes or uploads memory
3. pull no longer downloads remote memory
4. explicit pull flows regenerate local root memory from `synced-threads`
5. remote thread payloads for the current machine are visible in
   `synced-threads` after pull
