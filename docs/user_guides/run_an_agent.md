# Run an agent

Run these from `agent-x/agents/<name>`. If `agentx` is not installed globally, put `pnpm exec` in front.

| Command | Effect |
|---|---|
| `agentx run` | Open the thread `main`: a new session the first time, the same one afterwards |
| `agentx run --thread-id <thread>` | Open another thread, creating it if it does not exist |
| `agentx run -c` | Continue the most recent session, whichever thread it is |
| `agentx run -r` | Pick a session from a list |
| `agentx run --session <id>` | Open a session by full or partial ID |
| `agentx run <pi args>` | Pass any Pi arguments, e.g. `-p "prompt"` |

Sessions are stored in `storage/sessions`. Files the agent creates go to `storage/workspace`.

## Threads

A thread is one conversation, kept in one session; the thread's name is the session's ID. `main` is the default. Inside Pi, `/new` starts a session with a new ID, which is a new thread.

Messages can also reach a thread through the agent's queue ([send messages](send_messages.md)). While a session is open, queued messages for its thread arrive in it.

Only one process runs a thread at a time. If another terminal is running the thread, `agentx run` stops with a message saying so. Wait for that run to end, or open another thread.

## Non-interactive runs

```sh
agentx run -p "Summarize storage/workspace/notes.md" < /dev/null
```

Close stdin (`< /dev/null`) when calling `-p` from a script; otherwise Pi waits to read it.

A one-shot run is part of a thread: it adds to `main` unless you pass `--thread-id`, and it is refused while another process runs the thread. It answers only its own prompt; messages queued for the thread stay queued for the runner or a terminal session. For a run that leaves no trace, add `--no-session`.

## Pi subcommands

`agentx run mcp list`, `agentx run install <package>` and other Pi subcommands work. `pi mcp` reads `.pi/mcp.json` only after you trusted the agent once with `/trust` in an interactive session.

## What is and is not loaded

Loaded: agentx's Pi package (its extensions and the harness prompt), the agent's `.pi/`: `settings.json`, `mcp.json`, `system_prompt/`, `skills/`, `extensions/`.

Not loaded: `~/.pi/agent` (your global Pi settings, extensions and login), `AGENTS.md` and `CLAUDE.md` files. Skills in `~/.agents/skills` are not shown to the agent; Pi still lists them at startup and you can run one yourself with `/skill:<name>`.
