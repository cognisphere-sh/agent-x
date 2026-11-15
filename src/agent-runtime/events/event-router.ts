// EventRouter: one of the three loops of `agentx run`, and the only one that adds events to the queue. It takes the agent's inbox oldest first:
// an event without a thread gets the thread its routers pick, each called in a child process of its own for each event: the agent's own,
// storage/knowledge/event_router.mjs, then its developer's, .pi/event_router.mjs, each when it exists, until one picks a thread; else `main`.
// An event that names a thread keeps it. A router that fails counts as one that picked none, and the event gets `agentX-RouterError: <why>`,
// so no event is stuck and the agent learns that a router broke; what the router printed is kept in a log.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Event } from "../functions/contracts.js";
import { type Call, callFunction, type Outcome } from "../functions/function-call.js";
import { done, inbox, type Mail, reject, waiting } from "./mailbox.js";
import { checkEvent, isThreadId, Queue, withoutBlockTag, workflowName } from "./queue.js";
import { storageOf } from "../storage.js";
import { loadWorkflows, type WorkflowDefinition } from "../workflows/workflows.js";

// How often the inbox is checked when it is empty.
const pollMs = 1000;
// How much of what the router printed is kept when it fails: the end.
const keptOutput = 2048;

// The routers, asked in this order until one picks a thread: the agent's own, then its developer's. Either may be missing.
const routers = [
	{ owner: "agent", file: join("storage", "knowledge", "event_router.mjs") },
	{ owner: "developer", file: join(".pi", "event_router.mjs") },
];

// Where what a router printed for an event it failed on is kept, from the agent directory.
const routerLog = (eventId: string, owner: string) => join("storage", "workspace", "router-logs", `${eventId}.${owner}.log`);

/** Takes the inbox of the agent in `agentRoot` into its queue, oldest first, with up to `routerMs` for each router call of an event without a thread. */
export class EventRouter {
	private readonly queue: Queue;
	private readonly inbox: string;
	private stopping = false;
	private call: Call | undefined;
	// When the loop last looked at the inbox.
	private roundAt = Date.now();

	constructor(
		private readonly agentRoot: string,
		private readonly routerMs: number,
	) {
		this.queue = new Queue(agentRoot);
		this.inbox = inbox(storageOf(agentRoot));
	}

	/** Takes events until `stop` is called. A router call in progress ends first. */
	async run(): Promise<void> {
		while (!this.stopping) {
			this.roundAt = Date.now();
			let took = false;
			for (const { marker, mail } of waiting(this.inbox, (marker, why) => this.setAside(marker, why))) {
				took = true;
				await this.takeOne(marker, mail);
				if (this.stopping) break;
				this.roundAt = Date.now();
			}
			if (!took) await sleep(pollMs);
		}
		this.queue.close();
	}

	/** Takes no more events; with `force`, ends the router call in progress too, and its event waits for the next start. */
	stop(force = false): void {
		this.stopping = true;
		if (force) this.call?.stop();
	}

	/** When the loop last looked at the inbox; now while it waits for a router call, which has a time limit of its own. */
	lastRound(): number {
		return this.call === undefined ? this.roundAt : Date.now();
	}

	// Adds the event of a marker to the queue, and ends its wait.
	private async takeOne(marker: string, mail: Mail): Promise<void> {
		try {
			checkEvent(mail.event);
		} catch (error) {
			reject(this.inbox, marker);
			return this.setAside(marker, (error as Error).message);
		}
		// Sent again with its key, it has the id of an event on the queue already, and adds nothing: no router is asked.
		if (this.queue.get(mail.id) !== undefined) return done(this.inbox, marker);
		let { threadId } = mail.event;
		let facts = mail.facts;
		if (threadId === undefined) {
			const routed = await this.thread({ id: mail.id, content: mail.event.content, metadata: { ...mail.event.metadata, ...mail.facts }, createdAt: mail.sentAt });
			// Stopped: the event waits in the inbox for the next start.
			if (routed === undefined) return;
			threadId = routed.thread;
			facts = { ...facts, ...routed.facts };
		}
		this.queue.enqueue({ ...mail.event, threadId }, facts, { id: mail.id, sentAt: mail.sentAt });
		done(this.inbox, marker);
	}

