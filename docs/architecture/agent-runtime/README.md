# Agent runtime

The agent runtime is the code that runs one agent. It lives in `src/agent-runtime/`, beside `src/cli/`; the planned coordinator gets its own folder, `src/coordinator-runtime/`. `agentx chat` uses it to start Pi for a person at a terminal. `agentx run` uses it to run the agent with no person present: route its events, run its Pi threads and its workflows.

```
src/agent-runtime/
  agent-env.ts           the environment of the agent's processes: Pi, the router, workflows
  supervisor/            `agentx run` itself
    agent-supervisor.ts  class AgentSupervisor: the parent of three loops
    runner-settings.ts   the limits of `agentx run`, from the agent's settings
  events/                an event before anyone handles it: stored, sent, given a thread
    queue.ts             class Queue: the agent's queue file
    send-event.ts        sendEvent: how every sender adds an event
    event-router.ts      class EventRouter: gives events without a thread their thread
  workflows/             events handled by a script
    workflow-runner.ts   class WorkflowRunner: runs the events of workflow threads
    workflows.ts         the agent's workflows, from its two workflows.json
  functions/             running a function the agent or its developer wrote: the router, a workflow
    function-call.ts     calls it in a child process
    function-host.ts     that child process
    contracts.ts         the types of those functions, exported as the package's types
  pi/                    events handled by Pi
    pi-launch.ts         how Pi is started, for `agentx chat` and for the Pi runner
    pi-runner.ts         class PiRunner: a Pi process per Pi thread with events
    pi-package/          what Pi loads into every agent
      extensions/system-prompt/    builds the system prompt
      extensions/event-queue/      delivers a Pi thread's events to Pi
      extensions/composio/         gives each thread a Composio session and its tools
  agent-manager.ts       class AgentManager (planned)
```

| Module | Covers |
|---|---|
| [agent](agent/README.md) | The agent directory: its definition, knowledge and storage |
| [supervisor](supervisor/README.md) | `agentx run`: the supervisor, its three loops, settings, heartbeat and stopping |
| [events](events/README.md) | The event queue, how events are sent, and the router that gives them a thread |
| [workflows](workflows/README.md) | Workflows, their runs and their failure reports |
| [functions](functions/README.md) | Calling the router and workflows in a child process, and their contracts |
| [pi](pi/README.md) | Starting Pi, and the Pi runner: one Pi process per Pi thread with events |
| [pi/pi-package](pi/pi-package/README.md) | The Pi package agentx adds to every agent: how it loads, and the system prompt extension |
| [pi/pi-package/event-queue](pi/pi-package/event-queue/README.md) | The extension that delivers a Pi thread's events to Pi |
| [pi/pi-package/composio](pi/pi-package/composio/README.md) | Each agent's access to external services through Composio |
| [pi/pi-reference](pi/pi-reference/README.md) | The Pi behavior all of this relies on |

## Planned

- **AgentManager.** Starts, watches and stops each agent's process, and later its sandbox ([coordinator](../../tasks/backlog/coordinator.md)).

## Open questions

- What a sandbox is (process, container or VM), and how `storage/` maps into it.
- How the app sends events and gets answers. There is no API for it yet and no way to answer back.
