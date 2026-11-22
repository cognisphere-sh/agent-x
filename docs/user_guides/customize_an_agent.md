# Customize an agent

Everything below is in `agent-x/agents/<name>/.pi/` and is checked in. It is what you give the agent, and the agent treats it as read-only. agentx's own extensions and harness prompt come from the agentx package, not from here. Changes apply from the next session; system prompt changes from the next message the agent starts on.

## System prompt

Add or edit `.md` files in `.pi/system_prompt/`. Each file is a section of the prompt of its own, `agentx-identity-<file name>`, after the harness's. Start each name with an index: the files go in its order, as numbers, so `1-role.md` comes before `2-style.md`, and `9-` before `10-`. The index only orders: `1-role.md` is the section `agentx-identity-role`, so renumbering a file changes nothing the agent is sent, and two files must not differ only in their index. When you change one file, the agent's conversations get only that section again, so keep one subject per file. Rewrite `1-role.md` to say what this agent is for, and add files such as `2-style.md`. Name files with lowercase letters, digits and hyphens: any other character becomes `-` in the section's name. Pi's working directory and the agent's skills come before these sections.

## Skills

Every agent has agentx's own skills too, such as its [browser](give_an_agent_a_browser.md). Add one of the agent's own as `.pi/skills/<skill-name>/SKILL.md`:

```markdown
---
name: release-notes
description: Write release notes from a list of changes.
metadata:
  version: 1
---

Steps the agent follows...
```

Each skill is a section of the agent's prompt of its own, with its name, description, version and file; the agent reads the file when a task needs it. A new skill, or a change to one, shows from the agent's next run. When you change a skill, raise its version and say what changed at the top of a `CHANGELOG.md` next to it: the agent's conversations see the new version, and read the changelog. The agent does the same with its own skills. When one of its skills has the name of one of yours, the agent's is used.

## Extensions

Add a `.ts` file to `.pi/extensions/`. Pi loads it with no build step. Extensions are yours alone: the agent writes skills, prompt text, a router and workflows for itself, but no extensions.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("hello", {
		description: "Say hello",
		handler: async (args, ctx) => ctx.ui.notify(`hello ${args}`, "info"),
	});
}
```

Common uses:

- **Commands:** `pi.registerCommand`.
- **Tools:** `pi.registerTool`.
- **Answer what a person types with a script, not the model:** handle the `input` event, run the script with `pi.exec`, show its output with `pi.sendMessage`, and return `{ action: "handled" }`. For events, write a [workflow](#workflows) instead.

Under `agentx run` nobody watches the session. A dialog such as `ctx.ui.confirm` gets no answer and counts as cancelled.

## MCP servers

Add servers to `.pi/mcp.json`:

```json
{
	"mcpServers": {
		"github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
	}
}
```

A server named `composio` would replace the agent's Composio tools; give yours another name.

## External services (Composio)

Every agent can use [Composio](https://docs.composio.dev)'s tools to work in external services, such as Gmail, Google Calendar and Drive, through accounts of its own. Create a Composio project and a scoped API key with only **Session management** (read, write) and **Session tool execution** (write), and set it where agents run. Without it, the agent has no Composio tools and says so when a task needs them.

```sh
# agent-x/agents/<name>/.env, the agent's own, which git ignores
COMPOSIO_API_KEY=...
```

Only that agent gets the variables of its `.env`; each agent that uses Composio needs the key in its own. On a server, you can set them in the environment of the process that runs agentx instead, which every agent gets; a variable there wins over the file.

A new agent's `.pi/settings.json` has its Composio user id, `<agent>@<project>`. Keep it as it is: the agent's connected accounts are kept under it. To connect an account, ask the agent in `agentx chat`, for example "connect my Gmail"; it gives you a link to sign in.

A new agent's settings enable eight services: Gmail, Google Calendar, Drive, Sheets and Docs, Supabase, HubSpot and Telegram. Without `toolkits`, an agent may use every service Composio has. By default an agent may ask for connections. Change all of this under `session`, in Composio's [session options](https://docs.composio.dev/docs/configuring-sessions); what you give replaces agentx's default key by key:

```json
"agentx": {
	"composio": {
		"userId": "main@my-project",
		"session": {
			"toolkits": { "enable": ["gmail", "github"] },
			"manage_connections": { "enable": false }
		}
	}
}
```

`toolkits.enable` lists the services (Composio's slugs, such as `github` or `slack`), or `["*"]` for all of them; `manage_connections.enable: false` stops the agent from asking for connections. A change applies from each thread's next start. Details: [Composio](../architecture/agent-runtime/pi/pi-package/composio/README.md).

## Packages

Pi packages bundle extensions, skills, prompt templates and themes, from npm, git or a local path. List them in `.pi/settings.json`:

```json
"packages": ["npm:@example/pi-tools@1.0.0"]
```

A new agent lists two: `pi-web-access`, which searches and reads the web, and `pi-doc-reader`, which lets `read` open PDF and office files ([what each gives](../architecture/agent-runtime/agent/README.md#pisettingsjson)). Change a version, or remove a line to leave a package out. [`agentx upgrade-agent`](upgrade_agentx.md) moves these two to the versions a new agentx pins, and adds neither back once removed. Keys for more search providers go in `agent-x/.pi/web-search.json`.

Pi installs missing packages on the next start, into `.pi/npm/` and `.pi/git/` (gitignored). `agentx chat install -l <package> --approve` adds the entry for you; `--approve` is needed because Pi changes a project's packages only when it trusts the project. Without `-l`, the package goes to `agent-x/.pi`, which is not checked in and loads in every agent of the project.

## Workflows

A workflow handles events with a script instead of the model, such as filing every invoice email. Your workflows go in `.pi/workflows.json`, checked in and read-only to the agent; the agent can add its own in `storage/knowledge/workflows.json`. A new agent has both, empty, each with an empty `workflows/` folder next to it for the scripts, and on a name in both, the agent's is used:

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "workflows/file-invoice.ts",
		"timeoutSeconds": 600
	}
}
```

