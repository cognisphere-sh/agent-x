---
name: knowledge-in-pi
title: Keep each agent's knowledge in its checked-in .pi/knowledge/, one source that the agent and its developer both write
description: Prompt text, skills, extensions, the router, workflows, schedules and webhooks are kept in one checked-in .pi/knowledge/, a folder per kind, which the agent and its developer both write; storage/ keeps only state and working files.
type: feature
priority: none
status: done
modules: [agent-runtime/agent, agent-runtime/events, agent-runtime/workflows, agent-runtime/pi/pi-package, coordinator-runtime/services/scheduler, coordinator-runtime/services/webhooks]
created: 2026-11-23
updated: 2026-11-23
---

# Keep each agent's knowledge in its checked-in .pi/knowledge/, one source that the agent and its developer both write

## What was built

- **The template** (`templates/agent/.pi/`): `settings.json` and `mcp.json`, and `knowledge/` with `system_prompt/1-role.md`, `skills/`, `extensions/`, `router/event_router.ts`, `workflows/workflows.json`, `schedules/schedules.json` and `webhooks/webhooks.json`. The settings list `knowledge/extensions`, `knowledge/skills` and, under `agentx.systemPrompt`, `knowledge/system_prompt`.
- **One source per kind**: `workflows.ts`, the `EventRouter` and the scheduler read one file each, and the code and messages for "the agent's wins on a name in both" are gone. The router's log is `router-logs/<event id>.log`.
- **Webhooks** (`hooks.ts`) are kept in `.pi/knowledge/webhooks/webhooks.json`, tokens included; their logs stay in `storage/workspace/webhook-logs/`.
- **The system prompt extension** reads only the `agentx.systemPrompt` folders, as `agentx-knowledge-<file>`; `agentx-identity-` is gone. **The skills extension** reads only the folders of the `skills` setting, with no developer's folder last.
- **The memory index** is `storage/memory/index.db`: it is built from the sessions, so it is state.
- **`ensureStorage`** makes only `workspace/`.
- **The harness prompt**: `preamble.md`, `2-files.md` (the knowledge is the agent's and its developer's, checked in, with no secret in it; the rest of `.pi/` is read-only), `3-learning.md` (the agent and its developer own every item alike and change it in place, never with an overriding copy; the knowledge's places and nothing else there: what holds in every conversation is a note, what holds only for some task or situation a skill, with its data in the skill's folder; and an extension, tried with `agentx chat --thread-id extension-check -e <file>` first) and `5-failures.md`. The `routing`, `workflows`, `schedules` and `webhooks` skills are at version 2.
- Not committed yet.

## Decisions

- [D35](../../architecture/agent-runtime/agent/README.md#d35): the agent's knowledge is `.pi/knowledge/`, one checked-in source that the agent and its developer both write.
- [D51](../../architecture/agent-runtime/events/README.md#d51): one router, which the agent and its developer both write, called in a child process.
- [D52](../../architecture/agent-runtime/workflows/README.md#d52): workflows are listed in one `workflows.json`.
- [D101](../../architecture/coordinator-runtime/services/webhooks/README.md#d101): a webhook's token is in the knowledge, in git.
- D4, D64, D73 and D96 are reworded for one source.

## Choices made with the user

- **Webhook tokens are checked in** with their webhooks, so a clone or a deploy keeps every URL; whoever reads the repository can call them.
- **The agent may write extensions.** The harness prompt says that a broken one stops every later session, and how to try one first.
- **The router** is `router/event_router.ts`, a folder like every other kind; the request did not name it.

## Migration

- **The prompt changes for every agent** at its next run: `agentx-identity-<file>` sections become `agentx-knowledge-<file>`.

## Verification

- `test/runner.test.mjs`: a new agent's `.pi/knowledge/` has a folder per kind, empty lists, and git ignores none of it; the settings list the knowledge's folders; a skill, an extension and notes there load, in index order after the template's role; storage holds only `workspace/`; a prompt folder of the settings that is a file gives `agentx-knowledge-unreadable`.
- `test/agentx-run.test.mjs`: one router; nothing or no router sends to `main`; failures name `.pi/knowledge/router/event_router.ts` and log to `router-logs/<id>.log`.
- `test/context.test.mjs`: a skill written during a session shows at the next run; one named like agentx's is left out.
- `test/coordinator.test.mjs`: schedules, workflows and webhooks from `.pi/knowledge/`.
- By hand, in a scratch project: `agentx chat --thread-id extension-check -e <file> -p 'Say ok.'` exits 1 with Pi's error for a broken extension and 0 for a good one. With `--no-session` the event queue extension refuses the session, so the prompt names a thread.
- `pnpm run check`; `pnpm test`: 124 of 124 in the last of three runs. The first two each failed "an agentx run that is killed takes its sessions with it…" with the event still in flight, the rare failure its own comment names and task 14 saw; it passed 3 of 3 alone and in 2 of 2 runs of its file. The suite without this change passed 2 of 2.

## Follow-ups

- Nothing commits what the agent writes on a server: a deploy that replaces the checkout drops it.
- [Memory](../backlog/memory.md): decide whether memories go in `.pi/knowledge/` as files.

## Original plan

The user asked: keep the agent's knowledge in one source, checked in and kept by both the agent and its developer, in `.pi/knowledge/<system_prompt, skills, workflows, webhooks, schedules, extensions>`; update the system prompt, the extensions and the settings template; everything that lasts goes in the knowledge, and `storage/` is only for state and working files.