	// Says that an inbox event cannot be taken; its marker is in .rejected/ already.
	private setAside(marker: string, why: string): void {
		console.error(`router: inbox event ${marker} cannot be taken and is set aside in .rejected/: ${why}`);
	}

	// The thread for an event without one, with the facts it gets on the way; undefined when a call was stopped.
	private async thread(event: Event): Promise<{ thread: string; facts: Record<string, string> } | undefined> {
		const failures: string[] = [];
		let thread = "main";
		// Read for each event, so a router sees the workflows as they are.
		let workflows: Map<string, WorkflowDefinition> | undefined;
		for (const router of routers) {
			if (!existsSync(join(this.agentRoot, router.file))) continue;
			workflows ??= loadWorkflows(this.agentRoot);
			const answer = await this.ask(router, event, workflows);
			// Stopped: the event waits in the inbox for the next start.
			if (answer === undefined) return undefined;
			if ("why" in answer) failures.push(answer.why);
			else if (answer.thread !== undefined) {
				thread = answer.thread;
				break;
			}
		}
		console.log(`router: ${event.id} goes to ${thread}`);
		// One line, which the model sees with the event; a failure must not keep the event from being delivered.
		return { thread, facts: failures.length === 0 ? {} : { "agentX-RouterError": withoutBlockTag(failures.join(" ").replace(/\s+/g, " ")) } };
	}

	// What one router answered: a thread, none, or why it failed; undefined when the call was stopped.
	private async ask(router: (typeof routers)[number], event: Event, workflows: Map<string, WorkflowDefinition>): Promise<{ thread?: string } | { why: string } | undefined> {
		let output = "";
		this.call = callFunction(
			this.agentRoot,
			join(this.agentRoot, router.file),
			event,
			{ kind: "router", workflows: [...workflows.values()].map(({ name, description }) => ({ name, description })) },
			this.routerMs,
			(chunk) => (output = (output + chunk).slice(-keptOutput)),
		);
		const outcome = await this.call.done;
		this.call = undefined;
		if ("kind" in outcome && outcome.kind === "stopped") return undefined;

		const answer = checked(outcome, workflows);
		if (!("why" in answer)) return answer;
		let why = `${router.file}: ${answer.why}`;
		console.error(`router: ${event.id}: ${why}`);
		if (output !== "") {
			const log = routerLog(event.id, router.owner);
			mkdirSync(dirname(join(this.agentRoot, log)), { recursive: true });
			writeFileSync(join(this.agentRoot, log), output);
			why += ` What it printed: ${log}`;
		}
		return { why };
	}
}

// The thread the router answered, none, or why its answer cannot be used, starting with what kind of failure it was.
function checked(outcome: Outcome, workflows: Map<string, unknown>): { thread?: string } | { why: string } {
	// "timeout: ..." and "exit: ..." say their kind already.
	if ("error" in outcome) return { why: outcome.kind === "threw" ? `failed: ${outcome.error}` : outcome.error };
	// Nothing: this router leaves the event to the next.
	if (outcome.result === null) return {};
	const thread = (outcome.result as { thread?: unknown }).thread;
	if (typeof outcome.result !== "object" || !isThreadId(thread)) {
		return { why: `bad answer: it returned ${JSON.stringify(outcome.result)}, not { thread: "<thread id>" } or nothing.` };
	}
	const workflow = workflowName(thread);
	if (workflow !== undefined && !workflows.has(workflow)) return { why: `unknown workflow: it named ${thread}, and the agent has no such workflow.` };
	return { thread };
}
