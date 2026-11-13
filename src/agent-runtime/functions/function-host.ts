// The child process in which `agentx run` calls code the agent wrote (function-call.ts): it imports the module and calls its default export with the event.
// The job arrives and the outcome leaves over the IPC channel. When `agentx run` is gone, the channel closes and this process ends with it.

import { pathToFileURL } from "node:url";
import type { RouterContext, SendOptions, WorkflowContext } from "./contracts.js";
import type { Job, Outcome } from "./function-call.js";
import { sendEvent } from "../events/send-event.js";

// The agent directory: function-call.ts starts this process in it, and the code may change directory.
const agentRoot = process.cwd();

process.once("disconnect", () => process.exit(1));

process.once("message", async (job: Job) => {
	let outcome: Outcome;
	try {
		const module = await import(pathToFileURL(job.file).href);
		if (typeof module.default !== "function") throw new Error(`${job.file} has no default export function.`);
		const ctx: RouterContext | WorkflowContext =
			job.kind === "router"
				? { workflows: job.workflows }
				: {
						workflow: job.workflow,
						send: async (content: string, options: SendOptions = {}) =>
							// The run is an agentX- fact, so no sender can claim that a run sent its event.
							sendEvent(
								agentRoot,
								{ threadId: options.threadId, key: options.key, content, metadata: { ...options.metadata, source: `workflow.${job.workflow}` } },
								options.agent,
								{ "agentX-WorkflowRun": job.event.id },
							),
					};
		const result = await module.default(job.event, ctx);
		// Only the router's answer is used, and a workflow's may not survive the trip: the channel carries JSON.
		outcome = { result: job.kind === "router" ? (result ?? null) : null };
	} catch (error) {
		// The stack goes to the output, which the caller keeps.
		console.error(error);
		outcome = { error: error instanceof Error ? error.message : String(error), kind: "threw" };
	}
	process.send?.(outcome, () => process.exit(0));
});
