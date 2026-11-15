// `agentx remove-agent <name> [--yes]`: removes an agent from the project: its folder in agent-x/agents/, its state in agent-x/storage/, and its entry in
// agent-x/agentx.json, and takes it off the other agents' canSendTo. Its sessions and what it learned go with it, so without --yes it only says what it would delete.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { configFile, projectConfig, saveProjectConfig } from "../../agent-runtime/project-config.js";
import { centralStorage, heartbeatMs, lastBeat } from "../../agent-runtime/storage.js";
import { projectAgentX } from "../agent-root.js";

/** Runs `agentx remove-agent <name> [--yes]` in the project whose root or agent-x/ is `cwd`; without --yes, only says what it would delete. */
export function removeAgent(cwd: string, args: string[]): void {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { yes: { type: "boolean", default: false } } });
	const [name] = positionals;
	if (positionals.length !== 1 || !nameRule.test(name)) throw new Error("usage: agentx remove-agent <name> [--yes]");
	const agentX = projectAgentX(cwd);
	const root = join(agentX, "agents", name);
	const storage = centralStorage(root);
	const config = projectConfig(agentX);
	const listed = Object.hasOwn(config.agents, name);
	if (!listed && !existsSync(root) && !existsSync(storage)) throw new Error(`This project has no agent "${name}".`);
	// A heartbeat newer than three beats means the agent is running.
	if (Date.now() - lastBeat(storage) < 3 * heartbeatMs) throw new Error(`Agent "${name}" is running. Stop agentx serve, or its agentx run, first.`);
	const what = [...[root, storage].filter((path) => existsSync(path)), ...(listed ? [`its entry in ${configFile(agentX)}`] : [])];
	if (!values.yes) {
		console.log(`agentx remove-agent ${name} --yes deletes, with the agent's sessions and what it learned:\n${what.map((line) => `  ${line}`).join("\n")}`);
		return;
	}
	// The folder's storage is a link, which is removed, not followed; the state it leads to goes next.
	rmSync(root, { recursive: true, force: true });
	rmSync(storage, { recursive: true, force: true });
	delete config.agents[name];
	for (const entry of Object.values(config.agents)) if (Array.isArray(entry.canSendTo)) entry.canSendTo = entry.canSendTo.filter((other) => other !== name);
	saveProjectConfig(agentX, config);
	console.log(`Removed agent "${name}":\n${what.map((line) => `  ${line}`).join("\n")}`);
}
