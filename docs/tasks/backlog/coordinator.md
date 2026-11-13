---
name: coordinator
title: Run every agent of a project with `agentx serve`
description: An always-running coordinator that starts each agent as a process of its own, starts it again when it stops, marks it failed after repeated restarts, and reports every agent's health; the next step moves each agent into a sandbox.
type: feature
priority: none
status: planned
modules: [coordinator-runtime, agent-runtime, agent-runtime/agent, cli]
created: 2026-11-13
updated: 2026-11-13
---

# Run every agent of a project with `agentx serve`

`agentx serve`, in the project root or in `agent-x/`, starts the [coordinator](../../architecture/coordinator-runtime/README.md): one process that runs every agent of the project, keeps them running and reports their health. The goal is a server that runs the project's app and its agents. Each agent is a process of its own, `agentx run` in the agent's directory, so this plan needs [`agentx run`](agentx-run.md) first. The next step moves each agent into a sandbox. The coordinator then reaches an agent only by starting and stopping its process, by reading its checked-in settings, and through files in its `storage/`: its heartbeat here, and its [events](agentx-run.md) with [webhooks](coordinator-webhooks.md).

## Plan

1. **One agent's process.** `src/agent-runtime/agent-manager.ts`: the planned `AgentManager`, with a child process where the sandbox will be. For one agent it:
   - starts `agentx run` with the coordinator's own Node (`process.execPath <agentx>/dist/cli/agentx.js run`) in the agent directory, with an IPC channel, in a process group of its own (`detached: true`), so a terminal's Ctrl-C reaches only the coordinator and does not add to the coordinator's SIGTERM;
   - writes each line of the process's output with the agent's name in front;
   - starts the process again when it exits without being told to: after 1 s, doubling up to 1 minute, and back to 1 s once it has run for 10 minutes;
   - `stop(force)`: sends SIGTERM, which lets the running threads finish, or with `force` a second SIGTERM, which stops them; resolves when the process has exited.

   The sandbox step changes how this class starts the process; the coordinator stays as it is.
