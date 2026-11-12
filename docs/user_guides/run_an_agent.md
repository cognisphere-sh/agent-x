# Run an agent

Run these in `agent-x/agents/<name>`. If `agentx` is not installed globally, put `pnpm exec` in front.

| Command | Effect |
|---|---|
| `agentx run` | Open the thread `main`, creating it the first time |
| `agentx run --thread-id <thread>` | Open another thread, and create it if it does not exist |
| `agentx run -c` | Continue the latest session, whatever its thread |
| `agentx run -r` | Pick a session from a list |
| `agentx run --session <id>` | Open a session by its full or partial id |
| `agentx run <pi args>` | Pass any Pi arguments, such as `-p "prompt"` |

Sessions are kept in `storage/sessions`. Files the agent makes go in `storage/workspace`.

## Threads

A thread is one conversation, kept in one session. The thread's name is the session's id. `main` is the default. In Pi, `/new` starts a session with a new id, which is a new thread.

Messages can also reach a thread through the agent's queue ([send messages](send_messages.md)). While a session is open, the queued messages of its thread arrive in it.

Only one process runs a thread at a time. If another process runs the thread, `agentx run` stops with a message: wait for that run to end, or open another thread. A killed session holds its thread for up to two minutes.

## Non-interactive runs

```sh
agentx run -p "Summarize storage/workspace/notes.md" < /dev/null
```

From a script, close stdin (`< /dev/null`), or Pi waits to read it.

A one-shot run adds to `main` unless you pass `--thread-id`, and is refused while another process runs the thread. It answers only its own prompt; queued messages wait for the runner or a terminal session. To leave no trace, add `--no-session`.

## Pi subcommands

Pi subcommands work, such as `agentx run mcp list` and `agentx run install <package>`. `pi mcp` reads `.pi/mcp.json` only after you have trusted the agent once with `/trust` in an interactive session.

## What is and is not loaded

Loaded:

- agentx's Pi package: its extensions and the harness prompt.
- The agent's `.pi/`: `settings.json`, `mcp.json`, `system_prompt/`, `skills/`, `extensions/`.
- The agent's `storage/knowledge/`, through the lines for it in `.pi/settings.json`.

Not loaded:

- `~/.pi/agent`: your global Pi settings, extensions and login.
- `AGENTS.md` and `CLAUDE.md` files.

Skills in `~/.agents/skills` are hidden from the agent. Pi still loads them and lists them at startup, and you can run one yourself with `/skill:<name>`.
