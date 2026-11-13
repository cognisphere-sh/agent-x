// WorkflowRunner: one of the three loops of `agentx run`. It runs the events of workflow threads, `workflow.<name>`: each in a child process
// of its own, one event at a time per workflow, a few workflows at once. A run is never retried, because it may have done part of its work.
// When one fails, the agent hears of it: an event on the workflow's failureReportTo thread says why and where the log is.

import { createWriteStream, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Call, callFunction } from "../functions/function-call.js";
import { type Event, Queue, withoutBlockTag, workflowName, workflowPrefix } from "../events/queue.js";
import { sendEvent } from "../events/send-event.js";
import { loadWorkflows } from "./workflows.js";

// How often the queue is checked for workflow events.
const pollMs = 1000;
// Runs at once, apart from the Pi runner's threads.
const maxRuns = 4;
// The size at which a run's log stops growing.
const maxLog = 1024 * 1024;

/** Where the log of a workflow's run of an event is, from the agent directory. */
export const runLog = (workflow: string, eventId: string) => join("storage", "workspace", "workflow-logs", workflow, `${eventId}.log`);

/** Runs the workflow events of the agent in `agentRoot`. */
export class WorkflowRunner {
	private readonly queue: Queue;
	private readonly agent: string;
	// The run in progress on each workflow thread.
	private readonly runs = new Map<string, Call>();
	private stopping = false;
	private roundAt = Date.now();

	constructor(private readonly agentRoot: string) {
		this.queue = new Queue(agentRoot);
		this.agent = basename(agentRoot);
	}

	/** Runs workflows until `stop` is called and the running ones have ended. */
	async run(): Promise<void> {
		while (!this.stopping || this.runs.size > 0) {
			this.roundAt = Date.now();
			for (const thread of this.runs.keys()) this.queue.renew(thread);
			// A thread looked at in this round and not started, such as one whose only event was cut off, is not offered again in it.
			const looked: string[] = [];
			while (!this.stopping && this.runs.size < maxRuns) {
				const thread = this.queue.nextThread([...this.runs.keys(), ...looked], true);
				if (thread === undefined) break;
				looked.push(thread);
				this.start(thread);
			}
			await sleep(pollMs);
		}
		this.queue.close();
	}

	/** Starts no more runs; `run` returns when the running ones have ended. With `force`, ends them now, as failed. */
	stop(force = false): void {
		this.stopping = true;
		if (force) for (const call of this.runs.values()) call.stop();
	}

	/** When the loop last looked at the queue. Runs go on apart from it. */
	lastRound(): number {
		return this.roundAt;
	}

	private start(thread: string): void {
		const name = workflowName(thread) ?? thread;
		// Events left in flight by a process that stopped: taking the thread over fails them, and the agent hears of each.
		const cutOff = this.queue.inFlightIds(thread);
		// A run is never repeated, so events left in flight fail instead of going back to the queue.
		if (!this.queue.acquire(thread, false)) return;
		for (const id of cutOff) this.report(name, id, "cut off: agentx run stopped during the run, so the workflow may still have been running");
		const event = this.queue.claimOldest(thread);
		const workflow = loadWorkflows(this.agentRoot).get(name);
		if (event === undefined || workflow === undefined) {
			if (event !== undefined) this.end(thread, name, event, "workflow not found: it was removed after the event was routed");
			this.queue.release(thread);
			return;
		}

		const logFile = join(this.agentRoot, runLog(name, event.id));
		mkdirSync(dirname(logFile), { recursive: true });
		const log = createWriteStream(logFile, { flags: "a" });
		let written = 0;
		const call = callFunction(
			this.agentRoot,
			workflow.script,
			event,
			{ kind: "workflow", workflow: name },
			workflow.timeoutSeconds * 1000,
			(chunk) => {
				if (written < maxLog) log.write(written + chunk.length > maxLog ? `${chunk.subarray(0, maxLog - written)}\n[agentx: the log stops here, at 1 MB]\n` : chunk);
				written += chunk.length;
			},
		);
		this.runs.set(thread, call);
		console.log(`${thread}: running ${event.id}`);
		call.done
			.then((outcome) => {
				log.end();
				this.runs.delete(thread);
				this.end(thread, name, event, "error" in outcome ? outcome.error : undefined);
				this.queue.release(thread);
			})
			// Such as a queue file that stayed locked. The event stays in flight, and fails as cut off when the lease is taken over.
			.catch((error) => console.error(`${thread}: the end of the run of ${event.id} could not be recorded: ${(error as Error).message}`));
	}

	// Records how the run ended, and reports a failure.
	private end(thread: string, name: string, event: Event, error?: string): void {
		this.queue.finish(thread, event.id, error);
		console.log(`${thread}: ${event.id} ${error === undefined ? "done" : `failed: ${error}`}`);
		if (error !== undefined) this.report(name, event.id, error);
	}

	// Tells the workflow's failureReportTo thread, or this agent's main when the workflow is gone.
	private report(name: string, eventId: string, why: string): void {
		const to = loadWorkflows(this.agentRoot).get(name)?.failureReportTo ?? { agent: this.agent, thread: "main" };
		const elsewhere = to.agent !== this.agent;
		const content = [
			`Workflow \`${name}\` of agent \`${this.agent}\` failed on event \`${eventId}\`: ${withoutBlockTag(why)}`,
			"",
			`Its log: \`${runLog(name, eventId)}\`${elsewhere ? ` in agent \`${this.agent}\`'s directory` : ""}. See the run with \`agentx event show ${eventId}${elsewhere ? ` --agent ${this.agent}` : ""}\`.`,
		].join("\n");
		try {
			sendEvent(this.agentRoot, { threadId: to.thread, content, key: `failed:${eventId}`, metadata: { source: `workflow.${name}` } }, elsewhere ? to.agent : undefined);
		} catch (error) {
			console.error(`${workflowPrefix}${name}: the failure of ${eventId} could not be reported to ${to.agent}.${to.thread}: ${(error as Error).message}`);
		}
	}
}
