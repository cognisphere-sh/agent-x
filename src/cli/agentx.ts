#!/usr/bin/env node
// `agentx` command line: creates projects and agents, and runs an agent with Pi.

import { spawnSync } from "node:child_process";
import { initAgent } from "./commands/init-agent.js";
import { initProject } from "./commands/init-project.js";
import { runAgent } from "./commands/run.js";
import { pinnedCli } from "./pinned-cli.js";

const usage = `usage:
  agentx init-project [name]   create a project with web/ (Next.js) and agent-x/, in ./<name> or the current directory
  agentx init-agent <name>     create agent-x/agents/<name>, run in a project's root or its agent-x/
  agentx run [pi args]         start Pi in the agent directory it is run from`;

const [command, name] = process.argv.slice(2);

// Inside a project, the version it pins does the work, whichever `agentx` was started (a global link, npx from the registry).
// init-project creates a new project, so it runs from this copy.
const pinned = command === "init-project" ? undefined : pinnedCli(process.cwd());
if (pinned) process.exit(spawnSync(process.execPath, [pinned, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);

try {
	if (command === "init-project") initProject(name ?? ".", process.cwd());
	else if (command === "init-agent" && name) initAgent(name, process.cwd());
	// npm and pnpm run scripts from the package directory, which is the agent directory.
	else if (command === "run") process.exit(runAgent(process.cwd(), process.argv.slice(3)));
	else throw new Error(usage);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
