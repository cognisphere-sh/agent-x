// Brings a project's or an agent's files up to the templates of the agentx it pins: adds what a template has and the file lacks, and never changes or
// removes what is there, so `agentx upgrade-project` and `agentx upgrade-agent` can run any number of times.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { harnessRoot } from "./copy-template.js";

/** What an upgrade changed: the file, and what it added or changed in it. */
export type Change = [file: string, change: string];

/** The text of `templates/<path>` of this agentx, such as `agent/.pi/settings.json`. */
export const templateText = (path: string) => readFileSync(join(harnessRoot, "templates", path), "utf8");

/** The changes that add each of `names` to `file`. */
export const added = (file: string, names: string[]): Change[] => names.map((name) => [file, `added ${name}`]);

/** Prints each change as `<file>: <change>`, the file relative to `cwd`, or that there was nothing to add. */
export function printChanges(cwd: string, changes: Change[]): void {
	if (changes.length === 0) console.log("Nothing to add: the files are up to date.");
	for (const [file, change] of changes) console.log(`${relative(cwd, file)}: ${change}`);
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** Adds to `target` each key of `template` it lacks, also inside objects both have, and returns the dotted paths it added. A value already there, a list too, stays. */
export function addMissingKeys(target: object, template: object, prefix = ""): string[] {
	const into = target as JsonObject;
	const paths: string[] = [];
	for (const [key, value] of Object.entries(template)) {
		if (!Object.hasOwn(into, key)) {
			into[key] = value;
			paths.push(prefix + key);
		} else if (isObject(into[key]) && isObject(value)) paths.push(...addMissingKeys(into[key], value, `${prefix}${key}.`));
	}
	return paths;
}

/** The variables an env file sets, or names in a comment as the templates do: `NAME=value` or `# NAME=value`. */
export const variables = (text: string) => new Set([...text.matchAll(/^#?\s*([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]));

/**
 * Appends to the env file `file` each paragraph of the env template `template` that names a variable the file does not, with the comments that explain it,
 * and creates the file from the template when it is missing. Returns the variables it added.
 */
export function addMissingEnv(file: string, template: string): string[] {
	if (!existsSync(file)) {
		writeFileSync(file, template);
		return [...variables(template)];
	}
	const text = readFileSync(file, "utf8");
	const present = variables(text);
	const missing = template.split(/\n\s*\n/).filter((paragraph) => [...variables(paragraph)].some((name) => !present.has(name)));
	if (missing.length > 0) writeFileSync(file, `${text}${text.endsWith("\n") ? "" : "\n"}${missing.map((paragraph) => `\n${paragraph.trim()}\n`).join("")}`);
	return [...variables(missing.join("\n"))].filter((name) => !present.has(name));
}

/** Appends to `file` each line of `template` it lacks, such as a .gitignore pattern, creating it when it is missing. Returns the lines it added. */
export function addMissingLines(file: string, template: string): string[] {
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	const present = new Set(text.split("\n").map((line) => line.trim()));
	const missing = template.split("\n").filter((line) => line.trim() !== "" && !present.has(line.trim()));
	if (missing.length > 0) writeFileSync(file, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
	return missing;
}
