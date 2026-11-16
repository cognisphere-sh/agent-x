#!/usr/bin/env node
// `agentx-browser`: the agent's own browser command, run in its processes, such as the model's bash, which the browser skill teaches it. Not a command
// for people: it finds the agent from the environment its processes have.

import { join } from "node:path";
import { isAgentFolder } from "../project-config.js";
import { ensureStorage } from "../storage.js";
import { defaultProfile, runBrowser } from "./agent-browser.js";

const usage = `usage:
  agentx-browser [--profile <name>] <command> [args]
                           runs agentx's agent-browser on one of the agent's profiles, "${defaultProfile}" unless told another, kept in
                           storage/workspace/browser/profiles/<name>/; agentx-browser skills get core says how to use it`;

const { AGENTX_AGENT: agent, PI_CODING_AGENT_DIR: piDir } = process.env;
const args = process.argv.slice(2);
const [profile, command] = args[0] === "--profile" ? [args[1], args.slice(2)] : [defaultProfile, args];

try {
	// The agent's processes have its name, and the project's Pi agent directory, agent-x/.pi, beside agent-x/agents/.
	if (agent === undefined || piDir === undefined) throw new Error("agentx-browser is the agent's own, run in its processes, such as the model's bash.");
	const agentRoot = join(piDir, "..", "agents", agent);
	if (profile === undefined || command.length === 0) throw new Error(usage);
	if (!isAgentFolder(agentRoot)) throw new Error(`${agentRoot} is not an agent directory.`);
	// Its storage is made when missing, as after a fresh clone, such as in an image that installs Chrome ahead.
	ensureStorage(agentRoot);
	process.exit(runBrowser(agentRoot, profile, command));
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
