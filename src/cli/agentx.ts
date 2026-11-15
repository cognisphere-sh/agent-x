#!/usr/bin/env node
// `agentx` command line: creates projects and agents, runs an agent or all of them, opens Pi on one of its threads, and gives it events.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { ensureStorage } from "../agent-runtime/storage.js";
import { agentRoot } from "./agent-root.js";
import { chatAgent } from "./commands/chat.js";
import { event } from "./commands/event.js";
import { initAgent } from "./commands/init-agent.js";
import { initProject } from "./commands/init-project.js";
import { removeAgent } from "./commands/remove-agent.js";
import { serve } from "./commands/serve.js";
import { runAgent } from "../agent-runtime/supervisor/run-agent.js";
import { pinnedCli } from "./pinned-cli.js";

const usage = `usage:
  agentx init-project [name]   create a project with web/ (Next.js) and agent-x/, in ./<name> or the current directory
  agentx init-agent <name>     create agent-x/agents/<name>, run in a project's root or its agent-x/
  agentx remove-agent <name> [--yes]
                               delete an agent: its folder, its state in agent-x/storage/ and its entry in agentx.json; without --yes, say what
  agentx serve [--host <host>] [--port <port>]
                               run every agent of the project until stopped, and deliver events between them, in its root or agent-x/

in an agent directory:
  agentx run                   run the agent until stopped: route its events, run its Pi threads and its workflows
  agentx chat [--thread-id <id>] [pi args]
                               open Pi on a thread, "main" unless told otherwise
  agentx event deliver [--thread-id <id>] [--agent <name>] [--meta <name>=<value> ...] [--file <path> ...] <content>
                               give the agent, or another, an event; without a thread, the agent's router picks one
  agentx event send ...        the agent's own send, from its processes, such as the model's bash`;

const [command, name] = process.argv.slice(2);
const args = process.argv.slice(3);
const cwd = process.cwd();

// The agent directory `dir`, with its storage made when it is missing, as after a fresh clone.
function agentAt(dir: string): string {
	const root = agentRoot(dir);
	ensureStorage(root);
	return root;
}

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
	else if (command === "remove-agent") removeAgent(cwd, args);
	else if (command === "serve") await serve(cwd, args);
	// The other commands act on the agent directory they are started in.
	else if (command === "run" && args.length === 0) await runAgent(agentAt(cwd));
	else if (command === "chat") process.exit(chatAgent(agentAt(cwd), args));
	else if (command === "event") event(agentAt(cwd), args);
	else throw new Error(usage);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
