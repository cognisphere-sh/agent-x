// AgentSupervisor: the parent inside `agentx run`. It runs the agent's three loops, the EventRouter, the PiRunner and the WorkflowRunner,
// starts again a loop that crashes, writes the agent's heartbeat while all three work, and stops them.
// One process, not three: the code that can fail, the router, workflows and Pi, already runs in child processes of the loops.

import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { EventRouter } from "../events/event-router.js";
import { PiRunner } from "../pi/pi-runner.js";
import { heartbeatFile, heartbeatMs, storageOf } from "../storage.js";
import type { RunnerSettings } from "./runner-settings.js";
import { WorkflowRunner } from "../workflows/workflow-runner.js";

/** One of the loops: it runs until stopped and says when it last looked at the queue. */
interface Loop {
	run(): Promise<void>;
	stop(force?: boolean): void;
	lastRound(): number;
}

// How long a loop may go without looking at the queue before it counts as stuck.
const stuckMs = 30_000;
// A loop that crashes is started again after this wait, doubled after each crash up to a minute, and back to the start after a run of 10 minutes.
const firstDelayMs = 1000;
const lastDelayMs = 60_000;
const goodRunMs = 600_000;

/** Runs the agent in `agentRoot` until `stop`. */
export class AgentSupervisor {
	private readonly loops: Record<string, Loop>;
	// Loops that have ended after `stop`. One that ended is done, not stuck, so the heartbeat goes on while the others finish their work.
	private readonly ended = new Set<Loop>();
	private stopping = false;

	constructor(
		private readonly agentRoot: string,
		settings: RunnerSettings,
	) {
		this.loops = {
			router: new EventRouter(agentRoot, settings.routerSeconds * 1000),
			pi: new PiRunner(agentRoot, settings.maxThreads, settings.stallSeconds * 1000),
			workflows: new WorkflowRunner(agentRoot),
		};
	}

	/** Runs the loops; returns when `stop` was called and each has ended. */
	async run(): Promise<void> {
		this.beat();
		const timer = setInterval(() => this.beat(), heartbeatMs);
		await Promise.all(Object.entries(this.loops).map(([name, loop]) => this.keep(name, loop)));
		clearInterval(timer);
	}

	/** First call: no new work, and running work finishes. With `force`: running work stops now. */
	stop(force = false): void {
		this.stopping = true;
		for (const loop of Object.values(this.loops)) loop.stop(force);
	}

	// Runs a loop, and again after a crash. The same object runs again, so it keeps the child processes it was watching.
	private async keep(name: string, loop: Loop): Promise<void> {
		for (let delay = firstDelayMs; ; delay = Math.min(delay * 2, lastDelayMs)) {
			const startedAt = Date.now();
			try {
				await loop.run();
				this.ended.add(loop);
				return;
			} catch (error) {
				console.error(`${name}: the loop crashed: ${(error as Error).stack ?? error}`);
			}
			if (this.stopping) return;
			if (Date.now() - startedAt >= goodRunMs) delay = firstDelayMs;
			console.error(`${name}: starting the loop again in ${delay / 1000} s`);
			await sleep(delay);
		}
	}

	// The heartbeat says the agent works, so it is written only while every loop does. The coordinator reads it.
	private beat(): void {
		if (Object.values(this.loops).every((loop) => this.ended.has(loop) || Date.now() - loop.lastRound() < stuckMs)) writeFileSync(heartbeatFile(storageOf(this.agentRoot)), String(Date.now()));
	}
}
