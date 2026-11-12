# Agent

An agent is a directory, `agent-x/agents/<name>/`, created by `agentx init-agent <name>` from `templates/agent/`. What an agent knows and can do comes from three places, each with one owner:

| Source | Where | Written by | Checked in | To the agent |
|---|---|---|---|---|
| The harness | agentx's [Pi package](../pi-package/README.md), in the agentx version the project pins | agentx | with agentx | read-only |
| The agent's definition | `.pi/` in the agent directory | its developer | yes ([D4](#d4)) | read-only |
| The agent's knowledge | `storage/knowledge/` in the agent directory | the agent, while it runs | no | its own ([D35](#d35)) |

```
agent-x/agents/<name>/
  .pi/                  the agent's definition, from its developer (D29)
    settings.json       Pi project settings, with agentx's own under `agentx`
    mcp.json            MCP servers ({"mcpServers": {}})
    system_prompt/      *.md, joined in filename order after the harness prompt
      00-identity.md    who the agent is; rewritten per agent
    skills/<skill>/SKILL.md   the developer's skills (empty in the template)
    extensions/         the developer's extensions (empty in the template)
  storage/              gitignored
    knowledge/          what the agent learns and keeps
      system_prompt/  skills/  extensions/    loaded after the developer's, through the settings
    sessions/           all sessions of this agent, one per thread
    workspace/          the agent's working files
    message_queue.db    the agent's message queue
```

