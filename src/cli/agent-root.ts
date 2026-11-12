// Recognizes an agent directory, so that commands meant for one do not act on some other folder.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { harnessPackage } from "./copy-template.js";

/** Returns `dir` if it is an agent directory: a folder in `agents/` of the package that depends on agentx. Throws otherwise. */
export function agentRoot(dir: string): string {
	// agent-x/agents/<name>. Pi's shared directory (agent-x/.pi) and the pinned agentx are found from the same layout.
	const packagePath = join(dir, "..", "..", "package.json");
	const pinsAgentx = existsSync(packagePath) && harnessPackage.name in (JSON.parse(readFileSync(packagePath, "utf8")).dependencies ?? {});
	if (basename(dirname(dir)) !== "agents" || !pinsAgentx) throw new Error(`${dir} is not an agent directory. Run this in agent-x/agents/<name> of a project.`);
	return dir;
}
