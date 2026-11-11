# Run an agent

Run these from `agent-x/agents/<name>`.

| Command | Effect |
|---|---|
| `npm run pi` | New session |
| `npm run continue` | Continue the most recent session |
| `npm run resume` | Pick a session from a list |
| `npm run pi -- --session <id>` | Open a session by full or partial ID |
| `npm run pi -- <pi args>` | Pass any Pi arguments, e.g. `-p "prompt"` |

Sessions are stored in `storage/sessions`. Files the agent creates go to `storage/workspace`.

## Non-interactive runs

```sh
npm run pi -- -p "Summarize storage/workspace/notes.md" < /dev/null
```

Close stdin (`< /dev/null`) when calling `-p` from a script; otherwise Pi waits to read it.

## Pi subcommands

`npm run pi -- mcp list`, `npm run pi -- install <package>` and other Pi subcommands work. `pi mcp` reads `.pi/mcp.json` only after you trusted the agent once with `/trust` in an interactive session.

## What is and is not loaded

Loaded: agentx's Pi package (its extension and the harness prompt), the agent's `.pi/settings.json`, `.pi/mcp.json`, `skills/`, `extensions/`, `system_prompt/`.

Not loaded: `~/.pi/agent` (your global Pi settings, extensions and login), `AGENTS.md` and `CLAUDE.md` files. Skills in `~/.agents/skills` are not shown to the agent; Pi still lists them at startup and you can run one yourself with `/skill:<name>`.
