---
name: agent-browser
title: Give every agent a browser that stays signed in
description: Agents use websites through agent-browser on profiles in their storage, from bash with agentx-browser, taught by a skill of agentx's Pi package.
type: feature
priority: none
status: done
modules: [agent-runtime/browser, agent-runtime/pi/pi-package]
created: 2026-11-16
updated: 2026-11-16
---

# Give every agent a browser that stays signed in

Built on 2026-11-16. The design: [browser](../../architecture/agent-runtime/browser/README.md).

## What was built

In the commit that adds this task to `done/`.

- **The dependency.** `agent-browser` 0.43.0, exact. Its install script is not run (`allowBuilds` in `pnpm-workspace.yaml`): its launcher links the native binary on the first run.
- **`src/agent-runtime/browser/`.** `agent-browser.ts` runs agent-browser on one profile, with the agent's namespace and folders; `browser-command.ts` is `agentx-browser`, a second executable of the package.
- **The browser skill**, `pi-package/skills/browser/SKILL.md`, which the manifest now lists.

## Decisions

- [D78](../../architecture/agent-runtime/browser/README.md#d78): an agent's browser is the agent-browser agentx pins, run with `agentx-browser`.
- [D79](../../architecture/agent-runtime/browser/README.md#d79): a profile is a Chrome profile in the agent's storage, and one browser.

## Changes from the plan

- **`agentx-browser`, not `agentx browser`.** The CLI is for people, so the agent's command is an executable of its own, built from `src/agent-runtime/browser/`. A script in the skill's folder was not used: plain `node` cannot load agentx's TypeScript the way Pi does.
- **Sockets outside `storage/`.** The plan had all browser data in `storage/workspace/browser/`. Profiles, downloads and screenshots are there; agent-browser's sockets and its own state are in `~/.agent-browser/namespaces/agentx-<hash>/`, as a socket path in `storage/` passes the 104-byte limit.
- **No domain allowlist.** agent-browser refuses its allowlist with a profile, so staying signed in won over it.
- **No remote sign-in.** The plan had a person sign in on an agent's browser in the cloud through a link: a coordinator service relaying agent-browser's live view over a WebSocket. It was built, then taken out at the user's request, to give the agent access to the browser only for now. Decision numbers D80 and D81 went with it.

## Migration

- Nothing to change in a project or an agent. Every agent gets the skill.
- Chrome is downloaded on first use, into `~/.agent-browser/browsers/`. On Linux, Chrome's system libraries need `agentx-browser install --with-deps` as root; on Linux ARM64, a system Chromium and `AGENT_BROWSER_EXECUTABLE_PATH`.
- A project installed with pnpm 11 needs `agent-browser: false` under `allowBuilds` in `agent-x/pnpm-workspace.yaml`, as it needs Pi's `@google/genai` and `protobufjs`; otherwise `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`. The project template does not have that file yet.

## Verification

- `pnpm test`: `agentx-browser` refuses to run outside the agent's processes and for an agent that does not exist, takes a plain profile name, and its guide comes from the pinned agent-browser; the model's bash runs it as the agent; the skill is in the system prompt.
- By hand on macOS, with Chrome 157: a cookie and local storage last across a browser's restart in a profile folder; agent-browser's background process outlives a killed process group, as when Pi's bash tool ends a command.
- From a packed tarball installed with pnpm: `agentx-browser` is linked into `node_modules/.bin`, runs from `agent-x/` with the agent's variables, and makes the agent's storage.
- In Docker, Linux x86-64: `install --with-deps`, a headless launch as root, and a cookie across a restart. Linux ARM64 has no Chrome for Testing.
- **Not checked by hand:** a sign-in to a real site that stays across runs of the agent.

## Original plan

The request: give an agent access to a browser, so it can use the internet, sign in to apps and do tasks there, and stay signed in; minimal, light, fast, secure, used from bash. Compared moli, Lightpanda and agent-browser; picked agent-browser. Then: a skill and a script; several profiles per agent, `default` unless the task needs another, which the agent makes; browser data in `storage/workspace/browser/`; and, since agents run in the cloud, a person signs in through a unique link to the remote browser and controls it there. Staying signed in was chosen over agent-browser's domain allowlist, and the limits of encryption at rest were accepted.
