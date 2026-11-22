// The environment of an agent's processes. Pi, the router and the workflows all run with it, so they see the same keys, the same `agentx` and the same
// time zone.

import { existsSync, readFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { parseEnv } from "node:util";
import { agentTimeZone } from "./time-zone.js";

/**
 * The environment of the agent's processes: Pi, its router and its workflows. Its agent directory is the project's agent-x/.pi (agent-x/agents/<name> -> agent-x/.pi):
 * one login and one Pi state for all agents of the project. The project's gitignored agent-x/.env adds keys such as COMPOSIO_API_KEY for all its agents;
 * a variable already in the environment wins, as a deployment sets it. The project's commands come first on the PATH, so `agentx` is the one it pins.
 * `AGENTX_AGENT` names the agent, so that `agentx event send`, run by the model's bash or a workflow, sends from inside the agent. `TZ` is the agent's time
 * zone, when its settings name one, so that what its processes and the commands they run say of the time is in it.
 */
export function agentEnv(agentRoot: string): NodeJS.ProcessEnv {
	const agentX = join(agentRoot, "..", "..");
	const env = withEnvFile(join(agentX, ".env"));
	const timeZone = agentTimeZone(agentRoot);
	return {
		...env,
		PATH: [join(agentX, "node_modules", ".bin"), env.PATH].filter(Boolean).join(delimiter),
		PI_CODING_AGENT_DIR: join(agentX, ".pi"),
		AGENTX_AGENT: basename(agentRoot),
		...(timeZone ? { TZ: timeZone } : {}),
	};
}

/** This process's environment, with the variables of the env file `file` that it does not set: a variable already in the environment wins, as a deployment sets it. */
export function withEnvFile(file: string): NodeJS.ProcessEnv {
	return { ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}), ...process.env };
}
