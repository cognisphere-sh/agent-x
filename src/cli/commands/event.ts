// `agentx event send|list|show`: sends an event to an agent, and shows what became of an agent's events.

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { type Event, type Queue, withQueue, workflowName } from "../../agent-runtime/events/queue.js";
import { agentDir, sendEvent } from "../../agent-runtime/events/send-event.js";
import { runLog } from "../../agent-runtime/workflows/workflow-runner.js";
import { loadWorkflows } from "../../agent-runtime/workflows/workflows.js";

const usage = `usage:
  agentx event send [--agent <name>] [--thread-id <id>] [--key <key>] [--do-not-steer] [--silent] [--meta <name>=<value> ...] [--] <content>
    --agent <name>         another agent of the project (default: this one)
    --thread-id <id>       the thread the event belongs to, or workflow.<name> (default: none, the agent's router picks it)
    --key <key>            sending again with the same key adds nothing
    --do-not-steer         wait for the thread's next run instead of joining the one in progress
    --silent               do not start a run for this event
    --meta <name>=<value>  a fact for the agent about the event, such as --meta from=ops; repeat it for more
  agentx event list [--agent <name>] [--limit <n>]
                           the newest events (default: 20), and where each went
  agentx event show [--agent <name>] <id>
                           one event: its content, its route, what became of it, and a workflow's run`;

/** Runs `agentx event <action> ...` in the agent directory `agentRoot`. */
export function event(agentRoot: string, args: string[]): void {
	const [action, ...rest] = args;
	if (action === "send") send(agentRoot, rest);
	else if (action === "list") list(agentRoot, rest);
	else if (action === "show") show(agentRoot, rest);
	else throw new Error(usage);
}

// Strict: an unknown or misspelt option is an error. What follows `--` is content, also when it starts with dashes.
function send(agentRoot: string, args: string[]): void {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			agent: { type: "string" },
			"thread-id": { type: "string" },
			key: { type: "string" },
			"do-not-steer": { type: "boolean", default: false },
			silent: { type: "boolean", default: false },
			meta: { type: "string", multiple: true, default: [] },
		},
	});
	// Where the event comes from, unless the sender says.
	const metadata: Record<string, string> = { source: "cli" };
	for (const entry of values.meta) {
		const [name, value] = entry.split(/=(.*)/s);
		if (!name || value === undefined) throw new Error(`--meta ${entry} needs a name and a value, such as --meta from=ops.\n${usage}`);
		metadata[name] = value;
	}
	if (positionals.length === 0) throw new Error(`Nothing to send.\n${usage}`);
	const threadId = values["thread-id"];
	const id = sendEvent(agentRoot, { threadId, key: values.key, content: positionals.join(" "), metadata, doNotSteer: values["do-not-steer"], isSilent: values.silent }, values.agent);
	const facts = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
	const where = threadId === undefined ? "for the router" : `on thread "${threadId}"`;
	console.log(`Queued event ${id} ${where}${values.agent === undefined ? "" : ` of agent "${values.agent}"`} with ${facts.join(", ")}.`);
}

function list(agentRoot: string, args: string[]): void {
	const { values } = parseArgs({ args, options: { agent: { type: "string" }, limit: { type: "string", default: "20" } } });
	const limit = Number(values.limit);
	if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit takes a whole number above 0.\n${usage}`);
	withQueue(target(agentRoot, values.agent), (queue) => {
		for (const found of queue.list(limit)) console.log([time(found.createdAt), found.id, found.status.padEnd(9), found.threadId ?? "(router)", found.metadata.source ?? ""].join("  "));
	});
}

function show(agentRoot: string, args: string[]): void {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { agent: { type: "string" } } });
	const [id] = positionals;
	if (id === undefined) throw new Error(`Which event? Give its id.\n${usage}`);
	const root = target(agentRoot, values.agent);
	withQueue(root, (queue) => {
		const found = queue.get(id);
		if (found === undefined) throw new Error(`Agent "${basename(root)}" has no event ${id}.`);
		const lines = [
			`Event ${found.id} of agent "${basename(root)}"`,
			`Created: ${time(found.createdAt)}, last change: ${time(found.updatedAt)}`,
			`Thread: ${found.threadId ?? "none yet: it waits for the router"}${found.metadata["agentX-RouterError"] === undefined ? "" : ", because the router failed"}`,
			`Status: ${found.status}, attempts: ${found.attempts}`,
			...(found.key === null ? [] : [`Key: ${found.key}`]),
			...(found.entryId === null ? [] : [`Session entry: ${found.entryId}, in storage/sessions/${found.threadId}/`]),
			...(found.error === null ? [] : ["Error:", indent(found.error)]),
			"Metadata:",
			...Object.entries(found.metadata).map(([name, value]) => `  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
			"Content:",
			indent(found.content),
			...(workflowName(found.threadId) === undefined ? [] : workflowRun(root, queue, found)),
		];
		console.log(lines.join("\n"));
	});
}

// What a workflow's run of the event left: its log, the events it sent, and its failure report with what became of it.
function workflowRun(agentRoot: string, queue: Queue, found: Event): string[] {
	const name = workflowName(found.threadId) ?? "";
	const log = runLog(name, found.id);
	const sent = queue.withMetadata("agentX-WorkflowRun", found.id);
	// The report is on the agent the workflow reports to, this one unless it names another.
	const key = `failed:${found.id}`;
	const agent = loadWorkflows(agentRoot).get(name)?.failureReportTo.agent ?? basename(agentRoot);
	const reported = agent === basename(agentRoot) ? queue.byKey(key) : withQueue(agentDir(agentRoot, agent), (other) => other.byKey(key));
	const report = reported && `${reported.id} on ${agent}.${reported.threadId}, ${reported.status}${reported.entryId === null ? "" : `, session entry ${reported.entryId}`}`;
	return [
		"Workflow run:",
		`  Log: ${existsSync(join(agentRoot, log)) ? log : "none"}`,
		`  Events it sent: ${sent.length === 0 ? "none" : sent.map((child) => `${child.id} to ${child.threadId ?? "the router"} (${child.status})`).join(", ")}`,
		`  Failure report: ${report ?? "none"}`,
	];
}

// This agent's directory, or that of the fellow agent `--agent` names.
const target = (agentRoot: string, agent: string | undefined) => (agent === undefined ? agentRoot : agentDir(agentRoot, agent));

// "2026-11-14 09:30:12", in the machine's time zone.
const time = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace("T", " ");

const indent = (text: string) => text.replace(/^/gm, "  ");
