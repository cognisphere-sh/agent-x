---
name: coordinator-events-storage-router-workflows
title: Coordinator, events, storage, router and workflows
description: agentx serve runs every agent of a project and is the only way events reach an agent; each agent sends through its outbox; state lives in agent-x/storage/; two routers place events; workflows report through the outbox.
type: feature
priority: none
status: done
modules: [coordinator-runtime, agent-runtime/events, agent-runtime/agent, agent-runtime/workflows, agent-runtime/supervisor, agent-runtime/pi/pi-package, cli]
created: 2026-11-13
updated: 2026-11-15
---

# Coordinator, events, storage, router and workflows

Built from 2026-11-13 to 2026-11-15, on top of [`agentx run`](2-agentx-run.md). This record holds what stands at release, in place of the thirteen tasks it merges (their plans are [below](#original-plans)). The design: [coordinator](../../architecture/coordinator-runtime/README.md), [events](../../architecture/agent-runtime/events/README.md), [storage](../../architecture/agent-runtime/agent/README.md#storage), [workflows](../../architecture/agent-runtime/workflows/README.md).

## What was built

### Coordinator

- `agentx serve`, in the project root or `agent-x/`, runs every agent that `agent-x/agentx.json` lists. An `AgentManager` per agent starts the agent's process, restarts it with a backoff, kills it when its heartbeat stops, and marks it failed after five restarts. The agent's process ends with the coordinator.
- `agent-x/agentx.json` lists the agents: each one's `description` and `canSendTo`. Every agent's prompt lists the agents it may send to.
- Each second the coordinator delivers every agent's outbox into the receivers' inboxes, and fires the schedules of `.pi/schedules.json` and `storage/knowledge/schedules.json`.
- `/health` and `/agents` over HTTP.

### Events

- Every event reaches an agent through its inbox: a folder per event, with its files, and a marker per event that waits. Only the router loop adds events to the queue.
- The agent sends with `sendEvent`: the model's `agentx event send`, its workflows' `ctx.send`, and the workflow runner's failure reports. Every event it sends, also to itself, goes into its own outbox.
- Only `deliverEvent`, in the coordinator runtime, writes an inbox: for the coordinator (outboxes, schedules, refusals) and for a person's `agentx event deliver`. The coordinator adds `agentX-FromAgent`, `agentX-FromThread` and `agentX-FromWorkflow`, checks `canSendTo`, and tells the sending thread why it refused an event.
- An event's files keep their names in its folder, and its content's last line names them. Its id comes from the receiver and its key, so a copy is added once.

### Storage

- Each agent's state is in `agent-x/storage/<agent>/`, which the agent directory reaches through its `storage` link. The coordinator uses the central folder.
- `agentx remove-agent` deletes an agent's folder, its state and its entry in `agentx.json`.

### Router

- An event without a thread goes to the agent's router, `storage/knowledge/event_router.mjs`, then the developer's, `.pi/event_router.mjs`, then `main`. `init-agent` writes a developer's router that sends everything to `main`.
- A router that fails counts as one that picked nothing; the event gets `agentX-RouterError`, and the router's output goes to a log.

### Workflows

- A workflow sends from its babysitter thread, as the workflow, so answers and refusals reach that thread.
- A failed run is reported to the babysitter thread through the outbox.

### Prompt and CLI

- The harness prompt says where the agent keeps what it learns, puts every failure in one place, and lets the agent write no extensions.
- A thread is a folder of Pi sessions, whose latest session goes on, so Pi's own `-c`, `-r`, `/new` and `/resume` stay in the thread ([D21](../../architecture/agent-runtime/pi/README.md#d21)).
- `run`, `serve` and `event` only call the runtimes, which never import the CLI. `agentx run` is the agent runtime's `runAgent`. `agentx event send` is the agent's own; a person uses `agentx event deliver`.

## Decisions

[D47](../../architecture/agent-runtime/events/README.md#d47) to [D65](../../architecture/agent-runtime/agent/README.md#d65), in the [index](../../README.md#decisions).

## Changes from the plan

- Thirteen tasks merged at the release into this one record, which keeps only what stands.

## Migration

- None: no project predates this release.

## Verification

- `pnpm run check`; `pnpm test`: 83 tests pass, among them `agentx serve` end to end with two agents.
- Not checked by hand: schedules under a real clock, `/resume` through the storage link, and Windows.

## Follow-ups

- Sandboxes: mount `agent-x/storage/<agent>/` at the agent's `storage/`.
- [Webhooks](../backlog/coordinator-webhooks.md) and [Composio triggers](../backlog/composio-triggers.md), delivered into the inbox like other events.
- Pruning the mailboxes' folders and the logs.
- An agent can guess a harness key, such as `schedule:<name>:<time>`, and send it to another agent first.

## Original plans

- Run every agent of a project with `agentx serve`.
- List a project's agents in `agentx.json`, and send agents events on schedules.
- Keep every agent's storage in one folder, `agent-x/storage`.
- Remove an agent with `agentx remove-agent`.
- Let the developer write an event router too, asked after the agent's; give a new agent one that sends every event to `main`.
- A simpler harness prompt, and no extensions written by the agent.
- Name an event's files by name, and deliver an event's folder as it is.
- Fix what a review of the inbox found: a bad event blocked the inbox, order within a millisecond, copies asking a router.
- Only the agent sends, into its outbox; only the coordinator runtime delivers; the runtimes never depend on the CLI.
- The CLI is a developer's local tool: no `agentx event list` or `show`.
