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
| [cli/deploy](architecture/cli/deploy/README.md) | `agentx dev` and `agentx server`: a project on a laptop and on an Ubuntu server, and the logins and keys they ask for |
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
| [agent-runtime/pi/pi-package/episodes](architecture/agent-runtime/pi/pi-package/episodes/README.md) | Episodes, each of Pi's runs, ended by a message with its id and the tokens it added |
| [agent-runtime/pi/pi-package/context](architecture/agent-runtime/pi/pi-package/context/README.md) | Folds of episodes, which the agent writes when a fold nudge asks |
| [agent-runtime/pi/pi-package/memory](architecture/agent-runtime/pi/pi-package/memory/README.md) | Episodic memory: the index of every thread's episodes, searched by keyword and read back |
| [agent-runtime/pi/pi-reference](architecture/agent-runtime/pi/pi-reference/README.md) | Pi behavior agentx relies on |
| [agent-runtime/browser](architecture/agent-runtime/browser/README.md) | The agent's browser: `agentx-browser` and its profiles |
| [coordinator-runtime](architecture/coordinator-runtime/README.md) | `agentx serve`: runs every agent and the services, reports health, serves the services' requests |
| [coordinator-runtime/services/relay](architecture/coordinator-runtime/services/relay/README.md) | Core service: delivers the events agents send, from outboxes into inboxes |
| [coordinator-runtime/services/scheduler](architecture/coordinator-runtime/services/scheduler/README.md) | Core service: fires each agent's schedules |
| [coordinator-runtime/services/composio](architecture/coordinator-runtime/services/composio/README.md) | Core service: Composio's webhook, each trigger event to its agent |
| [coordinator-runtime/services/telegram](architecture/coordinator-runtime/services/telegram/README.md) | Optional service: each agent's Telegram bot, its chats' messages and button taps to the agent |
| [coordinator-runtime/services/webhooks](architecture/coordinator-runtime/services/webhooks/README.md) | Optional service: each agent's webhooks, which it keeps with `agentx webhook`, each request to its workflow |

## Decisions

Each decision is in the "Decisions" section of the module it affects. Numbers are not used again; the next free number is **D113**.

