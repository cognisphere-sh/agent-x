# Send messages to an agent

Besides typing to an agent, you can put messages on its queue and let it work through them. Run these commands from `agent-x/agents/<name>`.

## Open the thread

A thread's messages are handled by its Pi session, so keep that session open in a terminal:

```sh
agentx run                            # the thread "main"
agentx run --thread-id support        # another thread, in another terminal
```

Queued messages arrive in the session as if you had typed them. If you stop the session in the middle of a message, that message is `cancelled`. Messages not yet handled wait until the thread is open again.

Nothing runs threads in the background yet: `agentx serve` is planned.

## Queue a message

```sh
agentx send "Summarize storage/workspace/notes.md"
agentx send --thread-id support --meta from=ops --meta ticket=42 "The export is failing again"
```

| Option | Effect |
|---|---|
| `--thread-id <id>` | The conversation. Default `main`. Letters, digits, `.`, `_` and `-`, starting and ending with a letter or digit. |
| `--do-not-steer` | If the thread is busy, wait for its next run instead of joining the current one. |
| `--silent` | Do not start a run; go along with the thread's next message. |
| `--meta <name>=<value>` | A fact for the agent, such as `--meta from=ops`. Repeat it for more. |

Any other option is an error. The command prints the message's id, thread and facts. Put `--` before text that starts with dashes.

A thread is one conversation in one Pi session. Threads run side by side. A thread's messages are handled in the order sent, except that a later message can join a run ahead of a `--do-not-steer` one. A message that arrives while its thread is working reaches the agent at its next step.

## What the agent sees

Each message starts with a block of facts, then your text:

```
<agentx-metadata id="q7Rk2mXa9LbT">
agentX-ThreadId: support
agentX-SentTime: Wednesday 2026-11-11 21:58:10 GMT+5:30
agentX-CurrentTime: Wednesday 2026-11-11 21:59:54 GMT+5:30
agentX-IsRetry: false
from: ops
ticket: 42
</agentx-metadata>
The export is failing again
```

- The `id` is the one `agentx send` prints.
- The `agentX-` lines come from agentx. The others are your `--meta` facts.
- Times use the machine's time zone, unless the agent's settings name one ([customize an agent](customize_an_agent.md#time-zone)).
- A message whose text or facts contain `<agentx-metadata` is refused, so nobody can fake the block.

Nobody may be watching when a queued message runs. So the agent treats an on-screen question from a tool or extension as declined, and asks you in its reply instead.

## See what happened

The queue is a SQLite file in the agent's `storage/`:

```sh
sqlite3 storage/message_queue.db 'SELECT id, thread_id, status, attempts, error FROM messages ORDER BY seq DESC LIMIT 20'
```

| Status | Meaning |
|---|---|
| `queued` | Waiting for its thread. |
| `in_flight` | Its thread's session has taken it. |
| `done` | The agent finished the run that handled it. |
| `failed` | Three attempts failed. `error` says why. |
| `cancelled` | The run was stopped in a terminal session: aborted, or the session was closed or switched during it. |

`done`, `failed` and `cancelled` are final. To have a message handled again, send it again.

The agent's answer is in the thread's session: `agentx run --thread-id <thread>`.

## One session per thread

Only one process runs a thread at a time. If the thread is open in another terminal, `agentx run` for it stops with a message. Use that terminal, or open another thread.

A one-shot run (`agentx run -p "..."`) answers its own prompt and leaves the queue alone.

## Without a model or a login

A message cannot run until the agent has a model and a login ([quick start](quick_start.md)). Until then it is tried three times within a few seconds and marked `failed`, with the reason in `error`. Send it again after you log in.
