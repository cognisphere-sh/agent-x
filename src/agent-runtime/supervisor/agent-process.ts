// The process the coordinator starts for one agent, in the agent's directory: it runs the agent until it is stopped, as `agentx run` does, without the CLI.

import { runAgent } from "./run-agent.js";

try {
	await runAgent(process.cwd());
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
