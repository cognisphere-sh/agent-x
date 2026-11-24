# Workflows

A workflow handles an event with a fixed script instead of the model, such as filing an invoice email. Each workflow has a thread, `workflow.<name>`. The [router](../events/README.md#routing) sends events there, and so do the agent's [schedules](../../coordinator-runtime/services/scheduler/README.md) and [webhooks](../../coordinator-runtime/services/webhooks/README.md); the agent can with `agentx event send --thread-id workflow.<name>`, and a person with `agentx event deliver`. The `WorkflowRunner` (`src/agent-runtime/workflows/workflow-runner.ts`), one of the loops of [`agentx run`](../supervisor/README.md), runs them. Pi never runs a workflow's thread, and `agentx chat` refuses one.

## The list of workflows

`workflows.ts` reads `.pi/knowledge/workflows/workflows.json`, in the agent's [knowledge](../agent/README.md#knowledge), each time it needs it, so an edit applies at once ([D52](#d52)). The agent and its developer both edit it, and keep the scripts in the same folder. A new agent has it, empty.

```json
{
	"file-invoice": {
		"description": "Files an invoice email. For events from the billing mailbox.",
		"script": "file-invoice.ts",
		"timeoutSeconds": 600,
		"babysitterThread": "billing"
	}
}
```

| Key | Required | Meaning |
|---|---|---|
| `description` | yes | What it does and which events it is for. The router sees it. |
| `script` | yes | The module, from `.pi/knowledge/workflows/`. |
| `timeoutSeconds` | no | Default 600. |
| `babysitterThread` | no | The agent's thread that looks after the workflow: it hears of failed runs and refused sends, and gets the answers to the workflow's sends. Default `main`. |

Names use letters, digits and dashes. A broken entry is skipped and reported on `agentx run`'s error output.

## The contract

The script, a `.ts` file ([D74](../functions/README.md#d74)), has a default export that takes the event and a context. Its types come with the `@cognisphere-sh/agentx` package (`src/agent-runtime/functions/contracts.ts`):

```ts
import type { Workflow } from "@cognisphere-sh/agentx";

const run: Workflow = async (event, ctx) => {
	const { invoice } = JSON.parse(event.content); // the content and event.metadata are the workflow's input
	await ctx.send(`Filed invoice ${invoice}.`, { threadId: "main" });
};

export default run;
```

- `event` is `{ id, content, metadata, createdAt }`. Its content and metadata are the workflow's parameters: what a sender gives with `--meta` or `metadata`, or a schedule in its `metadata`, is in `event.metadata`, with facts such as `source`. Its files are in its inbox folder, and the content's last line names them.
- `ctx.send(content, { threadId, agent, key, metadata, files })` sends an event through `sendEvent`, into the agent's outbox ([Events](../events/README.md#sending-and-delivering)), with `source: workflow.<name>`. `files` are paths from the agent directory. It goes out from the babysitter thread, as the workflow: a refusal or an answer then reaches the babysitter thread, not the workflow's own thread, which would run it.
- `ctx.composio(tool, args)` runs one Composio tool as the agent, with its accounts and policy, and resolves to the tool's data; it throws when the tool does not complete ([functions](../functions/README.md#composio-in-a-workflow)).
- Returning means the run worked; throwing means it failed.
- It runs in a child process with the agent's environment ([functions](../functions/README.md)).

## A run

Once a second, the runner takes a workflow thread with work, holds its lease, and runs its oldest queued event.

- The lease keeps a workflow to one event at a time.
- Up to 4 runs go at once, apart from the Pi runner's threads.
- What the script prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`.
- After `timeoutSeconds`, its process group is killed.
- The first stop signal lets running workflows finish; the second kills them.

The event then becomes `done`, or `failed` with the reason: the error it threw, `timeout`, `stopped`, `exit` (the process ended without an answer), or `workflow not found`. An event left in flight by an `agentx run` that died fails as cut off when the next one takes the thread. A run gets one attempt ([D53](#d53)).

## Failure reports

When a run fails, the runner sends an event to the babysitter thread, from that thread and as the workflow, through the agent's outbox. `agentx serve` delivers it.

- It says which workflow failed on which event, why, and where the log is. A run that was cut off may still have been running.
- Its key is `failed:<event id>`, so a report is sent once.

The agent reads the log and the script, fixes the script, and sends the work again. A success is not reported.

## Known limits

- Nothing stops loops: a workflow that sends to its own thread, or two that send to each other, run until a person stops them.
- An `agentx run` that dies holds its workflow threads for up to 2 minutes, until the lease runs out.
- A workflow has the agent's rights. Until sandboxes, it can touch other agents' files.
- Workflows and Pi share the agent's files with no lock.

## Decisions

<a id="d52"></a>
### D52. Workflows are listed in one `workflows.json`; each is a function on its own thread

- **Decision.** A workflow is an entry in `.pi/knowledge/workflows/workflows.json`, with a description and a script whose default export takes the event. Its events are on the thread `workflow.<name>`, which Pi never runs.
- **Why.** One file lists what the router can choose from, easy to review and for the agent and its developer to edit ([D35](../agent/README.md#d35)). A thread per workflow reuses the queue's lease to run one event at a time.
- **Rejected.** A folder per workflow with its own `workflow.json`; a SQLite file, which nobody can review in git; scripts in any language reading stdin, which every workflow would have to parse.

<a id="d53"></a>
### D53. A run gets one attempt, and every failure is reported to the babysitter thread

- **Decision.** A failed run is never started again by itself. The runner sends an event to the workflow's babysitter thread with the reason and the log's path, keyed `failed:<event id>`.
- **Why.** A workflow may fail after it sent an email or paid an invoice, so only the agent or a person can tell whether running it again is safe. Reporting in agentx, not in each script, means a careless script still tells the agent.
- **Rejected.** A few retries, which suit only scripts that are safe to run twice. Reports of successes, which would wake the agent for every event a workflow exists to handle without it.
