# Workflows

A workflow handles an event with a script instead of you: the same steps every time, without a model. An event goes to a workflow when its thread is `workflow.<name>`: from a router, a schedule, or `agentx event send --thread-id workflow.<name> '<input>'`.

Keep yourself for what needs judgement. A model is slower and costs more than a script, and can answer differently each time, so what a script can do the same way every time, such as filtering, computing, copying or reformatting data, or sending a message with a Composio tool, belongs in a workflow. When part of the work needs judgement, the workflow does the fixed steps and sends what needs judging, its result or the error it hit, to one of your threads with `ctx.send`; you judge it there. A workflow that throws is reported to its babysitter thread by itself (see "When something fails"); one that returns reports nothing unless it sends.

Workflows are listed by name in `.pi/workflows.json`, your developer's (**read-only**), and in `storage/knowledge/workflows.json`, yours. On a name in both, yours is used:

```json
{ "file-invoice": { "description": "Adds an invoice email's total to storage/workspace/invoices.csv.", "script": "workflows/file-invoice.ts" } }
```

`script` is a `.ts` file, by its path from the folder of that workflows.json; keep scripts in the `workflows/` folder next to it. Optional: `timeoutSeconds` (600 unless given), and `babysitterThread`, your thread that looks after the workflow (`main` unless given). The script exports one function, which runs in your agent directory; the event's content and metadata are its input, `event.content` and `event.metadata`:

```ts
import { appendFileSync } from "node:fs";
import type { Workflow } from "agent-x";

const run: Workflow = async (event, ctx) => {
	const total = event.content.match(/Total: (\S+)/)?.[1];
	if (total === undefined) throw new Error("The invoice has no total.");
	appendFileSync("storage/workspace/invoices.csv", `${event.id},${total}\n`);
	await ctx.send(`Filed invoice ${event.id}: ${total}.`, { threadId: "main" }); // optional; options: threadId, agent, key, metadata, files
};

export default run;
```

Returning means it worked; throwing means it failed. What it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`. Its events go out from its babysitter thread, so answers and refusals come there.

`ctx.composio(tool, arguments)` runs one Composio tool (see "External services") as you, with your connected accounts and the services you may use, and resolves to the tool's data: `await ctx.composio("TELEGRAM_SEND_MESSAGE", { chat_id, text })`. Find the tool's name and arguments first with `COMPOSIO_SEARCH_TOOLS` and `COMPOSIO_GET_TOOL_SCHEMAS`. It throws when the tool fails, and when it needs a person, such as an account to connect: connect accounts from a thread before a workflow needs them.
