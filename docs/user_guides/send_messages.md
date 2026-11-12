# Send messages to an agent

Besides typing to an agent, you can put messages on its queue and let it work through them. Run these from `agent-x/agents/<name>`.

## Open the thread

A thread's messages are handled by its Pi session, so keep that session open in a terminal:

```sh
agentx run                            # the thread "main"
agentx run --thread-id support        # another thread, in another terminal
```

Messages queued for the thread arrive in that session as if you had typed them. If you stop a session in the middle of a message, the message is marked `cancelled`; an unhandled one stays queued until the thread is opened again.

Nothing runs threads in the background yet: `agentx serve` is planned.

## Queue a message

```sh
agentx send "Summarize storage/workspace/notes.md"
agentx send --thread-id support --meta from=ops --meta ticket=42 "The export is failing again"
```

| Option | Effect |
|---|---|
| `--thread-id <id>` | The conversation the message belongs to. Default `main`. Letters, digits, `.`, `_` and `-`. |
| `--do-not-steer` | If the thread is busy, wait for its next run instead of joining the one in progress. |
| `--silent` | Do not start a run for this message; it goes along with the next message of the thread. |
| `--meta <name>=<value>` | A fact for the agent about the message, such as `--meta from=ops`. Repeat it for more. |

Any other option is an error. The command confirms what it queued, with the thread and the facts. Put `--` before content that starts with dashes.

A thread is one conversation, kept in one Pi session. Messages of the same thread are handled in the order they were sent, except that a `--do-not-steer` message can be overtaken by a later one that joins the run in progress. Different threads run side by side.

If a message arrives while its thread is already working, the agent gets it at its next step, without waiting for the current answer to finish. A message for a thread that no session has open waits on the queue.

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

The `id` is the message's id, the one `agentx send` prints. The `agentX-` lines are added by agentx: when you sent the message and when the agent got it. The others are yours. The times are the machine's, unless the agent's settings name a time zone ([customize an agent](customize_an_agent.md#time-zone)). A message whose text or metadata contains `<agentx-metadata` is refused, so that nobody can fake the block.

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
| `cancelled` | The run was stopped in a terminal session: aborted, or the session was closed or switched while it ran. |

`done`, `failed` and `cancelled` are final. To have a message handled again, send it again.

The agent's answer is in the thread's session. Open it with `agentx run --thread-id <thread>`.

## One session per thread

Only one process runs a thread at a time. If a thread is already open in another terminal, `agentx run` for the same thread stops with a message; use that terminal, or open another thread with `agentx run --thread-id <other>`.

A one-shot run (`agentx run -p "..."`) answers its own prompt and leaves the queue alone.

## Without a model or a login

A message cannot run until the agent has a model and a login ([quick start](quick_start.md)). Until then it is tried three times in a few seconds and marked `failed`, with the reason in `error`. Send it again after you log in.
