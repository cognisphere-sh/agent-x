// Adds an event to an agent of the project. Every sender goes through here: `agentx event send`, workflows, and their failure reports.
// For now it writes straight into the receiving agent's queue file. The coordinator will add every event instead, and only this file changes.

import { basename } from "node:path";
import { type NewEvent, withQueue, workflowName } from "./queue.js";
import { fellowAgent, loadWorkflows } from "../workflows/workflows.js";

/** Adds `event` to the agent in `agentRoot`, or to its fellow agent `toAgent`, with the harness's `agentX-` facts, and returns the event's id. */
export function sendEvent(agentRoot: string, event: NewEvent, toAgent?: string, facts?: Record<string, string>): string {
	const target = toAgent === undefined ? agentRoot : agentDir(agentRoot, toAgent);
	const workflow = workflowName(event.threadId);
	if (workflow !== undefined && !loadWorkflows(target).has(workflow)) throw new Error(`Agent "${basename(target)}" has no workflow "${workflow}".`);
	return withQueue(target, (queue) => queue.enqueue(event, facts));
}

/** The directory of `name`, a fellow agent of the agent in `agentRoot`. Throws when the project has no such agent. */
export function agentDir(agentRoot: string, name: string): string {
	const dir = fellowAgent(agentRoot, name);
	if (dir === undefined) throw new Error(`This project has no agent "${name}".`);
	return dir;
}
