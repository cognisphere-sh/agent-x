# Agent

An agent is a directory, `agent-x/agents/<name>/`, created by `agentx init-agent <name>` from `templates/agent/`. Everything checked in there, plus the agentx version the project pins, defines the agent ([D4](#d4)). What agentx adds to every agent, such as the harness prompt, comes from the agentx package ([Pi package](../pi-package/README.md)); the agent directory holds only the agent's own files.

```
agent-x/agents/<name>/
  package.json          scripts: pi, continue, resume -> agentx run [...]
  .pi/
    settings.json       Pi project settings; the author's alone, agentx adds nothing here
    mcp.json            MCP servers ({"mcpServers": {}})
  system_prompt/        *.md, joined in filename order after the harness prompt
    00-identity.md      who the agent is; rewritten per agent
  skills/<skill>/SKILL.md   the agent's own skills (empty in the template)
  extensions/           the agent's own extensions (empty in the template)
  storage/              gitignored
    sessions/           all sessions of this agent
    workspace/          files the agent creates
```

Pi's own state (login, saved trust, Pi's settings and runtime files) is not in the agent: all agents of a project share `agent-x/.pi/` ([below](#pis-agent-directory)).

## .pi/settings.json

The file belongs to the agent's author. What agentx itself needs from Pi is passed by `agentx run` ([below](#how-agentx-run-starts-pi)).

```json
{
	"extensions": ["../extensions"],
	"skills": ["../skills"],
	"prompts": [],
	"packages": []
}
```

- Resource paths (`extensions`, `skills`, `prompts`) resolve from `.pi/`, hence `../`.
- `packages` takes Pi packages (`npm:...`, git, local paths); Pi installs missing npm and git ones on start into `.pi/npm/` and `.pi/git/`, which the project's `.gitignore` excludes.

## System prompt

The system prompt extension in agentx's Pi package builds the system prompt: the harness prompt, then this agent's `system_prompt/*.md` in filename order ([Pi package](../pi-package/README.md#the-system-prompt-extension)). `00-identity.md` says who the agent is; add sections as more numbered files.

## How `agentx run` starts Pi

`src/cli/commands/run.ts` spawns `node <pi>/bundle/cli.js [flags] [args]`:

| Setting | Value | Why |
|---|---|---|
| Pi CLI | resolved from agentx's own dependency | [D1](#d1) |
| `cwd` | the agent directory | Pi reads `.pi/` from `cwd` ([D2](#d2)) |
| `PI_CODING_AGENT_DIR` | `agent-x/.pi` (`<agent>/../../.pi`) | isolates the agents from `~/.pi/agent`; one for the project ([D17](#d17)) |
| `-nc` | always, except for Pi subcommands | skip `AGENTS.md` / `CLAUDE.md` ([D6](#d6)) |
| `--approve` | always, except for Pi subcommands | trust `.pi/` for this run without a prompt ([D6](#d6)) |
| `-e <agentx>/src/agent-runtime/pi-package` | always, except for Pi subcommands | load agentx's Pi package ([D16](../pi-package/README.md#d16)) |
| `--session-dir <agent>/storage/sessions` | always, except for Pi subcommands | keep sessions in the agent's storage ([D16](../pi-package/README.md#d16)) |

Pi subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`, `auth`) must be the first argument, so no flags are added before them.

Pi creates `agent-x/.pi` and `storage/sessions` itself when missing. `run` writes nothing.

## Pi's agent directory

`agent-x/.pi/` is gitignored state that Pi writes and all agents of the project share ([D17](#d17)):

- `auth.json`: one login for every agent (`/login`, or `npm run pi -- auth login <provider>` in any agent).
- `settings.json`: Pi's user-level settings. Pi writes it itself (`defaultProvider` and `defaultModel` when a model is chosen, `deviceId`, `lastChangelogVersion`). An agent's own `.pi/settings.json` overrides it key by key, so an agent that needs a fixed model sets `defaultProvider` and `defaultModel` there.
- `trust.json`, `models-store.json`, `bin/`: saved trust per agent path, the model list, tools Pi downloads.
- Packages installed with `pi install` without `-l`, and anything put in its `extensions/`, `skills/` or `prompts/`, load in every agent on this machine and are not checked in.

It is not project config: Pi reads `.pi/` only from its working directory, never from a parent, so the name does not make an agent pick it up twice.

## Known limits

- What is in `agent-x/.pi/` applies to every agent but is not checked in, so the model Pi last chose there is the default of agents that set none.
- Skills in `~/.agents/skills` are hidden from the model but stay loaded in Pi ([D18](../pi-package/README.md#d18)).
- `npm run pi -- mcp list` reads `.pi/mcp.json` only after the project was trusted with `/trust` in an interactive session, because `pi mcp` ignores `--approve` ([D6](#d6)).

## Decisions

<a id="d1"></a>
### D1. Run the Pi CLI from agentx's own dependency

- **Problem.** A global `pi` on `PATH` can be any version, so the same agent could behave differently per machine.
- **Decision.** `run.ts` resolves `bundle/cli.js` from `@earendil-works/pi-coding-agent` (an exact-version dependency of agentx) and runs it with `process.execPath`.
- **Why.** One Pi version per agentx version; upgrading Pi means upgrading agentx.

<a id="d2"></a>
### D2. The agent directory is Pi's working directory; config lives in `.pi/`

- **Problem.** Pi reads project config only from `<cwd>/.pi/` ([Pi integration](../pi/README.md#config-locations)).
- **Decision.** Pi runs with `cwd` = agent directory. The agent's config is `.pi/settings.json` and `.pi/mcp.json`.
- **Rejected.** `cwd` = `storage/workspace`: config would have to be copied or generated into the workspace or the agent directory at start, breaking [D4](#d4). The agent is instead told by its system prompt to work in `storage/workspace`.

<a id="d3"></a>
### D3. `storage/pi` is Pi's agent directory

- **Problem.** Pi's default agent directory, `~/.pi/agent`, carries the user's global settings, extensions and credentials into every agent.
- **Decision.** `PI_CODING_AGENT_DIR=<agent>/storage/pi`, gitignored. Each agent logs in once; `auth.json` lives there.
- **Rejected.** Symlinking `~/.pi/agent/auth.json`: hidden coupling to the user's home.
- **Superseded in part.** The directory is `agent-x/.pi`, shared by the project's agents ([D17](#d17)).

<a id="d4"></a>
### D4. Nothing in the agent directory changes when an agent starts

- **Problem.** Earlier versions merged agent settings into `storage/pi/settings.json` or saved trust on start, so the effective config was generated, not checked in.
- **Decision.** `run` only spawns Pi. Checked-in files are the whole config; Pi itself creates `storage/pi` and `storage/sessions`.
- **Consequence.** Limits that would need generated files are accepted ([D6](#d6), [D7](../project/README.md#d7)).
- **Superseded in part.** Pi's agent directory is `agent-x/.pi`, outside the agent ([D17](#d17)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Problem.** The agent needs a system prompt made of several files, replacing Pi's default, identical under the CLI and the SDK.
- **Decision.** `extensions/system-prompt.ts` sets `customPrompt` in `before_agent_start` from `system_prompt/*.md`.
- **Rejected.** `.pi/SYSTEM.md`: one file only. `--system-prompt`: CLI flag, so the SDK path would need its own concatenation.
- **Superseded in part.** The extension moved to the agentx package ([D11](../pi-package/README.md#d11)).

<a id="d6"></a>
### D6. `run` passes `-nc` and `--approve`, except before Pi subcommands

- **Problem.** `AGENTS.md` / `CLAUDE.md` in the agent or its parents leak into the prompt. Print mode skips untrusted `.pi/` silently.
- **Decision.** Add `-nc --approve` to session runs. Add nothing when the first argument is a Pi subcommand, which must come first.
- **Consequence.** `pi mcp` ignores `--approve`; it works after `/trust` in an interactive session. Saving trust from `run` was rejected by [D4](#d4).

<a id="d17"></a>
### D17. One Pi agent directory per project, `agent-x/.pi`

- **Problem.** With `storage/pi` in each agent, every agent needed its own login, and Pi's downloads and model list were repeated per agent.
- **Decision.** `PI_CODING_AGENT_DIR=<project>/agent-x/.pi` for every agent, gitignored. Sessions and the workspace stay in the agent's `storage/`.
- **Why.** One login per project and machine. The directory still isolates agents from `~/.pi/agent`. Pi locks `auth.json`, `settings.json` and `trust.json` when writing, so agents can run at the same time.
- **Rejected.** A checked-in `agent-x/.pi/settings.json` owned by agentx that lists agentx's Pi package, in place of `-e` from `run` ([D16](../pi-package/README.md#d16)): Pi writes machine state to that file (`deviceId`, `lastChangelogVersion`, the chosen model), so it cannot have one owner; checked in, every run would dirty it, and gitignored, `run` would have to generate it on each machine ([D4](#d4)).
- **Consequence.** The default model and user-scope packages are shared by all agents and not checked in. Every agent can reach the one `auth.json`; the harness prompt forbids reading it.
