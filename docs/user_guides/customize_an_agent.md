# Customize an agent

Everything below lives in `agent-x/agents/<name>/.pi/` and is checked in. It is what you give the agent, and the agent treats it as read-only. agentx's own extensions, harness prompt and skills come from the agentx package and are not edited here. Changes apply on the next session; system prompt changes apply on the next prompt.

## System prompt

Add or edit `.md` files in `.pi/system_prompt/`. They are joined in filename order after the harness prompt, which explains agentx and the agent's files and always comes first. Rewrite `00-identity.md` to say who this agent is, and add sections after it, such as `10-style.md`. Pi appends the skills list and working directory.

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
- **Answer some messages with a script instead of the model:** handle the `input` event, run the script with `pi.exec`, show its output with `pi.sendMessage`, and return `{ action: "handled" }`.

## MCP servers

Add servers to `.pi/mcp.json`:

```json
{
	"mcpServers": {
		"github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
	}
}
```

## Packages

Pi packages bundle extensions, skills, prompt templates and themes from npm, git or a local path. Add them to `.pi/settings.json`:

```json
"packages": ["npm:@example/pi-tools@1.0.0"]
```

Pi installs missing packages on the next start, into `.pi/npm/` and `.pi/git/` (gitignored). `agentx run install -l <package> --approve` adds the entry for you; Pi changes a project's packages only when it trusts the project, which `--approve` says for this one command. Without `-l` the package goes to `agent-x/.pi`, which is not checked in and applies to every agent of the project.

## Time zone

Queue messages tell the agent the current time. A new agent's `.pi/settings.json` has `"timezone": null`, which means the time of the machine the agent runs on. Name a zone to fix it, for example so that an agent on a server in UTC keeps your time:

```json
"agentx": {
	"timezone": "Asia/Kolkata"
}
```

## What the agent learns

An agent keeps what it learns in `storage/knowledge/`: text for its own system prompt, skills and extensions it writes for itself, and any notes, files and scripts. That folder is the agent's, not yours, and is not checked in. A new agent's settings load it:

```json
"extensions": ["../storage/knowledge/extensions"],
"skills": ["../storage/knowledge/skills"],
"agentx": {
	"systemPrompt": ["../storage/knowledge/system_prompt"]
}
```

An agent whose settings lack these lines loads none of it: add them. Remove a line to keep the agent from teaching itself that way.

Two things to know before you rely on it:

- An extension the agent writes that fails to load stops the agent from starting until you remove the file from `storage/knowledge/extensions/`.
- The agent writes there when it decides to, also on what a queue message tells it, and what it writes applies to every later session. Read the folder from time to time.
