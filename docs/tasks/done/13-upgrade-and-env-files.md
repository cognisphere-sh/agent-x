---
name: upgrade-and-env-files
title: Upgrade a project and its agents, and give the project and each agent one secrets file
description: agentx upgrade-project moves a project to the latest agentx and adds the settings and keys its templates add; agentx upgrade-agent does it for one agent and moves its Pi packages to the template's versions. The coordinator's secrets move from agent-x/.env.services to agent-x/.env, and each agent's keys to its own .env.
type: feature
priority: none
status: done
modules: [cli, cli/project, agent-runtime/agent, agent-runtime/browser, coordinator-runtime]
created: 2026-11-22
updated: 2026-11-22
---

# Upgrade a project and its agents, and give the project and each agent one secrets file

Built on 2026-11-22. The design: [the commands](../../architecture/cli/README.md#commands), [D99](../../architecture/cli/README.md#d99), [D100](../../architecture/cli/README.md#d100), [D43](../../architecture/agent-runtime/agent/README.md#d43) and [D68](../../architecture/coordinator-runtime/README.md#d68).

## What was built

In the commit that adds this task to `done/`.

- **`agentx upgrade-project`** (`src/cli/commands/upgrade-project.ts`). With `agent-x` pinned at a version, it asks pnpm for `agent-x@latest`; when that is newer, it installs it with `pnpm add --save-exact` and runs the new copy's `upgrade-project`. Then it adds to `agentx.json`, `agent-x/.env` and `.gitignore` what their templates have and they lack, and upgrades every agent.
- **`agentx upgrade-agent <name>`** (`src/cli/commands/upgrade-agent.ts`). It adds to `.pi/settings.json` each `agentx` setting the agent lacks, with the template's value, moves each Pi package the agent lists to the template's version, and adds to the agent's `.env` the keys it does not name.
- **`src/cli/template-sync.ts`**: adds missing keys to JSON, missing paragraphs to env files and missing lines to `.gitignore`, and prints each change.
- **Shared with the rest of the CLI.** `copyTemplate` names each template's `env` and `gitignore` files with a dot, for `init-project` and `init-agent` alike. `pinned-cli.ts` runs the installed copy, for D15's hand-over and the upgrade's. `agentFolders` in `project-config.ts` lists the agent folders for the coordinator and the upgrade.
- **One secrets file each.** `agent-x/.env` holds the coordinator's and its services' secrets, which `.env.services` held; the template's `agent-x/env.services` is gone. `init-agent` writes the agent's own `.env` from `templates/agent/env`, with `COMPOSIO_API_KEY` commented out. `agentEnv` and `agentx-browser` read the agent's `.env`, never `agent-x/.env`. `.gitignore` ignores `agent-x/agents/*/.env`.

## Decisions

- [D99](../../architecture/cli/README.md#d99): `upgrade-project` installs the latest agentx, and the new copy brings the files up to its own templates.
- [D100](../../architecture/cli/README.md#d100): an upgrade adds what the templates have and the files lack, and changes no value.
- [D43](../../architecture/agent-runtime/agent/README.md#d43), rewritten: each agent's keys go in its own `.env`.
- [D68](../../architecture/coordinator-runtime/README.md#d68), rewritten: the services' secrets are in `agent-x/.env`.

## Changes from the plan

- **Packages are bumped, never added.** The template's packages are a start the developer changes, so a package the agent does not list stays out.
- **Only config files are added.** `workflows.json`, `schedules.json` and `mcp.json` stay files of their own, and are not written again when missing.

## Migration

For a project made before this change:

1. Run `agentx upgrade-project` first. It adds `agent-x/agents/*/.env` to `.gitignore`, so no agent's keys are committed, writes each agent's `.env` when missing, and adds the settings the agents lack. Check `git diff`. Until then, an `.env` that `init-agent` or `upgrade-agent` writes in the project is not ignored.
2. Move the agents' keys, such as `COMPOSIO_API_KEY`, from `agent-x/.env` into each agent's `agent-x/agents/<name>/.env`. Each agent that uses Composio needs the key in its own file.
3. Move the lines of `agent-x/.env.services` into `agent-x/.env`, and delete `.env.services`.

Afterwards an agent no longer sees `agent-x/.env`: a key left there reaches the coordinator only. A service whose secret is still in `.env.services` is off, and `agentx serve` says why.

## Verification

- `pnpm test`, with `test/upgrade.test.mjs`: with a `link:` pin, `upgrade-project` adds the missing `agentx` settings inside objects and keeps every value; moves `pi-web-access` to the template's version and adds no package; writes a missing agent `.env`; appends to `agent-x/.env` the coordinator's keys it lacks, and not one it sets; adds the `.gitignore` line; and changes nothing on a second run. With a version pinned and a stand-in `pnpm` that names a newer latest, it installs that version with `pnpm add --save-exact`, runs the installed copy, which finds itself the latest, and brings the files up to date; with no pnpm on the PATH, it fails at `pnpm view`. `upgrade-agent` upgrades one agent, and refuses one the project does not have. `test/composio.test.mjs`: the agent's `.env` gives it `COMPOSIO_API_KEY`, and `agent-x/.env` does not. The coordinator's tests read the services' secrets from `agent-x/.env`.
- Not checked: the real registry and a real install. `agent-x` is not on npm yet, and the tests have no network.

## Follow-ups

- Check `upgrade-project` against the registry once `agent-x` is published.

## Original plan

The request: add `upgrade-project` and `upgrade-agent`, which move to the latest version and add the settings and files a new version adds. One settings file and one secrets file for the project, and one of each for each agent; no file per service. Secrets in `.env`, config in a file.

The answers to the questions asked before building:

- The coordinator's secrets must not reach the agents: each agent gets its own `.env`.
- `upgrade-agent` also moves the agent's Pi packages to the versions the template pins.
- The agent's settings file stays `.pi/settings.json`; `workflows.json`, `schedules.json` and `mcp.json` stay apart.