2. **Failed agents.** The coordinator counts how many times it has started each agent's process again. A run of 10 minutes sets the count back to 0, as it does the backoff. At 5 the agent is `failed`: the coordinator starts it no more and logs its last exit. Restarting `serve`, as a deploy does, starts a failed agent again.
3. **Heartbeat.** The agent's `AgentSupervisor` writes the time to `storage/heartbeat` every 10 seconds while its loops work ([`agentx run`](agentx-run.md)). The coordinator counts only a heartbeat written after it started the process, so a file left by an earlier process counts for nothing; a process id would not do, because a sandbox numbers its processes apart. A process without such a heartbeat for 60 seconds, the first one included, is hung: the coordinator kills its process group with SIGKILL, and that counts as an exit. The agent is `starting` until the first heartbeat. In the sandbox step the agent's `storage/` is shared with the coordinator, so the file works the same.
4. **The HTTP server.** `node:http` in the coordinator, on `--host` (default `127.0.0.1`) and `--port` (default 3100, next to the app's 3000). Plain HTTP: TLS comes from a reverse proxy or a tunnel.
   - `GET /health` answers 200 while the coordinator runs, for the host's process manager or a load balancer.
   - `GET /agents` answers each agent's state (`starting`, `running`, `restarting`, `failed`, `stopping`), since when, how many times it was started again, and its last exit. It answers 200 when every agent is `running` and 503 otherwise, for a monitor that alerts a person. So one failed agent never takes the server, and with it the other agents' webhooks, out of a load balancer.
   - The server closes after the agents' processes have stopped, so events that arrive during a drain wait in the agents' files ([webhooks](coordinator-webhooks.md)).
5. **No agent's process outlives the coordinator.** `agentx run` started with an IPC channel stops at once when the channel closes (`process.on("disconnect")`). A coordinator killed with SIGKILL then leaves no agents running, and the next coordinator does not start a second process per agent. When it is done, `run` closes the channel itself (`process.disconnect()`), which would otherwise keep it running.
6. **The coordinator creates every event.** `POST /agents/<agent>/events` adds an event to an agent: content, an optional thread, key and metadata, and attachments, which it saves in the agent's `storage/attachments/` and names in the content. `agentx event send` calls it, replacing the temporary script of [`agentx run`](agentx-run.md), with the same options. So do workflow failure reports. The coordinator sets `source` and, for an event from another agent, `from-agent`. Webhooks and later a scheduler add events the same way. In the sandbox step an agent can write only its own `storage/`, so this is the only way between agents. The server listens on localhost; when agents move into sandboxes, each agent's process gets a token, so no agent can pretend to be another.
7. **The coordinator.** `src/coordinator-runtime/coordinator.ts`: class `Coordinator`. Given the project's `agent-x/`, it finds the agents (folders in `agents/` with a `.pi/settings.json`), starts an `AgentManager` for each and the HTTP server, and stops them all on `stop(force)`.
8. **The command.** `src/cli/commands/serve.ts` and a branch in `agentx.ts`. It runs in the project root or `agent-x/`, found as `init-agent` finds it, says which agents it runs and where it listens, and starts the coordinator. The first SIGINT or SIGTERM drains every agent; the second stops them at once. As in `work`, a SIGTERM within a second after a SIGINT counts as the same stop: `pnpm exec` adds one to the terminal's Ctrl-C, and `pnpm agentx serve`, the project root's script, is still to be checked. The agents' processes get the environment `serve` was started with, less the coordinator's own keys that later tasks add ([webhooks](coordinator-webhooks.md), [Composio triggers](composio-triggers.md)), so each Pi process still reads `agent-x/.env` when it starts ([D43](../../architecture/agent-runtime/agent/README.md#d43)).
9. **Tests**, against the fake model: in a project with two agents, messages to both are done; an agent's process killed with SIGKILL is started again, and a message sent after that is done; an agent whose process always exits at once is `failed` after 5 restarts, and `/agents` answers 503 and says so while `/health` answers 200; a process that stops writing its heartbeat, or never writes one, is killed and started again; an old `storage/heartbeat` does not count for a new process; SIGINT to `serve`'s process group lets a running thread finish, then `serve` exits 0; SIGKILL to `serve` ends the agents' processes; `agentx event send --agent b` from agent `a` adds an event to `b` with `from-agent: a`, and one for an agent that does not exist is refused.
10. **Docs.** The coordinator's doc (what it does, the server, its routes, creating events, its decisions), the event queue's doc (the `from-agent` metadata), the CLI doc (`agentx event send` through the coordinator), the agent runtime's doc (the `AgentManager`, with a process as the sandbox for now), the agent's doc (`storage/heartbeat`), the CLI's commands table, a new user guide on running a project on a server (below), the components, diagram and status in `high_level_design.md`, `docs/README.md`, the mental model in `CLAUDE.md`, and the layout in `README.md`.

## Running it on a server

What the new user guide says:

- The app and the agents run side by side as two services: `web/` with `next start` on port 3000, and `agent-x/` with `serve` on port 3100. A reverse proxy, such as Caddy or nginx, gives both one address: `/webhooks/` goes to the coordinator, everything else to the app. `/health` and `/agents` are for the host, not for the public.
- The host keeps both services running, with systemd's `Restart=` or Docker's restart policy. The coordinator keeps the agents running.
- A stop drains only if SIGTERM reaches `serve` alone and the host waits long enough. systemd's default sends SIGTERM to every process of the service at once, and each Pi process then aborts its run; `KillMode=mixed` and a `TimeoutStopSec` fix that. Docker sends it to the container's first process and waits `stop_grace_period`; `init: true` reaps processes whose parent has gone.
- Start the pinned CLI directly, `node agent-x/node_modules/agent-x/dist/cli/agentx.js serve`, so no package manager or handover sits in between and `serve` is the process that gets the signal.
- Every interruption costs the messages in flight an attempt, and a message fails after three ([D24](../../architecture/agent-runtime/pi-package/message-queue/README.md#d24)). A drain ends when every running thread has no work left; a thread that keeps getting messages is cut off when the host's stop timeout runs out, at the cost of an attempt.

## To decide

- **A process per agent** (pick), or `PiRunner` objects inside the coordinator. A process keeps one agent's crash from stopping the others, and it is the boundary the sandbox step needs. Runners inside the coordinator would save a Node process per agent, but the sandbox step would have to split them apart again.
- **When an agent is failed.** After 5 restarts with no run of 10 minutes between them (pick). That covers a process that cannot start and one that crashes every few minutes. A process that crashes after longer runs is started again for ever, with the backoff, and `/agents` shows its restarts.
- **The heartbeat.** A file in the agent's `storage/` (pick), which works the same across a sandbox's boundary. Messages over the IPC channel exist only between Node processes on one machine, and an HTTP port per agent adds a port to every sandbox.
- **The app.** `serve` runs only the agents (pick), and the guide runs the app beside it. `web/` and `agent-x/` are separate packages, deployed apart, and the host already keeps services running. `serve` starting `next start` too would make one service of two.
- **Where the `AgentManager` lives.** `src/agent-runtime/` (pick), where the docs already plan it.
- **Events between agents.** Through the coordinator (pick): a sandboxed agent can write only its own `storage/`, and the coordinator is one place to control later who may send to whom. Or written straight into the other agent's file: simpler, but not inside a sandbox.
- **Who may send to whom.** Any agent of the project (pick for now). A list of allowed senders in each agent's settings can come later.
- **Agents added while `serve` runs.** Found at start only (pick): restart `serve` to add or remove one, as a deploy does. Watching `agents/` can come later.

## Not in this plan

- Sandboxes: the next step.
- Starting one failed agent again without restarting `serve`, such as `POST /agents/<agent>/restart`: later, with a way to authorize such calls.
- The health of an agent's work in `/agents`, such as how many messages failed or how long the oldest one has waited: later.
- One project on several machines: each agent's queue is a file on a local disk.

## Decisions to record when built

- Each agent is a process of its own, in its own process group, started by the coordinator as `agentx run`.
- The `AgentManager` starts an agent's process again with a backoff, and gives up after 5 restarts with no run of 10 minutes.
- An agent's heartbeat is a file in its `storage/`.
- `/health` says whether the coordinator runs; `/agents` says how each agent is.
- An agent's process started by the coordinator ends with it.
- Only the coordinator creates events, for every source, between agents included.
