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
- **Answer some messages with a script, not the model:** handle the `input` event, run the script with `pi.exec`, show its output with `pi.sendMessage`, and return `{ action: "handled" }`.

Under the runner nobody watches the session. A dialog such as `ctx.ui.confirm` gets no answer and counts as cancelled.

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

Pi packages bundle extensions, skills, prompt templates and themes, from npm, git or a local path. List them in `.pi/settings.json`:

```json
"packages": ["npm:@example/pi-tools@1.0.0"]
```

Pi installs missing packages on the next start, into `.pi/npm/` and `.pi/git/` (gitignored). `agentx run install -l <package> --approve` adds the entry for you; `--approve` is needed because Pi changes a project's packages only when it trusts the project. Without `-l`, the package goes to `agent-x/.pi`, which is not checked in and loads in every agent of the project.

## Time zone

Queue messages tell the agent when they were sent and what time it is. A new agent's `.pi/settings.json` has `"timezone": null`, the machine's time zone. Name a zone to fix it, for example so that an agent on a UTC server keeps your time:

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
- The agent writes there when it decides to, also when a queue message tells it to, and what it writes applies to every later session. Read the folder from time to time.
