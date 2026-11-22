// The agent's workflows: listed in its developer's .pi/workflows.json and in its own storage/knowledge/workflows.json, read again each time they are needed,
// so an edit applies at once. On a name in both, the agent's wins, so the agent can replace a workflow of its developer's.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isThreadId, nameRule, workflowName } from "../events/queue.js";

/** One workflow, checked. */
export interface WorkflowDefinition {
	name: string;
	description: string;
	/** The script's absolute path. */
	script: string;
	timeoutSeconds: number;
	/** The thread of the agent that looks after the workflow: it hears of a failed run and of a send that cannot be delivered, and gets the answers to its sends. */
	babysitterThread: string;
}

// A problem is said once per process, not for every event.
const said = new Set<string>();
const warn = (text: string) => {
	if (said.has(text)) return;
	said.add(text);
	console.error(text);
};

/** The workflows of the agent in `agentRoot`, by name. Broken entries are left out, and said once on the error output. */
export function loadWorkflows(agentRoot: string): Map<string, WorkflowDefinition> {
	const all = new Map<string, WorkflowDefinition>();
	for (const file of [join(agentRoot, "storage", "knowledge", "workflows.json"), join(agentRoot, ".pi", "workflows.json")]) {
		if (!existsSync(file)) continue;
		let entries: unknown;
		try {
			entries = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			warn(`${file}: ${(error as Error).message}. Its workflows are skipped.`);
			continue;
		}
		for (const [name, entry] of Object.entries(entries ?? {})) {
			const checked = check(file, name, entry);
			if (typeof checked === "string") warn(`${file}: workflow "${name}" is skipped: ${checked}`);
			else if (all.has(name)) warn(`${file}: workflow "${name}" is skipped: storage/knowledge/workflows.json has one of that name, which is used.`);
			else all.set(name, checked);
		}
	}
	return all;
}

/** The workflow `threadId` names when the agent in `agentRoot` has no such workflow; undefined for any other thread. */
export function missingWorkflow(agentRoot: string, threadId: string | undefined): string | undefined {
	const workflow = workflowName(threadId);
	return workflow !== undefined && !loadWorkflows(agentRoot).has(workflow) ? workflow : undefined;
}

/** The babysitter thread of the workflow `name`, or `main` when there is no such workflow, as when it was removed. */
export function babysitterThread(agentRoot: string, name: string): string {
	return loadWorkflows(agentRoot).get(name)?.babysitterThread ?? "main";
}

// The entry as a workflow, or what is wrong with it.
function check(file: string, name: string, entry: unknown): WorkflowDefinition | string {
	if (!nameRule.test(name)) return "a name has only letters, digits and dashes.";
	const { description, script, timeoutSeconds = 600, babysitterThread = "main" } = (entry ?? {}) as Record<string, unknown>;
	if (typeof description !== "string" || description.trim() === "") return "it needs a description.";
	if (typeof script !== "string" || !script.endsWith(".ts")) return "it needs a script, a .ts file, by its path from the folder of its workflows.json.";
	const path = resolve(dirname(file), script);
	if (!existsSync(path)) return `its script ${path} does not exist.`;
	if (typeof timeoutSeconds !== "number" || !(timeoutSeconds > 0)) return "timeoutSeconds must be a number of seconds above 0.";
	if (!isThreadId(babysitterThread)) return 'babysitterThread must be a thread of this agent, such as "main".';
	return { name, description, script: path, timeoutSeconds, babysitterThread };
}