`script` is a path from `.pi/` to a `.ts` module whose default export takes the event ([send events](send_events.md#workflows) shows one). The routers decide which events go to a workflow: route them in `.pi/event_router.ts` ([send events](send_events.md#routing)), or tell the agent in its system prompt when to use yours. A failed run is not retried; the workflow's `babysitterThread` (`main` by default) hears about it.

## How `agentx run` runs the agent

`agentx run` takes its limits from `agentx.runner` in the agent's `.pi/settings.json`. All are optional:

```json
"agentx": {
	"runner": { "maxThreads": 4, "stallSeconds": 600, "routerSeconds": 60 }
}
```

| Key | Default | Meaning |
|---|---|---|
| `maxThreads` | 4 | Pi threads that run at once. Each Pi process uses about 130 MB. |
| `stallSeconds` | 600 | A Pi process that writes nothing for this long is stopped. Set it above the longest time one of the agent's tools runs without output. |
| `routerSeconds` | 60 | How long each router may take for one event. |

## Schedules

A schedule sends the agent an event at the times a cron pattern names. List yours in `.pi/schedules.json`; the agent can add its own in `storage/knowledge/schedules.json`. A new agent has both, empty, and on a name in both, the agent's is used: the agent can change one of yours, or stop it with a copy that has `"isActive": false`:

```json
{
	"daily-report": { "cron": "0 9 * * 1-5", "content": "Write the daily report.", "threadId": "reports" },
	"new-year": { "cron": "0 0 1 1 *", "content": "Say happy new year to the team.", "fireOnce": true },
	"monthly-invoices": { "cron": "0 8 1 * *", "threadId": "workflow.file-invoices", "metadata": { "month": "last" } }
}
```

A schedule can run a [workflow](send_events.md#workflows) instead of the model: its `threadId` is `workflow.<name>`. It then needs no `content`, and the workflow reads its `metadata` as `event.metadata`. `cron` is in the agent's time zone (below). Schedules fire only under `agentx serve`, and an edit applies within a second. All the keys, such as `catchUp` for fires missed while it was down: [coordinator](../architecture/coordinator-runtime/services/scheduler/README.md).

## Removing an agent

`agentx remove-agent <name>`, in the project root, `agent-x/` or `agent-x/agents/`, lists what it deletes: the agent's folder, its state in `agent-x/storage/<name>/` (its sessions and what it learned), and its entry in `agent-x/agentx.json`. It deletes them when you answer `y`; anything else, or Ctrl-C, keeps them. `--yes` deletes without asking. The other agents' `canSendTo` lose its name. Stop `agentx serve` first: it refuses while the agent runs.

## Removing a thread

`agentx remove-thread <thread-id>`, in the agent's directory, deletes a thread: its sessions in `storage/sessions/<thread-id>/` and its episodes in the agent's [memory](#memory). It says what it deletes and asks first; `--yes` deletes without asking. It refuses while the thread runs, in `agentx chat` or under `agentx run`, and while events wait for it. The agent itself cannot run it. An event for the thread later starts it again, empty.

## Who the agent may send to

The project's agents are listed in `agent-x/agentx.json`; `agentx init-agent` adds each with an empty `description`. `agentx serve` runs only the agents listed there. Under it, an agent may send events to every other agent of the project. To allow only some, list them in its `canSendTo`:

```json
{
	"agents": {
		"support": { "description": "Answers questions about orders.", "canSendTo": ["billing", "ops"] },
		"billing": { "description": "Files invoices." },
		"ops": { "description": "Watches the servers." }
	}
}
```

The agent's system prompt lists the agents it may send to, each with its `description`, so write one line in every agent's `description` that says what it does. An event to any other agent is not delivered, and the thread that sent it is told why. An empty list allows no agent. Events this agent sends to itself are not affected, nor are those a person delivers.

## Time zone

Every time the agent sees is in its time zone: when its events were sent and what time it is, when its past episodes ran, the times Composio gives, and what `date` says in its bash and `new Date()` in its workflows. Its schedules' crons are in it too. A new agent's `.pi/settings.json` has `"timezone": null`, the machine's time zone. Name a zone to fix it, for example so that an agent on a UTC server keeps your time:

```json
"agentx": {
	"timezone": "Asia/Kolkata"
}
```

## Context

The agent keeps its context small itself ([context](../architecture/agent-runtime/pi/pi-package/context/README.md)):

- An episode is the agent's work from an event to its last answer ([episodes](../architecture/agent-runtime/pi/pi-package/episodes/README.md)). When it ends, a message gives its id and how many tokens it added, from the model's usage.
- When an episode ends and the episodes since the last request added a tenth of the window, the agent is asked to fold earlier episodes it no longer needs into summaries it writes, and gets one turn for it. The request says how, and leaves its context with that turn. It can read any episode back.
- When the context nears the window's end anyway, Pi compacts it by itself, with its own `compaction` settings.

To change how often it is asked:

```json
"agentx": {
	"memory": {
		"compaction": { "foldNudgeEvery": 40000 }
	}
}
```

`foldNudgeEvery` is a count of tokens when it is a whole number, and a share of the window when it is a fraction, such as `0.2`.

`"enabled": false` turns folds off.

## Memory

The agent remembers the episodes of all its threads: it searches them by keywords with `episode_search`, and reads any of them back with `episode_read` ([memory](../architecture/agent-runtime/pi/pi-package/memory/README.md)). Their index, `storage/knowledge/memory/index.db`, is built from the threads' session files, which stay the record. An episode is in it as soon as it ends. Each thread's session indexes its own file. To build the index again, stop the agent and delete `index.db` with its `index.db-wal` and `index.db-shm` files, or the whole `memory/` folder; each thread's episodes come back when the thread next runs.

## What the agent learns

The agent keeps what it learns in `storage/knowledge/`: text for its own system prompt, its own skills, and notes, files and scripts. The folder is the agent's, not yours, and is not checked in. A new agent's settings load it:

```json
"skills": ["../storage/knowledge/skills"],
"agentx": {
	"systemPrompt": ["../storage/knowledge/system_prompt"]
}
```

Without these lines the agent loads none of its knowledge. Remove a line to stop the agent from teaching itself that way. Know that:

- The agent writes there when it decides to, also when an event tells it to, and what it writes applies to every later session. That includes its event router and its own workflows, which are code that `agentx run` runs. Read the folder from time to time.
