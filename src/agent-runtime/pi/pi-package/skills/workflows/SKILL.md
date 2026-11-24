---
name: workflows
description: How to write a workflow, a script that handles events of one kind without you, the same way every time, and can run Composio tools. Use it before you write or change one, and when a workflow failed.
metadata:
  version: 3
---

# Workflows

A workflow handles an event with a script instead of you: the same steps every time, without a model. An event goes to a workflow when its thread is `workflow.<name>`: from your router, a schedule, a webhook, or `agentx event send --thread-id workflow.<name> '<input>'`.

Workflows are listed by name in `.pi/knowledge/workflows/workflows.json`. You and your developer own every entry alike: change one in place, whoever wrote it.

```json
{ "file-invoice": { "description": "Adds an invoice email's total to storage/workspace/invoices.csv.", "script": "file-invoice.ts" } }
```

`script` is a `.ts` file, by its path from `.pi/knowledge/workflows/`, where the scripts are kept. Optional: `timeoutSeconds` (600 unless given), and `babysitterThread`, your thread that looks after the workflow (`main` unless given). The script exports one function, which runs in your agent directory; the event's content and metadata are its input, `event.content` and `event.metadata`, and the files that came with it are in its folder, `storage/workspace/inbox/<event.id>/`:

```ts
import { appendFileSync } from "node:fs";
import type { Workflow } from "@cognisphere-sh/agentx";

const run: Workflow = async (event, ctx) => {
	const total = event.content.match(/Total: (\S+)/)?.[1];
	if (total === undefined) throw new Error("The invoice has no total.");
	appendFileSync("storage/workspace/invoices.csv", `${event.id},${total}\n`);
	await ctx.send(`Filed invoice ${event.id}: ${total}.`, { threadId: "main" }); // optional; options: threadId, agent, key, metadata, files
};

export default run;
```

Returning means it worked; throwing means it failed. A workflow that throws is reported to its babysitter thread by itself; one that returns reports nothing unless it sends. What it prints goes to `storage/workspace/workflow-logs/<workflow>/<event id>.log`. Its events go out from its babysitter thread, so answers and refusals come there. When part of the work needs judgement, the workflow does the fixed steps and sends what needs judging, its result or the error it hit, to one of your threads with `ctx.send`; you judge it there.

`ctx.composio(tool, arguments)` runs one Composio tool as you, with your connected accounts and the services you may use, and resolves to the tool's data: `await ctx.composio("TELEGRAM_SEND_MESSAGE", { chat_id, text })`. Find the tool's name and arguments first with `COMPOSIO_SEARCH_TOOLS` and `COMPOSIO_GET_TOOL_SCHEMAS`. It throws when the tool fails, and when it needs a person, such as an account to connect: connect accounts from a thread before a workflow needs them.

Scripts are TypeScript, which Node runs by stripping the types without checking them: no `enum`, `namespace` or constructor parameter properties, and a relative import names its `.ts` file. Any `.js` file you write is an ES module: use `import`, or name a CommonJS script `.cjs`. Each event runs the script in a new process, so an edit applies to the next event.
