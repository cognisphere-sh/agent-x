# Workflows

A workflow handles an event with a script instead of you: the same steps every time, without a model. An event goes to a workflow when its thread is `workflow.<name>`: from a router, a schedule, or `agentx event send --thread-id workflow.<name> '<input>'`.

Workflows are listed by name in `.pi/workflows.json`, your developer's (**read-only**), and in `storage/knowledge/workflows.json`, yours:

```json
{ "file-invoice": { "description": "Adds an invoice email's total to storage/workspace/invoices.csv.", "script": "workflows/file-invoice.mjs" } }
```

`script` is a path from the folder of that workflows.json; keep scripts in the `workflows/` folder next to it. Optional: `timeoutSeconds` (600 unless given), and `babysitterThread`, your thread that looks after the workflow (`main` unless given). The script exports one function, which runs in your agent directory; the event's content and metadata are its input, `event.content` and `event.metadata`:

```js
import { appendFileSync } from "node:fs";

/** @type {import("agent-x").Workflow} */
export default async function run(event, ctx) {
	const total = event.content.match(/Total: (\S+)/)?.[1];
	if (total === undefined) throw new Error("The invoice has no total.");
	appendFileSync("storage/workspace/invoices.csv", `${event.id},${total}\n`);
	await ctx.send(`Filed invoice ${event.id}: ${total}.`, { threadId: "main" }); // optional; options: threadId, agent, key, metadata, files
}
```

Returning means it worked; throwing means it failed. What it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`. Its events go out from its babysitter thread, so answers and refusals come there.
