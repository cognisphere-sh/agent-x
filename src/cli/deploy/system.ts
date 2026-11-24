// Runs the server's own commands for agentx server: as the user, or as root through sudo, which asks for the password in the terminal.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Runs `command` with `args`, its output in the terminal. Throws when it fails, unless `mayFail`; returns whether it succeeded. */
export function run(command: string, args: string[], mayFail = false): boolean {
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.status === 0) return true;
	if (mayFail) return false;
	throw new Error(`${[command, ...args].join(" ")} failed${result.error ? `: ${result.error.message}` : "."}`);
}

/** The output of `command` with `args`, trimmed; undefined when it fails or is missing. */
export function output(command: string, args: string[]): string | undefined {
	const result = spawnSync(command, args, { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : undefined;
}

/** Runs `args` as root, with sudo. Throws when it fails. */
export const sudo = (args: string[]) => run("sudo", args);

/** Writes `text` to the file `file` as root, readable by all, when it differs; returns whether it changed. */
export function writeAsRoot(file: string, text: string): boolean {
	if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
	const folder = mkdtempSync(join(tmpdir(), "agentx-"));
	try {
		writeFileSync(join(folder, "file"), text);
		sudo(["mkdir", "-p", dirname(file)]);
		sudo(["install", "-m", "644", join(folder, "file"), file]);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
	return true;
}
