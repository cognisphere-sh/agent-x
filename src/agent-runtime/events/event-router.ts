// EventRouter: one of the three loops of `agentx run`. It gives each event without a thread its thread, by calling the agent's router,
// storage/knowledge/event_router.mjs, in a child process of its own for each event. When the router fails, the event goes to `main`
// with `agentX-RouterError: <why>` in its metadata, so no event is stuck and the agent learns that its router broke; what the router printed is kept in a log.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Call, callFunction, type Outcome } from "../functions/function-call.js";
import { type Event, isThreadId, Queue, withoutBlockTag, workflowName } from "./queue.js";
import { loadWorkflows } from "../workflows/workflows.js";

// How often the queue is checked for events without a thread.
const pollMs = 1000;
// How much of what the router printed is kept when it fails: the end.
const keptOutput = 2048;

// The agent's router file.
const routerFile = (agentRoot: string) => join(agentRoot, "storage", "knowledge", "event_router.mjs");

// Where what the router printed for an event it failed on is kept, from the agent directory.
const routerLog = (eventId: string) => join("storage", "workspace", "router-logs", `${eventId}.log`);

// Written when the agent has no router: every event goes to `main`.
const starterRouter = `// The agent's event router. \`agentx run\` calls it for every event that names no thread, each time in a new process, so an edit applies to the next event.
//
// It gets:
//   event: { id, content, metadata, createdAt }. The content is markdown; files it names, under storage/attachments/, hold the rest.
//   ctx:   { workflows: [{ name, description }] }, the agent's workflows.
// It returns { thread: "<id>" }: a thread of the agent, such as "main", or "workflow.<name>" to run that workflow with the event.
// If it throws, takes longer than agentx.runner.routerSeconds (60 s unless set), or returns anything else, the event goes to "main",
// with "agentX-RouterError" in its metadata. It may read files, import the project's packages and ask a model.

/** @type {import("agent-x").Router} */
export default async function route(event, ctx) {
	return { thread: "main" };
}
`;

/** Routes the events of the agent in `agentRoot` without a thread, one at a time, each with up to `routerMs` of router. */
export class EventRouter {
	private readonly queue: Queue;
	private stopping = false;
	private call: Call | undefined;
	// When the loop last looked at the queue.
	private roundAt = Date.now();

	constructor(
		private readonly agentRoot: string,
		private readonly routerMs: number,
	) {
		this.queue = new Queue(agentRoot);
	}

	/** Routes events until `stop` is called. A router call in progress ends first. */
	async run(): Promise<void> {
		while (!this.stopping) {
			this.roundAt = Date.now();
			const event = this.queue.nextUnrouted();
			if (event === undefined) await sleep(pollMs);
			else await this.routeOne(event);
		}
		this.queue.close();
	}

	/** Routes no more events; with `force`, ends the router call in progress too, and its event waits for the next start. */
	stop(force = false): void {
		this.stopping = true;
		if (force) this.call?.stop();
	}

	/** When the loop last looked at the queue; now while it waits for a router call, which has a time limit of its own. */
	lastRound(): number {
		return this.call === undefined ? this.roundAt : Date.now();
	}

	private async routeOne(event: Event): Promise<void> {
		const file = routerFile(this.agentRoot);
		if (!existsSync(file)) {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, starterRouter);
		}
		const workflows = loadWorkflows(this.agentRoot);
		let output = "";
		this.call = callFunction(
			this.agentRoot,
			file,
			event,
			{ kind: "router", workflows: [...workflows.values()].map(({ name, description }) => ({ name, description })) },
			this.routerMs,
			(chunk) => (output = (output + chunk).slice(-keptOutput)),
		);
		const outcome = await this.call.done;
		this.call = undefined;
		if ("kind" in outcome && outcome.kind === "stopped") return;

		const answer = checked(outcome, workflows);
		if ("thread" in answer) {
			this.queue.route(event.id, answer.thread, event.metadata);
			console.log(`router: ${event.id} goes to ${answer.thread}`);
			return;
		}
		console.error(`router: ${event.id} goes to main, because the router failed: ${answer.why}`);
		let why = answer.why;
		if (output !== "") {
			const log = join(this.agentRoot, routerLog(event.id));
			mkdirSync(dirname(log), { recursive: true });
			writeFileSync(log, output);
			why += ` What it printed: ${routerLog(event.id)}`;
		}
		// One line, which the model sees with the event; a failure must not keep the event from being delivered.
		this.queue.route(event.id, "main", { ...event.metadata, "agentX-RouterError": withoutBlockTag(why.replace(/\s+/g, " ")) });
	}
}

// The thread the router answered, or why its answer cannot be used, starting with what kind of failure it was.
function checked(outcome: Outcome, workflows: Map<string, unknown>): { thread: string } | { why: string } {
	// "timeout: ..." and "exit: ..." say their kind already.
	if ("error" in outcome) return { why: outcome.kind === "threw" ? `failed: ${outcome.error}` : outcome.error };
	const thread = (outcome.result as { thread?: unknown } | null)?.thread;
	if (!isThreadId(thread)) return { why: `bad answer: it returned ${JSON.stringify(outcome.result)}, not { thread: "<thread id>" }.` };
	const workflow = workflowName(thread);
	if (workflow !== undefined && !workflows.has(workflow)) return { why: `unknown workflow: it named ${thread}, and the agent has no such workflow.` };
	return { thread };
}
