# agentx docs

New here: [quick start](user_guides/quick_start.md).

| Section | What it holds |
|---|---|
| [high_level_design.md](high_level_design.md) | The overall design: goals, components, how they fit, main flows |
| [architecture/](#architecture) | One folder per module, in the same hierarchy as `src/`: its `README.md` (behavior and decisions) plus images or other assets |
| [user_guides/](#user-guides) | How to use agentx |
| [todos/](todos/README.md) | Planned work, one file per item with YAML frontmatter (type, priority, status) |

## Architecture

The folders follow `src/`: `cli/`, `agent-runtime/` and `coordinator-runtime/`, and inside each, a folder per module.

| Module | Covers | Status |
|---|---|---|
| [cli](architecture/cli/README.md) | The `agentx` command and its commands | Built |
| [cli/project](architecture/cli/project/README.md) | The project `init-project` creates: the app package and the agent-x package | Built |
| [agent-runtime](architecture/agent-runtime/README.md) | What runs one agent: its modules, and what is planned | `AgentManager` planned |
| [agent-runtime/agent](architecture/agent-runtime/agent/README.md) | An agent directory and how Pi is started in it | Built |
| [agent-runtime/agent-runner](architecture/agent-runtime/agent-runner/README.md) | `AgentRunner`: a Pi process for each thread with messages | Built, with no command to start it |
| [agent-runtime/pi-package](architecture/agent-runtime/pi-package/README.md) | The Pi package agentx adds to every agent: how it loads, the system prompt extension, the harness prompt | Built |
| [agent-runtime/pi-package/message-queue](architecture/agent-runtime/pi-package/message-queue/README.md) | Each agent's message queue and the extension that delivers its messages: messages, states, threads and leases, what the model sees | Built |
| [agent-runtime/pi](architecture/agent-runtime/pi/README.md) | Pi behavior agentx relies on, with source references | Reference |
| [coordinator-runtime](architecture/coordinator-runtime/README.md) | The process that will run all agents of a project | Planned |

## Decisions

Each decision lives in the "Decisions" section of the module it affects, and describes the design as it is. Numbers are global and are not used again when a decision is deleted; the next free number is **D37**.

| # | Decision | Module |
|---|---|---|
| [D1](architecture/agent-runtime/agent/README.md#d1) | Run the Pi CLI from agentx's own dependency | agent-runtime/agent |
| [D2](architecture/agent-runtime/agent/README.md#d2) | The agent directory is Pi's working directory; config lives in `.pi/` | agent-runtime/agent |
| [D4](architecture/agent-runtime/agent/README.md#d4) | Starting an agent changes nothing that is checked in | agent-runtime/agent |
| [D5](architecture/agent-runtime/agent/README.md#d5) | The system prompt comes from an extension | agent-runtime/agent |
| [D6](architecture/agent-runtime/agent/README.md#d6) | `run` passes `-nc` and `--approve`, except before Pi subcommands | agent-runtime/agent |
| [D7](architecture/cli/project/README.md#d7) | `init-project` runs `git init`, which bounds Pi's search for skills | cli/project |
| [D9](architecture/cli/project/README.md#d9) | The template ships `gitignore`; `init-project` renames it | cli/project |
| [D11](architecture/agent-runtime/pi-package/README.md#d11) | agentx's Pi package ships in the agentx package | agent-runtime/pi-package |
| [D12](architecture/cli/README.md#d12) | npm package `agent-x`; the command is `agentx` | cli |
| [D13](architecture/cli/project/README.md#d13) | Agents live in `agent-x/agents/` | cli/project |
| [D14](architecture/cli/project/README.md#d14) | `web/` and `agent-x/` are independent packages | cli/project |
| [D15](architecture/cli/README.md#d15) | Any `agentx` hands over to the copy the project pins | cli |
| [D16](architecture/agent-runtime/pi-package/README.md#d16) | Whoever starts Pi passes agentx's part of the config; the agent's settings are the author's alone | agent-runtime/pi-package |
| [D17](architecture/agent-runtime/agent/README.md#d17) | One Pi agent directory per project, `agent-x/.pi` | agent-runtime/agent |
| [D18](architecture/agent-runtime/pi-package/README.md#d18) | The system prompt extension hides `~/.agents/skills` from the model | agent-runtime/pi-package |
| [D19](architecture/agent-runtime/pi-package/message-queue/README.md#d19) | SQLite through Node's built-in `node:sqlite` | agent-runtime/pi-package/message-queue |
| [D20](architecture/agent-runtime/pi-package/message-queue/README.md#d20) | One queue file per agent, in `storage/` | agent-runtime/pi-package/message-queue |
| [D21](architecture/agent-runtime/pi-package/message-queue/README.md#d21) | A thread is a Pi session; the thread id is the session id | agent-runtime/pi-package/message-queue |
| [D22](architecture/agent-runtime/pi-package/message-queue/README.md#d22) | One live process per thread, by a lease in the queue file | agent-runtime/pi-package/message-queue |
| [D23](architecture/agent-runtime/agent-runner/README.md#d23) | The message queue extension is the only consumer of the queue; the runner only starts Pi processes | agent-runtime/agent-runner |
| [D24](architecture/agent-runtime/pi-package/message-queue/README.md#d24) | A retry sends the message again, marked as a retry; three attempts | agent-runtime/pi-package/message-queue |
| [D25](architecture/agent-runtime/pi-package/message-queue/README.md#d25) | A queue message reaches the model as a user message that starts with a metadata block | agent-runtime/pi-package/message-queue |
| [D27](architecture/agent-runtime/pi-package/message-queue/README.md#d27) | All queue code lives in the message queue extension's folder | agent-runtime/pi-package/message-queue |
| [D28](architecture/agent-runtime/pi-package/message-queue/README.md#d28) | Only a session that stays open takes messages from the queue | agent-runtime/pi-package/message-queue |
| [D29](architecture/agent-runtime/agent/README.md#d29) | The agent's prompt, skills and extensions live in `.pi/` | agent-runtime/agent |
| [D30](architecture/cli/README.md#d30) | `agentx send` reads every option it does not know as metadata | cli |
| [D31](architecture/agent-runtime/agent-runner/README.md#d31) | The runner starts a Pi process per thread, in RPC mode | agent-runtime/agent-runner |
| [D32](architecture/agent-runtime/pi-package/message-queue/README.md#d32) | The runner's sessions are workers, marked with `--agentx-worker` | agent-runtime/pi-package/message-queue |
| [D33](architecture/agent-runtime/pi-package/message-queue/README.md#d33) | The runner takes a thread from its dead Pi process by process id | agent-runtime/pi-package/message-queue |
| [D34](architecture/agent-runtime/README.md#d34) | `src/agent-runtime/` and `src/coordinator-runtime/`, beside `src/cli/` | agent-runtime |
| [D35](architecture/agent-runtime/agent/README.md#d35) | What an agent learns is kept in `storage/knowledge/`, apart from what its developer gave it | agent-runtime/agent |
| [D36](architecture/agent-runtime/agent/README.md#d36) | agentx's own settings for an agent are under `agentx` in its `.pi/settings.json` | agent-runtime/agent |

## User guides

| Guide | For |
|---|---|
| [quick_start.md](user_guides/quick_start.md) | From nothing to a running app and agent |
| [run_an_agent.md](user_guides/run_an_agent.md) | Open a thread, continue and resume sessions |
| [send_messages.md](user_guides/send_messages.md) | Queue messages for an agent and run its queue |
| [customize_an_agent.md](user_guides/customize_an_agent.md) | System prompt, skills, extensions, MCP servers, packages |
| [develop_agentx.md](user_guides/develop_agentx.md) | Work on agentx itself |

## Maintaining these docs

See [CLAUDE.md](../CLAUDE.md#documentation): what goes where, what to update after creating a module, and the decision format.
