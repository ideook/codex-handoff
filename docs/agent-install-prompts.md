# Prompt Pack

These are short user-facing prompts for Codex when using `codex-handoff`.

The prompts are intentionally brief. Users should not need to know the internal
CLI flow. The skill is responsible for mapping these prompts to `setup`,
`receive`, `sync now`, and explicit watcher automation requests.

## 1. Install If Needed, Then Set Up And Start

Use on any machine when the user wants Codex to make sure the package is
available, then finish repo setup and immediate agent start for the current
project.

Recommended prompt:

```text
Install or upgrade `@brdgkr/codex-handoff` with npm if needed, then set up codex-handoff for this repository and start the agent.
Finish only when setup has completed and the agent is running.
```

Short form:

```text
Install `@brdgkr/codex-handoff` if needed, then set up this repository and start the agent.
```

Use the same prompt on another PC. Plain `setup` already decides whether the
repo needs a pull or a push.

## 2. Set Up And Start For This Repo

Use when the package is already installed and the user wants the repo set up
and the agent started immediately.

```text
Set up codex-handoff for this repository and start the agent.
Finish only when setup has completed and the agent is running.
```

## 3. Set Up This Repo Without Starting The Agent

Use when the package is already installed and the user wants repo setup only,
without immediate background sync.

```text
Set up codex-handoff sync for this repository, but do not start the agent yet.
```

## 4. Sync This Repo

Use when the repo is already set up and the user wants a one-shot sync.

```text
Sync this repository with codex-handoff.
```

## 5. Update Package And Reconcile

Use after npm reinstall or upgrade.

```text
I updated codex-handoff. Reconcile this repository so it works again.
```

## 6. Enable Push Automation

Use only when the repo is already attached and the user explicitly wants ongoing
background sync.

```text
Enable codex-handoff push automation for this repository.
```

## 7. Disable Push Automation

```text
Disable codex-handoff push automation for this repository.
```

## 8. Remove From This Repo

Use when the user wants to detach this repo from codex-handoff management.

```text
Detach this repository from codex-handoff.
```

## Intent Mapping Notes

For maintainers reviewing this file:

- install + start prompt: npm install or upgrade if needed, then plain `setup`
- repo setup + start prompt: plain `setup`
- repo setup only prompt: `setup --skip-agent-start --skip-autostart`
- sync prompt: `setup --skip-agent-start --skip-autostart` when unattached, `sync now` when already attached, `receive` when cross-machine resume is clear
- update prompt: package reinstall/upgrade lifecycle, then `setup`
- enable automation prompt: `agent enable` then `agent start`
- disable automation prompt: `agent stop`, optionally `agent disable`
- remove prompt: `detach`
