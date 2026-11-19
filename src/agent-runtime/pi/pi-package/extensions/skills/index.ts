// The skills extension, loaded by Pi into every agent: the agent's skills as sections of the system prompt, one per skill, with its version.
// Pi lists every skill in one section, `skills`, read once when the session starts and without versions, so any change sends the whole list again.
// This extension empties Pi's list on every run, so Pi writes no such section, and reads the skills again itself: a new or changed skill
// shows from the next run, without /reload, and a change to one sends only its section. Pi still finds the skills, so `/skill:name` works.
// Skills from ~/.agents/skills are left out: Pi loads them for every project, and they are not part of the agent.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type ExtensionAPI, loadSkillsFromDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

const homeSkills = join(homedir(), ".agents", "skills") + sep;
// A skill's name as the Agent Skills specification has it, which also makes a valid section name after `agentx-skill-`.
const nameRule = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Settings {
	skills?: string[];
}

/** A skill as its section shows it. */
interface Skill {
	name: string;
	description: string;
	version: string;
	filePath: string;
}

// The skill a SKILL.md defines now, or why it cannot be one. Undefined when the file is gone or is hidden from the model.
function readSkill(filePath: string): Skill | string | undefined {
	let frontmatter: Record<string, unknown>;
	try {
		({ frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8")));
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : `its frontmatter cannot be read: ${(error as Error).message}`;
	}
	if (frontmatter["disable-model-invocation"] === true) return undefined;
	const name = typeof frontmatter.name === "string" ? frontmatter.name : basename(dirname(filePath));
	const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
	if (!nameRule.test(name)) return `its name "${name}" is not lowercase letters and digits joined by single hyphens`;
	if (description === "") return "it has no description";
	const metadata = frontmatter.metadata as { version?: unknown } | undefined;
	const version = metadata?.version === undefined ? "none" : String(metadata.version);
	return { name, description, version, filePath };
}

function intro(broken: string[]): string {
	const lines = [
		"# Skills",
		"",
		"Each `agentx-skill-<name>` section is one of your skills: how to do one kind of task, with its version, when to use it, and its file.",
		"When a task matches a skill's description, read its file with `read` before you start, and resolve relative paths in it against the skill's folder.",
		"When a skill's version changes, read it again; its `CHANGELOG.md`, next to it, says what changed.",
	];
	if (broken.length > 0) lines.push("", "These skills could not be loaded:", "", ...broken.map((line) => `- ${line}`));
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const options = event.systemPromptOptions;
		// Pi's skills, then any new one in the agent's skill folders, which resolve from .pi/ like Pi's own paths. Those Pi could not load are read too, to say why.
		const paths = (options.skills ?? []).map((skill) => skill.filePath);
		options.skills = [];
		for (const folder of [join(options.cwd, ".pi", "skills"), ...((pi.getSettings() as Settings).skills ?? []).map((path) => resolve(options.cwd, ".pi", path))]) {
			const scan = loadSkillsFromDir({ dir: folder, source: "agentx" });
			paths.push(...scan.skills.map((skill) => skill.filePath), ...scan.diagnostics.flatMap((diagnostic) => (diagnostic.path?.endsWith("SKILL.md") ? [diagnostic.path] : [])));
		}
		const skills = new Map<string, Skill>();
		const broken: string[] = [];
		for (const filePath of new Set(paths)) {
			if (filePath.startsWith(homeSkills)) continue;
			const skill = readSkill(filePath);
			if (typeof skill === "string") broken.push(`${filePath}: ${skill}`);
			// The first of two skills with one name wins, as in Pi: its own come first.
			else if (skill && skills.has(skill.name)) broken.push(`${filePath}: the name "${skill.name}" is taken by ${skills.get(skill.name)?.filePath}`);
			else if (skill) skills.set(skill.name, skill);
		}
		options.sections["agentx-skills"] = intro(broken);
		for (const skill of [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))) {
			options.sections[`agentx-skill-${skill.name}`] = [`name: ${skill.name}`, `version: ${skill.version}`, `description: ${skill.description}`, `file: ${skill.filePath}`].join("\n");
		}
	});
}
