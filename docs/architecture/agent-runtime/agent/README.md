# Agent

An agent is a directory, `agent-x/agents/<name>/`, which `agentx init-agent <name>` creates from `templates/agent/`. What an agent knows and can do comes from three places:

| Source | Where | Written by | To the agent |
|---|---|---|---|
| The harness | agentx's [Pi package](../pi/pi-package/README.md), in the pinned agentx | agentx | read-only |
| The definition | `.pi/` in the agent directory, checked in ([D4](#d4)) | its developer | read-only |
| The knowledge | `storage/knowledge/`, not checked in | the agent, while it runs | its own ([D35](#d35)) |

```
agent-x/agents/<name>/
  .pi/                  the definition (D2)
    settings.json       Pi project settings; agentx's own are under `agentx`
    mcp.json            MCP servers
    system_prompt/      *.md, a section each after the harness's, in the order of the index before each name; 1-role.md says what the agent is for
    skills/  extensions/   the developer's
    event_router.ts     the developer's router; the template's sends every event to main
    workflows.json  workflows/  schedules.json
  storage               a link to agent-x/storage/<name>/ (D65), gitignored
    knowledge/          what the agent learns: system_prompt/, skills/, event_router.ts, workflows.json, workflows/, schedules.json, and memory/index.db, the index of its episodes
    sessions/<thread>/  the thread's Pi sessions
    workspace/          the agent's files; workflow-logs/, router-logs/, inbox/, outbox/, browser/ (its browser profiles)
    event_queue.db      the event queue
    heartbeat           the time agentx run last saw all its loops working
    schedule-state.json what the coordinator fired of each schedule
```

## Storage

An agent's runtime state is in `agent-x/storage/<name>/`, and the agent reaches it as `storage/`: a link now, a mount in a sandbox later ([D65](#d65)). Everything inside the agent says `storage/`: Pi's settings, the harness prompt, the paths in events, the routers and workflows.

- `init-agent` makes the folder and the link (`ensureStorage` in `src/agent-runtime/storage.ts`). `agentx run`, `chat`, `event` and `serve` make them again when missing, as after a fresh clone.
- A `storage` that is already there, a link or a folder of its own, is used as it is; agentx never moves or deletes one. But `agentx serve` does not run an agent whose `storage` is not its central folder, and `agentx event deliver` refuses one, since both reach the agent through the central folder.
- `agentx remove-agent <name>` deletes an agent with its state, after asking ([CLI](../../cli/README.md#commands)).
- `agentx remove-thread <thread-id>` deletes a thread's sessions and its episodes in the memory index, after asking ([CLI](../../cli/README.md#commands)).

## .pi/settings.json

The file belongs to the developer. What agentx needs from Pi, `agentx chat` and `agentx run` pass as flags ([Pi](../pi/README.md#how-agentx-chat-starts-pi)). The template:

```json
{
	"extensions": [],
	"skills": ["../storage/knowledge/skills"],
	"prompts": [],
	"packages": ["npm:pi-web-access@0.48.0", "npm:pi-doc-reader@0.3.2"],
	"agentx": {
		"timezone": null,
		"systemPrompt": ["../storage/knowledge/system_prompt"],
		"runner": { "maxThreads": 4, "stallSeconds": 600, "routerSeconds": 60 },
		"composio": {
			"session": {
				"toolkits": { "enable": ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "supabase", "hubspot", "telegram"] }
			}
		},
		"memory": {
			"compaction": { "enabled": true, "foldNudgeEvery": 0.1 }
		}
	}
}
```

- Pi loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` by itself ([Pi](../pi/pi-reference/README.md#config-locations)). `extensions` and `skills` add more folders, resolved from `.pi/`.
- `packages` takes Pi packages. Pi installs missing ones on start, into `.pi/npm/` and `.pi/git/`, which are gitignored. The template lists two, each at an exact version ([D83](#d83)):

| Package | What it gives the agent |
|---|---|
| [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Web search and reading pages, PDFs and videos without a browser, with no key needed. Tools: `web_search`, `fetch_content`, `get_search_content`, `source_check` |
| [`pi-doc-reader`](https://www.npmjs.com/package/pi-doc-reader) | `read` opens PDF, DOCX, XLSX and PPTX files |

- `agentx` holds agentx's own settings for the agent ([D36](#d36)). The template lists each with its default value, so a developer sees what there is to change. The agent's `description` and `canSendTo` are in the project's [`agentx.json`](../../coordinator-runtime/README.md#d63).

| Key | Meaning |
|---|---|
| `systemPrompt` | Folders whose `*.md` files follow `.pi/system_prompt/` in the system prompt, each a section `agentx-knowledge-<file name>`, whatever the folder. The template adds the agent's knowledge. |
| `composio` | The agent's Composio user id and session policy ([Composio](../pi/pi-package/composio/README.md#settings)). The template enables eight toolkits; `init-agent` adds the user id. |
| `runner` | The limits of `agentx run` ([supervisor](../supervisor/README.md#settings)). |
| `timezone` | The agent's time zone: its processes run in it, every time the harness shows the agent is in it, and so are its schedules ([D98](#d98)). `null` means the machine's; an IANA name such as `Asia/Kolkata` fixes it. |
| `memory` | `compaction`: folds, fold nudges and summaries ([context](../pi/pi-package/context/README.md#settings)). |

## System prompt

The system prompt extension builds the prompt: the harness's preamble, then, after Pi's own sections and a section per skill, a section per file: the harness's, the agents this one can send to, `.pi/system_prompt/*.md` in the order of the index before each name, then the `agentx.systemPrompt` folders ([Pi package](../pi/pi-package/README.md#the-system-prompt-extension), [D5](#d5)).

## Knowledge

`storage/knowledge/` is the agent's own: what it learns and wants in later sessions ([D35](#d35)). The harness prompt says so, and that the harness and the definition are read-only.

| In `storage/knowledge/` | Loaded |
|---|---|
| `system_prompt/*.md` | at the end of the system prompt, a section per file, at the start of every run, through `agentx.systemPrompt` |
| `skills/<name>/SKILL.md` | a section per skill, at the start of every run, through `skills` ([skills](../pi/pi-package/README.md#the-skills-extension)) |
| `event_router.ts` | for every event without a thread ([routing](../events/README.md#routing)) |
| `workflows.json` and its scripts | when routing and running ([workflows](../workflows/README.md)) |
| `schedules.json` | by the coordinator, when it changes ([schedules](../../coordinator-runtime/services/scheduler/README.md)) |
| anything else | when the agent reads it |

All threads of the agent share it.

## Threads

A thread is one conversation: a folder of Pi sessions, `storage/sessions/<thread>/`, whose latest session goes on ([D21](../pi/README.md#d21)). A workflow's thread, `workflow.<name>`, has no Pi session.

- `agentx chat` opens `main`; `agentx chat --thread-id <thread>` opens another. `agentx chat -p "..."` is a one-shot run on `main`.
- A session that stays open receives its thread's queued events. A one-shot run answers only its own prompt.
- With one of Pi's own session flags (`-c`, `-r`, `--session`, `--session-id`, `--fork`), Pi picks the session among the thread's. `/new` starts another session in the same thread.
- One process at a time holds a thread ([D22](../events/README.md#d22)). `agentx chat` stops with an error on a thread another process holds, and on a workflow's thread.

## Pi's agent directory

`agent-x/.pi/` is gitignored state that Pi writes, shared by all agents of the project ([D17](#d17)):

- `auth.json`: one login for all agents. The harness prompt forbids reading it.
- `settings.json`: Pi's user settings, such as the model last chosen. An agent's `.pi/settings.json` overrides it key by key.
- Packages installed with `pi install` without `-l`, which load in every agent.

## Known limits

- The model Pi last chose in `agent-x/.pi/` is the default of every agent that sets none.
- Knowledge is gitignored state, lost with the rest of `storage/`.
- Whatever makes the agent write into its knowledge, an event included, lasts for every later session: its prompt text is read at the start of every run, and its router and workflows are code that runs.
- `agentx chat mcp list` needs the project trusted once with `/trust` in an interactive session ([D6](#d6)).
- The first session of an agent, and the first after a clone, installs the template's packages from npm: up to half a minute. Without the network, or with `PI_OFFLINE` set, Pi starts without them.
- pi-web-access reads its search providers' keys from `agent-x/.pi/web-search.json`, shared by every agent of the project.

## Decisions

<a id="d1"></a>
### D1. Run the Pi CLI from agentx's own dependency

- **Decision.** agentx runs `dist/bundle/cli.js` from `@earendil-works/pi-coding-agent`, an exact-version dependency, with `process.execPath`.
- **Why.** A global `pi` can be any version. This way each agentx version runs one Pi version.

<a id="d2"></a>
### D2. The agent directory is Pi's working directory, and the definition is in its `.pi/`

- **Decision.** Pi runs with `cwd` = the agent directory, and the agent's settings, MCP servers, prompt, skills and extensions are in its `.pi/`.
- **Why.** Pi reads project config only from `<cwd>/.pi/`, so the whole definition is one folder.
- **Rejected.** `cwd` = `storage/workspace`: config would have to be copied there at start, against [D4](#d4).

<a id="d4"></a>
### D4. Starting an agent changes nothing that is checked in

- **Decision.** `chat` and `run` only start processes; everything they and Pi write is gitignored: `storage/`, `agent-x/.pi/`, and Pi's `.pi/npm/` and `.pi/git/`.
- **Why.** Otherwise the config in effect would differ from what is checked in.
- **Consequence.** Limits that only generated files could remove are accepted ([D6](#d6)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Decision.** agentx's system prompt extension sets the prompt in `before_agent_start`, from the harness prompt, `.pi/system_prompt/*.md` and the `agentx.systemPrompt` folders, a section per file ([D73](../pi/pi-package/README.md#d73)).
- **Why.** The files are read at the start of every run, so an edit applies from the next run, without a restart.
- **Rejected.** `.pi/SYSTEM.md`, one file only; `--system-prompt`, which joins the files once, at start.

<a id="d6"></a>
### D6. `chat` passes `-nc` and `--approve`, except before Pi subcommands

- **Decision.** Session runs get `-nc --approve`; a Pi subcommand, which must come first, gets nothing added.
- **Why.** Otherwise `AGENTS.md` and `CLAUDE.md` leak into the prompt, and Pi without a terminal silently skips an untrusted `.pi/`.
- **Consequence.** `pi mcp` ignores `--approve`, so it works only after `/trust` in an interactive session.

<a id="d17"></a>
### D17. One Pi agent directory per project, `agent-x/.pi`

- **Decision.** Every agent runs with `PI_CODING_AGENT_DIR=<project>/agent-x/.pi`, which is gitignored.
- **Why.** The agents share one login, and nothing comes in from the user's `~/.pi/agent`. Pi locks the files it writes there, so agents can run at the same time.
- **Rejected.** A checked-in `agent-x/.pi/settings.json` that lists agentx's Pi package: Pi writes machine state to that file.

<a id="d35"></a>
### D35. What an agent learns is kept in `storage/knowledge/`, apart from its definition

- **Decision.** `storage/knowledge/` is the agent's own, and its `.pi/settings.json` lists the `skills/` and `system_prompt/` folders there, so they load after the developer's. The agent writes no extensions.
- **Why.** The agent must not write into `.pi/`, which its developer owns, and a developer who does not want the agent to teach itself removes the lines. An extension runs with all of Pi's power, and one that fails to load stops every later session; a script, a router or a workflow does what an agent needs beyond skills and prompt text.
- **Rejected.** Passing the folders as flags: they would load in every agent, whatever its developer wants.

<a id="d36"></a>
### D36. agentx's own settings for an agent are under `agentx` in its `.pi/settings.json`

- **Decision.** An `agentx` object in the agent's `.pi/settings.json` holds `timezone`, `systemPrompt`, `composio` and `runner`. agentx's extensions read it with `pi.getSettings()`; code outside Pi reads the file as JSON.
- **Why.** One settings file per agent. Pi keeps keys it does not know and hands them to extensions.
- **Consequence.** Outside Pi, `agentx` keys in the shared `agent-x/.pi/settings.json` do not apply.

<a id="d43"></a>
### D43. Keys for all agents of a project go in the gitignored `agent-x/.env`; the environment wins

- **Decision.** Every process of the agent gets the environment of `agent-env.ts`: the process's own, plus the variables of `agent-x/.env` it does not have, and `AGENTX_AGENT`, the agent's name.
- **Why.** A developer keeps keys in one file next to the project's agent state; a deployment sets the same variables in the environment and needs no file.
- **Rejected.** `web/.env.local`, which belongs to the app; a file per agent, when the keys are the project's.

<a id="d65"></a>
### D65. An agent's state lives in `agent-x/storage/<agent>/`, reached as `storage/` through a link

- **Decision.** Every agent's runtime state is in `agent-x/storage/<agent>/`. The agent directory reaches it through `storage`, a relative link that agentx makes when it is missing, and in a sandbox a mount. The coordinator uses the central folder.
- **Why.** Definition and state are apart: a deploy replaces one and keeps the other, and a server backs up one folder. Inside the agent nothing changes, in or out of a sandbox. The folder is inside `agent-x/`, so routers and workflows in `storage/knowledge/` find the project's packages.
- **Rejected.** Paths that name `agent-x/storage/<agent>/` everywhere, which would differ inside a sandbox; a central folder outside `agent-x/`, which would lose the project's packages.
- **Consequence.** Until sandboxes, `storage/..` holds every agent's state, one step up.

<a id="d83"></a>
### D83. A new agent lists Pi packages, at exact versions, in its own settings

- **Problem.** Every agent needs to search and read the web, and read office documents and PDFs. A developer should still be able to change or drop each package.
- **Decision.** The template's `.pi/settings.json` lists `pi-web-access` and `pi-doc-reader` in `packages`, each at an exact version. Pi installs them on the agent's first start.
- **Why.** The settings file is the developer's ([D4](#d4)), so changing the versions or removing a line is enough to override them. Pi never updates an exact version, and on start installs it again when the installed one differs, so each session starts on the versions the settings name.
- **Rejected.** Adding them to agentx's Pi package, which loads in every agent and which a developer cannot leave out. Listing them in the shared `agent-x/.pi/settings.json`, which is gitignored and written by Pi ([D17](#d17)).

<a id="d98"></a>
### D98. Every time the agent sees is in its time zone: its processes run with `TZ`, and the harness writes its times in it

- **Problem.** The agent reasons about when things happened and when to act. Times in other zones mislead it: UTC from services, and the machine's from `date` or a workflow's `new Date()`, which on a server is often UTC.
- **Decision.** The agent's time zone is `agentx.timezone`, or the machine's when it is `null`. `agent-env.ts` sets `TZ` to it for every process of the agent: Pi under `agentx chat` and `agentx run`, the commands its bash runs, its routers and its workflows. The harness writes every time it shows the agent in it too, read from the agent's settings (`time-zone.ts`): the times on events, the times of episodes in memory, Composio's `event-time`, and the time in Composio's search answers.
- **Why.** One variable reaches everything the agent runs, commands and scripts agentx does not write included. The coordinator runs every agent in one process, so what it writes for an agent, such as a Composio event, takes the zone from that agent's settings.
- **Consequence.** A changed time zone applies to each process from its next start. A zone Node does not know is the machine's, and the event queue extension says so in the session.
