#!/usr/bin/env node
// `agentx` command line: creates projects and agents, runs an agent with Pi, and puts messages on an agent's queue.

import { spawnSync } from "node:child_process";
import { agentRoot } from "./agent-root.js";
import { initAgent } from "./commands/init-agent.js";
import { initProject } from "./commands/init-project.js";
import { runAgent } from "./commands/run.js";
import { sendMessage } from "./commands/send.js";
import { pinnedCli } from "./pinned-cli.js";

const usage = `usage:
  agentx init-project [name]   create a project with web/ (Next.js) and agent-x/, in ./<name> or the current directory
  agentx init-agent <name>     create agent-x/agents/<name>, run in a project's root or its agent-x/

in an agent directory:
  agentx run [--thread-id <id>] [pi args]
                               start Pi on a thread, "main" unless told otherwise
  agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--<name> <value> ...] <content>
                               queue a message for a thread, "main" unless told otherwise; other options are metadata`;

const [command, name] = process.argv.slice(2);
const args = process.argv.slice(3);
const cwd = process.cwd();

// Inside a project, the version it pins does the work, whichever `agentx` was started (a global install, a copy fetched from the registry).
// init-project creates a new project, so it runs from this copy.
const pinned = command === "init-project" ? undefined : pinnedCli(cwd);
if (pinned) process.exit(spawnSync(process.execPath, [pinned, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1);

try {
	if (command === "init-project") initProject(name ?? ".", cwd);
	else if (command === "init-agent" && name) initAgent(name, cwd);
	// run and send act on the agent directory they are started in.
	else if (command === "run") process.exit(runAgent(agentRoot(cwd), args));
	else if (command === "send") sendMessage(agentRoot(cwd), args);
	else throw new Error(usage);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
