// The project's own deploy scripts, which its developer writes: deploy/check.sh, run before the project starts, and deploy/setup.sh, at the end of a
// server's setup.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Runs `deploy/<name>.sh` of the project whose root is `root` with bash, in the root, when the file exists. Throws when it fails, which stops the command. */
export function runProjectScript(root: string, name: "check" | "setup"): void {
	const script = join("deploy", `${name}.sh`);
	if (!existsSync(join(root, script))) return;
	const result = spawnSync("bash", [script], { cwd: root, stdio: "inherit" });
	if (result.status !== 0) throw new Error(`${script} failed${result.error ? ` (${result.error.message})` : ` with status ${result.status ?? result.signal}`}.`);
}
