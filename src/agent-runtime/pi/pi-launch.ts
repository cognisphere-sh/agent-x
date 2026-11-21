// How Pi is started for an agent. `agentx chat` and the Pi runner of `agentx run` both start the Pi CLI with what is here, so the agent is the same under both.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The Pi CLI this harness pins: Pi's own dependency, never a global `pi` on PATH, so every agent runs the same version. */
export const piCli = fileURLToPath(new URL("bundle/cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")));

// agentx's Pi package. Pi loads it from source, so this is the folder in src/, also when this file runs from dist/.
const piPackage = fileURLToPath(new URL("../../../src/agent-runtime/pi/pi-package", import.meta.url));

/** The folder of the thread `threadId`'s Pi sessions, of the agent in `agentRoot`. */
export const threadFolder = (agentRoot: string, threadId: string) => join(agentRoot, "storage", "sessions", threadId);

/**
 * Pi's arguments for a session of the agent in `agentRoot` on the thread `threadId`: agentx's part of the config, so the agent's .pi/settings.json holds only
 * what its author wrote. With `continueLatest` false, the caller picks the session itself among the thread's, as with `-r`.
 */
export function sessionFlags(agentRoot: string, threadId: string, continueLatest = true): string[] {
	// -nc: no AGENTS.md or CLAUDE.md from the agent or its parents.
	// --approve: trust the agent's .pi/ for this run. Without a terminal Pi cannot ask and would skip .pi/ otherwise.
	// A thread is a folder of Pi sessions, and its latest session goes on: Pi continues it, or starts one in an empty folder.
	return ["-nc", "--approve", "-e", piPackage, "--session-dir", threadFolder(agentRoot, threadId), ...(continueLatest ? ["--continue"] : [])];
}

