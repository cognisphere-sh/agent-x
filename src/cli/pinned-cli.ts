// Finds the agentx CLI that the project around a directory pins, so any `agentx` can hand over to it.

import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harnessPackage } from "./copy-template.js";

/** The CLI entry file in the project's agent-x/node_modules, searched from `cwd` upward; undefined if there is none or it is this copy. */
export function pinnedCli(cwd: string): string | undefined {
	const cli = join("node_modules", harnessPackage.name, "dist", "cli", "agentx.js");
	for (let dir = cwd; ; dir = dirname(dir)) {
		// In the project root the install is in agent-x/; in agent-x/ and its agents it is in an ancestor.
		const found = [join(dir, "agent-x", cli), join(dir, cli)].find((path) => existsSync(path));
		if (found) return realpathSync(found) === realpathSync(fileURLToPath(new URL("agentx.js", import.meta.url))) ? undefined : found;
		if (dir === dirname(dir)) return undefined;
	}
}
