// How Pi is started for an agent. `agentx run` and the runner both start the Pi CLI with what is here, so the agent is the same under both.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/** The Pi CLI this harness pins: Pi's own dependency, never a global `pi` on PATH, so every agent runs the same version. */
export const piCli = fileURLToPath(new URL("bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));

// agentx's Pi package. Pi loads it from source, so this is the folder in src/, also when this file runs from dist/.
const piPackage = fileURLToPath(new URL("../../src/agent-runtime/pi-package", import.meta.url));

/** Pi's arguments for a session of the agent in `agentRoot`, on the thread `threadId` when one is given: agentx's part of the config, so the agent's .pi/settings.json holds only what its author wrote. */
export function sessionFlags(agentRoot: string, threadId?: string): string[] {
	// -nc: no AGENTS.md or CLAUDE.md from the agent or its parents.
	// --approve: trust the agent's .pi/ for this run. Without a terminal Pi cannot ask and would skip .pi/ otherwise.
	// A thread is a Pi session, and its id is the session's id.
	return ["-nc", "--approve", "-e", piPackage, "--session-dir", join(agentRoot, "storage", "sessions"), ...(threadId === undefined ? [] : ["--session-id", threadId])];
}

/**
 * The environment Pi runs in. Its agent directory is the project's agent-x/.pi (agent-x/agents/<name> -> agent-x/.pi): one login and one Pi state for all agents of the project.
 * The project's gitignored agent-x/.env adds keys such as COMPOSIO_API_KEY for all its agents; a variable already in the environment wins, as a deployment sets it.
 */
export function piEnv(agentRoot: string): NodeJS.ProcessEnv {
	const envFile = join(agentRoot, "..", "..", ".env");
	const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
	return { ...fromFile, ...process.env, PI_CODING_AGENT_DIR: join(agentRoot, "..", "..", ".pi") };
}
