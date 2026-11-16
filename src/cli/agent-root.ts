// Recognizes an agent directory and a project's agent-x/, so that commands meant for one do not act on some other folder.

import { basename, dirname, join } from "node:path";
import { pinsAgentx } from "./pinned-cli.js";

/** Returns `dir` if it is an agent directory: a folder in `agents/` of the package that depends on agentx. Throws otherwise. */
export function agentRoot(dir: string): string {
	// agent-x/agents/<name>. Pi's shared directory (agent-x/.pi) and the pinned agentx are found from the same layout.
	if (basename(dirname(dir)) !== "agents" || !pinsAgentx(join(dir, "..", ".."))) throw new Error(`${dir} is not an agent directory. Run this in agent-x/agents/<name> of a project.`);
	return dir;
}

/** The `agent-x/` directory of the project whose root, `agent-x/` or `agent-x/agents/` is `cwd`. Throws otherwise. */
export function projectAgentX(cwd: string): string {
	const agentX = [join(cwd, "agent-x"), cwd, ...(basename(cwd) === "agents" ? [dirname(cwd)] : [])].find(pinsAgentx);
	if (!agentX) throw new Error(`${cwd} is not a project's root, its agent-x/ or its agent-x/agents/ directory. Run this in one of them.`);
	return agentX;
}
