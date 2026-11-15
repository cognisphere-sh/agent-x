# agentx docs

New here: [quick start](user_guides/quick_start.md).

| Section | What it holds |
|---|---|
| [high_level_design.md](high_level_design.md) | Project structure, modules with their responsibilities and dependencies, lifecycles, status |
| [architecture/](#architecture) | One folder per module, as in `src/`: its behavior and decisions |
| [user_guides/](#user-guides) | How to use agentx |
| [tasks/](tasks/README.md) | Work on agentx: `backlog/` and `done/` |

## Architecture

| Module | Covers |
|---|---|
| [cli](architecture/cli/README.md) | The `agentx` command |
| [cli/project](architecture/cli/project/README.md) | The project `init-project` creates |
| [agent-runtime](architecture/agent-runtime/README.md) | What runs one agent |
| [agent-runtime/agent](architecture/agent-runtime/agent/README.md) | An agent directory: definition, knowledge, storage |
| [agent-runtime/supervisor](architecture/agent-runtime/supervisor/README.md) | `agentx run`: three loops, settings, heartbeat, stopping |
| [agent-runtime/events](architecture/agent-runtime/events/README.md) | The queue, the inbox and outbox, sending, and the router loop |
| [agent-runtime/workflows](architecture/agent-runtime/workflows/README.md) | Workflows, their runs and failure reports |
| [agent-runtime/functions](architecture/agent-runtime/functions/README.md) | Calling routers and workflows in a child process |
| [agent-runtime/pi](architecture/agent-runtime/pi/README.md) | Starting Pi, and the Pi runner |
| [agent-runtime/pi/pi-package](architecture/agent-runtime/pi/pi-package/README.md) | What agentx adds to every agent, and the system prompt |
| [agent-runtime/pi/pi-package/event-queue](architecture/agent-runtime/pi/pi-package/event-queue/README.md) | Handing a thread's events to Pi |
| [agent-runtime/pi/pi-package/composio](architecture/agent-runtime/pi/pi-package/composio/README.md) | Access to external services through Composio |
| [agent-runtime/pi/pi-reference](architecture/agent-runtime/pi/pi-reference/README.md) | Pi behavior agentx relies on |
| [coordinator-runtime](architecture/coordinator-runtime/README.md) | `agentx serve`: runs every agent and the services, reports health, serves the services' requests |
| [coordinator-runtime/services/relay](architecture/coordinator-runtime/services/relay/README.md) | Core service: delivers the events agents send, from outboxes into inboxes |
| [coordinator-runtime/services/scheduler](architecture/coordinator-runtime/services/scheduler/README.md) | Core service: fires each agent's schedules |
| [coordinator-runtime/services/composio](architecture/coordinator-runtime/services/composio/README.md) | Core service: Composio's webhook, each trigger event to its agent |
| [coordinator-runtime/services/telegram](architecture/coordinator-runtime/services/telegram/README.md) | Optional service: each agent's Telegram bot, its chats' messages to the agent |

## Decisions

Each decision is in the "Decisions" section of the module it affects. Numbers are not used again; the next free number is **D66**.

| # | Decision | Module |
|---|---|---|
| [D1](architecture/agent-runtime/agent/README.md#d1) | Run the Pi CLI from agentx's own dependency | agent-runtime/agent |
| [D2](architecture/agent-runtime/agent/README.md#d2) | The agent directory is Pi's working directory, and the definition is in its `.pi/` | agent-runtime/agent |
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
| [D21](architecture/agent-runtime/pi/README.md#d21) | A thread is a folder of Pi sessions, and its latest session goes on | agent-runtime/pi |
| [D22](architecture/agent-runtime/events/README.md#d22) | One live process per thread, by a lease in the queue file | agent-runtime/events |
| [D23](architecture/agent-runtime/pi/README.md#d23) | The event queue extension is the only consumer of a Pi thread's events; the runner only starts Pi processes | agent-runtime/pi |
| [D24](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d24) | A retry sends the event again, marked as a retry; three attempts | agent-runtime/pi/pi-package/event-queue |
| [D25](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d25) | An event reaches Pi as a user message that starts with a metadata block | agent-runtime/pi/pi-package/event-queue |
| [D28](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d28) | Only a session that stays open takes events from the queue | agent-runtime/pi/pi-package/event-queue |
| [D30](architecture/cli/README.md#d30) | `agentx event` takes metadata as repeated `--meta name=value` | cli |
| [D31](architecture/agent-runtime/pi/README.md#d31) | The runner starts a Pi process per thread, in RPC mode | agent-runtime/pi |
| [D32](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d32) | The Pi runner's sessions are workers, marked with `--agentx-worker` | agent-runtime/pi/pi-package/event-queue |
| [D33](architecture/agent-runtime/pi/README.md#d33) | The Pi runner frees a thread of its dead Pi process by process id | agent-runtime/pi |
| [D35](architecture/agent-runtime/agent/README.md#d35) | What an agent learns is kept in `storage/knowledge/`, apart from its definition | agent-runtime/agent |
| [D36](architecture/agent-runtime/agent/README.md#d36) | agentx's own settings for an agent are under `agentx` in its `.pi/settings.json` | agent-runtime/agent |
| [D38](architecture/agent-runtime/pi/pi-package/composio/README.md#d38) | Each agent has its own Composio user id, written into its settings by `init-agent` | agent-runtime/pi/pi-package/composio |
| [D39](architecture/agent-runtime/pi/pi-package/composio/README.md#d39) | One Composio session per thread, recorded in the thread's Pi session | agent-runtime/pi/pi-package/composio |
| [D40](architecture/agent-runtime/pi/pi-package/composio/README.md#d40) | The extension registers the session's MCP server, with direct tools, and uses no Composio SDK | agent-runtime/pi/pi-package/composio |
| [D41](architecture/agent-runtime/pi/pi-package/composio/README.md#d41) | Without Composio, the session starts and the model is told why | agent-runtime/pi/pi-package/composio |
| [D42](architecture/agent-runtime/pi/pi-package/README.md#d42) | The package's manifest lists its extensions in the order they load | agent-runtime/pi/pi-package |
| [D43](architecture/agent-runtime/agent/README.md#d43) | Keys for all agents of a project go in the gitignored `agent-x/.env`; the environment wins | agent-runtime/agent |
| [D44](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d44) | The session takes events only once every extension has started | agent-runtime/pi/pi-package/event-queue |
| [D45](architecture/cli/README.md#d45) | `run` runs the agent, `chat` opens a thread, `event` sends and delivers | cli |
| [D46](architecture/agent-runtime/supervisor/README.md#d46) | `agentx run` is one process: a supervisor with three loops | agent-runtime/supervisor |
| [D47](architecture/agent-runtime/events/README.md#d47) | What reaches an agent is an event, and its thread decides who takes it | agent-runtime/events |
| [D48](architecture/agent-runtime/events/README.md#d48) | Only the agent sends, into its own outbox; only the host delivers, with `deliverEvent` | agent-runtime/events |
| [D49](architecture/agent-runtime/events/README.md#d49) | An event's files are in its inbox folder | agent-runtime/events |
| [D50](architecture/agent-runtime/events/README.md#d50) | An event's key makes adding it idempotent | agent-runtime/events |
| [D51](architecture/agent-runtime/events/README.md#d51) | Two routers, the agent's then the developer's, each called in a child process | agent-runtime/events |
| [D52](architecture/agent-runtime/workflows/README.md#d52) | Workflows are listed in two `workflows.json` files; each is a function on its own thread | agent-runtime/workflows |
| [D53](architecture/agent-runtime/workflows/README.md#d53) | A run gets one attempt, and every failure is reported to the babysitter thread | agent-runtime/workflows |
| [D54](architecture/agent-runtime/events/README.md#d54) | Every event reaches an agent through its inbox, and only the router loop adds events to the queue | agent-runtime/events |
| [D55](architecture/agent-runtime/events/README.md#d55) | A mailbox is a folder per event, kept, and an empty marker per waiting event | agent-runtime/events |
| [D56](architecture/coordinator-runtime/README.md#d56) | Each agent is a process of its own, which the coordinator's AgentManager keeps running | coordinator-runtime |
| [D57](architecture/coordinator-runtime/README.md#d57) | An agent's heartbeat is a file in its `storage/` | coordinator-runtime |
| [D58](architecture/coordinator-runtime/README.md#d58) | `/health` says whether the coordinator runs; `/agents` says how each agent is | coordinator-runtime |
| [D59](architecture/coordinator-runtime/README.md#d59) | An agent's process ends with the coordinator | coordinator-runtime |
| [D60](architecture/coordinator-runtime/services/relay/README.md#d60) | Every event an agent sends goes from its outbox, through the coordinator, into the receiver's inbox | coordinator-runtime/services/relay |
| [D61](architecture/coordinator-runtime/services/relay/README.md#d61) | A send that cannot be delivered is reported on the sending thread | coordinator-runtime/services/relay |
| [D62](architecture/coordinator-runtime/services/relay/README.md#d62) | The sender's entry in `agentx.json` says which agents it may send to | coordinator-runtime/services/relay |
| [D63](architecture/coordinator-runtime/README.md#d63) | The project's `agentx.json` lists its agents | coordinator-runtime |
| [D64](architecture/coordinator-runtime/services/scheduler/README.md#d64) | Schedules are files the coordinator polls each second | coordinator-runtime/services/scheduler |
| [D65](architecture/agent-runtime/agent/README.md#d65) | An agent's state lives in `agent-x/storage/<agent>/`, reached as `storage/` through a link | agent-runtime/agent |
| [D66](architecture/coordinator-runtime/README.md#d66) | Everything the coordinator does besides running the agents is a service, in its process | coordinator-runtime |
| [D67](architecture/coordinator-runtime/README.md#d67) | A service polls with `context.every` | coordinator-runtime |
| [D68](architecture/coordinator-runtime/README.md#d68) | A service's config is in `agentx.json`, and its secrets in `agent-x/.env.services` | coordinator-runtime |
| [D69](architecture/coordinator-runtime/README.md#d69) | The coordinator and every service declare their API as routes | coordinator-runtime |
| [D70](architecture/coordinator-runtime/README.md#d70) | Private routes need the API token; a public route checks its caller itself; people sign in to the web app | coordinator-runtime |
| [D71](architecture/coordinator-runtime/services/composio/README.md#d71) | One Composio webhook for the project, which finds the agent by its Composio user id | coordinator-runtime/services/composio |
| [D72](architecture/coordinator-runtime/services/telegram/README.md#d72) | Telegram messages come in through a service; the agent answers with Composio's Telegram tools | coordinator-runtime/services/telegram |

## User guides

| Guide | For |
|---|---|
| [quick_start.md](user_guides/quick_start.md) | From nothing to a running app and agent |
| [chat_with_an_agent.md](user_guides/chat_with_an_agent.md) | Threads, sessions, one-shot runs |
| [send_events.md](user_guides/send_events.md) | Run an agent, give it events and files, route them, write workflows |
| [run_on_a_server.md](user_guides/run_on_a_server.md) | Run every agent with `agentx serve`: health, restarts, stopping, state, Composio's events, Telegram |
| [customize_an_agent.md](user_guides/customize_an_agent.md) | Prompt, skills, extensions, MCP, Composio, workflows, schedules, `canSendTo`, time zone |
| [develop_agentx.md](user_guides/develop_agentx.md) | Work on agentx itself |

## Maintaining these docs

See [CLAUDE.md](../CLAUDE.md#documentation).
