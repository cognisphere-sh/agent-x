# Agent

An agent is a directory, `agent-x/agents/<name>/`, which `agentx init-agent <name>` creates from `templates/agent/`. What an agent knows and can do comes from three places:

| Source | Where | Written by | To the agent |
|---|---|---|---|
| The harness | agentx's [Pi package](../pi/pi-package/README.md), in the pinned agentx | agentx | read-only |
| The definition | `.pi/` in the agent directory but its `knowledge/`, checked in ([D4](#d4)) | its developer | read-only |
| The knowledge | `.pi/knowledge/`, checked in ([D35](#d35)) | its developer, and the agent while it runs | its own |

```
agent-x/agents/<name>/
  .pi/                  the definition (D2)
    settings.json       Pi project settings; agentx's own are under `agentx`
    mcp.json            MCP servers
    knowledge/          the knowledge (D35), a folder for each kind
      system_prompt/    *.md, a section each after the harness's, in the order of the index before each name; 1-role.md says what the agent is for
      skills/  extensions/
      router/           event_router.ts, the router; the template's sends every event to main
      workflows/        workflows.json and the workflows' scripts
      schedules/        schedules.json
      webhooks/         webhooks.json, with each webhook's token, kept with `agentx webhook`
  .env                  its keys, such as COMPOSIO_API_KEY (D43), gitignored
  storage               a link to agent-x/storage/<name>/ (D65), gitignored
    sessions/<thread>/  the thread's Pi sessions
    memory/index.db     the index of its episodes
    workspace/          the agent's files; workflow-logs/, router-logs/, webhook-logs/, inbox/, outbox/, browser/ (its browser profiles)
    event_queue.db      the event queue
    heartbeat           the time agentx run last saw all its loops working
    schedule-state.json what the coordinator fired of each schedule
```

## Storage

An agent's runtime state is in `agent-x/storage/<name>/`, and the agent reaches it as `storage/`: a link now, a mount in a sandbox later ([D65](#d65)). Everything inside the agent says `storage/`: the harness prompt, the paths in events, the routers and workflows.

- `init-agent` makes the folder and the link (`ensureStorage` in `src/agent-runtime/storage.ts`). `agentx run`, `chat`, `event` and `serve` make them again when missing, as after a fresh clone.
- A `storage` that is already there, a link or a folder of its own, is used as it is; agentx never moves or deletes one. But `agentx serve` does not run an agent whose `storage` is not its central folder, and `agentx event deliver` refuses one, since both reach the agent through the central folder.
- `agentx remove-agent <name>` deletes an agent with its state, after asking ([CLI](../../cli/README.md#commands)).
- `agentx remove-thread <thread-id>` deletes a thread's sessions and its episodes in the memory index, after asking ([CLI](../../cli/README.md#commands)).

## .pi/settings.json

The file belongs to the developer. What agentx needs from Pi, `agentx chat` and `agentx run` pass as flags ([Pi](../pi/README.md#how-agentx-chat-starts-pi)). The template:

```json
{
	"extensions": ["knowledge/extensions"],
	"skills": ["knowledge/skills"],
	"prompts": [],
	"packages": ["npm:pi-web-access@0.48.0", "npm:pi-doc-reader@0.3.2"],
	"agentx": {
		"timezone": null,
		"systemPrompt": ["knowledge/system_prompt"],
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

- `extensions` and `skills` name the knowledge's folders, resolved from `.pi/`. Pi also loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` by itself when they exist ([Pi](../pi/pi-reference/README.md#config-locations)); the template has none of them.
- `packages` takes Pi packages. Pi installs missing ones on start, into `.pi/npm/` and `.pi/git/`, which are gitignored. The template lists two, each at an exact version ([D83](#d83)):

| Package | What it gives the agent |
|---|---|
| [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Web search and reading pages, PDFs and videos without a browser, with no key needed. Tools: `web_search`, `fetch_content`, `get_search_content`, `source_check` |
| [`pi-doc-reader`](https://www.npmjs.com/package/pi-doc-reader) | `read` opens PDF, DOCX, XLSX and PPTX files |

- `agentx` holds agentx's own settings for the agent ([D36](#d36)). The template lists each with its default value, so a developer sees what there is to change. The agent's `description` and `canSendTo` are in the project's [`agentx.json`](../../coordinator-runtime/README.md#d63).

| Key | Meaning |
|---|---|
| `systemPrompt` | Folders whose `*.md` files follow the harness's sections in the system prompt, each a section `agentx-knowledge-<file name>`, resolved from `.pi/`. The template lists the knowledge's `system_prompt/`. |
| `composio` | The agent's Composio user id and session policy ([Composio](../pi/pi-package/composio/README.md#settings)). The template enables eight toolkits; `init-agent` adds the user id. |
| `runner` | The limits of `agentx run` ([supervisor](../supervisor/README.md#settings)). |
| `timezone` | The agent's time zone: its processes run in it, every time the harness shows the agent is in it, and so are its schedules ([D98](#d98)). `null` means the machine's; an IANA name such as `Asia/Kolkata` fixes it. |
| `memory` | `compaction`: folds, fold nudges and summaries ([context](../pi/pi-package/context/README.md#settings)). |

- A later agentx may add settings. `agentx upgrade-agent` adds each `agentx` setting the agent lacks, with the template's value, and moves the packages the template pins to their new versions ([D100](../../cli/README.md#d100)). It brings back a setting that was deleted, so turn one off by its value, such as `"systemPrompt": []`.

## System prompt

The system prompt extension builds the prompt: the harness's preamble, then, after Pi's own sections and a section per skill, a section per file: the harness's, the agents this one can send to, then the `agentx.systemPrompt` folders, `.pi/knowledge/system_prompt/` in the template, in the order of the index before each name ([Pi package](../pi/pi-package/README.md#the-system-prompt-extension), [D5](#d5)).

## Knowledge

`.pi/knowledge/` is what the agent and its developer keep for every later session ([D35](#d35)). Both write it, and it is checked in, so git shows what the agent changed and a clone has it. The harness prompt tells the agent so, that no secret goes in it, and that the harness and the rest of `.pi/` are read-only.

| In `.pi/knowledge/` | Loaded |
|---|---|
| `system_prompt/*.md` | at the end of the system prompt, a section per file, at the start of every run, through `agentx.systemPrompt` |
| `skills/<name>/SKILL.md` | a section per skill, at the start of every run, through `skills` ([skills](../pi/pi-package/README.md#the-skills-extension)) |
| `extensions/` | when a session starts, through `extensions`, as Pi loads `.pi/extensions/` |
| `router/event_router.ts` | for every event without a thread ([routing](../events/README.md#routing)) |
| `workflows/workflows.json` and its scripts | when routing and running ([workflows](../workflows/README.md)) |
| `schedules/schedules.json` | by the coordinator, when it changes ([schedules](../../coordinator-runtime/services/scheduler/README.md)) |
| `webhooks/webhooks.json` | by the coordinator, on every request to one of the agent's webhooks; kept with `agentx webhook` ([webhooks](../../coordinator-runtime/services/webhooks/README.md)) |

Nothing else goes in it. The harness prompt tells the agent to keep what holds in every conversation as a note in `system_prompt/`, and what holds only for some task or situation as a skill, with any data the skill needs in its folder. All threads of the agent share it. agentx commits nothing: the developer commits what the agent wrote.

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
- What the agent writes into its knowledge on a server reaches git only when someone commits it there, and a deploy that replaces the agent directory drops what was not.
- Whatever makes the agent write into its knowledge, an event included, lasts for every later session: its prompt text is read at the start of every run, and its router, workflows and extensions are code that runs.
- An extension that fails to load stops Pi from starting, so every later session fails until a person fixes or removes it, also one the agent wrote. The harness prompt tells the agent to try one first, outside `extensions/`.
- Each webhook's token is in git with its webhook, so whoever can read the repository can call it ([D101](../../coordinator-runtime/services/webhooks/README.md#d101)). `agentx webhook rotate` replaces a token that leaked.
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

- **Decision.** `chat` and `run` only start processes; everything they and Pi write is gitignored: `storage/`, `agent-x/.pi/`, and Pi's `.pi/npm/` and `.pi/git/`. Only the agent writes what is checked in, into its knowledge ([D35](#d35)).
- **Why.** Otherwise the config in effect would differ from what is checked in.
- **Consequence.** Limits that only generated files could remove are accepted ([D6](#d6)).

<a id="d5"></a>
### D5. The system prompt comes from an extension

- **Decision.** agentx's system prompt extension sets the prompt in `before_agent_start`, from the harness prompt and the `agentx.systemPrompt` folders, a section per file ([D73](../pi/pi-package/README.md#d73)).
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
### D35. The agent's knowledge is `.pi/knowledge/`, one checked-in source that the agent and its developer both write

- **Problem.** An agent learns while it runs, and its developer shapes it. Both need the result in every later session, on every machine, and the developer needs to see what the agent learned.
- **Decision.** Everything that lasts, other than settings and MCP servers, is in `.pi/knowledge/`, a folder for each kind: `system_prompt/`, `skills/`, `extensions/`, `router/`, `workflows/`, `schedules/` and `webhooks/`. Each kind has one source, which the agent and its developer both edit, and the folder is checked in. The settings list its `skills/`, `extensions/` and `system_prompt/`. The rest of `.pi/` is the developer's and read-only to the agent, and `storage/` holds only state and working files ([D65](#d65)).
- **Why.** The developer reviews what the agent learned in git, as their own changes, and a clone or a deploy has it. With one source, no rule says whose entry of a name wins. Listing the folders in the settings keeps them the developer's choice.
- **Rejected.** Passing the folders as flags: they would load in every agent, whatever its developer wants.
- **Consequence.** The agent can write extensions, which run with all of Pi's power, and a webhook's token is in git ([Known limits](#known-limits)).

<a id="d36"></a>
### D36. agentx's own settings for an agent are under `agentx` in its `.pi/settings.json`

- **Decision.** An `agentx` object in the agent's `.pi/settings.json` holds `timezone`, `systemPrompt`, `composio` and `runner`. agentx's extensions read it with `pi.getSettings()`; code outside Pi reads the file as JSON.
- **Why.** One settings file per agent. Pi keeps keys it does not know and hands them to extensions.
- **Consequence.** Outside Pi, `agentx` keys in the shared `agent-x/.pi/settings.json` do not apply.

<a id="d43"></a>
### D43. Each agent's keys go in its own gitignored `.env`; the environment wins

- **Decision.** Every process of the agent gets the environment of `agent-env.ts`: the process's own, plus the variables of the agent's `.env` it does not have, and `AGENTX_AGENT`, the agent's name. `init-agent` writes the file, with each key the agent uses commented out. The project's `agent-x/.env` is the coordinator's, and no agent reads it ([D68](../../coordinator-runtime/README.md#d68)).
- **Why.** An agent's processes get its keys, and no other agent's or the coordinator's. Its secrets are in one file next to its settings; a deployment sets the same variables in the environment and needs no file.
- **Rejected.** `web/.env.local`, which belongs to the app; one file for every agent and the coordinator, which would put the coordinator's keys, such as one that connects Composio accounts for any agent, into every agent's processes.
- **Consequence.** A key that several agents use, such as the Composio project's, is in each one's `.env`. A variable set in the environment of `agentx serve` reaches every agent, until they run in sandboxes.

<a id="d65"></a>
### D65. An agent's state lives in `agent-x/storage/<agent>/`, reached as `storage/` through a link

- **Decision.** Every agent's runtime state is in `agent-x/storage/<agent>/`. The agent directory reaches it through `storage`, a relative link that agentx makes when it is missing, and in a sandbox a mount. The coordinator uses the central folder.
- **Why.** Definition and state are apart: a deploy replaces one and keeps the other, and a server backs up one folder. Inside the agent nothing changes, in or out of a sandbox. The folder is inside `agent-x/`, so scripts in the agent's working files find the project's packages.
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
