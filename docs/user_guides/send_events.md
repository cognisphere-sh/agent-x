# Send events to an agent

Besides typing to an agent, you can send it **events** and let it work through them. Run these commands from `agent-x/agents/<name>`. If `agentx` is not installed globally, put `pnpm exec` in front.

## Run the agent

```sh
agentx run
```

`agentx run` keeps the agent running until you stop it. It:

- sends each event without a thread through the agent's **router**, which picks its thread;
- starts a Pi session for each thread with events;
- runs **workflows**, scripts that handle events without the model.

The first Ctrl-C lets running work finish; a second one stops it now. Events that arrive while it is stopped wait for the next start.

Instead of `agentx run`, you can keep one thread open in a terminal with `agentx chat --thread-id <thread>`: its events arrive in that session as if you had typed them. If you stop a terminal session in the middle of an event, that event is `cancelled`.

## Send an event

```sh
agentx event send "Summarize storage/workspace/notes.md"
agentx event send --thread-id support --meta from=ops --meta ticket=42 "The export is failing again"
```

| Option | Effect |
|---|---|
| `--thread-id <id>` | The thread. Without it, the agent's router picks one. Letters, digits, `.`, `_` and `-`, starting and ending with a letter or digit. `workflow.<name>` runs that workflow. |
| `--agent <name>` | Send to another agent of the project. |
| `--key <key>` | Sending again with the same key adds nothing. |
| `--do-not-steer` | If the thread is busy, wait for its next run instead of joining the current one. |
| `--silent` | Do not start a run; go along with the thread's next event. |
| `--meta <name>=<value>` | A fact for the agent, such as `--meta from=ops`. Repeat it for more. `source=cli` is added unless you give `source` yourself. |

Any other option is an error. The command prints the event's id, where it went and its facts. Put `--` before text that starts with dashes.

Keep the text short. Put large data in a file under `storage/attachments/` and name the file in the text: the agent reads it when it needs to.

A thread is one conversation in one Pi session. Threads run side by side, up to 4 at once unless the agent's settings say otherwise ([customize an agent](customize_an_agent.md#how-agentx-run-runs-the-agent)). A thread's events are handled in the order sent, except that a later event can join a run ahead of a `--do-not-steer` one. An event that arrives while its thread is working reaches the agent at its next step.

## Routing

An event without a thread goes to the agent's router, `storage/knowledge/event_router.mjs`. The agent writes and keeps it. If it is missing, `agentx run` writes a starter that sends every event to `main`.

```js
/** @type {import("agent-x").Router} */
export default async function route(event, ctx) {
	// event: { id, content, metadata, createdAt }. ctx: { workflows: [{ name, description }] }.
	if (event.metadata.source === "composio") return { thread: "inbox" };
	return { thread: "main" };
}
```

It may return a thread, or `workflow.<name>` to run a workflow. If it throws, takes longer than 60 seconds, or returns something else, the event goes to `main` with `agentX-RouterError: <why>` among its facts, and what the router printed is kept in `storage/workspace/router-logs/<event id>.log`.

## Workflows

A workflow handles an event with a script instead of the model. List it in `.pi/workflows.json` (yours, checked in) or `storage/knowledge/workflows.json` (the agent's own):

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "workflows/file-invoice.mjs"
	}
}
```

```js
// .pi/workflows/file-invoice.mjs
/** @type {import("agent-x").Workflow} */
export default async function run(event, ctx) {
	const { invoice } = JSON.parse(event.content);
	// ... file it ...
	await ctx.send(`Filed invoice ${invoice}.`, { threadId: "main" });
}
```

Run it by hand with `agentx event send --thread-id workflow.file-invoice '{"invoice": "4411"}'`, or let the router send events to it.

- Returning means it worked; throwing means it failed. It may take up to `timeoutSeconds`, 600 unless set.
- What it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`.
- A failed run is not run again by itself. The thread named in `failureReportTo` (`<agent>.<thread>`, this agent's `main` unless set) gets an event that says what failed and where the log is.

## What the agent sees

Each event starts with a block of facts, then your text:

```
<agentx-metadata id="q7Rk2mXa9LbT">
agentX-ThreadId: support
agentX-SentTime: Wednesday 2026-11-11 21:58:10 GMT+5:30
agentX-CurrentTime: Wednesday 2026-11-11 21:59:54 GMT+5:30
agentX-IsRetry: false
source: cli
from: ops
ticket: 42
</agentx-metadata>
The export is failing again
```

- The `id` is the one `agentx event send` prints.
- The `agentX-` lines come from agentx. The others are your facts.
- Times use the machine's time zone, unless the agent's settings name one ([customize an agent](customize_an_agent.md#time-zone)).
- An event whose text or facts contain `<agentx-metadata` is refused, so nobody can fake the block.

Nobody may be watching when an event runs. So the agent treats an on-screen question from a tool or extension as declined, and asks you in its reply instead.

## See what happened

```sh
agentx event list              # the newest events, and where each went
agentx event show <id>         # one event: its thread, status, error, session entry, and a workflow's run
```

| Status | Meaning |
|---|---|
| `queued` | Waiting for its thread, or, with no thread yet, for the router. |
| `in_flight` | Its thread's session, or its workflow, has taken it. |
| `done` | The run that handled it finished. |
| `failed` | Three attempts failed, or its workflow's one run failed. `error` says why. |
| `cancelled` | The run was stopped in a terminal session: aborted, or the session was closed or switched during it. |

`done`, `failed` and `cancelled` are final. To have an event handled again, send it again.

The agent's answer is in the thread's session: `agentx chat --thread-id <thread>`. `agentx event show` gives the session entry that got the event.

## One session per thread

Only one process runs a thread at a time. If the thread is open in another terminal, `agentx chat` for it stops with a message. Use that terminal, or open another thread.

A one-shot run (`agentx chat -p "..."`) answers its own prompt and leaves the queue alone.

## Without a model or a login

An event on a Pi thread cannot run until the agent has a model and a login ([quick start](quick_start.md)). Until then it is tried three times within a few seconds and marked `failed`, with the reason in `error`. Send it again after you log in.
