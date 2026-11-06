// Copies one of the harness's templates (templates/project, templates/agent) into a new directory.

import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// dist/cli/copy-template.js -> the package root.
const harnessRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The harness's own package.json, for its name and version. */
export const harnessPackage: { name: string; version: string } = JSON.parse(
	readFileSync(join(harnessRoot, "package.json"), "utf8"),
);

/** Copies `templates/<template>` to `target`, which must not exist, and sets `packageFields` in its package.json. */
export function copyTemplate(template: string, target: string, packageFields: Record<string, unknown>): void {
	if (existsSync(target)) throw new Error(`${target} already exists`);
	cpSync(join(harnessRoot, "templates", template), target, { recursive: true });
	const packagePath = join(target, "package.json");
	const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
	writeFileSync(packagePath, `${JSON.stringify({ ...packageJson, ...packageFields }, null, "\t")}\n`);
}
