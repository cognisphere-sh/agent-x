// Runs one agent until it is stopped: routes its events, runs its Pi threads and its workflows. `agentx run` calls it, and so does the process the
// coordinator starts for each agent (agent-process.ts).

import { basename } from "node:path";
import { AgentSupervisor } from "./agent-supervisor.js";
import { runnerSettings } from "./runner-settings.js";
import { onStopSignals } from "./stop-signals.js";

/** Runs the agent in `agentRoot`. The first SIGINT or SIGTERM lets running work finish; the second stops it. Resolves when everything has stopped. */
export async function runAgent(agentRoot: string): Promise<void> {
	const settings = runnerSettings(agentRoot);
	const supervisor = new AgentSupervisor(agentRoot, settings);
	console.log(`Running agent "${basename(agentRoot)}", up to ${settings.maxThreads} Pi threads at once. Ctrl-C lets running work finish; a second Ctrl-C stops it.`);
	onStopSignals((force) => supervisor.stop(force));
	// Started by the coordinator, with an IPC channel: the channel closes when the coordinator is gone, even killed, and the agent ends with it at once.
	// Its Pi processes end as their input closes, and its router and workflow processes as their own channels close.
	const lifeline = () => process.exit(1);
	if (process.connected) process.once("disconnect", lifeline);
	await supervisor.run();
	// An open channel would keep this process running.
	if (process.connected) {
		process.off("disconnect", lifeline);
		process.disconnect?.();
	}
}
