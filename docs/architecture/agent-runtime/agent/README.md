# Agent

An agent is a directory, `agent-x/agents/<name>/`. `agentx init-agent <name>` creates it from `templates/agent/`. What an agent knows and can do comes from three places, each with one owner:

| Source | Where | Written by | Checked in | To the agent |
|---|---|---|---|---|
| The harness | agentx's [Pi package](../pi/pi-package/README.md), in the agentx version the project pins | agentx | with agentx | read-only |
| The agent's definition | `.pi/` in the agent directory | its developer | yes ([D4](#d4)) | read-only |
| The agent's knowledge | `storage/knowledge/` in the agent directory | the agent, while it runs | no | its own ([D35](#d35)) |

```
agent-x/agents/<name>/
  .pi/                  the agent's definition, from its developer (D2)
    settings.json       Pi project settings; agentx's own are under `agentx`
    mcp.json            MCP servers ({"mcpServers": {}})
    system_prompt/      *.md, joined in filename order after the harness prompt
      00-identity.md    who the agent is; rewrite it for each agent
    skills/<skill>/SKILL.md   the developer's skills (empty in the template)
    extensions/         the developer's extensions (empty in the template)
    workflows.json      the developer's workflows, optional, with the scripts it names
  storage/              gitignored
    knowledge/          what the agent learns and keeps
      system_prompt/  skills/  extensions/    loaded after the developer's, through the settings
      event_router.mjs  the agent's event router, written as a starter by `agentx run` when missing
      workflows.json    the agent's own workflows, optional
    sessions/<thread>/  the thread's Pi sessions, one folder per thread
    workspace/          the agent's working files
      workflow-logs/<workflow>/<event id>.log   what each workflow run printed
      router-logs/<event id>.log                what the router printed for an event it failed on
    attachments/        files that came with events, named in their content
    event_queue.db      the agent's event queue
    heartbeat           the time `agentx run` last saw all its loops working
```

