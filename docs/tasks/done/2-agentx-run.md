---
name: agentx-run
title: Run an agent with `agentx run`, its event router and its workflows
description: The `agentx run` runs one agent until it is stopped. It routes events without a thread with a router the agent keeps, sends Pi threads' events to Pi, and runs workflows, functions that handle events without the model. The old `agentx run` becomes `agentx chat`, and messages become events.
type: feature
priority: none
status: done
modules: [cli, agent-runtime/supervisor, agent-runtime/events, agent-runtime/workflows, agent-runtime/functions, agent-runtime/pi, agent-runtime/pi/pi-package, agent-runtime/pi/pi-package/event-queue, agent-runtime/agent]
created: 2026-11-13
updated: 2026-11-14
---

# Run an agent with `agentx run`, its event router and its workflows

Built on 2026-11-14, from the plan in `b7fe4bf`, which is kept [below](#original-plan). The design as built: [agent supervisor](../../architecture/agent-runtime/supervisor/README.md), [event router](../../architecture/agent-runtime/events/README.md), [Pi runner](../../architecture/agent-runtime/pi/README.md), [workflows](../../architecture/agent-runtime/workflows/README.md), [event queue](../../architecture/agent-runtime/events/README.md).

## What was built

- **Names.** `agentx chat` (the old `run`), `agentx run`, `agentx event send|list|show` (the old `send`). `AgentRunner` is `PiRunner`. Messages are events: `storage/event_queue.db`, table `events`, the event queue extension.
- **The queue.** Migration 3 makes the `events` table, with an optional thread and a unique `key`. Methods for the router (`nextUnrouted`, `route`), for workflows (`nextThread(…, true)`, `claimOldest`, `finish`, `inFlightIds`) and for audits (`list`, `get`, `byKey`, `withMetadata`). A workflow's event in flight fails on takeover instead of going back to the queue. An old `message_queue.db` is renamed when it is opened.
- **`agentx run`.** `AgentSupervisor` with the `EventRouter`, `PiRunner` and `WorkflowRunner` loops, `agentx.runner` settings, the heartbeat, restarts of a crashed loop, and two-step stopping.
- **Layout.** `src/agent-runtime/` is grouped by function: `supervisor/` (`agentx run`), `events/` (the queue, moved out of the Pi extension's folder, `sendEvent`, the router loop), `workflows/`, `functions/` (calling the router and workflows, their types) and `pi/` (starting Pi, the Pi runner, and the Pi package). The docs under `docs/architecture/agent-runtime/` follow the same folders; the Pi reference is `pi/pi-reference/`.
- **Calling the agent's code.** `function-call.ts` and `function-host.ts`: a child process per call, in its own process group, with the job and outcome over IPC. `contracts.ts` holds the types, which the package exports (`types` in `package.json`, `declaration` in `tsconfig.json`).
- **Router and workflows.** The starter router, `router-error` on failure, `workflows.json` in two places, runs with logs, failure reports keyed `failed:<event id>`.
- **Sending.** `sendEvent`, used by `agentx event send`, `ctx.send` and failure reports. `piEnv` puts `agent-x/node_modules/.bin` first on `PATH`.
- **CLI.** The handover ignores `SIGINT`. `init-project` and `init-agent` point to `agentx chat`.
- **Harness prompt.** "Events" (with the router and `agentx event`) and "Workflows" sections; the files list names the new folders.
- **Tests.** `test/agentx-run.test.mjs` (10 tests); queue tests for keys, routing, workflow threads, audits and the renamed file; the runner and Composio tests moved to `agentx run`, `agentx chat` and `agentx event send`. `test/runner-process.mjs` is gone.

## Decisions

- [D45](../../architecture/cli/README.md#d45): `agentx run` runs the agent; `agentx chat` opens a thread for a person; `agentx event` sends and shows events.
- [D46](../../architecture/agent-runtime/supervisor/README.md#d46): `agentx run` is one process: a supervisor with three loops.
- [D47](../../architecture/agent-runtime/events/README.md#d47): what reaches an agent is an event, and its thread decides who takes it.
- [D48](../../architecture/agent-runtime/events/README.md#d48): every sender goes through `sendEvent`.
- [D49](../../architecture/agent-runtime/events/README.md#d49): events hold no attachments.
- [D50](../../architecture/agent-runtime/events/README.md#d50): an event's key makes adding it idempotent.
- [D51](../../architecture/agent-runtime/events/README.md#d51): one router, the agent's own, a function called in a child process for each event.
- [D52](../../architecture/agent-runtime/workflows/README.md#d52): workflows are listed in two `workflows.json` files; each is a function on its own thread.
- [D53](../../architecture/agent-runtime/workflows/README.md#d53): a run gets one attempt, and agentx reports every failure.
- Changed: [D15](../../architecture/cli/README.md#d15) (the handover ignores `SIGINT`), [D36](../../architecture/agent-runtime/agent/README.md#d36) (`runner`, and settings read outside Pi), and the wording of D6, D21, D23 to D33, D37 and D44 for events, `chat` and the Pi runner.

## Changes from the plan

- **No `--preserve-symlinks`.** The plan started the router and workflows with it, so imports would work once `storage/` is linked in from elsewhere. It breaks packages that pnpm installs with dependencies of their own: importing Pi with the flag failed on one of Pi's dependencies. Imports resolve from the file's real path, which works while `storage/` is in the agent directory; the linked case is a known limit, and its test was not written.
- **Where a router failure is kept.** The plan kept the reason and the router's output in the event's `error`. A delivery clears `error` when Pi takes the event, so the reason is in the `router-error` metadata instead, one line that the model sees (`failed: …`, `timeout: …`, `exit: …`, `bad answer: …`, `unknown workflow: …`), and the output is in `storage/workspace/router-logs/<event id>.log`.
- **Health.** The plan wrote the heartbeat only while every loop finished a round in the last 30 s. A router call may take `routerSeconds`, 60 by default, so the router loop also counts as healthy while it waits for a call, which has its own time limit. A loop that has ended after a stop counts as healthy too, so the heartbeat goes on during a drain.
- **Workflow threads and Pi.** Besides `agentx chat`, the event queue extension refuses a workflow's thread, so Pi given that session id itself takes none of its events.
- **A crashed loop's backoff** goes back to 1 s after a run of 10 minutes, as the coordinator plans for agents.
- **Cut off.** An event in flight when `agentx run` died fails with `The process running this thread stopped.`, the queue's takeover reason; its failure report says the run was cut off.
- **`agentx event send`** keeps `--do-not-steer` and `--silent` from `send`, and adds `source: cli` unless `--meta source=…` is given. `event list` takes `--limit`, and `list` and `show` take `--agent`.
- **`failureReportTo`** must name an agent of the project; an entry that names another is skipped.
- **Not tested:** that the heartbeat stops while a loop is stuck, and imports through a linked `storage/`. A fresh heartbeat, a crashed loop's restart, Ctrl-C to the whole process group, and a router that imports a package of the project are tested.

## Migration

- `agentx run` now runs the agent until it is stopped. To talk to an agent at a terminal, use `agentx chat`, with the same options the old `run` took.
- `agentx send` is `agentx event send`. Without `--thread-id`, an event waits for the router, which only `agentx run` runs; with only a terminal session open, send to its thread with `--thread-id`.
- The first agentx of this version to open an agent's queue renames `storage/message_queue.db` to `event_queue.db` and migrates it to version 3. Stop every older agentx process of the project first: an old one keeps writing to the old name, and refuses the migrated file.
- Anything that reads the queue file directly reads the table `events`.
- The first `agentx run` writes `storage/knowledge/event_router.mjs`, which sends everything to `main`.
- The harness prompt is longer: the "Messages" section is "Events", with the router, `agentx event`, and "Workflows".

## Verification

- `pnpm run check`, and `pnpm test`: 67 tests pass (queue 17, Pi threads 32, Composio 8, `agentx run` 10).
- Checked by hand: `--preserve-symlinks` breaks importing `@earendil-works/pi-coding-agent` from this repository.
- Not checked with a real model or under a coordinator.

## Follow-ups

- The coordinator starts `agentx run`, ends it when its IPC channel closes, adds every event in place of the direct write in `sendEvent`, and reads the heartbeat: [coordinator](../backlog/coordinator.md).
- Composio events and triggers: [webhooks](../backlog/coordinator-webhooks.md), [Composio triggers](../backlog/composio-triggers.md).
- Loops between workflows, pruning events, attachments and logs, and imports through a linked `storage/`: known limits in [workflows](../../architecture/agent-runtime/workflows/README.md#known-limits), [event queue](../../architecture/agent-runtime/events/README.md#known-limits) and [event router](../../architecture/agent-runtime/events/README.md#known-limits).

## Original plan

### The idea

When this task is done, `agentx run`, in an agent's directory, starts the agent and keeps it running until it is stopped. A person runs it on a laptop. The [coordinator](../backlog/coordinator.md) will start it for each agent on a server, and later each sandbox will run it.

- An **event** is what reaches an agent: a person's request, a new email from a [Composio trigger](../backlog/composio-triggers.md), a workflow's failure report. Events live in the agent's `storage/event_queue.db`.
- Each event goes by its `thread_id`:

  | `thread_id` | Who takes it |
  |---|---|
  | empty | the **router**, a function the agent writes and keeps, which picks a thread |
  | `workflow.<name>` | the **workflow runner**: a function handles it, without the model |
  | anything else, like `main` | the **Pi runner**: Pi reads it |

```text
                             ┌─ no thread ─▶ EventRouter ─▶ sets the thread ─┐
coordinator ─▶ event_queue.db┤                                               │
 (adds every event)          ├─ workflow.<name> ◀─────────────────────────────┤─▶ WorkflowRunner ─▶ workflow function
                             └─ other thread    ◀─────────────────────────────┘─▶ PiRunner ───────▶ Pi
```

- Only the coordinator creates events. The agent's process only routes and works them.
- Today the [AgentRunner](../../architecture/agent-runtime/pi/README.md) is built, but only the tests start it, through `test/runner-process.mjs`.

#### How cognisphere-harness differs

cognisphere-harness works the same way: the agent edits `workspace/router.ts`, and the router can pick a workflow. The differences:

- **Where the router runs.** Here in a child process of the agent's process, once per event. In the harness, inside its server.
- **Events with a thread.** Here they skip the router, so a failure report always arrives, even if the agent broke its router. In the harness the router sees them too.
- **Router failure.** Here the event goes to `main`. The harness plans to retry, then park the event for a person.
- **Failed workflows.** Here agentx reports every failure. In the harness a script reports its own failures.

### Plan

#### Names

1. **Commands.**
   - Today's `agentx run` becomes **`agentx chat`**: it opens Pi's terminal on one thread, for a person to talk to the agent.
   - **`agentx run`** now runs the agent.
   - `agentx send` becomes **`agentx event send`**. New: **`agentx event list`** and **`agentx event show <id>`** (step 20).
2. **Classes.** `AgentRunner` becomes **`PiRunner`** (`src/agent-runtime/pi-runner.ts`). New: **`AgentSupervisor`**, **`EventRouter`**, **`WorkflowRunner`**. The coordinator's planned `AgentManager` keeps its name: it starts and watches the agent's process from outside.
3. **Messages become events.**
   - The file `storage/message_queue.db` becomes `storage/event_queue.db`, and the table `messages` becomes `events`. An existing `message_queue.db` is renamed the first time it is opened.
   - The message queue extension becomes the event queue extension (`extensions/event-queue/`, doc folder `pi-package/event-queue/`). It still gives each event to Pi as a user message.

#### The agent's process

4. **`AgentSupervisor`**, the parent inside `agentx run`. `src/cli/commands/run.ts` creates it for the agent directory. It:
   - starts three loops: the `EventRouter`, the `PiRunner` and the `WorkflowRunner`;
   - restarts a loop that crashes, after 1 s, doubling up to 1 minute, and logs why;
   - writes the time to `storage/heartbeat` every 10 s, but only while all three loops have finished a round in the last 30 s, so the coordinator sees a stuck loop as an unhealthy agent ([coordinator](../backlog/coordinator.md));
   - handles stopping: the **first** SIGINT or SIGTERM stops new work and lets running work finish; the **second** stops running work now. A SIGTERM within 1 s after a SIGINT counts as the same stop, because `pnpm exec` sends one right after Ctrl-C (pnpm 11.21, checked 2026-11-13).

   One process, not three: the risky code (the router, workflows, Pi) already runs in child processes, so a crash there cannot take the parent down. Three processes would repeat, in every agent, the restart and health logic the coordinator already has.
5. **Limits in the agent's settings**, under `agentx.runner` in `.pi/settings.json` ([D36](../../architecture/agent-runtime/agent/README.md#d36)). All optional:

   | Key | Default | Meaning |
   |---|---|---|
   | `maxThreads` | 4 | Pi threads that run at once. Each Pi process uses about 130 MB. |
   | `stallSeconds` | 600 | A Pi process that writes nothing for this long is stopped. Set it above the longest time a tool of the agent runs without output. |
   | `routerSeconds` | 60 | How long the router may take for one event. Long enough to ask a model. |

   They depend on the agent's tools, so the agent's developer sets them. `run` does not load Pi, so it reads the agent's own `.pi/settings.json` as plain JSON, without the `agentx` keys of the shared `agent-x/.pi/settings.json`. The template gets no entry.
6. **Ctrl-C lets work finish.** Today Ctrl-C also reaches the Pi processes, and Pi stops at once on SIGINT ([known limits](../../architecture/agent-runtime/pi/README.md#known-limits)). Every child process (router, workflow, Pi) starts in its own process group (`detached: true`), so only `agentx run` gets the signal. Pi still ends with it, because Pi closes its session when its input closes ([Pi](../../architecture/agent-runtime/pi/pi-reference/README.md#rpc-mode)).
7. **Ctrl-C through the handover.** The handover to the pinned copy ([D15](../../architecture/cli/README.md#d15)) waits in `spawnSync`. Today Ctrl-C ends it at once while the pinned copy keeps going, so the prompt comes back too early. Fix: the handover ignores SIGINT and returns when the pinned copy does. It cannot pass a SIGTERM on (no handler runs while `spawnSync` blocks; checked 2026-11-13), so anything that stops agentx with SIGTERM, like a process manager or the coordinator, starts the pinned CLI directly ([coordinator](../backlog/coordinator.md#running-it-on-a-server)).

#### Events

8. **The table.** A migration ([D37](../../architecture/agent-runtime/events/README.md#d37)) renames it to `events` and rebuilds it, because SQLite cannot change a column to allow empty values:
   - `thread_id` can be empty: the event waits for the router.
   - `key` (new, optional, unique): adding an event whose key is already there adds nothing. This stops repeat deliveries, like Composio's, from adding twice.
   - The statuses stay as they are: `queued`, `in_flight`, `done`, `failed`, `cancelled`. A `queued` event with no thread is waiting for the router.
9. **Content and attachments.** An event's content is markdown. Big data, like the 58 KB of an email, is a file in `storage/attachments/`, and the content names its path. The file is written first, so no event names a missing file. The agent reads it with its read tool; the router and workflows read it too. Paths are relative to the agent's directory, so they still work when `storage/` is mounted from elsewhere. Where an event came from is in its metadata, like `source: composio`.
10. **Only the coordinator creates events.** `agentx event send`, workflow failure reports, Composio and later a scheduler all go through it ([coordinator](../backlog/coordinator.md)). Until it is built, **`agentx event send` is a temporary script** that writes straight into the agent's `event_queue.db`:
    - `agentx event send [--agent <name>] [--thread-id <id>] [--key <key>] [--meta <name>=<value> ...] <content>`
    - Without `--thread-id`, the event goes to the router. With `--agent`, it goes to another agent of the project.
    - It refuses `--thread-id workflow.<name>` if that workflow does not exist.
    - The coordinator task replaces its inside with a call to the coordinator; its options stay.
    - `piEnv` puts `agent-x/node_modules/.bin` first on `PATH`, so Pi, the router and workflows all run the pinned `agentx`.

#### The router

11. **Routing.** The `EventRouter` takes the oldest `queued` event with no thread and calls the router. One event at a time.
    - The router returns `{ thread: "<id>" }`: a Pi thread, or `workflow.<name>`.
    - agentx saves it with `UPDATE events SET thread_id = ? WHERE id = ? AND thread_id IS NULL`. If no row changed, another process already routed it. So an event is never routed twice.
    - **If the router fails**, agentx sends the event to `main` and adds `router-error` to its metadata, so no event is stuck and the agent learns its router is broken. The router fails if it throws, does not return within `routerSeconds`, returns something else than `{ thread }`, or names a thread the queue refuses or a workflow that does not exist. The event's `error` keeps the reason and the last 2 KB of the router's output.
    - On the first stop signal, routing stops. New events wait for the next start.
12. **The router's contract.** `storage/knowledge/event_router.mjs` is the agent's own ([D35](../../architecture/agent-runtime/agent/README.md#d35)), and there is only one. It exports one function:

    ```ts
    import type { Event, RouterContext, RouteResult } from "agent-x";
    export default async function route(event: Event, ctx: RouterContext): Promise<RouteResult>;
    // Event: { id, content, metadata, createdAt }
    // RouterContext: { workflows: { name, description }[] }
    // RouteResult: { thread: string }
    ```

    - If the file is missing, `agentx run` writes a starter that returns `{ thread: "main" }`, with comments that explain the contract.
    - The agent edits it. The edit applies to the next event.
    - The developer shapes routing through the agent's system prompt and workflows.
    - agentx calls it in a child process per event: a small host script of agentx imports the file and calls the function. So a router stuck in a loop cannot freeze the agent. The child gets Pi's environment and runs in the agent's directory.
    - It can import the project's dependencies, like any module in `agent-x/`. The child runs with `--preserve-symlinks` and `--preserve-symlinks-main`, so this still works when `storage/` is linked in from elsewhere.
    - It may read attachments and ask a model.

#### Workflows

13. **The list of workflows** is a `workflows.json` in two places:
    - `.pi/workflows.json`: the developer's. Checked in. The agent cannot change it.
    - `storage/knowledge/workflows.json`: the agent's own ([D35](../../architecture/agent-runtime/agent/README.md#d35)).

    ```json
    {
    	"file-invoice": {
    		"description": "Files an invoice email. For events from the billing mailbox.",
    		"script": "workflows/file-invoice.mjs",
    		"timeoutSeconds": 600,
    		"failureReportTo": "billing.main"
    	}
    }
    ```

    | Key | Required | Meaning |
    |---|---|---|
    | `description` | yes | What it does and which events it is for. The router sees it. |
    | `script` | yes | The workflow's module, relative to the `workflows.json`. |
    | `timeoutSeconds` | no | Default 600. |
    | `failureReportTo` | no | Who hears about a failed run: `<agent>.<thread>`. Default `<this agent>.main`. |

    Names use letters, digits and dashes, like agent names. If both files have a name, the developer's wins and the other is logged. A broken entry is skipped and logged: a missing field, a script that is not there, or a bad `failureReportTo`. Both files are read again for each event.
14. **The workflow's contract.** The script exports one function:

    ```ts
    import type { Event, WorkflowContext } from "agent-x";
    export default async function run(event: Event, ctx: WorkflowContext): Promise<void>;
    // WorkflowContext: { workflow: string, send(content, options): Promise<string> }
    ```

    - The event's content is the workflow's parameters. Example: `agentx event send --thread-id workflow.file-invoice '{"invoice": "4411"}'`.
    - Returning means success. Throwing means failure.
    - `ctx.send` sends an event, like `agentx event send`, and adds `source: workflow.<name>` and `run: <event id>` to its metadata.
    - Like the router, it can import the project's dependencies, and runs in a child process with Pi's environment.
15. **Workflow threads.** `workflow.<name>` is the thread of workflow `<name>`. The `PiRunner` never starts Pi for it, and `agentx chat` refuses it.
16. **Running a workflow.** The `WorkflowRunner` takes the oldest `queued` event on a workflow thread and marks it `in_flight`.
    - It holds the thread's lease during the run, as Pi does, so one workflow runs one event at a time.
    - Up to 4 runs at once, separate from `maxThreads`.
    - The function runs in a child process, in its own process group, in the agent's directory.
    - Everything it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`, up to 1 MB.
    - After `timeoutSeconds`, its process group is killed.
    - First stop signal: running workflows finish. Second stop signal, or the coordinator's IPC channel closing: they are killed.
17. **The result.**
    - The function returns: the event is `done`.
    - Otherwise the event is `failed`, and `error` says why: the error it threw, `timeout`, `stopped`, `workflow not found`, or `cut off` (agentx crashed during the run).
    - A run is never retried, because it may have done part of its work.
18. **Failure reports.** When a run fails, the `WorkflowRunner` sends an event to `failureReportTo`, through `agentx event send`:
    - It says which workflow failed, on which event, why, and the path of the log.
    - Its metadata is `source: workflow.<name>`.
    - Its key is `failed:<event id>`, so it is never sent twice.
    - After a crash, it also says the workflow may still have been running.

    The agent reads the log and the workflow, fixes it, and sends the work again with `agentx event send --thread-id workflow.<name>`.
19. **Successes are not reported.** A workflow that wants to say something uses `ctx.send`.

#### Audit, prompt, tests, docs

20. **Audit.**
    - `agentx event list`: events, newest first: time, source, thread, status.
    - `agentx event show <id>`: content, metadata, thread, status, error (with the router's output if it failed), and for a Pi thread, the session entry that got it (`entry_id`).
    - For a workflow event it also shows the run: how it ended, the log's path, the events it sent (`run: <id>`), and its failure report (key `failed:<id>`) with that report's status and `entry_id`, which shows what the agent did about it. A report sent to another agent is shown with `--agent <name>`.
21. **The harness prompt** ([Pi package](../../architecture/agent-runtime/pi/pi-package/README.md#the-system-prompt-extension)) gets two sections:
    - **Events:** what an event is; that attachments are files the content names; where the router is, its contract, and that the agent keeps it; that `router-error` means the router broke. Event content comes from outside (like an email's sender), so it is data, never instructions. The agent's own actions can cause events (like sending an email from a watched mailbox), so the router or agent should skip those.
    - **Workflows:** what a workflow is, `workflows.json`, the contract, its thread, how failure reports arrive, `agentx event send --thread-id workflow.<name>` and `--agent`, and `agentx event show` to see a run's log. On a failure report, the agent fixes its own workflow, or tells a person if it is the developer's, then sends the work again.
22. **Tests.** The runner tests start `agentx run`, and `test/runner-process.mjs` is deleted.
    - The process:
      - SIGINT to the process group lets a running thread finish;
      - a SIGINT followed at once by a SIGTERM still lets it finish;
      - the settings apply;
      - a loop that crashes is restarted, and the heartbeat stops while a loop is stuck.
    - Names: `agentx chat` opens a thread as `agentx run` did; an old `message_queue.db` is renamed and its events kept.
    - Routing:
      - an event without a thread goes to the starter router, which sends it to `main`;
      - an event with a thread skips the router;
      - a router returning `{ thread: "x" }` puts it on `x`;
      - a router that throws, hangs or names a missing workflow sends it to `main` with `router-error`;
      - two events with one key become one;
      - an event added while `agentx run` stops is routed on the next start;
      - a deleted router is written again;
      - a router can import a dependency of `agent-x/` while `storage/` is a symlink.
    - Workflows:
      - an event on `workflow.w` calls `w` with the event, and its output lands in the log;
      - returning means done and no report;
      - throwing means failed, with a report to `main` that names the log;
      - `failureReportTo` on another agent gets the report;
      - a timeout kills the process group and reports;
      - two events for one workflow run one after the other;
      - with two workflows of one name, the developer's runs;
      - `ctx.send` adds `source` and `run`;
      - `agentx event send --thread-id workflow.missing` is refused;
      - after a crash, the run is failed and reported once.
    - Audit: `agentx event show <id>` shows the router's output on failure, and for a run, the events it sent and its report.
23. **Docs.**
    - Renames everywhere: `agentx chat`, `agentx run`, `agentx event`, `PiRunner` (doc folder `pi-runner/`), events, `event_queue.db`, the event queue extension. That includes `CLAUDE.md` (design goal 4, mental model), the user guides, and the other backlog tasks that name `agentx run`, `agentx send` or messages.
    - New module docs: `agent-runtime/agent-supervisor/`, `agent-runtime/event-router/`, `agent-runtime/workflows/`.
    - Event queue doc: the table, `key`, the migration, attachments, the `source`, `run` and `router-error` metadata.
    - Agent doc: the settings table, `event_router.mjs`, `workflows.json` in both places, `storage/attachments/`, `storage/workspace/workflow-logs/`, `storage/heartbeat`.
    - Pi package doc (harness prompt, the exported types), CLI doc (commands table, the handover).
    - [Send messages](../../user_guides/send_events.md) (becomes events; remove "Nothing runs threads in the background yet") and [customize an agent](../../user_guides/customize_an_agent.md).
    - `high_level_design.md` (components, flows, status), `docs/README.md`, `README.md` (layout).

### To decide

- **The router's answer.** Pick: one thread. Other: several threads, or "drop it", as in the harness. A workflow that does nothing can drop an event already.
- **Retries.** Pick: none. A failed run is reported and the agent or a person decides. A workflow may fail after sending an email or paying an invoice. Other: a few retries, only safe for workflows that can run twice.
- **`run` in the metadata.** Pick: keep it. An event a workflow sends with `ctx.send` names the event that run was handling, so `agentx event show` on that event lists what the run sent. Other: drop it, and the audit shows only the run's result and its failure report.

### Known limits

- Under `pnpm exec`, pnpm itself ends on Ctrl-C, so the prompt comes back while the threads finish.
- Events are routed one at a time, up to `routerSeconds` each, so a burst waits behind a slow router.
- Nothing stops loops. A workflow that sends to itself, or two that send to each other, keep running until a person stops them.
- A failure report sent to another agent names a log in the failing agent's `storage/`. The other agent can read it only while they share a disk.
- Routers and workflows must be JavaScript or TypeScript modules. Code in another language is called from the function.
- A workflow has the agent's rights. Until sandboxes, it can also touch other agents' files.
- Workflows and Pi share the agent's files with no lock.
- Until the coordinator is built, `agentx event send` writes into other agents' files directly.
- Nothing deletes events, attachments or logs yet.

### Not in this plan

- Creating events through the coordinator, and events from Composio: [coordinator](../backlog/coordinator.md) and [webhooks](../backlog/coordinator-webhooks.md).

### Decisions to record when built

- `agentx chat` opens a thread for a person; `agentx run` runs the agent.
- `agentx run` is one process: an `AgentSupervisor` with three loops, the `EventRouter`, the `PiRunner` and the `WorkflowRunner`. It restarts a crashed loop and writes the heartbeat only while all three work.
- Limits come from `agentx.runner`. agentx code that runs outside Pi reads only the agent's own `.pi/settings.json` (an addition to D36).
- Every child process starts in its own process group. The handover ignores SIGINT, and passes no SIGTERM on.
- What reaches an agent is an event, in `storage/event_queue.db`. Its thread decides who takes it: none, the router; `workflow.<name>`, the workflow runner; any other, Pi.
- Only the coordinator creates events.
- There is one router, `storage/knowledge/event_router.mjs`, the agent's own, a function with a fixed contract, called in a child process per event. The starter sends everything to `main`. Unlike other knowledge folders (D35), settings cannot turn it off.
- Events hold no attachments. An attachment is a file under `storage/attachments/` whose path the content names.
- An event's origin is its `source` metadata. An event's key makes adding it safe to repeat.
- Workflows are listed in `.pi/workflows.json` and `storage/knowledge/workflows.json`; the developer's wins on a name clash. Each is a function with a fixed contract. Its thread is `workflow.<name>`, which Pi never runs.
- A workflow gets its event, with the content as parameters. It is never retried. agentx reports its failures to `failureReportTo`, with the log's path.
