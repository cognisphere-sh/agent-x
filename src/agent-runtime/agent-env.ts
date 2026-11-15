// The environment of an agent's processes. Pi, the router and the workflows all run with it, so they see the same keys and the same `agentx`.

import { existsSync, readFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { parseEnv } from "node:util";

/**
 * The environment of the agent's processes: Pi, its router and its workflows. Its agent directory is the project's agent-x/.pi (agent-x/agents/<name> -> agent-x/.pi):
 * one login and one Pi state for all agents of the project. The project's gitignored agent-x/.env adds keys such as COMPOSIO_API_KEY for all its agents;
 * a variable already in the environment wins, as a deployment sets it. The project's commands come first on the PATH, so `agentx` is the one it pins.
 * `AGENTX_AGENT` names the agent, so that `agentx event send`, run by the model's bash or a workflow, sends from inside the agent.
 */
export function agentEnv(agentRoot: string): NodeJS.ProcessEnv {
	const agentX = join(agentRoot, "..", "..");
	const envFile = join(agentX, ".env");
	const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
	const env = { ...fromFile, ...process.env };
	return {
		...env,
		PATH: [join(agentX, "node_modules", ".bin"), env.PATH].filter(Boolean).join(delimiter),
		PI_CODING_AGENT_DIR: join(agentX, ".pi"),
		AGENTX_AGENT: basename(agentRoot),
	};
}
