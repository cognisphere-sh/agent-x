// Runs the AgentRunner for the agent in the current directory, as a process the tests can stop. No agentx command starts the runner yet.
// Usage: node runner-process.mjs <max workers>. The first SIGINT or SIGTERM lets the running threads finish; the second stops at once.

import { AgentRunner } from "../dist/agent-runtime/agent-runner.js";

const runner = new AgentRunner(process.cwd(), Number(process.argv[2]));
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		if (!runner.stop()) process.exit(1);
	});
}
await runner.run();
