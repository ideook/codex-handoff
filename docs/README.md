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

- [Global Watcher Architecture](global-watcher-architecture.md)
  background watcher model and repo routing
- [Thread Sync Design](thread-sync-design.md)
  thread bundle sync model and remote layout

## Reference

- [Handoff JSON Schema](../schemas/handoff.schema.json)
