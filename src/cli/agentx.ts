#!/usr/bin/env node
// `agentx` command line: creates projects and agents, runs an agent, opens Pi on one of its threads, and sends and shows its events.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { agentRoot } from "./agent-root.js";
import { chatAgent } from "./commands/chat.js";
import { event } from "./commands/event.js";
import { initAgent } from "./commands/init-agent.js";
import { initProject } from "./commands/init-project.js";
import { runAgent } from "./commands/run.js";
import { pinnedCli } from "./pinned-cli.js";

const usage = `usage:
  agentx init-project [name]   create a project with web/ (Next.js) and agent-x/, in ./<name> or the current directory
  agentx init-agent <name>     create agent-x/agents/<name>, run in a project's root or its agent-x/

in an agent directory:
  agentx run                   run the agent until stopped: route its events, run its Pi threads and its workflows
  agentx chat [--thread-id <id>] [pi args]
                               open Pi on a thread, "main" unless told otherwise
  agentx event send [--thread-id <id>] [--agent <name>] [--meta <name>=<value> ...] <content>
                               send an event; without a thread, the agent's router picks one
  agentx event list | show <id>
                               the agent's events, and what became of each`;

const [command, name] = process.argv.slice(2);
const args = process.argv.slice(3);
const cwd = process.cwd();

try {
	// Inside a project, the version it pins does the work, whichever `agentx` was started (a global install, a copy fetched from the registry).
	// init-project creates a new project, so it runs from this copy.
	const pinned = command === "init-project" ? undefined : pinnedCli(cwd);
	if (pinned) {
		const copy = spawn(process.execPath, [pinned, ...process.argv.slice(2)], { stdio: "inherit" });
		// A terminal's Ctrl-C reaches the pinned copy too, which decides what it means, as `agentx run` lets running work finish.
		// Ignored here, this process waits for that copy instead of ending first.
		process.on("SIGINT", () => {});
		// A SIGTERM sent to this process alone, as by `kill` or a process manager, is passed on, so the pinned copy never runs on by itself.
		process.on("SIGTERM", () => copy.kill("SIGTERM"));
		const [code] = await once(copy, "exit");
		process.exit(code ?? 1);
	}
	if (command === "init-project") initProject(name ?? ".", cwd);
	else if (command === "init-agent" && name) initAgent(name, cwd);
	// The other commands act on the agent directory they are started in.
	else if (command === "run" && args.length === 0) await runAgent(agentRoot(cwd));
	else if (command === "chat") process.exit(chatAgent(agentRoot(cwd), args));
	else if (command === "event") event(agentRoot(cwd), args);
	else throw new Error(usage);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
