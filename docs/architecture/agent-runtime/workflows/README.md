# Workflows

A workflow handles an event with a fixed script instead of the model, such as filing an invoice email. Each workflow has a thread, `workflow.<name>`: the agent's [router](../events/README.md) sends events to it, and anyone can send one there with `agentx event send --thread-id workflow.<name>`. The `WorkflowRunner` (`src/agent-runtime/events/workflow-runner.ts`), one of the three loops of `agentx run` ([agent supervisor](../supervisor/README.md)), runs them. Pi never runs a workflow's thread, and `agentx chat` refuses one.

## The list of workflows

`src/agent-runtime/events/workflows.ts` reads two files, again each time it needs them, so an edit applies at once ([D52](#d52)):

- `.pi/workflows.json`: the developer's, checked in, read-only to the agent.
- `storage/knowledge/workflows.json`: the agent's own ([D35](../agent/README.md#d35)).

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "workflows/file-invoice.mjs",
		"timeoutSeconds": 600,
		"failureReportTo": "billing.main"
	}
}
```

| Key | Required | Meaning |
|---|---|---|
| `description` | yes | What it does and which events it is for. The router sees it. |
| `script` | yes | The workflow's module, from the folder of the `workflows.json`. |
| `timeoutSeconds` | no | Default 600. |
| `failureReportTo` | no | Who hears about a failed run: `<agent>.<thread>`, with an agent of the project. Default `<this agent>.main`. |

Names have letters, digits and dashes, as agent names do. On a name in both files the developer's is used. A broken entry is skipped: a bad name, a missing field, a script that is not there, a bad `failureReportTo`. Both are said once on `agentx run`'s error output.

## The contract

The script's default export takes the event and a context. Its types come with the `agent-x` package (`src/agent-runtime/events/contracts.ts`):

```js
/** @type {import("agent-x").Workflow} */
export default async function run(event, ctx) {
	const { invoice } = JSON.parse(event.content); // the content is the workflow's parameters
	await ctx.send(`Filed invoice ${invoice}.`, { threadId: "main" });
}
```

- `event` is `{ id, content, metadata, createdAt }`. Its content is the workflow's parameters, such as JSON from `agentx event send --thread-id workflow.file-invoice '{"invoice": "4411"}'`, and its attachments are files the content names.
- `ctx.workflow` is the workflow's name. `ctx.send(content, { threadId, agent, key, metadata })` sends an event through `sendEvent` ([Event queue](../events/README.md#sending)), with `source: workflow.<name>` and `agentX-WorkflowRun: <this event's id>` added to its metadata, and resolves to its id. `agentX-WorkflowRun` is the harness's fact, so no sender can claim that a run sent its event.
- Returning means the run worked; throwing means it failed.
- It runs as the router does ([Event router](../functions/README.md)): a child process with the agent's environment, which can import the project's packages.

## A run

Once a second the loop takes a workflow thread with work, holds its lease, and takes its oldest queued event (`claimOldest`):

- The lease keeps a workflow to one event at a time, so its runs do not race each other. The loop renews it while the run lasts.
- Up to 4 runs go at once, apart from the Pi runner's `maxThreads`.
- Everything the script prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`, up to 1 MB.
- After `timeoutSeconds`, its process group is killed.
- The first stop signal lets running workflows finish; the second kills them.

When it ends, `finish` marks the event `done`, or `failed` with the reason in `error`: the message of the error it threw, `timeout: …`, `stopped: …`, `exit: …` (the process ended without an answer), or `workflow not found: …` (removed after the event was routed). An event left in flight by an `agentx run` that died fails when the next one takes the thread over, with `The process running this thread stopped.`. A run has one attempt ([D53](#d53)).

## Failure reports

When a run fails, the runner sends an event to the workflow's `failureReportTo` thread, through `sendEvent`:

- It says which workflow of which agent failed on which event, why, and where the log is, with the `agentx event show` command that shows the run.
- After a crash, it says the run was cut off and the workflow may still have been running.
- Its metadata is `source: workflow.<name>`, and its key `failed:<event id>`, so a report is never sent twice.

The agent reads the log and the script, fixes it, or tells a person when the workflow is its developer's, and sends the work again. A success is not reported; a workflow that wants to say something uses `ctx.send`.

`agentx event show <id>` on a workflow's event shows its run: the log, the events it sent to this agent (those with `agentX-WorkflowRun: <id>`), and its failure report with that report's status and session entry, which shows what the agent did about it ([CLI](../../cli/README.md#commands)).

## Known limits

- Nothing stops loops: a workflow that sends to its own thread, or two that send to each other, keep running until a person stops them.
- A failure report on another agent names a log in the failing agent's `storage/`, which the other agent reads only while they share a disk.
- Events a run sends to another agent show in that agent's events, not in the run's audit.
- An `agentx run` that dies holds its workflow threads for up to two minutes, until the lease runs out; then their events fail as cut off.
- A workflow has the agent's rights. Until sandboxes, it can also touch other agents' files.
- Workflows and Pi share the agent's files with no lock.

## Decisions

<a id="d52"></a>
### D52. Workflows are listed in two `workflows.json` files; each is a function on its own thread

- **Decision.** A workflow is an entry in `.pi/workflows.json` or `storage/knowledge/workflows.json`, with a description and a script whose default export takes the event. On a name in both, the developer's wins. Its events are on the thread `workflow.<name>`, which Pi never runs.
- **Why.** One file lists what the router can choose from, readable in a review and easy for the agent to edit, and the script holds only code. A thread per workflow reuses the queue's lease to run one event at a time, and its id says who takes the event.
- **Rejected.** A folder per workflow with its own `workflow.json`; a SQLite file, which nobody can review in git; scripts in any language reading stdin, which every workflow would have to parse.

<a id="d53"></a>
### D53. A run gets one attempt, and agentx reports every failure

- **Decision.** A failed run is never started again by itself. The runner sends an event to the workflow's `failureReportTo` thread with the reason and the log's path, keyed `failed:<event id>`.
- **Why.** A workflow may fail after it sent an email or paid an invoice, so only the agent or a person can tell whether running it again is safe. Reporting in agentx, not in each script, means a careless script still tells the agent when it fails.
- **Rejected.** A few retries, which suit only scripts that are safe to run twice. Reports of successes, which would wake the agent for every event a workflow exists to handle without it.
