# agentx docs

New here: [quick start](user_guides/quick_start.md).

| Section | What it holds |
|---|---|
| [high_level_design.md](high_level_design.md) | The overall design: goals, components, how they fit, main flows |
| [architecture/](#architecture) | One folder per component: its `README.md` (behavior and decisions) plus images or other assets |
| [user_guides/](#user-guides) | How to use agentx |

## Architecture

| Component | Covers | Status |
|---|---|---|
| [cli](architecture/cli/README.md) | The `agentx` command and its commands | Built |
| [project](architecture/project/README.md) | The project `init-project` creates: app, harness, workspaces | Built |
| [agent](architecture/agent/README.md) | An agent directory and how `agentx run` starts Pi in it | Built |
| [runtime](architecture/runtime/README.md) | Coordinator, `AgentManager`, `AgentRunner` | Planned |
| [pi](architecture/pi/README.md) | Pi behavior agentx relies on, with source references | Reference |

## Decisions

Each decision lives in the "Decisions" section of the component it affects. Numbers are global; the next free number is **D11**.

| # | Decision | Component |
|---|---|---|
| [D1](architecture/agent/README.md#d1) | Run the Pi CLI from agentx's own dependency | agent |
| [D2](architecture/agent/README.md#d2) | The agent directory is Pi's working directory; config lives in `.pi/` | agent |
| [D3](architecture/agent/README.md#d3) | `storage/pi` is Pi's agent directory | agent |
| [D4](architecture/agent/README.md#d4) | Nothing in the agent directory changes when an agent starts | agent |
| [D5](architecture/agent/README.md#d5) | The system prompt comes from an extension | agent |
| [D6](architecture/agent/README.md#d6) | `run` passes `-nc` and `--approve`, except before Pi subcommands | agent |
| [D7](architecture/project/README.md#d7) | Accept `~/.agents/skills`; bound ancestor skills with `git init` | project |
| [D8](architecture/runtime/README.md#d8) | No SDK integration and no `models.json` yet | runtime |
| [D9](architecture/project/README.md#d9) | npm workspaces plus `pnpm-workspace.yaml`; template ships `gitignore` | project |
| [D10](architecture/runtime/README.md#d10) | Runtime layout: `coordinator/` and `agents/` | runtime |

## User guides

| Guide | For |
|---|---|
| [quick_start.md](user_guides/quick_start.md) | From nothing to a running app and agent |
| [run_an_agent.md](user_guides/run_an_agent.md) | Start, continue and resume sessions |
| [customize_an_agent.md](user_guides/customize_an_agent.md) | System prompt, skills, extensions, MCP servers, packages |
| [develop_agentx.md](user_guides/develop_agentx.md) | Work on agentx itself |

## Maintaining these docs

See [CLAUDE.md](../CLAUDE.md#documentation): what goes where, what to update after creating a module, and the decision format.
