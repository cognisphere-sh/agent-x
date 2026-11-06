#!/usr/bin/env node
// `agentx` command line: creates projects and agents, and runs an agent with Pi.

import { initAgent } from "./commands/init-agent.js";
import { initProject } from "./commands/init-project.js";
import { runAgent } from "./commands/run.js";

const usage = `usage:
  agentx init-project <name>   create a project with app/ (Next.js) and harness/
  agentx init-agent <name>     create harness/<name>, run inside a project
  agentx run [pi args]         start Pi in the agent directory it is run from`;

const [command, name] = process.argv.slice(2);

try {
	if (command === "init-project" && name) initProject(name, process.cwd());
	else if (command === "init-agent" && name) initAgent(name, process.cwd());
	// npm and pnpm run scripts from the package directory, which is the agent directory.
	else if (command === "run") process.exit(runAgent(process.cwd(), process.argv.slice(3)));
	else throw new Error(usage);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
