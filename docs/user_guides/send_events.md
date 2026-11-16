# Send events to an agent

Besides typing to an agent, you can give it **events** and let it work through them. Run these commands in `agent-x/agents/<name>`. If `agentx` is not installed globally, put `pnpm exec` in front.

## Run the agent

```sh
agentx run
```

`agentx run` keeps the agent running until you stop it. It takes each event from the agent's inbox, oldest first, lets the **routers** pick a thread for one without a thread, starts a Pi session for each thread with events, and runs **workflows**, scripts that handle events without the model.

The first Ctrl-C lets running work finish; a second stops it now. Events that arrive meanwhile wait for the next start.

`agentx serve`, in the project root, runs every agent at once ([run a project on a server](run_on_a_server.md)). It also delivers what the agents send, to each other or to themselves, and fires schedules. Under `agentx run` alone, what an agent sends waits in its outbox.

## Give the agent an event

```sh
agentx event deliver "Summarize storage/workspace/notes.md"
agentx event deliver --thread-id support --meta from=ops "The export is failing again"
agentx event deliver --agent billing --file storage/workspace/invoice.pdf "Please file this one"
```

The event goes straight into the agent's inbox. It needs no `agentx serve`.

| Option | Effect |
|---|---|
| `--thread-id <id>` | The thread. Without it, the routers pick one. `workflow.<name>` runs that workflow. |
| `--agent <name>` | Another agent of the project. |
| `--key <key>` | Delivering again with the same key adds nothing. |
| `--do-not-steer` | If the thread is busy, wait for its next run instead of joining this one. |
| `--silent` | Do not start a run; go along with the thread's next event. |
| `--meta <name>=<value>` | A fact for the agent. Repeat it for more. `source=cli` is added unless you give `source`. |
| `--file <path>` | A file that goes with the event. Repeat it for more. |

The command prints the event's id. Put `--` before text that starts with dashes.

Keep the text short, and send large data with `--file`. The file lands in the event's folder, `storage/workspace/inbox/<id>/`, the text's last line names it, and the agent reads it when it needs to.

A thread is one conversation, kept as a folder of Pi sessions. Threads run side by side, up to 4 at once by default ([customize an agent](customize_an_agent.md#how-agentx-run-runs-the-agent)). A thread's events go in the order sent. An event that arrives while its thread works reaches the agent at its next step.

## Routing

An event without a thread goes to the routers: first the agent's own, `storage/knowledge/event_router.ts`, then yours, `.pi/event_router.ts`. A new agent has yours, which sends every event to `main`; change it or delete it. When no router picks a thread, the event goes to `main`.

```ts
// .pi/event_router.ts
import type { Router } from "agent-x";

const route: Router = async (event, ctx) => {
	// event: { id, content, metadata, createdAt }. ctx: { workflows: [{ name, description }] }.
	if (event.metadata.source === "composio") return { thread: "inbox" };
	// Nothing: the next router decides, or main.
};

export default route;
```

A router returns a thread, `workflow.<name>`, or nothing. One that throws, takes longer than 60 seconds or returns something else counts as nothing. The event then gets `agentX-RouterError: <why>`, and what the router printed is in `storage/workspace/router-logs/`.

## Workflows

A workflow handles an event with a script instead of the model. List it in `.pi/workflows.json` (yours) or `storage/knowledge/workflows.json` (the agent's):

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "workflows/file-invoice.ts"
	}
}
```

```ts
// .pi/workflows/file-invoice.ts
import type { Workflow } from "agent-x";

const run: Workflow = async (event, ctx) => {
	const { invoice } = JSON.parse(event.content);
	// ... file it ...
	await ctx.send(`Filed invoice ${invoice}.`, { threadId: "main" });
};

export default run;
```

Routers and workflows are TypeScript that Node runs as it is, by stripping the types ([D74](../architecture/agent-runtime/functions/README.md#d74)).

Run it by hand with `agentx event deliver --thread-id workflow.file-invoice '{"invoice": "4411"}'`, or let a router or a [schedule](customize_an_agent.md#schedules) send events to it. Its parameters are the event's content and metadata: `--meta month=last` arrives as `event.metadata.month`.

- Returning means it worked; throwing means it failed. It may take up to `timeoutSeconds`, 600 by default.
- What it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`.
- A failed run is not run again. Its babysitter thread (`babysitterThread`, `main` by default) gets an event that says what failed and where the log is.
- `ctx.send(text, { agent, threadId, key, metadata, files })` sends an event, as the agent's own sends go ([below](#when-the-agent-sends)), from the babysitter thread, with `source: workflow.<name>`.

## When the agent sends

The agent sends with `agentx event send`, from its bash, with the same options. Every event it sends, also to itself, waits in its outbox, `storage/workspace/outbox/`, until `agentx serve` delivers it. The receiver sees who sent it, `agentX-FromAgent` and `agentX-FromThread`, and can answer on that thread.

An agent may send only to the agents its `canSendTo` lists ([customize an agent](customize_an_agent.md#who-the-agent-may-send-to)). An event that cannot be delivered comes back to the thread that sent it, saying why.

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
</agentx-metadata>
The export is failing again
```

The `agentX-` lines come from agentx; the others are your facts. Times use the machine's time zone, unless the agent's settings name one ([customize an agent](customize_an_agent.md#time-zone)).

Nobody may be watching when an event runs, so the agent answers and asks on the event's channel, such as the Telegram chat it came from, and treats an on-screen question from a tool as declined.

## The answer

The agent's answer is in the thread's session: open it with `agentx chat --thread-id <thread>`. A failed Pi run is tried again, up to three times.

Only one process runs a thread at a time: `agentx chat` stops with a message on a thread that is open elsewhere. A one-shot run (`agentx chat -p "..."`) answers its own prompt and leaves the events alone.

An event cannot run until the agent has a model and a login ([quick start](quick_start.md)). Until then it fails within seconds, and `agentx run` prints why. Deliver it again after you log in.
