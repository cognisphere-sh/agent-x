---
name: agentx-run
title: Run an agent with `agentx run`, its event router and its workflows
description: agentx run runs one agent until it is stopped. It routes events without a thread, hands Pi threads' events to Pi, and runs workflows, functions that handle events without the model. agentx chat opens a thread for a person.
type: feature
priority: none
status: done
modules: [cli, agent-runtime/supervisor, agent-runtime/events, agent-runtime/workflows, agent-runtime/functions, agent-runtime/pi, agent-runtime/pi/pi-package, agent-runtime/pi/pi-package/event-queue, agent-runtime/agent]
created: 2026-11-13
updated: 2026-11-15
---

# Run an agent with `agentx run`, its event router and its workflows

Built on 2026-11-14. This record holds what stands at release; the [coordinator, events, storage, router and workflows](3-coordinator-events-storage-router-workflows.md) record builds on it. The design: [supervisor](../../architecture/agent-runtime/supervisor/README.md), [events](../../architecture/agent-runtime/events/README.md), [Pi](../../architecture/agent-runtime/pi/README.md), [workflows](../../architecture/agent-runtime/workflows/README.md), [functions](../../architecture/agent-runtime/functions/README.md).

## What was built

- **Names.** `agentx chat` opens a thread for a person; `agentx run` runs the agent. What reaches an agent is an event, in `storage/event_queue.db`.
- **The queue.** One `events` table, a unique `key` per event, and the steps workflows need: `claimOldest`, `finish`. A workflow's event in flight fails on takeover instead of going back to the queue.
- **`agentx run`.** The `AgentSupervisor` with the `EventRouter`, `PiRunner` and `WorkflowRunner` loops, `agentx.runner` settings, the heartbeat, restarts of a crashed loop, and two-step stopping.
- **Layout.** `src/agent-runtime/` grouped by function: `supervisor/`, `events/`, `workflows/`, `functions/` and `pi/`; the docs follow the same folders.
- **Calling the agent's code.** A child process per call of a router or workflow, in its own process group, with the job and result over IPC. `contracts.ts` holds their types, which the package exports.
- **Workflows.** Two `workflows.json` lists, runs with logs, one attempt, and failure reports keyed `failed:<event id>`.
- **Routers.** A router that fails counts as one that picked nothing; the event gets `agentX-RouterError`, and the router's output goes to a log.
- **The agent's environment** puts `agent-x/node_modules/.bin` first on `PATH`, so `agentx` in its bash is the pinned one.

## Decisions

[D45](../../architecture/cli/README.md#d45), [D46](../../architecture/agent-runtime/supervisor/README.md#d46), [D47](../../architecture/agent-runtime/events/README.md#d47), [D50](../../architecture/agent-runtime/events/README.md#d50), [D52](../../architecture/agent-runtime/workflows/README.md#d52) and [D53](../../architecture/agent-runtime/workflows/README.md#d53), in the [index](../../README.md#decisions).

## Changes from the plan

- No `--preserve-symlinks` for routers and workflows: it breaks packages that pnpm installs with dependencies of their own. Imports resolve from the file's real path, which the central storage folder inside `agent-x/` serves.
- The router loop counts as healthy while it waits on a router call, which has its own time limit.

## Migration

- None: no project predates this release.

## Verification

- `pnpm run check`; `pnpm test` covers the queue, the router loop, workflows and their reports, the supervisor and stopping.
- Checked by hand: `--preserve-symlinks` breaks importing `@earendil-works/pi-coding-agent`.
- Not tested: that the heartbeat stops while a loop is stuck.

## Follow-ups

- Loops between workflows, and pruning events and logs: known limits in [workflows](../../architecture/agent-runtime/workflows/README.md#known-limits) and [events](../../architecture/agent-runtime/events/README.md#known-limits).

## Original plan

- `agentx run`, in an agent's directory, starts the agent and keeps it running until it is stopped: it routes events without a thread with a router, hands Pi threads' events to Pi, and runs workflows. A person runs it on a laptop; the coordinator runs it on a server.
