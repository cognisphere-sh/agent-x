// The system prompt extension, loaded by Pi into every agent from this folder's source, not from dist/.
// Sets the system prompt as Pi's sections, so that when one file changes, Pi sends the model that section alone.
// preamble.md (next to this file) is Pi's preamble: it replaces Pi's default one, with its tool list, rules and docs.
// Then come agentx's sections, each in a tag of its own: core/*.md, the harness's rules, as agentx-core-<file>, and the agents this one
// may send events to as agentx-core-agents; the agent's .pi/system_prompt/*.md, which its developer wrote, as agentx-identity-<file>;
// and the folders its settings list under agentx.systemPrompt, which is how what the agent wrote for itself gets in, as agentx-knowledge-<file>.
// Pi puts them after its own sections, such as the skills list and the working directory.
// Skills from ~/.agents/skills are taken off that list: Pi loads them for every project, and they are not part of the agent.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canSendTo } from "../../../../project-config.js";

const preamble = fileURLToPath(new URL("preamble.md", import.meta.url));
const core = fileURLToPath(new URL("core", import.meta.url));
const homeSkills = join(homedir(), ".agents", "skills") + sep;

// agentx's own settings for an agent are under `agentx` in the agent's .pi/settings.json. Pi keeps keys it does not know and hands them to extensions.
interface Settings {
	agentx?: { systemPrompt?: string[] };
}

// A folder's Markdown files as sections, in filename order with numbers compared as numbers, so an index before the name, as in `1-tools.md`,
// orders them, and `9-` comes before `10-`. Each is named `<prefix>-<file name>`, without the index, so renumbering a file changes nothing that Pi sends.
// Pi throws on a name that is not lowercase letters, digits, `-` and `_`, which would stop every run, so anything else in a file name becomes `-`.
function sections(dir: string, prefix: string): [string, string][] {
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
		.map((file) => [`${prefix}-${file.slice(0, -3).replace(/^\d+-/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`, readFileSync(join(dir, file), "utf8").trim()]);
}

// The agent's own folders: storage/ is not checked in, and a developer may have no prompt files, so a folder may not exist.
function agentSections(dir: string, prefix: string): [string, string][] {
	return existsSync(dir) ? sections(dir, prefix) : [];
}

// The agents of the project the agent may send events to, each with what it does, from agent-x/agentx.json; nothing when there is none.
function fellowAgents(agent: string): string {
	let agents: { name: string; description: string }[];
	try {
		agents = canSendTo(agent);
	} catch (error) {
		return `# Agents you can send events to\n\nThe list cannot be read: ${(error as Error).message}`;
	}
	if (agents.length === 0) return "";
	const lines = agents.map(({ name, description }) => (description === "" ? `- \`${name}\`` : `- \`${name}\`: ${description}`));
	return ["# Agents you can send events to", "", "The harness delivers your events to these agents of the project, and to no other (see \"Sending events\"):", "", ...lines].join("\n");
}

export default function (pi: ExtensionAPI) {
	// Read on every run, so edits apply without /reload. Pi gives each run fresh options, so a file that is gone leaves no section behind.
	pi.on("before_agent_start", (event) => {
		const options = event.systemPromptOptions;
		// The agent directory is Pi's cwd. Its prompt folders are resolved from .pi/, like Pi's own resource paths.
		const agent = options.cwd;
		const knowledge = ((pi.getSettings() as Settings).agentx?.systemPrompt ?? []).flatMap((folder) => agentSections(resolve(agent, ".pi", folder), "agentx-knowledge"));
		options.customPrompt = readFileSync(preamble, "utf8").trim();
		for (const [name, text] of [...sections(core, "agentx-core"), ["agentx-core-agents", fellowAgents(agent)], ...agentSections(join(agent, ".pi", "system_prompt"), "agentx-identity"), ...knowledge]) {
			// Two files with one name, such as `1-goals.md` and `2-goals.md`, share a section, in their order, rather than one hiding the other. Pi leaves out an empty one.
			options.sections[name] = options.sections[name] ? `${options.sections[name]}\n\n${text}` : text;
		}
		options.skills = options.skills?.filter((skill) => !skill.filePath.startsWith(homeSkills));
	});
}