| # | Decision | Module |
|---|---|---|
| [D1](architecture/agent-runtime/agent/README.md#d1) | Run the Pi CLI from agentx's own dependency | agent-runtime/agent |
| [D2](architecture/agent-runtime/agent/README.md#d2) | The agent directory is Pi's working directory, and the definition is in its `.pi/` | agent-runtime/agent |
| [D4](architecture/agent-runtime/agent/README.md#d4) | Starting an agent changes nothing that is checked in | agent-runtime/agent |
| [D5](architecture/agent-runtime/agent/README.md#d5) | The system prompt comes from an extension | agent-runtime/agent |
| [D6](architecture/agent-runtime/agent/README.md#d6) | `chat` passes `-nc` and `--approve`, except before Pi subcommands | agent-runtime/agent |
| [D7](architecture/cli/project/README.md#d7) | `init-project` runs `git init`, which bounds Pi's search for skills | cli/project |
| [D11](architecture/agent-runtime/pi/pi-package/README.md#d11) | agentx's Pi package ships in the agentx package | agent-runtime/pi/pi-package |
| [D12](architecture/cli/README.md#d12) | npm package `@cognisphere-sh/agentx`; the command is `agentx` | cli |
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
| [D35](architecture/agent-runtime/agent/README.md#d35) | The agent's knowledge is `.pi/knowledge/`, one checked-in source that the agent and its developer both write | agent-runtime/agent |
| [D36](architecture/agent-runtime/agent/README.md#d36) | agentx's own settings for an agent are under `agentx` in its `.pi/settings.json` | agent-runtime/agent |
| [D38](architecture/agent-runtime/pi/pi-package/composio/README.md#d38) | Each agent has its own Composio user id, written into its settings by `init-agent` | agent-runtime/pi/pi-package/composio |
| [D39](architecture/agent-runtime/pi/pi-package/composio/README.md#d39) | One Composio session per thread, recorded in the thread's Pi session | agent-runtime/pi/pi-package/composio |
| [D40](architecture/agent-runtime/pi/pi-package/composio/README.md#d40) | The extension registers the session's MCP server, with direct tools, and uses no Composio SDK | agent-runtime/pi/pi-package/composio |
| [D41](architecture/agent-runtime/pi/pi-package/composio/README.md#d41) | Without Composio, the session starts and the model is told why | agent-runtime/pi/pi-package/composio |
| [D42](architecture/agent-runtime/pi/pi-package/README.md#d42) | The package's manifest lists its extensions in the order they load | agent-runtime/pi/pi-package |
| [D43](architecture/agent-runtime/agent/README.md#d43) | Each agent's keys go in its own gitignored `.env`; the environment wins | agent-runtime/agent |
| [D44](architecture/agent-runtime/pi/pi-package/event-queue/README.md#d44) | The session takes events only once every extension has started | agent-runtime/pi/pi-package/event-queue |
| [D45](architecture/cli/README.md#d45) | `run` runs the agent, `chat` opens a thread, `event` sends and delivers | cli |
| [D46](architecture/agent-runtime/supervisor/README.md#d46) | `agentx run` is one process: a supervisor with three loops | agent-runtime/supervisor |
| [D47](architecture/agent-runtime/events/README.md#d47) | What reaches an agent is an event, and its thread decides who takes it | agent-runtime/events |
| [D48](architecture/agent-runtime/events/README.md#d48) | Only the agent sends, into its own outbox; only the host delivers, with `deliverEvent` | agent-runtime/events |
| [D49](architecture/agent-runtime/events/README.md#d49) | An event's files are in its inbox folder | agent-runtime/events |
| [D50](architecture/agent-runtime/events/README.md#d50) | An event's key makes adding it idempotent | agent-runtime/events |
| [D51](architecture/agent-runtime/events/README.md#d51) | One router, which the agent and its developer both write, called in a child process | agent-runtime/events |
| [D52](architecture/agent-runtime/workflows/README.md#d52) | Workflows are listed in one `workflows.json`; each is a function on its own thread | agent-runtime/workflows |
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
| [D68](architecture/coordinator-runtime/README.md#d68) | A service's config is in `agentx.json`, and its secrets in `agent-x/.env` | coordinator-runtime |
| [D69](architecture/coordinator-runtime/README.md#d69) | The coordinator and every service declare their API as routes | coordinator-runtime |
| [D70](architecture/coordinator-runtime/README.md#d70) | Private routes need the API token; a public route checks its caller itself; people sign in to the web app | coordinator-runtime |
| [D71](architecture/coordinator-runtime/services/composio/README.md#d71) | One Composio webhook for the project, which finds the agent by its Composio user id | coordinator-runtime/services/composio |
| [D72](architecture/coordinator-runtime/services/telegram/README.md#d72) | Telegram messages come in through a service; the agent answers with Composio's Telegram tools | coordinator-runtime/services/telegram |
| [D73](architecture/agent-runtime/pi/pi-package/README.md#d73) | Each prompt file is a section of the system prompt of its own | agent-runtime/pi/pi-package |
| [D74](architecture/agent-runtime/functions/README.md#d74) | Routers, workflows and the project's services are TypeScript, which Node runs by stripping the types | agent-runtime/functions |
| [D75](architecture/coordinator-runtime/README.md#d75) | A project's developer writes services of its own in `agent-x/services/`, on the same contract, in the coordinator's process | coordinator-runtime |
| [D76](architecture/agent-runtime/pi/pi-package/composio/README.md#d76) | The agent's settings name its toolkits; agentx's code names none | agent-runtime/pi/pi-package/composio |
| [D77](architecture/coordinator-runtime/services/telegram/README.md#d77) | The Telegram service connects each bot in Composio with the coordinator's own Composio key | coordinator-runtime/services/telegram |
| [D78](architecture/agent-runtime/browser/README.md#d78) | An agent's browser is the agent-browser agentx pins, run with `agentx-browser` | agent-runtime/browser |
| [D79](architecture/agent-runtime/browser/README.md#d79) | A profile is a Chrome profile in the agent's storage, and one browser | agent-runtime/browser |
| [D82](architecture/agent-runtime/functions/README.md#d82) | A workflow runs Composio tools with `ctx.composio`, in a session of its run with the agent's policy | agent-runtime/functions |
| [D83](architecture/agent-runtime/agent/README.md#d83) | A new agent lists Pi packages, at exact versions, in its own settings | agent-runtime/agent |
| [D84](architecture/coordinator-runtime/services/telegram/README.md#d84) | The agent asks a question with fixed answers on inline buttons, which the service closes at the first tap | coordinator-runtime/services/telegram |
| [D85](architecture/agent-runtime/pi/pi-package/README.md#d85) | Each skill is a section of the system prompt of its own, with its version, read again on every run | agent-runtime/pi/pi-package |
| [D86](architecture/agent-runtime/pi/pi-package/episodes/README.md#d86) | The episode is the unit of folds and of memory, ended by a message that gives its id and the tokens it added | agent-runtime/pi/pi-package/episodes |
| [D87](architecture/agent-runtime/pi/pi-package/context/README.md#d87) | A fold puts the summary in place of the first message the model sees of its range, omits the rest and the `fold` call, and takes in earlier folds whole or not at all | agent-runtime/pi/pi-package/context |
| [D89](architecture/agent-runtime/pi/pi-package/context/README.md#d89) | The agent folds only when a fold nudge asks, after an episode ends, with one turn of its own and the instructions in the fold nudge, which then leave the context | agent-runtime/pi/pi-package/context |
| [D90](architecture/agent-runtime/pi/pi-package/memory/README.md#d90) | One SQLite index of every thread's episodes per agent, with FTS5, built from the session files | agent-runtime/pi/pi-package/memory |
| [D91](architecture/agent-runtime/pi/pi-package/memory/README.md#d91) | Each session indexes only its own episodes, when a run settles, from the last end message it indexed | agent-runtime/pi/pi-package/memory |
| [D92](architecture/agent-runtime/pi/pi-package/memory/README.md#d92) | A search matches any of its words, each a phrase of its own, with one hit per episode | agent-runtime/pi/pi-package/memory |
| [D93](architecture/coordinator-runtime/services/telegram/README.md#d93) | An album is one event, gathered after each part is answered | coordinator-runtime/services/telegram |
| [D94](architecture/cli/README.md#d94) | A person removes a thread with `agentx remove-thread`, which takes its episodes out of the memory index too, and only while the thread is idle | cli |
| [D95](architecture/agent-runtime/pi/pi-package/episodes/README.md#d95) | An episode's tokens come from the model's usage: what its last answer used, less what its first answer read, plus its event | agent-runtime/pi/pi-package/episodes |
| [D96](architecture/agent-runtime/events/README.md#d96) | The thread `pass` drops an event, which stays on the queue as `passed` | agent-runtime/events |
| [D97](architecture/agent-runtime/pi/pi-package/composio/README.md#d97) | The Composio extension trims a search's answer by removing the fields it names | agent-runtime/pi/pi-package/composio |
| [D98](architecture/agent-runtime/agent/README.md#d98) | Every time the agent sees is in its time zone: its processes run with `TZ`, and the harness writes its times in it | agent-runtime/agent |
| [D99](architecture/cli/README.md#d99) | `agentx upgrade-project` installs the latest agentx, and the new copy brings the files up to its own templates | cli |
| [D100](architecture/cli/README.md#d100) | An upgrade adds what the templates have and the files lack, and changes no value | cli |
| [D101](architecture/coordinator-runtime/services/webhooks/README.md#d101) | An agent's webhook is a URL with a random token, which the agent makes and keeps with `agentx webhook`, and each request runs one of its workflows | coordinator-runtime/services/webhooks |
| [D102](architecture/coordinator-runtime/services/webhooks/README.md#d102) | The URL's token is a webhook's only check, and the workflow confirms what a request says through Composio | coordinator-runtime/services/webhooks |
| [D103](architecture/coordinator-runtime/services/webhooks/README.md#d103) | A webhook answers 200 once the event is in the inbox, and never with an answer its caller waits for | coordinator-runtime/services/webhooks |
| [D104](architecture/agent-runtime/pi/pi-package/README.md#d104) | How to write a router, a workflow, a schedule or a webhook is a skill of the package, and the harness's rules name it | agent-runtime/pi/pi-package |
| [D105](architecture/cli/deploy/README.md#d105) | Running a project on a laptop or a server is agentx's, and a project adds only its own scripts | cli/deploy |
| [D106](architecture/cli/deploy/README.md#d106) | A server is Ubuntu, with Caddy for HTTPS and systemd user services | cli/deploy |
| [D107](architecture/cli/deploy/README.md#d107) | The web app builds beside the running one, in two folders in turn | cli/deploy |
| [D108](architecture/cli/deploy/README.md#d108) | The commands a person types ask for logins and keys; `agentx serve` only logs a missing login | cli/deploy |
| [D109](architecture/coordinator-runtime/README.md#d109) | `AGENTX_PUBLIC_URL` gives one run its own public address | coordinator-runtime |
| [D110](architecture/coordinator-runtime/README.md#d110) | A service marks an optional secret with `?` | coordinator-runtime |
| [D111](architecture/cli/project/README.md#d111) | `agent-x/` tells pnpm which install scripts to skip | cli/project |
| [D112](architecture/agent-runtime/pi/pi-package/context/README.md#d112) | A summary of independent tasks has a part per task, which starts with its episodes' ids | agent-runtime/pi/pi-package/context |

## User guides

| Guide | For |
|---|---|
| [quick_start.md](user_guides/quick_start.md) | From nothing to a running app and agent |
| [chat_with_an_agent.md](user_guides/chat_with_an_agent.md) | Threads, sessions, one-shot runs |
| [send_events.md](user_guides/send_events.md) | Run an agent, give it events and files, route them, write workflows |
| [run_on_a_server.md](user_guides/run_on_a_server.md) | Run a project on an Ubuntu server with `agentx server`, or another host with `agentx serve`: health, restarts, stopping, state, keys, Composio's events, Telegram, webhooks |
| [customize_an_agent.md](user_guides/customize_an_agent.md) | Prompt, skills, extensions, MCP, Composio, workflows, schedules, `canSendTo`, time zone |
| [give_an_agent_a_browser.md](user_guides/give_an_agent_a_browser.md) | The agent's browser: setting it up, and its profiles |
| [write_a_service.md](user_guides/write_a_service.md) | A service of the project's own in `agent-x/services/`: a webhook, its config, secrets and routes |
| [upgrade_agentx.md](user_guides/upgrade_agentx.md) | Move a project to the latest agentx, with the settings and keys it adds |
| [develop_agentx.md](user_guides/develop_agentx.md) | Work on agentx itself: build, test, branches, pull requests and releases |

## Maintaining these docs

See [CLAUDE.md](../CLAUDE.md#documentation).
