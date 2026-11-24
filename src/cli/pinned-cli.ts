// Finds the agentx CLI that the project around a directory pins, and runs it, so any `agentx` can hand over to it.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** agentx's npm package, which a project's agent-x/ lists in its dependencies. */
export const agentxPackage = "@cognisphere-sh/agentx";

/** The CLI entry file of the agentx installed in the package `pinning`, such as a project's agent-x/. */
export const installedCli = (pinning: string) => join(pinning, "node_modules", agentxPackage, "dist", "cli", "agentx.js");

/** The CLI entry file of the agentx that the project around `cwd` pins, searched from `cwd` upward; undefined outside a project or if it is this copy. Throws if the project has not installed it. */
export function pinnedCli(cwd: string): string | undefined {
	for (let dir = cwd; ; dir = dirname(dir)) {
		// In the project root the pinning package is agent-x/; agent-x/ and its agents are inside it.
		const pinning = [join(dir, "agent-x"), dir].find(pinsAgentx);
		if (pinning) {
			const cli = installedCli(pinning);
			// Running this copy instead would start another agentx version, with its own Pi.
			if (!existsSync(cli)) throw new Error(`agentx is not installed in ${pinning}, which pins it. Run pnpm install in the project root.`);
			return realpathSync(cli) === realpathSync(fileURLToPath(new URL("agentx.js", import.meta.url))) ? undefined : cli;
		}
		if (dir === dirname(dir)) return undefined;
	}
}

/** What the package in `dir` lists for agentx in its dependencies, such as `0.1.0` or `link:../agentx`; undefined when it lists nothing or has no package.json. */
export function agentxDependency(dir: string): string | undefined {
	const packagePath = join(dir, "package.json");
	const dependencies: Record<string, string> = existsSync(packagePath) ? (JSON.parse(readFileSync(packagePath, "utf8")).dependencies ?? {}) : {};
	return dependencies[agentxPackage];
}

/** Whether `dir` is a package that lists agentx in its dependencies, as a project's agent-x/ does. */
export const pinsAgentx = (dir: string) => agentxDependency(dir) !== undefined;

/** Runs the agentx CLI `cli` with `args` in this terminal, and resolves to its exit status. */
export async function runCli(cli: string, args: string[]): Promise<number> {
	const copy = spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
	// A terminal's Ctrl-C reaches the copy too, which decides what it means, as `agentx run` lets running work finish.
	// Ignored here, this process waits for that copy instead of ending first.
	process.on("SIGINT", () => {});
	// A SIGTERM sent to this process alone, as by `kill` or a process manager, is passed on, so the copy never runs on by itself.
	process.on("SIGTERM", () => copy.kill("SIGTERM"));
	const [code] = await once(copy, "exit");
	return code ?? 1;
}
