# agentx docs

New here: [quick start](user_guides/quick_start.md).

| Section | What it holds |
|---|---|
| [high_level_design.md](high_level_design.md) | The overall design: goals, components, how they fit, main flows |
| [architecture/](#architecture) | One folder per module, in the same hierarchy as `src/`: its `README.md` (behavior and decisions) plus images or other assets |
| [user_guides/](#user-guides) | How to use agentx |
| [tasks/](tasks/README.md) | Work on agentx, one file per task with YAML frontmatter: `backlog/` and `done/` |

## Architecture

The folders follow `src/`: `cli/`, `agent-runtime/` and `coordinator-runtime/`, and inside each, a folder per module.

| Module | Covers | Status |
|---|---|---|
| [cli](architecture/cli/README.md) | The `agentx` command and its commands | Built |
| [cli/project](architecture/cli/project/README.md) | The project `init-project` creates: the app package and the agent-x package | Built |
| [agent-runtime](architecture/agent-runtime/README.md) | What runs one agent: its modules, and what is planned | `AgentManager` planned |
| [agent-runtime/agent](architecture/agent-runtime/agent/README.md) | An agent directory: its definition, knowledge and storage | Built |
| [agent-runtime/supervisor](architecture/agent-runtime/supervisor/README.md) | `agentx run`: the supervisor and its three loops, settings, heartbeat, stopping | Built |
| [agent-runtime/events](architecture/agent-runtime/events/README.md) | Each agent's event queue, how events are sent, and the router that gives them a thread | Built |
| [agent-runtime/workflows](architecture/agent-runtime/workflows/README.md) | Workflows: the lists, the contract, runs and failure reports | Built |
| [agent-runtime/functions](architecture/agent-runtime/functions/README.md) | Calling the router and workflows in a child process, and their contracts | Built |
| [agent-runtime/pi](architecture/agent-runtime/pi/README.md) | Starting Pi, and the Pi runner: a Pi process for each Pi thread with events | Built |
| [agent-runtime/pi/pi-package](architecture/agent-runtime/pi/pi-package/README.md) | The Pi package agentx adds to every agent: how it loads, the system prompt extension, the harness prompt | Built |
| [agent-runtime/pi/pi-package/event-queue](architecture/agent-runtime/pi/pi-package/event-queue/README.md) | The extension that delivers events to Pi: delivery, workers, what the model sees | Built |
| [agent-runtime/pi/pi-package/composio](architecture/agent-runtime/pi/pi-package/composio/README.md) | Each agent's access to external services through Composio: user id, a session per thread, policy, failures | Built; checked against Composio by hand |
| [agent-runtime/pi/pi-reference](architecture/agent-runtime/pi/pi-reference/README.md) | Pi behavior agentx relies on, with source references | Reference |
| [coordinator-runtime](architecture/coordinator-runtime/README.md) | The process that will run all agents of a project | Planned |

## Decisions

Each decision lives in the "Decisions" section of the module it affects, and describes the design as it is. Numbers are global and are not used again when a decision is deleted; the next free number is **D54**.

| # | Decision | Module |
|---|---|---|
| [D1](architecture/agent-runtime/agent/README.md#d1) | Run the Pi CLI from agentx's own dependency | agent-runtime/agent |
| [D2](architecture/agent-runtime/agent/README.md#d2) | The agent directory is Pi's working directory, and the agent's definition is in its `.pi/` | agent-runtime/agent |
| [D4](architecture/agent-runtime/agent/README.md#d4) | Starting an agent changes nothing that is checked in | agent-runtime/agent |
| [D5](architecture/agent-runtime/agent/README.md#d5) | The system prompt comes from an extension | agent-runtime/agent |
| [D6](architecture/agent-runtime/agent/README.md#d6) | `chat` passes `-nc` and `--approve`, except before Pi subcommands | agent-runtime/agent |
| [D7](architecture/cli/project/README.md#d7) | `init-project` runs `git init`, which bounds Pi's search for skills | cli/project |
| [D11](architecture/agent-runtime/pi/pi-package/README.md#d11) | agentx's Pi package ships in the agentx package | agent-runtime/pi/pi-package |
| [D12](architecture/cli/README.md#d12) | npm package `agent-x`; the command is `agentx` | cli |
| [D14](architecture/cli/project/README.md#d14) | `web/` and `agent-x/` are independent packages | cli/project |
| [D15](architecture/cli/README.md#d15) | Any `agentx` hands over to the copy the project pins | cli |
| [D16](architecture/agent-runtime/pi/pi-package/README.md#d16) | Whoever starts Pi passes agentx's part of the config | agent-runtime/pi/pi-package |
| [D17](architecture/agent-runtime/agent/README.md#d17) | One Pi agent directory per project, `agent-x/.pi` | agent-runtime/agent |
| [D19](architecture/agent-runtime/events/README.md#d19) | SQLite through Node's built-in `node:sqlite` | agent-runtime/events |
| [D21](architecture/agent-runtime/pi/README.md#d21) | A thread is a Pi session; the thread id is the session id | agent-runtime/pi |
| [D22](architecture/agent-runtime/events/README.md#d22) | One live process per thread, by a lease in the queue file | agent-runtime/events |
| [D23](architecture/agent-runtime/pi/README.md#d23) | The event queue extension is the only consumer of a Pi thread's events; the runner only starts Pi processes | agent-runtime/pi |
| [D24](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d24) | A retry sends the event again, marked as a retry; three attempts | agent-runtime/pi/pi-package/event-queue |
| [D25](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d25) | A queued event reaches Pi as a user message that starts with a metadata block | agent-runtime/pi/pi-package/event-queue |
| [D28](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d28) | Only a session that stays open takes events from the queue | agent-runtime/pi/pi-package/event-queue |
| [D30](architecture/cli/README.md#d30) | `agentx event send` takes metadata as repeated `--meta name=value` | cli |
| [D31](architecture/agent-runtime/pi/README.md#d31) | The runner starts a Pi process per thread, in RPC mode | agent-runtime/pi |
| [D32](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d32) | The Pi runner's sessions are workers, marked with `--agentx-worker` | agent-runtime/pi/pi-package/event-queue |
| [D33](architecture/agent-runtime/pi/README.md#d33) | The Pi runner takes a thread from its dead Pi process by process id | agent-runtime/pi |
| [D35](architecture/agent-runtime/agent/README.md#d35) | What an agent learns is kept in `storage/knowledge/`, apart from its definition | agent-runtime/agent |
| [D36](architecture/agent-runtime/agent/README.md#d36) | agentx's own settings for an agent are under `agentx` in its `.pi/settings.json` | agent-runtime/agent |
| [D38](architecture/agent-runtime/pi/pi-package/composio/README.md#d38) | Each agent has its own Composio user id, written into its settings by `init-agent` | agent-runtime/pi/pi-package/composio |
| [D39](architecture/agent-runtime/pi/pi-package/composio/README.md#d39) | One Composio session per thread, recorded in the thread's Pi session | agent-runtime/pi/pi-package/composio |
| [D40](architecture/agent-runtime/pi/pi-package/composio/README.md#d40) | The extension registers the session's MCP server, with direct tools, and uses no Composio SDK | agent-runtime/pi/pi-package/composio |
| [D41](architecture/agent-runtime/pi/pi-package/composio/README.md#d41) | Without Composio, the session starts and the model is told why | agent-runtime/pi/pi-package/composio |
| [D42](architecture/agent-runtime/pi/pi-package/README.md#d42) | The package's manifest lists its extensions in the order they load | agent-runtime/pi/pi-package |
| [D43](architecture/agent-runtime/agent/README.md#d43) | Keys for all agents of a project go in the gitignored `agent-x/.env`; the environment wins | agent-runtime/agent |
| [D44](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d44) | The session takes queued events only once every extension has started | agent-runtime/pi/pi-package/event-queue |
| [D45](architecture/cli/README.md#d45) | `agentx run` runs the agent; `agentx chat` opens a thread for a person; `agentx event` sends and shows events | cli |
| [D46](architecture/agent-runtime/supervisor/README.md#d46) | `agentx run` is one process: a supervisor with three loops | agent-runtime/supervisor |
| [D47](architecture/agent-runtime/events/README.md#d47) | What reaches an agent is an event, and its thread decides who takes it | agent-runtime/events |
| [D48](architecture/agent-runtime/events/README.md#d48) | Every sender goes through `sendEvent` | agent-runtime/events |
| [D49](architecture/agent-runtime/events/README.md#d49) | Events hold no attachments | agent-runtime/events |
| [D50](architecture/agent-runtime/events/README.md#d50) | An event's key makes adding it idempotent | agent-runtime/events |
| [D51](architecture/agent-runtime/events/README.md#d51) | One router, the agent's own: a function called in a child process for each event | agent-runtime/events |
| [D52](architecture/agent-runtime/workflows/README.md#d52) | Workflows are listed in two `workflows.json` files; each is a function on its own thread | agent-runtime/workflows |
| [D53](architecture/agent-runtime/workflows/README.md#d53) | A run gets one attempt, and agentx reports every failure | agent-runtime/workflows |

## User guides

| Guide | For |
|---|---|
| [quick_start.md](user_guides/quick_start.md) | From nothing to a running app and agent |
| [chat_with_an_agent.md](user_guides/chat_with_an_agent.md) | Open a thread, continue and resume sessions |
| [send_events.md](user_guides/send_events.md) | Run an agent, send it events, route them, write workflows, and look back at what happened |
| [customize_an_agent.md](user_guides/customize_an_agent.md) | System prompt, skills, extensions, MCP servers, Composio, packages |
| [develop_agentx.md](user_guides/develop_agentx.md) | Work on agentx itself |

## Maintaining these docs

See [CLAUDE.md](../CLAUDE.md#documentation): what goes where, what to update after creating a module, and the decision format.
