// Runs the AgentRunner for the agent in the current directory, as a process the tests can stop. No agentx command starts the runner yet.
// Usage: node runner-process.mjs <max workers> [<stall ms>]. The first SIGINT or SIGTERM lets the running threads finish; the second stops them at once.

import { AgentRunner } from "../dist/agent-runtime/agent-runner.js";

const runner = new AgentRunner(process.cwd(), Number(process.argv[2]), process.argv[3] === undefined ? undefined : Number(process.argv[3]));
let signals = 0;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => runner.stop(++signals > 1));
await runner.run();
