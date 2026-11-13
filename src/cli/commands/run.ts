// `agentx run`: runs the agent in an agent directory until it is stopped: routes its events, runs its Pi threads and its workflows.

import { basename } from "node:path";
import { AgentSupervisor } from "../../agent-runtime/supervisor/agent-supervisor.js";
import { runnerSettings } from "../../agent-runtime/supervisor/runner-settings.js";

/** Runs the agent in `agentRoot`. The first SIGINT or SIGTERM lets running work finish; the second stops it. Resolves when everything has stopped. */
export async function runAgent(agentRoot: string): Promise<void> {
	const settings = runnerSettings(agentRoot);
	const supervisor = new AgentSupervisor(agentRoot, settings);
	console.log(`Running agent "${basename(agentRoot)}", up to ${settings.maxThreads} Pi threads at once. Ctrl-C lets running work finish; a second Ctrl-C stops it.`);
	let stops = 0;
	let interruptedAt = 0;
	const stop = () => supervisor.stop(++stops > 1);
	process.on("SIGINT", () => {
		interruptedAt = Date.now();
		stop();
	});
	// `pnpm exec` sends a SIGTERM right after the terminal's Ctrl-C (pnpm 11.21); that is the same stop.
	process.on("SIGTERM", () => {
		if (Date.now() - interruptedAt > 1000) stop();
	});
	await supervisor.run();
}
