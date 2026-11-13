---
name: agent-runner-command
title: Start an agent's runner with `agentx work`
description: A command, run in an agent directory, that serves the agent's queue with the AgentRunner until it is stopped; the coordinator starts the same command for each agent.
type: feature
priority: none
status: planned
modules: [cli, agent-runtime/agent-runner, agent-runtime/agent]
created: 2026-11-13
updated: 2026-11-13
---

# Start an agent's runner with `agentx work`

The [AgentRunner](../../architecture/agent-runtime/agent-runner/README.md) is built, but only the tests start it, through `test/runner-process.mjs`. `agentx work`, run in an agent directory, starts it: it watches the agent's queue and starts a Pi process for each thread with messages, until it is stopped. The [coordinator](coordinator.md) runs the same command for each agent, so an agent works its queue the same way on a laptop and on a server.

## Plan

1. **The command.** `src/cli/commands/work.ts` exports `workAgent(agentRoot)`. It creates the `AgentRunner` with the agent's limits, says which agent it serves and how many threads it runs at once, and returns when `run()` does. The first SIGINT or SIGTERM calls `stop()`: no new threads, and the running ones finish. The second calls `stop(true)`. A SIGTERM within a second after a SIGINT counts as the same stop, because `pnpm exec` sends one right after the terminal's Ctrl-C (pnpm 11.21, checked on 2026-11-13). `agentx.ts` gets a branch and a usage line. Like `run` and `send`, `work` needs an agent directory (`agentRoot`).
2. **Limits in the agent's settings.** `agentx.runner` in `.pi/settings.json` ([D36](../../architecture/agent-runtime/agent/README.md#d36)), both keys optional:

   | Key | Default | Meaning |
   |---|---|---|
   | `maxThreads` | 4 | Threads that run at once. Each is a Pi process of about 130 MB. |
   | `stallSeconds` | 600 | A Pi process that writes nothing this long is stopped. Set it above the longest a tool of the agent runs without output. |

   Both depend on the agent's tools, so its developer sets them, and the coordinator needs no setting per agent. The tests set a short `stallSeconds`. `work` does not load Pi, so it reads the agent's own `.pi/settings.json` as JSON. Unlike `pi.getSettings()`, that leaves out `agentx` keys in the shared `agent-x/.pi/settings.json`. The template gets no entry.
3. **Ctrl-C drains.** Today a terminal's Ctrl-C also reaches the runner's Pi processes, and Pi ends at once on SIGINT ([known limits](../../architecture/agent-runtime/agent-runner/README.md#known-limits)). The runner starts each Pi process in a process group of its own (`detached: true`), so only the runner gets the signal. Pi still ends with the runner, because it closes its session when its input closes ([Pi](../../architecture/agent-runtime/pi/README.md#rpc-mode)).
4. **Ctrl-C through the handover.** The handover to the pinned copy ([D15](../../architecture/cli/README.md#d15)) waits in `spawnSync`. Ctrl-C ends it at once while the pinned `work` keeps draining, so the prompt comes back early. The handover ignores SIGINT, which works under `spawnSync`, and so returns when the pinned copy does. It cannot pass a SIGTERM on: no handler runs while `spawnSync` blocks, and a SIGTERM to the outer `agentx` leaves the pinned copy running (checked on 2026-11-13). So whatever stops agentx with SIGTERM, a process manager or the coordinator, starts the pinned CLI directly ([coordinator](coordinator.md#running-it-on-a-server)).
5. **Tests.** The runner tests start `agentx work`, and `test/runner-process.mjs` is deleted. New tests: SIGINT to the command's process group lets a running thread finish; a SIGINT followed at once by a SIGTERM still lets it finish; `maxThreads` and `stallSeconds` from the settings apply.
6. **Docs.** The agent runner's doc (how it is started, stopping, the Ctrl-C limit gone), the CLI's commands table and handover, the agent's settings table, [send messages](../../user_guides/send_messages.md) ("Nothing runs threads in the background yet"), [customize an agent](../../user_guides/customize_an_agent.md), the components and status in `high_level_design.md`, `docs/README.md`, the CLI line and the runner's status in `CLAUDE.md`, and `README.md`.

## To decide

- **The name.** `agentx work` (pick): "work" is the docs' word for serving a queue, and the runner's sessions are already called workers. `agentx serve` in an agent directory would give one command two meanings, since `serve` in the project starts the coordinator.
- **Settings or flags.** Settings (pick), for the reasons in step 2. Flags such as `--max-threads` would make each deployment repeat what the agent needs.
- **One runner per agent.** Two runners on one agent stay correct, because a thread's lease keeps it to one Pi process, but together they run up to twice `maxThreads`, and a thread one runner has just started can be started again by the other, whose Pi process then ends at once. A runner lease in the queue file would refuse the second runner. Pick: not now; the coordinator starts one runner per agent.

## Known limits

- Under `pnpm exec`, pnpm itself ends on Ctrl-C, so the prompt comes back while the threads finish.

## Decisions to record when built

- `agentx work` runs one agent's runner, with its limits from `agentx.runner`. agentx code that runs outside Pi reads only the agent's own `.pi/settings.json` (an addition to D36).
- The runner starts each Pi process in its own process group.
- The handover ignores SIGINT, and passes no SIGTERM on.
