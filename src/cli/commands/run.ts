// `agentx run [pi args]`: starts Pi in an agent directory without changing anything in it.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Pi reads its subcommands only as the first argument, so no flags may come before them.
const piSubcommands = ["install", "remove", "update", "list", "config", "mcp"];
// -nc: no AGENTS.md or CLAUDE.md from the agent or its parents.
// --approve: trust the agent's .pi/ for this run. Print mode cannot prompt and would skip .pi/ otherwise.
const sessionFlags = ["-nc", "--approve"];

/** Runs the Pi CLI pinned by this harness in `agentRoot` with `storage/pi` as its agent directory; returns its exit status. */
export function runAgent(agentRoot: string, piArgs: string[]): number {
	const flags = piSubcommands.includes(piArgs[0] ?? "") ? [] : sessionFlags;
	// Pi's own dependency, never a global `pi` on PATH, so every agent runs the version this harness pins.
	const piCli = fileURLToPath(new URL("bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
	const result = spawnSync(process.execPath, [piCli, ...flags, ...piArgs], {
		cwd: agentRoot,
		stdio: "inherit",
		env: { ...process.env, PI_CODING_AGENT_DIR: join(agentRoot, "storage", "pi") },
	});
	return result.status ?? 1;
}
