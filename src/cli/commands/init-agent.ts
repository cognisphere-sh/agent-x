// `agentx init-agent <name>`: creates an agent in the project's agent-x/agents/ directory.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { copyTemplate } from "../copy-template.js";
import { pinsAgentx } from "../pinned-cli.js";

/** Creates `agent-x/agents/<name>` from templates/agent. `cwd` is the project root or its agent-x/. */
export function initAgent(name: string, cwd: string): void {
	// The name is a folder name, so it cannot point outside agents/.
	if (!nameRule.test(name)) throw new Error(`"${name}" is not an agent name. Use letters, digits and dashes.`);
	const agentX = [join(cwd, "agent-x"), cwd].find(pinsAgentx);
	if (!agentX) throw new Error(`${cwd} is not a project's root or its agent-x/ directory. Run this in one of them.`);
	const root = join(agentX, "agents", name);
	copyTemplate("agent", root);
	// The agent's identity in Composio, under which its connected accounts are kept. Written once, so renaming the agent or the project keeps its accounts.
	// Shaped like an email address, which Composio suggests for user ids; no two agents of a Composio project may share one.
	const project = basename(dirname(agentX)).replace(/[^a-zA-Z0-9-]/g, "-");
	const settingsPath = join(root, ".pi", "settings.json");
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	settings.agentx.composio = { userId: `${name}@${project}` };
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`);
	// storage/ is not checked in. These are the folders the agent writes to: its working files, and what it learns and keeps.
	for (const dir of ["workspace", "knowledge/skills", "knowledge/extensions", "knowledge/system_prompt"]) {
		mkdirSync(join(root, "storage", dir), { recursive: true });
	}
	console.log(`Created ${root}

Next:
  cd ${root} && agentx chat    # talk to the agent; agentx run runs it in the background`);
}