Pi's own state (login, saved trust, Pi's settings) is not in the agent. All agents of a project share `agent-x/.pi/` ([below](#pis-agent-directory)).

## .pi/settings.json

The file belongs to the agent's developer. What agentx needs from Pi, `agentx chat` and `agentx run` pass as flags ([Pi](../pi/README.md#how-agentx-chat-starts-pi)). The template:

```json
{
	"extensions": ["../storage/knowledge/extensions"],
	"skills": ["../storage/knowledge/skills"],
	"prompts": [],
	"packages": [],
	"agentx": {
		"timezone": null,
		"systemPrompt": ["../storage/knowledge/system_prompt"]
	}
}
```

- Pi loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` by itself, so they need no line here ([Pi](../pi/pi-reference/README.md#config-locations)).
- `extensions` and `skills` add more folders, resolved from `.pi/`. The template adds the agent's [knowledge](#knowledge). A missing folder is skipped.
- `packages` takes Pi packages (`npm:...`, git, local paths). Pi installs missing npm and git packages on start, into `.pi/npm/` and `.pi/git/`, which the project's `.gitignore` leaves out.
- `agentx` holds agentx's own settings for the agent ([D36](#d36)):

| Key | Meaning |
|---|---|
| `systemPrompt` | Folders whose `*.md` files go into the system prompt after `.pi/system_prompt/`, resolved from `.pi/`. The template adds the agent's knowledge. |
| `composio` | The agent's Composio user id (`userId`, written by `init-agent`) and its session policy (`session`). See [Composio](../pi/pi-package/composio/README.md#settings). |
| `runner` | The limits of `agentx run`: `maxThreads`, `stallSeconds`, `routerSeconds`. See [agent supervisor](../supervisor/README.md#settings). |
| `timezone` | The time zone of the times on queued events. `null` means the machine's time zone. An IANA name such as `Asia/Kolkata` fixes it. A name Node does not know is reported when a session starts, and the machine's zone is used. |

## System prompt

The system prompt extension in agentx's Pi package builds the prompt in this order: the harness prompt, then `.pi/system_prompt/*.md` in filename order, then the folders under `agentx.systemPrompt` ([Pi package](../pi/pi-package/README.md#the-system-prompt-extension)). `00-identity.md` says who the agent is; the developer adds more numbered files. Pi itself knows only one file, `.pi/SYSTEM.md`; the `system_prompt/` folder is agentx's ([D5](#d5)).

## Knowledge

`storage/knowledge/` belongs to the agent: what it learns and wants in every later session ([D35](#d35)). The harness prompt tells the agent so, and says that the harness and its definition are read-only.

| In `storage/knowledge/` | Loaded | Through |
|---|---|---|
| `system_prompt/*.md` | before every user message, at the end of the system prompt | `agentx.systemPrompt` in the settings |
| `skills/<name>/SKILL.md` | when a session starts | `skills` in the settings |
| `extensions/` | when a session starts | `extensions` in the settings |
| `event_router.mjs` | for every event without a thread | always ([event router](../events/README.md#routing)) |
| `workflows.json` and its scripts | for every event, and for every run | always ([workflows](../workflows/README.md)) |
| anything else: notes, files, scripts | when the agent reads it | |

`init-agent` creates the folders. They are not checked in, so they can be missing, as after a fresh clone; the agent creates what it needs. All threads of the agent share them.

## Threads

A thread is one conversation of the agent and one Pi session: the thread id is the session id ([D21](../pi/README.md#d21)). An event on the agent's [queue](../events/README.md) names its thread, or gets one from the router, and that thread's session receives it. A workflow's thread, `workflow.<name>`, is not a Pi session ([workflows](../workflows/README.md)).

- `agentx chat` opens the thread `main`, and `agentx chat --thread-id <thread>` opens another. One-shot runs too: `agentx chat -p "..."` adds to `main`.
- A session that stays open (terminal UI, RPC mode) receives its thread's queued events. A one-shot run answers only its own prompt.
- With one of Pi's own session flags (`-c`, `-r`, `--session`, `--session-id`, `--fork`, `--no-session`), Pi picks the session, and that session is the thread. Pi looks only in the folder of the thread given with `--thread-id`, or named by `--session-id`, or else `main`.
- An open session holds its thread; no other process can run it ([D22](../events/README.md#d22)). If another process holds the thread, `agentx chat` stops with an error before Pi starts. It refuses a workflow's thread too.

## How Pi starts in it

`agentx chat` and the Pi runner start Pi in the agent directory with the flags of `pi/pi-launch.ts` and the environment of `agent-env.ts`: [Pi](../pi/README.md#how-agentx-chat-starts-pi).

## Pi's agent directory

`agent-x/.pi/` is gitignored state that Pi writes and all agents of the project share ([D17](#d17)):

- `auth.json`: one login for all agents (`/login`, or `agentx chat auth login <provider>` in any agent). Every agent can reach it, so the harness prompt forbids reading it.
- `settings.json`: Pi's user-level settings, written by Pi (`defaultProvider` and `defaultModel` when a model is chosen, `deviceId`, `lastChangelogVersion`). An agent's `.pi/settings.json` overrides it key by key, so an agent that needs a fixed model sets `defaultProvider` and `defaultModel` there.
- `trust.json`, `models-store.json`, `bin/`: saved trust per agent path, the model list, tools Pi downloads.
- Packages installed with `pi install` without `-l`, and anything in its `extensions/`, `skills/` or `prompts/`, load in every agent on this machine and are not checked in.

It is not project config. Pi reads `.pi/` only from its working directory, never from a parent, so no agent loads it twice.

## Known limits

- `agent-x/.pi/` applies to every agent but is not checked in, so the model Pi last chose there is the default of every agent that sets none.
- Skills in `~/.agents/skills` stay loaded in Pi. The system prompt extension only takes them off the skills list the model sees.
- Knowledge is gitignored state, lost with the rest of `storage/`. An agent whose settings lack the template's lines loads none of it, though the harness prompt tells every agent about it.
- If an extension the agent wrote for itself fails to load, no later session starts until a person removes the file. Under `agentx run`, its events end as `failed` after three attempts.
- Whatever gets the agent to write into its knowledge, an event included, lasts for every later session and thread. Its prompt text is read on every user message, and an extension, its router and its workflows are code that runs.
- `agentx chat mcp list` needs the project trusted once with `/trust` in an interactive session ([D6](#d6)).

## Decisions

<a id="d1"></a>
### D1. Run the Pi CLI from agentx's own dependency

- **Decision.** agentx runs `bundle/cli.js` from `@earendil-works/pi-coding-agent`, an exact-version dependency, with `process.execPath`.
- **Why.** A global `pi` can be any version. This way each agentx version runs one Pi version.

<a id="d2"></a>
### D2. The agent directory is Pi's working directory, and the agent's definition is in its `.pi/`

- **Decision.** Pi runs with `cwd` = the agent directory, and the agent's settings, MCP servers, prompt, skills and extensions are all in its `.pi/`.
- **Why.** Pi reads project config only from `<cwd>/.pi/` and loads `.pi/skills/` and `.pi/extensions/` with no settings ([Pi](../pi/pi-reference/README.md#config-locations)), so the whole definition is one folder.
- **Rejected.** `cwd` = `storage/workspace`: config would have to be copied there at start, against [D4](#d4).

<a id="d4"></a>
### D4. Starting an agent changes nothing that is checked in

- **Decision.** `chat` and `run` only start processes, and everything they write goes to the gitignored `storage/`. `agentx run` writes the starter router there when the agent has none.
- **Why.** If starting an agent wrote config, the config in effect would differ from what is checked in.
- **Consequence.** Limits that only generated files could remove are accepted ([D6](#d6)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Decision.** agentx's system prompt extension sets `customPrompt` in `before_agent_start`, from the harness prompt, `.pi/system_prompt/*.md` and the `agentx.systemPrompt` folders.
- **Why.** The files are read on every prompt, so an edit applies to the next message of a running session.
- **Rejected.** `.pi/SYSTEM.md` is one file only, and `--system-prompt` joins the files once, at start.

<a id="d6"></a>
### D6. `chat` passes `-nc` and `--approve`, except before Pi subcommands

- **Decision.** Session runs get `-nc --approve`; a Pi subcommand, which must come first, gets nothing added.
- **Why.** Otherwise `AGENTS.md` and `CLAUDE.md` leak into the prompt, and Pi without a terminal skips an untrusted `.pi/` without a word.
- **Consequence.** `pi mcp` ignores `--approve`, so it works only after `/trust` in an interactive session.

<a id="d17"></a>
### D17. One Pi agent directory per project, `agent-x/.pi`

- **Decision.** Every agent runs with `PI_CODING_AGENT_DIR=<project>/agent-x/.pi`, which is gitignored.
- **Why.** The agents share one login, and nothing comes in from the user's `~/.pi/agent`. Pi locks the files it writes there, so agents can run at the same time.
- **Rejected.** A checked-in `agent-x/.pi/settings.json` that lists agentx's Pi package: Pi writes machine state to that file.

<a id="d43"></a>
### D43. Keys for all agents of a project go in the gitignored `agent-x/.env`; the environment wins

- **Decision.** Every process of the agent, Pi, its router and its workflows, gets the environment of `agent-env.ts`, which adds the variables of `agent-x/.env`, read with Node's `util.parseEnv`. A variable already in the environment keeps its value.
- **Why.** A developer keeps keys in one file next to the project's other agent state, and a deployment sets the same variables in the environment, which then need no file.
- **Rejected.** `web/.env.local`: it belongs to the app, which deploys apart and must not hold agents' keys. A file per agent: the keys are the project's.

<a id="d35"></a>
### D35. What an agent learns is kept in `storage/knowledge/`, apart from its definition

- **Decision.** `storage/knowledge/` is the agent's own, and the agent's `.pi/settings.json` lists its three folders, so they load after the developer's.
- **Why.** The agent must not write into `.pi/`, which its developer owns, and a developer who does not want the agent to teach itself removes the lines.
- **Rejected.** Passing the folders as flags, like agentx's own package: they would load in every agent, whatever its developer wants.

<a id="d36"></a>
### D36. agentx's own settings for an agent are under `agentx` in its `.pi/settings.json`

- **Decision.** An `agentx` object in the agent's `.pi/settings.json` holds `timezone`, `systemPrompt`, `composio` and `runner`. agentx's extensions read it with `pi.getSettings()`. agentx code that runs outside Pi, such as `agentx run`, reads the agent's own file as JSON.
- **Why.** One settings file per agent. Pi accepts keys it does not know, keeps them, and hands them to extensions ([Pi](../pi/pi-reference/README.md#config-locations)).
- **Consequence.** Outside Pi, `agentx` keys in the shared `agent-x/.pi/settings.json` do not apply.
- **Rejected.** A separate agentx file is a second place to look.
