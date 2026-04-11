# codex-handoff

> Keep Codex work portable across machines, repos, and sessions.

![node >=18](https://img.shields.io/badge/node-%E2%89%A518-2f6f44)
![backend cloudflare r2](https://img.shields.io/badge/backend-Cloudflare%20R2-f48120)
![platform macOS windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-4b5563)
![license mit](https://img.shields.io/badge/license-MIT-111827)

`codex-handoff` watches repo-related Codex sessions, builds repo-scoped handoff
memory under `.codex-handoff/`, and syncs that state to a remote backend so you
can resume on another machine with the right context already in place.

Codex is OpenAI's coding agent. OpenAI describes Codex as "a coding agent that
helps you build and ship with AI—powered by ChatGPT" and the Codex app as "a
command center for agentic coding." Download and learn more at
[openai.com/codex](https://openai.com/codex/) or read
[Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/).

## Why

- repo-scoped instead of one giant session pool
- built for one-person, cross-machine handoff
- background sync while Codex is open
- thread payloads preserved separately under `.codex-handoff/synced-threads/` and `.codex-handoff/local-threads/`
- Cloudflare R2 support out of the box

## Start With Codex

The easiest way to use `codex-handoff` is to tell Codex what you want in plain
language.

Open the Codex app in the project you want to manage, make sure that project is
the current workspace/cwd, and paste one of these prompts into the Codex chat.

Install if needed, then set up and start:

```text
Install or upgrade `@brdgkr/codex-handoff` with npm if needed, then set up codex-handoff for this repository and start the agent.
Finish only when setup has completed and the agent is running.
```

Set up and start when the package is already installed:

```text
Set up codex-handoff for this repository and start the agent.
Finish only when setup has completed and the agent is running.
```

Set up this repo without starting the agent yet:

```text
Set up codex-handoff sync for this repository, but do not start the agent yet.
```

Use the same setup-and-start prompt on another PC. `codex-handoff setup`
chooses pull or push automatically for the current repo state.

Run a one-shot sync:

```text
Sync this repository with codex-handoff.
```

Enable background sync:

```text
Enable codex-handoff push automation for this repository.
```

Detach this repo:

```text
Remove codex-handoff from this repository.
```

## Remote Backend

The first supported backend is Cloudflare R2.

After the npm package is installed, `setup` needs valid R2 credentials for the
current repo. The two simplest auth paths are:

Prompt-friendly auth path:

```bash
codex-handoff remote login r2 --from-clipboard
codex-handoff setup
```

File-based auth path:

```bash
codex-handoff remote login r2 --dotenv ./.codex-handoff/.env.local
codex-handoff setup
```

## How It Works

`codex-handoff` keeps three main kinds of runtime state plus optional derived
artifacts:

- `.codex-handoff/synced-threads/`
  pulled thread payloads used for default restore reads, including
  `current-thread.json`, `thread-index.json`, and `threads/`
- `.codex-handoff/local-threads/`
  local thread payloads prepared for push
- `.codex-handoff/repo.json`
  repo-local control-plane state
- optional derived files such as `.codex-handoff/memory.md`
  manually generated repo memory artifacts that are not part of the default
  bootstrap read path

Background sync is driven by a global watcher:

- it watches `~/.codex/sessions/**`
- routes rollout changes to the matching repo using `session_meta.payload.cwd`
- writes producer-side thread updates into `.codex-handoff/local-threads/`
- pushes local thread payloads to the configured remote prefix
- keeps running while the Codex app process is alive, including background window-hidden states
- keeps pulled remote thread state under `.codex-handoff/synced-threads/` as the default thread read cache

Restore read flow:

- Producer PC watches Codex rollout changes and extracts deterministic thread
  bundles into `.codex-handoff/local-threads/threads/` without using AI.
- Producer PC does not summarize repo memory during conversation or shutdown.
- Producer shutdown does not rewrite `.codex-handoff/local-threads/`.
- Explicit pull flows materialize remote thread state under
  `.codex-handoff/synced-threads/`.
- New Codex sessions should start with
  `.codex-handoff/synced-threads/current-thread.json`.
- Use `.codex-handoff/synced-threads/thread-index.json` to choose a specific
  bundle under `.codex-handoff/synced-threads/threads/` when broader context
  is needed.
- Default bootstrap reads do not depend on root `.codex-handoff/memory.md`.
- Producer-side staged thread payloads are not part of the default bootstrap
  read path.

## Primary Commands

- `setup`
  bootstrap or reconcile a repo
- `receive`
  restore synced work on another machine
- `status`
  inspect local handoff state
- `resume`
  build a restore pack from local handoff state
- `search`
  search raw handoff evidence
- `sync now`
  perform a one-shot export and push
- `uninstall`
  detach the repo from codex-handoff management

Optional manual memory commands remain available, but they are not part of the
default bootstrap flow. For the full command surface, see
[docs/command-reference.md](docs/command-reference.md).

## Docs

- [Prompt Pack](docs/agent-install-prompts.md)
- [Command Reference](docs/command-reference.md)
- [Docs Index](docs/README.md)

## License

MIT
