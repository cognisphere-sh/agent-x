---
name: coordinator
title: Run every agent of a project with `agentx serve`
description: An always-running coordinator that starts each agent's runner as a process of its own and starts it again when it stops; the next step moves each agent into a sandbox.
type: feature
priority: none
status: planned
modules: [coordinator-runtime, agent-runtime, cli]
created: 2026-11-13
updated: 2026-11-13
---

# Run every agent of a project with `agentx serve`

`agentx serve`, in the project root or in `agent-x/`, starts the [coordinator](../../architecture/coordinator-runtime/README.md): one process that runs every agent of the project and keeps them running. Each agent's runner is a process of its own, `agentx work` in the agent's directory, so this plan needs the [runner command](agent-runner-command.md) first. The next step moves each agent into a sandbox, so the coordinator reaches an agent only by starting and stopping that process and, with [webhooks](coordinator-webhooks.md), by putting messages on its queue.

## Plan

1. **One agent's process.** `src/agent-runtime/agent-manager.ts`: the planned `AgentManager`, with a child process where the sandbox will be. For one agent it:
   - starts `node <agentx>/dist/cli/agentx.js work` in the agent directory, with an IPC channel, in a process group of its own (`detached: true`), so a terminal's Ctrl-C reaches only the coordinator and does not add to the coordinator's SIGTERM;
   - writes each line of the runner's output with the agent's name in front;
   - starts the runner again when it exits without being told to: after 1 s, doubling up to 1 minute, and back to 1 s once a runner has run for 10 minutes;
   - `stop(force)`: sends SIGTERM, which lets the running threads finish, or with `force` a second SIGTERM, which stops them; resolves when the runner has exited.

   The sandbox step changes how this class starts the runner; the coordinator stays as it is.
2. **No runner outlives the coordinator.** `agentx work` started with an IPC channel stops at once when the channel closes (`process.on("disconnect")`). A coordinator killed with SIGKILL then leaves no runners behind, and the next coordinator does not start a second runner per agent. When `run()` returns, `work` closes the channel itself (`process.disconnect()`), which would otherwise keep it running.
3. **The coordinator.** `src/coordinator-runtime/coordinator.ts`: class `Coordinator`. Given the project's `agent-x/`, it finds the agents (folders in `agents/` with a `.pi/settings.json`), starts an `AgentManager` for each, and stops them all on `stop(force)`.
4. **The command.** `src/cli/commands/serve.ts` and a branch in `agentx.ts`. It runs in the project root or `agent-x/`, found as `init-agent` finds it, says which agents it runs, and starts the coordinator. The first SIGINT or SIGTERM drains every runner; the second stops them at once. As in `work`, a SIGTERM within a second after a SIGINT counts as the same stop: `pnpm exec` adds one to the terminal's Ctrl-C, and `pnpm agentx serve`, the project root's script, is still to be checked. The runners get the environment `serve` was started with, unchanged, so each Pi process still reads `agent-x/.env` when it starts ([D43](../../architecture/agent-runtime/agent/README.md#d43)).
5. **Tests**, against the fake model: in a project with two agents, messages to both are done; a runner killed with SIGKILL is started again, and a message sent after that is done; SIGINT to `serve`'s process group lets a running thread finish, then `serve` exits 0; SIGKILL to `serve` ends its runners.
6. **Docs.** The coordinator's doc (what it does and its decisions), the agent runtime's doc (the `AgentManager`, with a process as the sandbox for now), the CLI's commands table, a new user guide on running agents on a server (below), the components, diagram and status in `high_level_design.md`, `docs/README.md`, the mental model in `CLAUDE.md`, and the layout in `README.md`.

## Running it on a server

What the new user guide says:

- The host keeps `serve` itself running, with systemd's `Restart=` or Docker's restart policy. The coordinator keeps the runners running.
- A stop drains only if SIGTERM reaches `serve` alone and the host waits long enough. systemd's default sends SIGTERM to every process of the service at once, and each Pi process then aborts its run; `KillMode=mixed` and a `TimeoutStopSec` fix that. Docker sends it to the container's first process and waits `stop_grace_period`; `init: true` reaps processes whose parent has gone.
- Start the pinned CLI directly, `node agent-x/node_modules/agent-x/dist/cli/agentx.js serve`, so no package manager or handover sits in between and `serve` is the process that gets the signal.
- Every interruption costs the messages in flight an attempt, and a message fails after three ([D24](../../architecture/agent-runtime/pi-package/message-queue/README.md#d24)). A drain ends when every running thread has no work left; a thread that keeps getting messages is cut off when the host's stop timeout runs out, at the cost of an attempt. A runner that crashes again and again fails its threads' messages after three crashes.

## To decide

- **A process per agent** (pick), or `AgentRunner` objects inside the coordinator. A process keeps one agent's crash from stopping the others, and it is the boundary the sandbox step needs. Runners inside the coordinator would save a Node process per agent, but the sandbox step would have to split them apart again.
- **Where the `AgentManager` lives.** `src/agent-runtime/` (pick), where the docs already plan it.
- **Agents added while `serve` runs.** Found at start only (pick): restart `serve` to add or remove one, as a deploy does. Watching `agents/` can come later.

## Not in this plan

- Sandboxes: the next step.
- Noticing a runner that hangs: the coordinator only sees a runner exit. A heartbeat can come later.
- One project on several machines: each agent's queue is a file on a local disk.

## Decisions to record when built

- Each agent's runner is a process of its own, in its own process group, started by the coordinator as `agentx work`.
- The `AgentManager` starts a runner that exits again, with a backoff.
- A runner started by the coordinator ends with it.
