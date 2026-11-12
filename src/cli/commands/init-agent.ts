// `agentx init-agent <name>`: creates an agent in the project's agent-x/agents/ directory.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { copyTemplate } from "../copy-template.js";

/** Creates `agents/<name>` from templates/agent. `cwd` is the project root or its agent-x/. */
export function initAgent(name: string, cwd: string): void {
	const agents = [join(cwd, "agent-x", "agents"), join(cwd, "agents")].find((dir) => existsSync(dir));
	if (!agents) throw new Error(`No agent-x/agents/ or agents/ in ${cwd}. Run this in a project's root or its agent-x/ directory.`);
	const root = join(agents, name);
	copyTemplate("agent", root);
	// storage/ is not checked in. These are the folders the agent writes to: its working files, and what it learns and keeps.
	for (const dir of ["workspace", "knowledge/skills", "knowledge/extensions", "knowledge/system_prompt"]) {
		mkdirSync(join(root, "storage", dir), { recursive: true });
	}
	console.log(`Created ${root}

Next:
  cd ${root} && agentx run`);
}
