# Agent runtime

The code that runs one agent, in `src/agent-runtime/`. `agentx chat` uses it to start Pi for a person. `agentx run` uses it to run the agent with no person: route its events, run its Pi threads and its workflows. The [coordinator](../coordinator-runtime/README.md), which runs every agent, is in `src/coordinator-runtime/`. Neither imports the CLI.

```
src/agent-runtime/
  agent-env.ts           the environment of the agent's processes
  storage.ts             where the agent's state is, and the storage link
  project-config.ts      agent-x/agentx.json: the project's agents
  sqlite.ts              opens a SQLite file that several processes share: the queue, the memory index
  time-zone.ts           the agent's time zone, and times as the agent reads them
  supervisor/            agentx run
    run-agent.ts         runAgent: runs the agent until it is stopped
    agent-process.ts     the agent's process that the coordinator starts
    agent-supervisor.ts  class AgentSupervisor: the parent of three loops
    runner-settings.ts   the limits of agentx run
    stop-signals.ts      the first stop signal lets work finish, the second stops it
  events/
    queue.ts             class Queue: the agent's queue file
    mailbox.ts           the inbox and outbox
    send-event.ts        sendEvent: the agent sends, into its outbox
    event-router.ts      class EventRouter: takes the inbox into the queue
  workflows/
    workflow-runner.ts   class WorkflowRunner: runs workflow events
    workflows.ts         the agent's workflows.json
  functions/
    function-call.ts     calls a router or workflow in a child process
    function-host.ts     that child process
    contracts.ts         their types, exported by the package
  pi/
    pi-launch.ts         how Pi is started
    pi-runner.ts         class PiRunner: a Pi process per thread with events
    pi-package/          what Pi loads into every agent
  browser/
    agent-browser.ts     runBrowser: agent-browser on one of the agent's profiles
    browser-command.ts   agentx-browser, the agent's browser command
```

| Module | Covers |
|---|---|
| [agent](agent/README.md) | The agent directory: its definition, knowledge and storage |
| [supervisor](supervisor/README.md) | `agentx run`: three loops, settings, heartbeat, stopping |
| [events](events/README.md) | The queue, the inbox and outbox, sending, and the router loop |
| [workflows](workflows/README.md) | Workflows, their runs and failure reports |
| [functions](functions/README.md) | Calling routers and workflows, and their contracts |
| [pi](pi/README.md) | Starting Pi, and the Pi runner |
| [pi/pi-package](pi/pi-package/README.md) | The Pi package and its system prompt extension |
| [pi/pi-package/event-queue](pi/pi-package/event-queue/README.md) | The extension that hands a thread's events to Pi |
| [pi/pi-package/composio](pi/pi-package/composio/README.md) | Access to external services through Composio |
| [pi/pi-reference](pi/pi-reference/README.md) | The Pi behavior all of this relies on |
| [browser](browser/README.md) | The agent's browser: `agentx-browser` and its profiles |

## Open questions

- What a sandbox is (process, container or VM), and how `storage/` maps into it.
- How the app sends events and gets answers.
