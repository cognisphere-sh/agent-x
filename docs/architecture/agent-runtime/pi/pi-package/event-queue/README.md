# Event queue extension

`pi/pi-package/extensions/event-queue/` is the extension in every Pi session that hands a Pi thread's [events](../../../events/README.md) to Pi. It uses the queue from `src/agent-runtime/events/queue.ts`.

```
src/agent-runtime/pi/pi-package/extensions/event-queue/
  index.ts     the extension
  render.ts    how events look to the model: metadata block, then content
```

## The event queue extension

`extensions/event-queue/index.ts` claims the thread's events, sends them to Pi, records the session entry each became, and settles them when the run ends. It reads the thread id from the session id. It works the same under `agentx chat` and under `agentx run` ([D23](../../README.md#d23)), apart from [workers](#workers).

| When | What it does |
|---|---|
| `session_start` | Reads the agent's time zone. Opens the queue, takes the thread's lease. A workflow's thread, `workflow.<name>`, is refused: the session opens no queue and takes no input. |
| `resources_discover` (after every extension's `session_start`) | Starts a one-second timer, so events are taken only once every extension has started ([D44](#d44)). Adds no resources. |
| every second | Checks the lease. If Pi is idle, claims the queued events and sends them as one user message, which starts a run. A worker with no work ends the session instead. |
| `context` (before every model call) | Checks the lease. For each new user message entry with metadata blocks, writes the entry's id to the events named in the opening tags. |
| `turn_end` | Checks the lease. After a completed turn, claims the events that may be steered and sends them as a steer, which Pi adds before the next model call. Skipped while the run is being aborted. |
| `agent_before_settle` | Notes whether Pi judged the run failed, and why. |
| `agent_settled` | Settles the run's events. |
| `input` | Refuses input in a session without the lease. |
| `session_shutdown` | Stops the timer, gives up the lease, closes the queue. |

Checking the lease renews it when due. A session whose lease belongs to another process aborts its run in progress and takes no more input or events. The new holder retries that run's events.

How this fits Pi ([Pi](../../pi-reference/README.md#delivering-messages)):

- Pi has no event for "a queued event arrived" while idle, so the extension waits with a timer.
- `deliverAs: "steer"` joins a run in progress, or starts one when Pi is idle.
- A one-shot run takes nothing from the queue ([D28](#d28)). Neither does an unsaved session (`--no-session`), which would keep no record.
- Pi does not say whether it accepted a message. So before starting a run, the extension checks that Pi has a model and a login, and fails the events with the reason if not. Otherwise, if Pi is idle a minute after the last send and an event is still in flight, Pi did not take it, and it gets another attempt.
- A session can lack the lease when Pi picked it itself (`-c`, `-r`, `/resume`) while another process runs that thread. The extension says so, a one-shot run exits with status 1, and nothing is written to the session.
- An unknown time zone in `agentx.timezone` is reported, and events show the machine's time.

### Workers

The Pi runner starts Pi with `--agentx-worker`, a flag this extension registers ([D32](#d32)). It marks a session nobody watches:

- A worker ends its own session when its thread has no work left (no queued event that can start a run, nothing in flight) or when it does not hold its thread. The Pi runner starts a new Pi process when events arrive.
- An aborted run of a worker gets another attempt, because only Pi closing the session aborts it: `agentx run` stopped or died, or the process was told to end. In a session a person runs, an abort is a choice, and the events become `cancelled`.

## What the model sees

`render` turns the events of one delivery into one user message: for each event, a metadata block and its content, with a blank line between events.

```
<agentx-metadata id="q7Rk2mXa9LbT">
agentX-ThreadId: main
agentX-SentTime: Wednesday 2026-11-11 21:58:10 GMT+5:30
agentX-CurrentTime: Wednesday 2026-11-11 21:59:54 GMT+5:30
agentX-IsRetry: true
agentX-RetryAttempt: 1
from: ops
</agentx-metadata>
The event itself.
```

- The opening tag carries the event's id. The extension finds delivered events by it.
- `agentX-SentTime` is when the event was queued, `agentX-CurrentTime` when it is delivered. Both use the agent's time zone: `agentx.timezone` in its [settings](../../../agent/README.md#pisettingsjson), or the machine's.
- `agentX-IsRetry` is `true` from the second attempt on. `agentX-RetryAttempt` (1 for the first retry) appears only on retries, `agentX-IsSilent: true` only on silent events.
- Other lines are the event's metadata: the sender's facts, `agentX-RouterError` when the router failed on the event, and `agentX-WorkflowRun` on an event a workflow's run sent, which only the harness can set because no sender may use a name that starts with `agentX-`. Values that are not text are shown as JSON; line breaks become spaces.

A queued event always starts with `<`, so Pi never reads it as a slash command. The harness prompt explains the block to the agent ([Pi package](../README.md#the-system-prompt-extension)).

## Known limits

- Only senders are checked for `<agentx-metadata`. Typed input or another extension's message could mark an event delivered, but only by its id, which nobody can guess.
- Aborting, closing or switching (`/new`, `/resume`) a terminal session during a run cancels its queued events, including those waiting inside Pi to be steered in. Pi may still put such a waiting event into that session's next run.
- An agent's extension that drops a block's opening tag from user messages makes delivered events look undelivered, so they are retried and fail.

## Decisions

<a id="d24"></a>
### D24. A retry sends the event again, marked as a retry; three attempts

- **Decision.** An event whose Pi run failed or was cut off is sent again in full, with `agentX-IsRetry: true` and the retry number. After three attempts it is `failed`. A workflow's event gets one attempt ([D53](../../../workflows/README.md#d53)).
- **Why.** One way to deliver; the model is told some work may be done, and the session shows what.

<a id="d25"></a>
### D25. A queued event reaches Pi as a user message that starts with a metadata block

- **Decision.** Each event starts with a block from `<agentx-metadata id="<event id>">` to `</agentx-metadata>`, one fact per line, the harness's named `agentX-<Name>`. The queue refuses content or metadata that contains the tag.
- **Why.** No sender can fake a block, and the random id links an event to its session entry without being guessable.
- **Rejected.** A Pi custom message: Pi keeps it apart from user messages and skips their input handling.

<a id="d28"></a>
### D28. Only a session that stays open takes events from the queue

- **Decision.** One-shot runs (`-p`, `--mode json`) take nothing from the queue, though they hold their thread while they run.
- **Why.** A one-shot run prints its last answer, and a steered event would replace the answer to the prompt that was asked.
- **Consequence.** `agentx chat -p` does not drain a thread's queue; `agentx run` or a terminal session does.

<a id="d32"></a>
### D32. The Pi runner's sessions are workers, marked with `--agentx-worker`

- **Decision.** The extension registers `--agentx-worker`, and the Pi runner passes it. A worker ends its session when its thread has no work, and its aborted runs get another attempt instead of `cancelled`.
- **Why.** Only the extension takes a Pi thread's events, so only it can tell without a race that nothing is left. Unlike an environment variable, a flag is visible and not inherited by the commands the agent runs.

<a id="d44"></a>
### D44. The session takes queued events only once every extension has started

- **Decision.** The extension takes the thread's lease in `session_start`, but starts the timer that delivers events in `resources_discover`, which Pi sends right after every extension's `session_start` handler has finished.
- **Why.** An extension that awaits work in `session_start`, such as one that registers an MCP server after a network call, must be done before the first run: Pi's MCP support waits for direct servers only at the first run's start, and only for those registered by then. Pi loads the agent's own extensions after agentx's package, so no order of extensions could ensure it.
- **Consequence.** `resources_discover` is meant for adding skill and prompt folders; the extension uses it as the one event that follows start-up, and returns none.
