# Docs

This directory holds the deeper implementation and operating notes for
`codex-handoff`.

Start here when the main README is not enough.

## Product And Usage

- [Command Reference](command-reference.md)
  concise command surface for day-to-day use
- [Operations Guide](operations-guide.md)
  runtime, lifecycle, logs, and troubleshooting
- [Agent Install UX](agent-install-ux.md)
  installation contract, lifecycle expectations, and operating model
- [Prompt Pack](agent-install-prompts.md)
  short user-facing prompts that Codex should understand
- [npm Installer Spec](npm-installer-spec.md)
  packaging and install behavior details

## Sync And Runtime Design

- [Read/Write Role Design](read-write-role-design.md)
  local separation between readable synced thread payloads and writable local thread payloads
- [Repo Memory Design](repo-memory-design.md)
  root-only placement and lifecycle rules for repo-level memory
- [Global Watcher Architecture](global-watcher-architecture.md)
  background watcher model and repo routing
- [Thread Sync Design](thread-sync-design.md)
  thread bundle sync model and remote layout
- [Receiver-Side Memory Implementation Design](receiver-memory-implementation-design.md)
  keep/remove/add implementation plan for sender uploads and consumer-side memory

## Reference

- [Handoff JSON Schema](../schemas/handoff.schema.json)
