// `agentx remove-agent <name> [--yes]`: removes an agent from the project: its folder in agent-x/agents/, its state in agent-x/storage/, and its entry in
// agent-x/agentx.json, and takes it off the other agents' canSendTo. Its sessions and what it learned go with it, so without --yes it lists what it deletes and asks first.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { configFile, projectConfig, saveProjectConfig } from "../../agent-runtime/project-config.js";
import { centralStorage, heartbeatMs, lastBeat } from "../../agent-runtime/storage.js";
import { projectAgentX } from "../agent-root.js";

/** Runs `agentx remove-agent <name> [--yes]` in the project whose root, agent-x/ or agent-x/agents/ is `cwd`; without --yes, asks first. */
export async function removeAgent(cwd: string, args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { yes: { type: "boolean", default: false } } });
	const [name] = positionals;
	if (positionals.length !== 1 || !nameRule.test(name)) throw new Error("usage: agentx remove-agent <name> [--yes]");
	const agentX = projectAgentX(cwd);
	const root = join(agentX, "agents", name);
	const storage = centralStorage(root);
	const config = projectConfig(agentX);
	const listed = Object.hasOwn(config.agents, name);
	if (!listed && !existsSync(root) && !existsSync(storage)) throw new Error(`This project has no agent "${name}".`);
	// A heartbeat newer than three beats means the agent is running. Checked again after the question, which may wait a long time.
	const refuseIfRunning = () => {
		if (Date.now() - lastBeat(storage) < 3 * heartbeatMs) throw new Error(`Agent "${name}" is running. Stop agentx serve, or its agentx run, first.`);
	};
	refuseIfRunning();
	const what = [...[root, storage].filter((path) => existsSync(path)), ...(listed ? [`its entry in ${configFile(agentX)}`] : [])].map((line) => `  ${line}`).join("\n");
	if (!values.yes) {
		console.log(`Removing agent "${name}" deletes, with its sessions and what it learned:\n${what}`);
		if (!(await confirmed("Delete them? [y/N] "))) {
			console.log("Nothing deleted.");
			return;
		}
		refuseIfRunning();
	}
	// The folder's storage is a link, which is removed, not followed; the state it leads to goes next.
	rmSync(root, { recursive: true, force: true });
	rmSync(storage, { recursive: true, force: true });
	delete config.agents[name];
	for (const entry of Object.values(config.agents)) if (Array.isArray(entry.canSendTo)) entry.canSendTo = entry.canSendTo.filter((other) => other !== name);
	saveProjectConfig(agentX, config);
	console.log(`Removed agent "${name}":\n${what}`);
}

// Whether the person answers yes to `question`. Input that ends unanswered, as with Ctrl-C or when nothing can be typed, is a no.
async function confirmed(question: string): Promise<boolean> {
	const input = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		input.once("close", () => resolve(""));
		input.question(question, resolve);
	});
	input.close();
	return /^y(es)?$/i.test(answer.trim());
}
