# Event queue extension

The extension in every Pi session that hands a Pi thread's [events](../../../events/README.md) to Pi. `index.ts` is the extension; `render.ts` says how events look to the model.

## The event queue extension

It claims the thread's events, sends them to Pi, records the session entry each became, and settles them when the run ends, at its first settle. The thread is the session's folder, `storage/sessions/<thread>/`. It works the same under `agentx chat` and `agentx run` ([D23](../../README.md#d23)), apart from [workers](#workers).

| When | What it does |
|---|---|
| `session_start` | Reads the agent's time zone, opens the queue, takes the thread's lease. Refuses a workflow's thread. |
| `resources_discover` | Starts a one-second timer, once every extension has started ([D44](#d44)). |
| every second | Checks the lease. If Pi is idle, claims the queued events and sends them as one user message, which starts a run. A worker with no work left ends the session. |
| `context` (before every model call) | Writes the session entry id of each new user message to the events it holds. |
| `turn_end` | Claims the events that may be steered and sends them as a steer, which Pi adds before the next model call. |
| `agent_before_settle`, `agent_settled` | Settles the run's events at its first `agent_before_settle`, done or failed as Pi judged the run, before any turn that another extension adds after it, such as the [context extension's](../context/README.md#fold-nudges) turn to fold; `turn_end` steers nothing into that turn. An aborted run, which has no `agent_before_settle`, is settled at `agent_settled`. |
| `input` | Refuses input in a session without the lease. |
| `session_shutdown` | Stops the timer, gives up the lease, closes the queue. |
| the process's `exit`, without `session_shutdown` | Gives the run's events in flight another attempt, gives up the lease, closes the queue ([D113](#d113)). |

A session whose lease went to another process aborts its run and takes no more input or events.

How this fits Pi ([Pi](../../pi-reference/README.md#delivering-messages)):

- Pi has no event for "an event arrived" while idle, so the extension polls.
- A one-shot run takes nothing from the queue ([D28](#d28)), nor does a session that is not saved (`--no-session`).
- Pi does not say whether it took a message. So before a run, the extension checks that Pi has a model and a login. If not, a worker's events fail with the reason; in a person's session they wait, not taken, and the session says why once, since the person can still choose a model or log in. An event still in flight a minute after Pi went idle gets another attempt.
- What goes wrong while the session is idle, such as a queue file that stays locked, is said once, in the session's UI or on its error output, which `agentx run` logs; the session tries again each second.
- A session Pi picked itself (`-c`, `-r`, `/resume`) can lack the lease when another process runs that thread. The extension says so, and writes nothing to the session.

### Workers

The Pi runner starts Pi with `--agentx-worker`, a flag this extension registers, for a session nobody watches ([D32](#d32)):

- A worker ends its session when its thread has no work left, or when it does not hold its thread. The Pi runner starts a new one when events arrive.
- A worker's aborted run gets another attempt, since only an ending process aborts it. In a person's session, an abort is a choice, and the events become `cancelled`.

## What the model sees

`render` turns one delivery's events into one user message: for each event, a metadata block, then its content.

```
<agentX-metadata id="q7Rk2mXa9LbT">
agentX-ThreadId: main
agentX-SentTime: Wednesday 2026-11-11 21:58:10 GMT+5:30
agentX-CurrentTime: Wednesday 2026-11-11 21:59:54 GMT+5:30
agentX-IsRetry: true
agentX-RetryAttempt: 1
from: ops
</agentX-metadata>
The event itself.
```

- The opening tag carries the event's id, by which the extension finds delivered events.
- `agentX-SentTime` is when the event was sent, `agentX-CurrentTime` when it is delivered, in the agent's time zone ([settings](../../../agent/README.md#pisettingsjson)).
- `agentX-RetryAttempt` appears only on retries, `agentX-IsSilent: true` only on silent events.
- The other lines are the event's metadata: the sender's facts, and the harness's own, which no sender can set: `agentX-RouterError`, `agentX-FromAgent`, `agentX-FromThread`, `agentX-FromWorkflow`, `agentX-Schedule`, `agentX-Service`.

A delivered event starts with `<`, so Pi never reads it as a slash command. The harness prompt explains the block to the agent.

## Known limits

- Only senders are checked for `<agentX-metadata`. Typed input that holds a block's opening tag with an event's id could mark that event delivered.
- Aborting, closing or switching a terminal session during a run cancels its queued events, also those waiting inside Pi to be steered in. Pi may still put such an event into the session's next run.
- An agent's extension that drops a block's opening tag from user messages makes delivered events look undelivered, so they are retried and fail.

## Decisions

<a id="d24"></a>
### D24. A retry sends the event again, marked as a retry; three attempts

- **Decision.** An event whose Pi run failed or was cut off is sent again in full, with `agentX-IsRetry: true` and the retry number. After three attempts it is `failed`. A workflow's event gets one attempt ([D53](../../../workflows/README.md#d53)).
- **Why.** One way to deliver; the model is told some work may be done, and the session shows what.

<a id="d25"></a>
### D25. An event reaches Pi as a user message that starts with a metadata block

- **Decision.** Each event starts with a block from `<agentX-metadata id="<event id>">` to `</agentX-metadata>`, one fact per line, the harness's named `agentx-<Name>`. Content or metadata that holds the tag is refused.
- **Why.** No sender can fake a block, and the id links an event to its session entry.
- **Rejected.** A Pi custom message: Pi keeps it apart from user messages and skips their input handling.

<a id="d28"></a>
### D28. Only a session that stays open takes events from the queue

- **Decision.** One-shot runs (`-p`, `--mode json`) take nothing from the queue, though they hold their thread while they run.
- **Why.** A one-shot run prints its last answer, and a steered event would replace the answer to the prompt that was asked.
- **Consequence.** `agentx chat -p` does not drain a thread's queue.

<a id="d32"></a>
### D32. The Pi runner's sessions are workers, marked with `--agentx-worker`

- **Decision.** The extension registers `--agentx-worker`, and the Pi runner passes it. A worker ends its session when its thread has no work, and its aborted runs get another attempt instead of `cancelled`.
- **Why.** Only the extension takes a thread's events, so only it can tell without a race that nothing is left. Unlike an environment variable, a flag is visible and not inherited by the commands the agent runs.

<a id="d44"></a>
### D44. The session takes events only once every extension has started

- **Decision.** The extension takes the thread's lease in `session_start`, but starts the timer that delivers events in `resources_discover`, which Pi sends after every extension's `session_start` handler has finished.
- **Why.** An extension that awaits work in `session_start`, such as registering an MCP server after a network call, must be done before the first run: Pi waits for MCP servers only at the first run's start, and only for those registered by then.
- **Consequence.** `resources_discover` is meant for adding skill and prompt folders; the extension uses it only as the one event that follows start-up.

<a id="d113"></a>
### D113. A session that ends without closing gives its events back as its process exits

- **Problem.** In RPC mode, Pi exits at once, without closing its session, when a write to its output fails ([Pi](../../pi-reference/README.md#rpc-mode)). When `agentx run` dies, the Pi processes it started write to a pipe nobody reads, so their run's events stayed in flight, and their threads held, until the lease ran out two minutes later. On Linux this happened most of the time.
- **Decision.** Once the session holds its thread, the extension listens for its process's `exit`, until `session_shutdown`. If the process exits first, the run's events in flight get another attempt, as when the session closes during a run, and the lease is given up.
- **Why.** Node runs `exit` listeners on `process.exit()` and on an uncaught exception, which are how Pi ends then. The queue is synchronous, as an `exit` listener needs, and the extension is the one code in that process that knows the thread and its events.
- **Rejected.** Ignoring the failed write: Pi exits on it anyway. The next runner checking whether the lease's process is alive: a process id can be reused, and in a sandbox another process's id means nothing.
