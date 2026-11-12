// Finds the agentx CLI that the project around a directory pins, so any `agentx` can hand over to it.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harnessPackage } from "./copy-template.js";

/** The CLI entry file of the agentx that the project around `cwd` pins, searched from `cwd` upward; undefined outside a project or if it is this copy. Throws if the project has not installed it. */
export function pinnedCli(cwd: string): string | undefined {
	for (let dir = cwd; ; dir = dirname(dir)) {
		// In the project root the pinning package is agent-x/; agent-x/ and its agents are inside it.
		const pinning = [join(dir, "agent-x"), dir].find(pinsAgentx);
		if (pinning) {
			const cli = join(pinning, "node_modules", harnessPackage.name, "dist", "cli", "agentx.js");
			// Running this copy instead would start another agentx version, with its own Pi.
			if (!existsSync(cli)) throw new Error(`agentx is not installed in ${pinning}, which pins it. Run pnpm install in the project root.`);
			return realpathSync(cli) === realpathSync(fileURLToPath(new URL("agentx.js", import.meta.url))) ? undefined : cli;
		}
		if (dir === dirname(dir)) return undefined;
	}
}

/** Whether `dir` is a package that lists agentx in its dependencies, as a project's agent-x/ does. */
export function pinsAgentx(dir: string): boolean {
	const packagePath = join(dir, "package.json");
	return existsSync(packagePath) && harnessPackage.name in (JSON.parse(readFileSync(packagePath, "utf8")).dependencies ?? {});
}
