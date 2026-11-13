# Chat with an agent

Run these in `agent-x/agents/<name>`. If `agentx` is not installed globally, put `pnpm exec` in front.

| Command | Effect |
|---|---|
| `agentx chat` | Open the thread `main`, creating it the first time |
| `agentx chat --thread-id <thread>` | Open another thread, and create it if it does not exist |
| `agentx chat -c` | Continue the latest session in `main`'s folder, or in the folder of the `--thread-id` given |
| `agentx chat -r` | Pick a session from that folder's list |
| `agentx chat --session <id>` | Open a session by its full or partial id |
| `agentx chat <pi args>` | Pass any Pi arguments, such as `-p "prompt"` |

Sessions are kept in `storage/sessions/<thread>/`, one folder per thread. Files the agent makes go in `storage/workspace`.

## Threads

A thread is one conversation, kept in one session. The thread's name is the session's id. `main` is the default. In Pi, `/new` starts a session with a new id, which is a new thread.

Events can also reach a thread through the agent's queue ([send events](send_events.md)). While a session is open, the queued events of its thread arrive in it. A workflow's thread, `workflow.<name>`, runs a script, not Pi, so `agentx chat` refuses it.

Only one process runs a thread at a time. If another process runs the thread, `agentx chat` stops with a message: wait for that run to end, or open another thread. A killed session holds its thread for up to two minutes.

## Non-interactive runs

```sh
agentx chat -p "Summarize storage/workspace/notes.md" < /dev/null
```

From a script, close stdin (`< /dev/null`), or Pi waits to read it.

A one-shot run adds to `main` unless you pass `--thread-id`, and is refused while another process runs the thread. It answers only its own prompt; queued events wait for `agentx run` or a terminal session. To leave no trace, add `--no-session`.

## Pi subcommands

Pi subcommands work, such as `agentx chat mcp list` and `agentx chat install <package>`. `pi mcp` reads `.pi/mcp.json` only after you have trusted the agent once with `/trust` in an interactive session.

## What is and is not loaded

Loaded:

- agentx's Pi package: its extensions and the harness prompt.
- The agent's `.pi/`: `settings.json`, `mcp.json`, `system_prompt/`, `skills/`, `extensions/`.
- The agent's `storage/knowledge/`, through the lines for it in `.pi/settings.json`.

Not loaded:

- `~/.pi/agent`: your global Pi settings, extensions and login.
- `AGENTS.md` and `CLAUDE.md` files.

Skills in `~/.agents/skills` are hidden from the agent. Pi still loads them and lists them at startup, and you can run one yourself with `/skill:<name>`.
