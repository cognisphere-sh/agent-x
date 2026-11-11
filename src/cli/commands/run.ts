// `agentx run [pi args]`: starts Pi in an agent directory without changing anything in it.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Pi reads its subcommands only as the first argument, so no flags may come before them.
const piSubcommands = ["install", "remove", "update", "list", "config", "mcp", "auth"];
// -nc: no AGENTS.md or CLAUDE.md from the agent or its parents.
// --approve: trust the agent's .pi/ for this run. Print mode cannot prompt and would skip .pi/ otherwise.
const sessionFlags = ["-nc", "--approve"];
// dist/cli/commands/run.js -> agentx's Pi package, which Pi loads from source.
const piPackage = fileURLToPath(new URL("../../../src/agent-runtime/pi-package", import.meta.url));

/** Runs the Pi CLI pinned by this harness in `agentRoot` with the project's `agent-x/.pi` as its agent directory; returns its exit status. */
export function runAgent(agentRoot: string, piArgs: string[]): number {
	// agentx's part of the config is passed here, so the agent's .pi/settings.json holds only what its author wrote.
	const flags = piSubcommands.includes(piArgs[0] ?? "")
		? []
		: [...sessionFlags, "-e", piPackage, "--session-dir", join(agentRoot, "storage", "sessions")];
	// Pi's own dependency, never a global `pi` on PATH, so every agent runs the version this harness pins.
	const piCli = fileURLToPath(new URL("bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
	const result = spawnSync(process.execPath, [piCli, ...flags, ...piArgs], {
		cwd: agentRoot,
		stdio: "inherit",
		// agent-x/agents/<name> -> agent-x/.pi: one login and one Pi state for all agents of the project.
		env: { ...process.env, PI_CODING_AGENT_DIR: join(agentRoot, "..", "..", ".pi") },
	});
	return result.status ?? 1;
}
