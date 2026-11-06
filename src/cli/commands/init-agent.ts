// `agentx init-agent <name>`: creates an agent in the project's harness/ directory.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { copyTemplate } from "../copy-template.js";

/** Creates `harness/<name>` from templates/agent. `projectRoot` must contain harness/. */
export function initAgent(name: string, projectRoot: string): void {
	const harness = join(projectRoot, "harness");
	if (!existsSync(harness)) throw new Error(`No harness/ in ${projectRoot}. Run this in a project's root directory.`);
	const root = join(harness, name);
	// Workspace package names must be unique; the app is named `app`.
	copyTemplate("agent", root, { name: `agent-${name}` });
	mkdirSync(join(root, "storage", "workspace"), { recursive: true });
	console.log(`Created ${root}

Next:
  npm install
  cd harness/${name} && npm run pi`);
}
