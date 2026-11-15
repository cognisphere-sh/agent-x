// Where an agent's runtime state is. It lives in the project's central folder, agent-x/storage/<agent>/, and the agent reaches it as storage/
// in its own directory: a link, and in a sandbox a mount. So everything inside the agent says storage/, and the coordinator uses the central folder.

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { agentXOf } from "./project-config.js";

/** The agent's state as the agent sees it: `storage/` in its directory. */
export const storageOf = (agentRoot: string) => join(agentRoot, "storage");

/** The agent's folder in the project's central storage, `agent-x/storage/<agent>/`, which the coordinator uses. */
export const centralStorage = (agentRoot: string) => join(agentXOf(agentRoot), "storage", basename(agentRoot));

// The folders the agent writes to: its working files, and what it learns and keeps.
const folders = ["workspace", "knowledge/skills", "knowledge/system_prompt", "knowledge/workflows"];

/**
 * Makes the agent's storage when it is missing, as in a new agent or a fresh clone: the central folder, and `storage/` linking to it.
 * A `storage/` already there, a link or a folder, is used as it is: in a sandbox it is the mount. Never moves or deletes one.
 */
export function ensureStorage(agentRoot: string): void {
	const storage = storageOf(agentRoot);
	if (existsSync(storage)) return;
	const central = centralStorage(agentRoot);
	for (const folder of folders) mkdirSync(join(central, folder), { recursive: true });
	// The agent's own workflows and schedules, empty, so it finds each file where its harness prompt says it is. A file already there, when only the link was missing, is kept.
	for (const list of ["workflows.json", "schedules.json"]) {
		const file = join(central, "knowledge", list);
		if (!existsSync(file)) writeFileSync(file, "{}\n");
	}
	// A link whose folder was missing now leads to it.
	if (!lstatSync(storage, { throwIfNoEntry: false })?.isSymbolicLink()) symlinkSync(relative(agentRoot, central), storage, "junction");
}

/**
 * Why the host cannot reach the agent's state, or undefined when it can: its `storage/` is the central folder, or is not there yet.
 * A `storage/` that is a folder of its own, as a sandbox's mount is, holds state the host does not see.
 */
export function storageProblem(agentRoot: string): string | undefined {
	const storage = storageOf(agentRoot);
	const central = centralStorage(agentRoot);
	if (!existsSync(storage) || (existsSync(central) && realpathSync(storage) === realpathSync(central))) return undefined;
	return `${storage} is not a link to ${central}, so the host cannot reach the agent's state. Move its contents there and remove it: agentx makes the link.`;
}

/** How often `agentx run` writes its heartbeat. */
export const heartbeatMs = 10_000;

/** The agent's heartbeat file, in its storage folder `storage`: `agentx run` writes the time to it while all its loops work. */
export const heartbeatFile = (storage: string) => join(storage, "heartbeat");

/** When the agent whose storage folder is `storage` last wrote its heartbeat, in milliseconds since 1970; 0 when it never did. */
export function lastBeat(storage: string): number {
	try {
		return Number(readFileSync(heartbeatFile(storage), "utf8"));
	} catch {
		return 0;
	}
}