Pi's own state (login, saved trust, Pi's settings and runtime files) is not in the agent: all agents of a project share `agent-x/.pi/` ([below](#pis-agent-directory)).

## .pi/settings.json

The file belongs to the agent's developer. What agentx itself needs from Pi is passed by `agentx run` ([below](#how-agentx-run-starts-pi)).

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

- Nothing lists the developer's extensions and skills: Pi loads `.pi/extensions/` and `.pi/skills/` of a trusted project by itself, and `.pi/prompts/` for prompt templates ([Pi](../pi/README.md#config-locations)).
- `extensions` and `skills` add folders, resolved from `.pi/`. The template adds the folders of the agent's [knowledge](#knowledge). A folder that does not exist is skipped.
- `packages` takes Pi packages (`npm:...`, git, local paths); Pi installs missing npm and git ones on start into `.pi/npm/` and `.pi/git/`, which the project's `.gitignore` excludes.
- `agentx` holds agentx's own settings for the agent ([D36](#d36)):

| Key | Meaning |
|---|---|
| `systemPrompt` | Folders whose `*.md` files are added to the system prompt after `.pi/system_prompt/`, resolved from `.pi/`. The template adds the agent's knowledge. |
| `timezone` | The time zone for the time shown on queue messages. `null`, as in the template, means the time zone of the machine the agent runs on. An IANA name such as `Asia/Kolkata` fixes it. A name Node does not know is reported when a session starts, and the machine's time zone is used. |

## System prompt

The system prompt extension in agentx's Pi package builds the system prompt in three parts: the harness prompt, then this agent's `.pi/system_prompt/*.md` in filename order, then the folders that the settings list under `agentx.systemPrompt` ([Pi package](../pi-package/README.md#the-system-prompt-extension)). `00-identity.md` says who the agent is; its developer adds sections as more numbered files. `.pi/system_prompt/` is agentx's own convention: Pi itself knows only a single `.pi/SYSTEM.md` ([D5](#d5)).

## Knowledge

`storage/knowledge/` is the agent's own: what it learns while it runs and wants to have in every later session ([D35](#d35)). The harness prompt tells the agent so, and that the harness and its definition are read-only.

| In `storage/knowledge/` | Loaded | Through |
|---|---|---|
| `system_prompt/*.md` | before every message, at the end of the system prompt | `agentx.systemPrompt` in the settings |
| `skills/<name>/SKILL.md` | when a session starts | `skills` in the settings |
| `extensions/` | when a session starts | `extensions` in the settings |
| anything else: notes, files, scripts | when the agent reads it | |

`init-agent` creates the folders. They are not checked in, so they can be missing, as after a fresh clone; the agent creates what it needs. All threads of the agent share them.

## Threads

A thread is one conversation of the agent, and it is one Pi session: the thread id is the session id ([D21](../pi-package/message-queue/README.md#d21)). Messages on the agent's [queue](../pi-package/message-queue/README.md) name their thread, and the session of that thread receives them.

- `agentx run` opens the thread `main`, creating it the first time and continuing it afterwards. `agentx run --thread-id <thread>` opens another one. This holds for one-shot runs too: `agentx run -p "..."` adds to `main`.
- A session that stays open (the terminal UI, RPC mode) receives the queued messages of its thread. A one-shot run does not: it answers its prompt and leaves the queue alone.
- With one of Pi's own ways of choosing a session (`-c`, `-r`, `--session`, `--session-id`, `--fork`, `--no-session`), Pi chooses, and the session it opens is the thread.
- While a session is open, it holds its thread: no other process can run the thread ([D22](../pi-package/message-queue/README.md#d22)). `agentx run` on a thread that another `agentx run` or one of the runner's Pi processes holds stops with an error before Pi starts.

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
| `--session-id <thread>` | the value of `--thread-id`, which `run` takes out of the arguments; `main` when there is none and the arguments neither choose a session nor open none (`--session-id`, `--session`, `-c`, `-r`, `--fork`, `--no-session`, `--export`, `--list-models`, `--help`, `--version`) | the session is the thread ([D21](../pi-package/message-queue/README.md#d21)) |

Pi subcommands (`install`, `remove`, `uninstall`, `update`, `list`, `config`, `mcp`, `auth`) must be the first argument, so no flags are added before them.

The Pi CLI, these flags and the environment come from `src/agent-runtime/pi-launch.ts`. The runner starts Pi from the same file, so a thread's session is the same under both ([Agent runner](../agent-runner/README.md#starting-a-threads-pi-process)).

Before it starts Pi on `main` or on a `--thread-id`, `run` looks in `storage/message_queue.db` for a live holder of that thread and stops if there is one. Pi creates `agent-x/.pi` and `storage/sessions` itself when missing; `run` creates only `storage/message_queue.db`.

## Pi's agent directory

`agent-x/.pi/` is gitignored state that Pi writes and all agents of the project share ([D17](#d17)):

- `auth.json`: one login for every agent (`/login`, or `agentx run auth login <provider>` in any agent).
- `settings.json`: Pi's user-level settings. Pi writes it itself (`defaultProvider` and `defaultModel` when a model is chosen, `deviceId`, `lastChangelogVersion`). An agent's own `.pi/settings.json` overrides it key by key, so an agent that needs a fixed model sets `defaultProvider` and `defaultModel` there.
- `trust.json`, `models-store.json`, `bin/`: saved trust per agent path, the model list, tools Pi downloads.
- Packages installed with `pi install` without `-l`, and anything put in its `extensions/`, `skills/` or `prompts/`, load in every agent on this machine and are not checked in.

It is not project config: Pi reads `.pi/` only from its working directory, never from a parent, so the name does not make an agent pick it up twice.

## Known limits

- What is in `agent-x/.pi/` applies to every agent but is not checked in, so the model Pi last chose there is the default of agents that set none.
- Skills in `~/.agents/skills` are hidden from the model but stay loaded in Pi ([D18](../pi-package/README.md#d18)).
- Knowledge is state: it is gitignored with the rest of `storage/` and is lost with it.
- An extension that the agent writes for itself and that fails to load stops every later session of the agent until a person removes the file. Under the runner its messages then end as `failed`.
- Whatever gets the agent to write into its knowledge, a message included, stays for every later session and thread: its prompt text is read on every message, and an extension is code that Pi runs.
- An agent whose settings lack the template's lines loads none of its knowledge, although the harness prompt tells every agent about the folder.
- `agentx run mcp list` reads `.pi/mcp.json` only after the project was trusted with `/trust` in an interactive session, because `pi mcp` ignores `--approve` ([D6](#d6)).

## Decisions

<a id="d1"></a>
### D1. Run the Pi CLI from agentx's own dependency

- **Problem.** A global `pi` on `PATH` can be any version, so the same agent could behave differently per machine.
- **Decision.** agentx resolves `bundle/cli.js` from `@earendil-works/pi-coding-agent`, an exact-version dependency, and runs it with `process.execPath`.
- **Why.** One Pi version per agentx version; upgrading Pi means upgrading agentx.

<a id="d2"></a>
### D2. The agent directory is Pi's working directory; config lives in `.pi/`

- **Problem.** Pi reads project config only from `<cwd>/.pi/` ([Pi](../pi/README.md#config-locations)).
- **Decision.** Pi runs with `cwd` = the agent directory, and the agent's config is in its `.pi/`.
- **Rejected.** `cwd` = `storage/workspace`: config would have to be copied or generated there at start, against [D4](#d4). The agent is told by its system prompt to work in `storage/workspace` instead.

<a id="d4"></a>
### D4. Starting an agent changes nothing that is checked in

- **Problem.** If starting an agent wrote or generated config, the config in effect would differ from what is checked in.
- **Decision.** `run` only starts Pi. The checked-in files are the whole config. What a run produces is in `storage/`, which is gitignored: Pi writes the sessions there, `run` creates the queue file when it is missing, and the agent writes its working files and its knowledge.
- **Consequence.** Limits that would need generated files are accepted ([D6](#d6)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Problem.** An agent's system prompt is made of several files, follows the harness prompt, and replaces Pi's default.
- **Decision.** The system prompt extension in agentx's Pi package sets `customPrompt` in `before_agent_start`: the harness prompt, then the agent's `.pi/system_prompt/*.md`, then the folders its settings list under `agentx.systemPrompt`.
- **Why.** The files are read on every prompt, so an edit applies to the next message of a session that is already running.
- **Rejected.** `.pi/SYSTEM.md`: one file only. `--system-prompt`: whoever starts Pi would have to join the files, once, at the start.

<a id="d6"></a>
### D6. `run` passes `-nc` and `--approve`, except before Pi subcommands

- **Problem.** `AGENTS.md` and `CLAUDE.md` in the agent or its parents leak into the prompt. Without a terminal, Pi skips an untrusted `.pi/` silently.
- **Decision.** Session runs get `-nc --approve`. Nothing is added when the first argument is a Pi subcommand, which must come first.
- **Consequence.** `pi mcp` ignores `--approve`; it works after `/trust` in an interactive session. `run` does not save trust itself ([D4](#d4)).

<a id="d17"></a>
### D17. One Pi agent directory per project, `agent-x/.pi`

- **Problem.** Pi's default agent directory, `~/.pi/agent`, carries the user's global settings, extensions and credentials into every agent. The agents of a project should still share one login.
- **Decision.** `PI_CODING_AGENT_DIR=<project>/agent-x/.pi` for every agent, gitignored. Sessions and the workspace stay in each agent's `storage/`.
- **Why.** One login per project and machine, and nothing from the user's home. Pi locks `auth.json`, `settings.json` and `trust.json` when it writes them, so agents can run at the same time.
- **Rejected.** Symlinking `~/.pi/agent/auth.json`: hidden coupling to the user's home. A checked-in `agent-x/.pi/settings.json` that lists agentx's Pi package, in place of `-e` ([D16](../pi-package/README.md#d16)): Pi writes machine state to that file, so every run would dirty it.
- **Consequence.** The default model and user-scope packages are shared by all agents and not checked in. Every agent can reach the one `auth.json`; the harness prompt forbids reading it.

<a id="d29"></a>
### D29. The agent's prompt, skills and extensions live in `.pi/`

- **Problem.** Pi loads a project's extensions and skills from `.pi/extensions/` and `.pi/skills/` by itself. Kept anywhere else, they have to be listed in the settings, and the agent's definition is spread over several folders.
- **Decision.** `.pi/extensions/`, `.pi/skills/` and `.pi/system_prompt/`. They need no line in the settings.
- **Why.** Everything that defines the agent to Pi is in one folder and loads with no settings.
- **Consequence.** `system_prompt/` is agentx's folder, not Pi's: only the system prompt extension reads it, so the prompt depends on agentx's Pi package being loaded.

<a id="d35"></a>
### D35. What an agent learns is kept in `storage/knowledge/`, apart from what its developer gave it

- **Problem.** An agent that runs for a long time learns things worth keeping: facts, ways of doing a task, scripts. Its definition in `.pi/` belongs to its developer and is checked in, so the agent must not write there.
- **Decision.** `storage/knowledge/` is the agent's own, with `system_prompt/`, `skills/`, `extensions/` and any other file it wants to keep. The agent's `.pi/settings.json` lists the three folders, so they load after the developer's. The harness prompt tells the agent that the harness and its definition are read-only and that its knowledge is where it writes.
- **Why.** Three sources with one owner each: agentx, the developer, the agent. The settings show what is loaded, and a developer who does not want an agent to teach itself removes the lines.
- **Rejected.** Passing the folders to Pi as flags, as agentx's own package is passed ([D16](../pi-package/README.md#d16)): they would load in every agent, whatever its developer wants.
- **Consequence.** Knowledge is state, not part of the checked-in definition. An agent created without these lines in its settings loads none of it. What the agent writes there is not checked by anyone ([known limits](#known-limits)).

<a id="d36"></a>
### D36. agentx's own settings for an agent are under `agentx` in its `.pi/settings.json`

- **Problem.** Some of what an agent's developer decides is for agentx to act on, not Pi: the time zone its messages show, and which folders add to its system prompt.
- **Decision.** An `agentx` object in the agent's `.pi/settings.json`, with `timezone` and `systemPrompt`. The template has `timezone` as `null`, which means the machine's time zone. agentx's extensions read the object through `pi.getSettings()`.
- **Why.** One settings file per agent. Pi accepts keys it does not know, keeps them when it rewrites the file, and hands them to extensions ([Pi](../pi/README.md#config-locations)).
- **Rejected.** A file of agentx's own beside it: a second place to look for an agent's settings, and code to read it. The `TZ` environment variable for the time zone: it belongs to the machine or the process, not to the agent, and is not checked in with it.
- **Consequence.** Pi's own tools neither show nor check these keys.
