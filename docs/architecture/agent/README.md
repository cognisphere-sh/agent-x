# Agent

An agent is a directory, `harness/<name>/`, created by `agentx init-agent <name>` from `templates/agent/`. Everything checked in there defines the agent ([D4](#d4)).

```
harness/<name>/
  package.json          scripts: pi, continue, resume -> agentx run [...]
  .pi/
    settings.json       Pi project settings
    mcp.json            MCP servers ({"mcpServers": {}})
  system_prompt/        *.md, joined in filename order; replaces Pi's default system prompt
    00-identity.md
    10-workspace.md     tells the agent to work in storage/workspace
  skills/<skill>/SKILL.md
  extensions/
    system-prompt.ts    applies system_prompt/
  storage/              gitignored
    pi/                 Pi's agent directory: auth.json, trust.json, Pi's runtime files
    sessions/           all sessions of this agent
    workspace/          files the agent creates
```

## .pi/settings.json

```json
{
	"sessionDir": "storage/sessions",
	"packages": [],
	"extensions": ["../extensions"],
	"skills": ["../skills"],
	"prompts": []
}
```

- Resource paths (`extensions`, `skills`, `prompts`) resolve from `.pi/`, hence `../`.
- `sessionDir` resolves from the agent directory (`cwd`).
- `packages` takes Pi packages (`npm:...`, git, local paths); Pi installs missing ones on start.

## System prompt

`extensions/system-prompt.ts` handles `before_agent_start` and sets `event.systemPromptOptions.customPrompt` to the `system_prompt/*.md` files, trimmed, sorted by filename, joined with blank lines. This replaces Pi's default preamble; Pi still appends tool descriptions, the skills list and the working directory. Files are read on every prompt, so edits apply without `/reload`. Why an extension: [D5](#d5).

To add a section, add a numbered `.md` file.

## How `agentx run` starts Pi

`src/cli/commands/run.ts` spawns `node <pi>/bundle/cli.js [flags] [args]`:

| Setting | Value | Why |
|---|---|---|
| Pi CLI | resolved from agentx's own dependency | [D1](#d1) |
| `cwd` | the agent directory | Pi reads `.pi/` from `cwd` ([D2](#d2)) |
| `PI_CODING_AGENT_DIR` | `<agent>/storage/pi` | isolates the agent from `~/.pi/agent` ([D3](#d3)) |
| `-nc` | always, except for Pi subcommands | skip `AGENTS.md` / `CLAUDE.md` ([D6](#d6)) |
| `--approve` | always, except for Pi subcommands | trust `.pi/` for this run without a prompt ([D6](#d6)) |

Pi subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`) must be the first argument, so no flags are added before them.

Pi creates `storage/pi` and `storage/sessions` itself when missing. `run` writes nothing.

## Known limits

- Login is per agent (`/login` writes `storage/pi/auth.json`).
- Skills in `~/.agents/skills` still load ([D7](../project/README.md#d7)).
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

<a id="d4"></a>
### D4. Nothing in the agent directory changes when an agent starts

- **Problem.** Earlier versions merged agent settings into `storage/pi/settings.json` or saved trust on start, so the effective config was generated, not checked in.
- **Decision.** `run` only spawns Pi. Checked-in files are the whole config; Pi itself creates `storage/pi` and `storage/sessions`.
- **Consequence.** Limits that would need generated files are accepted ([D6](#d6), [D7](../project/README.md#d7)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Problem.** The agent needs a system prompt made of several files, replacing Pi's default, identical under the CLI and the SDK.
- **Decision.** `extensions/system-prompt.ts` sets `customPrompt` in `before_agent_start` from `system_prompt/*.md`.
- **Rejected.** `.pi/SYSTEM.md`: one file only. `--system-prompt`: CLI flag, so the SDK path would need its own concatenation.

<a id="d6"></a>
### D6. `run` passes `-nc` and `--approve`, except before Pi subcommands

- **Problem.** `AGENTS.md` / `CLAUDE.md` in the agent or its parents leak into the prompt. Print mode skips untrusted `.pi/` silently.
- **Decision.** Add `-nc --approve` to session runs. Add nothing when the first argument is a Pi subcommand, which must come first.
- **Consequence.** `pi mcp` ignores `--approve`; it works after `/trust` in an interactive session. Saving trust from `run` was rejected by [D4](#d4).
