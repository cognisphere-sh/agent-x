// A service as the coordinator runs it: it starts the service with its context, runs its polling, and stops it. A service that fails to start is
// off, and its polling ends at once. A failure in its polling is logged, never thrown, so no service can end the coordinator.

import type { ServiceContext, ServiceDefinition } from "./service.js";

/** Runs one service. */
export class ServiceRunner {
	/** Whether its onStart succeeded. One that failed is off until agentx serve starts again. */
	on = false;
	private readonly timers: NodeJS.Timeout[] = [];
	// The runs of its polling in progress.
	private readonly runs = new Set<Promise<void>>();

	constructor(
		readonly name: string,
		readonly service: ServiceDefinition,
	) {}

	/** Starts the service with `context`, to which the runner adds `every`. */
	async start(context: Omit<ServiceContext, "every">): Promise<void> {
		try {
			await this.service.onStart?.({ ...context, every: (ms, work) => this.every(ms, work) });
			this.on = true;
		} catch (error) {
			console.error(`Service "${this.name}" is off: ${(error as Error).message}`);
			await this.endPolling();
		}
	}

	/** Ends its polling, waits for a run in progress, then runs its onStop. */
	async stop(): Promise<void> {
		await this.endPolling();
		if (!this.on) return;
		try {
			await this.service.onStop?.();
		} catch (error) {
			console.error(`Service "${this.name}" failed to stop: ${(error as Error).message}`);
		}
	}

	// Runs `work` every `ms`, never twice at once.
	private every(ms: number, work: () => void | Promise<void>): void {
		let busy = false;
		this.timers.push(
			setInterval(() => {
				if (busy) return;
				busy = true;
				const run: Promise<void> = Promise.resolve()
					.then(work)
					.catch((error) => console.error(`${this.name}: ${(error as Error).message}`))
					.finally(() => {
						busy = false;
						this.runs.delete(run);
					});
				this.runs.add(run);
			}, ms),
		);
	}

	private async endPolling(): Promise<void> {
		for (const timer of this.timers) clearInterval(timer);
		await Promise.all(this.runs);
	}
}
