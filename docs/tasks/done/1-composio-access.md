---
name: composio-access
title: Give each agent its own access to external services through Composio
description: Every agent gets Composio's tools under a Composio user id of its own, a Composio session per thread, and a policy from its settings; checked against Composio with a real model.
type: feature
priority: none
status: done
modules: [agent-runtime/pi/pi-package/composio, agent-runtime/pi/pi-package, agent-runtime/agent, cli]
created: 2026-11-12
updated: 2026-11-15
---

# Give each agent its own access to external services through Composio

Built on 2026-11-13. This record holds what stands at release. The design: [Composio](../../architecture/agent-runtime/pi/pi-package/composio/README.md).

## What was built

- **The Composio extension** (`src/agent-runtime/pi/pi-package/extensions/composio/index.ts`). On `session_start` it finds the thread's Composio session in its Pi session, or creates one, and registers its MCP server with direct tools. When anything is missing or fails, a `composio` section of the system prompt says why.
- **`init-agent`** writes the agent's Composio user id, `<agent>@<project>`.
- **Defaults** for every agent's policy: eight toolkits (Gmail, Google Calendar, Drive, Sheets, Docs, Supabase, HubSpot, Telegram), connection requests on, account removal off, no remote sandbox. An agent's `session` settings go over them key by key.
- **The harness prompt's "External services" section**, with only the rules Composio's tool descriptions do not give.
- **Start-up order.** A session takes events only once every extension has started, and the Pi package's manifest fixes the extensions' load order.
- **`agent-x/.env`** gives every agent of a project its keys; a variable in the environment wins.

## Decisions

[D38](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d38) to [D41](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d41), [D42](../../architecture/agent-runtime/pi/pi-package/README.md#d42), [D43](../../architecture/agent-runtime/agent/README.md#d43) and [D44](../../architecture/agent-runtime/pi/pi-package/event-queue/README.md#d44).

## Changes from the plan

- The plan's user id was `<project>:<agent>`; Composio suggests ids shaped like an email address, so it is `<agent>@<project>`.
- The plan's default policy was the whole catalog; it is eight toolkits.

## Migration

- None: no project predates this release.

## Verification

- `test/composio.test.mjs`, against `test/fake-composio.mjs`: the first event sees the tools while Composio answers slowly, a thread's session is reused and renewed, settings merge over the defaults, a refused key, an unreachable Composio, no key, a session that does not hold its thread writes nothing, `agent-x/.env`, and an agent's own extension that awaits in `session_start`.
- Against a live Composio project on 2026-11-13: sessions with the defaults; Pi declared the four meta tools at the first prompt; `COMPOSIO_MANAGE_CONNECTIONS` returned a Connect Link; an agent with a real model connected Gmail and sent an email; `manage_connections` turned requests and removal off; the scoped key worked and was refused elsewhere.

## Follow-ups

- Connect Links through a channel to a person, such as [Telegram](6-telegram.md). Until then, connect an unattended agent's accounts ahead of time in `agentx chat`.
- [Webhooks and Composio triggers](../backlog/composio-service.md).
- Keeping the key from the agent, with sandboxes.
- Several accounts of one toolkit (`multi_account`): not looked at.

## Original plan

- With Composio, every agent gets its own access to external services. Its settings decide which services it may use and whether it may ask a person to connect new accounts.
