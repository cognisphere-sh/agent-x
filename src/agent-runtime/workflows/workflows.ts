// The agent's workflows: listed in its developer's .pi/workflows.json and in its own storage/knowledge/workflows.json, read again each time they are needed,
// so an edit applies at once. On a name in both, the developer's wins.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isThreadId, nameRule } from "../events/queue.js";

/** One workflow, checked. */
export interface WorkflowDefinition {
	name: string;
	description: string;
	/** The script's absolute path. */
	script: string;
	timeoutSeconds: number;
	/** Who hears about a failed run. */
	failureReportTo: { agent: string; thread: string };
}

/** The directory of `name`, a fellow agent of the agent in `agentRoot`; undefined when the project has no such agent. */
export function fellowAgent(agentRoot: string, name: string): string | undefined {
	const dir = join(agentRoot, "..", name);
	return nameRule.test(name) && existsSync(join(dir, ".pi", "settings.json")) ? dir : undefined;
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
	for (const file of [join(agentRoot, ".pi", "workflows.json"), join(agentRoot, "storage", "knowledge", "workflows.json")]) {
		if (!existsSync(file)) continue;
		let entries: unknown;
		try {
			entries = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			warn(`${file}: ${(error as Error).message}. Its workflows are skipped.`);
			continue;
		}
		for (const [name, entry] of Object.entries(entries ?? {})) {
			const checked = check(agentRoot, file, name, entry);
			if (typeof checked === "string") warn(`${file}: workflow "${name}" is skipped: ${checked}`);
			else if (all.has(name)) warn(`${file}: workflow "${name}" is skipped: .pi/workflows.json has one of that name, which is used.`);
			else all.set(name, checked);
		}
	}
	return all;
}

// The entry as a workflow, or what is wrong with it.
function check(agentRoot: string, file: string, name: string, entry: unknown): WorkflowDefinition | string {
	if (!nameRule.test(name)) return "a name has only letters, digits and dashes.";
	const { description, script, timeoutSeconds = 600, failureReportTo = `${basename(agentRoot)}.main` } = (entry ?? {}) as Record<string, unknown>;
	if (typeof description !== "string" || description.trim() === "") return "it needs a description.";
	if (typeof script !== "string") return "it needs a script, a path from the folder of its workflows.json.";
	const path = resolve(dirname(file), script);
	if (!existsSync(path)) return `its script ${path} does not exist.`;
	if (typeof timeoutSeconds !== "number" || !(timeoutSeconds > 0)) return "timeoutSeconds must be a number of seconds above 0.";
	// `<agent>.<thread>`: agent names have no dot, so the first one ends the agent.
	const [agent, thread] = typeof failureReportTo === "string" ? failureReportTo.split(/\.(.*)/s) : [];
	if (!agent || !isThreadId(thread) || fellowAgent(agentRoot, agent) === undefined) {
		return `failureReportTo must be "<agent>.<thread>", with an agent of this project, such as "${basename(agentRoot)}.main".`;
	}
	return { name, description, script: path, timeoutSeconds, failureReportTo: { agent, thread } };
}
