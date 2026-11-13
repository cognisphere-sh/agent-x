// The limits of `agentx run` for one agent, from `agentx.runner` in the agent's own .pi/settings.json. They depend on the agent's tools,
// so its developer sets them. `agentx run` does not load Pi, so it reads the file as JSON, without Pi's shared agent-x/.pi/settings.json.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** How much `agentx run` does at once and how long it waits. */
export interface RunnerSettings {
	/** Pi threads that run at once. */
	maxThreads: number;
	/** A Pi process that writes nothing this long is stopped. */
	stallSeconds: number;
	/** How long the router may take for one event. */
	routerSeconds: number;
}

const defaults: RunnerSettings = { maxThreads: 4, stallSeconds: 600, routerSeconds: 60 };

/** The agent's limits: its settings over the defaults, key by key. Throws on a value that is not a number above 0. */
export function runnerSettings(agentRoot: string): RunnerSettings {
	const file = join(agentRoot, ".pi", "settings.json");
	const given = (JSON.parse(readFileSync(file, "utf8")) as { agentx?: { runner?: Partial<RunnerSettings> } }).agentx?.runner ?? {};
	const settings = { ...defaults, ...given };
	for (const key of Object.keys(defaults) as (keyof RunnerSettings)[]) {
		if (typeof settings[key] !== "number" || !(settings[key] > 0)) throw new Error(`agentx.runner.${key} in ${file} must be a number above 0.`);
	}
	return settings;
}
