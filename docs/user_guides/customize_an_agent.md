# Customize an agent

Everything below is in `agent-x/agents/<name>/.pi/` and is checked in. It is what you give the agent, and the agent treats it as read-only. agentx's own extensions and harness prompt come from the agentx package, not from here. Changes apply from the next session; system prompt changes from the next prompt.

## System prompt

Add or edit `.md` files in `.pi/system_prompt/`. They follow the harness prompt in filename order. Rewrite `00-identity.md` to say who this agent is, and add sections such as `10-style.md`. Pi adds the skills list and the working directory at the end.

## Skills

Add `.pi/skills/<skill-name>/SKILL.md`:

```markdown
---
name: release-notes
description: Write release notes from a list of changes.
---

Steps the agent follows...
```

## Extensions

Add a `.ts` file to `.pi/extensions/`. Pi loads it with no build step.

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

Every agent can use [Composio](https://docs.composio.dev)'s tools to work in Gmail, Google Calendar, Drive, Sheets and Docs, Supabase, HubSpot and Telegram, through accounts of its own. Create a Composio project and a scoped API key with only **Session management** (read, write) and **Session tool execution** (write), and set it where agents run. Without it, the agent has no Composio tools and says so when a task needs them.

```sh
# agent-x/.env in the project, which git ignores
COMPOSIO_API_KEY=...
```

Every agent of the project gets the variables of `agent-x/.env`. On a server, set them in the environment of the process that runs agentx instead; a variable there wins over the file.

A new agent's `.pi/settings.json` has its Composio user id, `<agent>@<project>`. Keep it as it is: the agent's connected accounts are kept under it. To connect an account, ask the agent in `agentx chat`, for example "connect my Gmail"; it gives you a link to sign in.

By default an agent may use those eight services and ask for connections. Change that under `session`, in Composio's [session options](https://docs.composio.dev/docs/configuring-sessions); what you give replaces agentx's default key by key, and `toolkits` as a whole:

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

`toolkits.enable` lists the services (Composio's slugs, such as `github` or `slack`); `manage_connections.enable: false` stops the agent from asking for connections. A change applies from each thread's next start. Details: [Composio](../architecture/agent-runtime/pi/pi-package/composio/README.md).

## Packages

Pi packages bundle extensions, skills, prompt templates and themes, from npm, git or a local path. List them in `.pi/settings.json`:

```json
"packages": ["npm:@example/pi-tools@1.0.0"]
```

Pi installs missing packages on the next start, into `.pi/npm/` and `.pi/git/` (gitignored). `agentx chat install -l <package> --approve` adds the entry for you; `--approve` is needed because Pi changes a project's packages only when it trusts the project. Without `-l`, the package goes to `agent-x/.pi`, which is not checked in and loads in every agent of the project.

## Workflows

A workflow handles events with a script instead of the model, such as filing every invoice email. Your workflows go in `.pi/workflows.json`, checked in and read-only to the agent; the agent can add its own in `storage/knowledge/workflows.json`, and on a name in both, yours is used:

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "workflows/file-invoice.mjs",
		"timeoutSeconds": 600
	}
}
```

`script` is a path from `.pi/`, to a module whose default export takes the event: [send events](send_events.md#workflows) shows one. The agent's router decides which events go to a workflow; tell the agent in its system prompt when to use yours. A failed run is not retried, and `failureReportTo` (`<agent>.<thread>`, this agent's `main` unless set) hears about it.

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
| `routerSeconds` | 60 | How long the agent's router may take for one event. |

## Time zone

Events tell the agent when they were sent and what time it is. A new agent's `.pi/settings.json` has `"timezone": null`, the machine's time zone. Name a zone to fix it, for example so that an agent on a UTC server keeps your time:

```json
"agentx": {
	"timezone": "Asia/Kolkata"
}
```

## What the agent learns

The agent keeps what it learns in `storage/knowledge/`: text for its own system prompt, its own skills and extensions, and notes, files and scripts. The folder is the agent's, not yours, and is not checked in. A new agent's settings load it:

```json
"extensions": ["../storage/knowledge/extensions"],
"skills": ["../storage/knowledge/skills"],
"agentx": {
	"systemPrompt": ["../storage/knowledge/system_prompt"]
}
```

Without these lines the agent loads none of its knowledge. Remove a line to stop the agent from teaching itself that way. Know that:

- If an extension the agent wrote fails to load, the agent does not start until you remove the file from `storage/knowledge/extensions/`.
- The agent writes there when it decides to, also when an event tells it to, and what it writes applies to every later session. That includes its event router and its own workflows, which are code that `agentx run` runs. Read the folder from time to time.
