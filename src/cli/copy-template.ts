// Copies one of the harness's templates (templates/project, templates/agent) into a new directory, and writes the JSON files the CLI changes in it.

import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The harness's package root: dist/cli/copy-template.js -> two levels up. */
export const harnessRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Writes `value` to the JSON file `file`, indented with tabs, as the templates are. */
export const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);

/** Sets `fields` in the package.json of `dir`. */
export function setPackageFields(dir: string, fields: Record<string, unknown>): void {
	const packagePath = join(dir, "package.json");
	writeJson(packagePath, { ...JSON.parse(readFileSync(packagePath, "utf8")), ...fields });
}

/** The template files that are copied with a dot before their name: npm drops `.gitignore` files from published packages, and may drop `.env` files. */
const dotted = ["gitignore", "env"];

/** Copies `templates/<template>` to `target`, which must be missing or empty, naming each `env` and `gitignore` file `.env` and `.gitignore`. */
export function copyTemplate(template: string, target: string): void {
	if (existsSync(target) && readdirSync(target).length > 0) throw new Error(`${target} already exists and is not empty`);
	cpSync(join(harnessRoot, "templates", template), target, { recursive: true });
	for (const file of readdirSync(target, { recursive: true, encoding: "utf8" })) {
		if (dotted.includes(basename(file))) renameSync(join(target, file), join(target, dirname(file), `.${basename(file)}`));
	}
}
