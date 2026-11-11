# Customize an agent

Everything below lives in `agent-x/agents/<name>/` and is checked in. agentx's own extension, harness prompt and skills come from the agentx package and are not edited here. Changes apply on the next session; system prompt changes apply on the next prompt.

## System prompt

Add or edit `.md` files in `system_prompt/`. They are joined in filename order after the harness prompt, which explains agentx and the agent's files and always comes first. Rewrite `00-identity.md` to say who this agent is, and add sections after it, such as `10-style.md`. Pi appends the skills list and working directory.

## Skills

Add `skills/<skill-name>/SKILL.md`:

```markdown
---
name: release-notes
description: Write release notes from a list of changes.
---

Steps the agent follows...
```

## Extensions

Add a `.ts` file to `extensions/`. Pi loads it with no build step.

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

Pi installs missing packages on the next start, into `.pi/npm/` and `.pi/git/` (gitignored). `npm run pi -- install -l <package>` adds the entry for you; without `-l` it goes to `agent-x/.pi`, which is not checked in and applies to every agent of the project.
