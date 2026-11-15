// The system prompt extension, loaded by Pi into every agent from this folder's source, not from dist/.
// Sets the system prompt: harness.md (next to this file) first, with the agents this one may send events to, then the agent's .pi/system_prompt/*.md,
// which its developer wrote, then the folders its settings list under agentx.systemPrompt, which is how what the agent wrote for itself gets in.
// A folder's files go in filename order.
// This replaces Pi's whole default prompt, including its tool list; Pi still appends the skills list and the working directory.
// Skills from ~/.agents/skills are taken off that list: Pi loads them for every project, and they are not part of the agent.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canSendTo } from "../../../../project-config.js";

const harnessPrompt = fileURLToPath(new URL("harness.md", import.meta.url));
const homeSkills = join(homedir(), ".agents", "skills") + sep;

// agentx's own settings for an agent are under `agentx` in the agent's .pi/settings.json. Pi keeps keys it does not know and hands them to extensions.
interface Settings {
	agentx?: { systemPrompt?: string[] };
}

// The texts of a folder's Markdown files, in filename order. storage/ is not checked in, so a folder may not exist.
function prompts(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.sort()
		.map((file) => readFileSync(join(dir, file), "utf8").trim());
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
	// Read on every run, so edits apply without /reload.
	pi.on("before_agent_start", (event) => {
		// The agent directory is Pi's cwd.
		const agent = event.systemPromptOptions.cwd;
		// More prompt folders, resolved from .pi/ like Pi's own resource paths. Each comes under a heading that names it,
		// so the model can tell that text, such as what it wrote for itself, from what its developer wrote.
		const more = ((pi.getSettings() as Settings).agentx?.systemPrompt ?? []).flatMap((folder) => {
			const dir = resolve(agent, ".pi", folder);
			const texts = prompts(dir);
			return texts.length > 0 ? [`# From ${relative(agent, dir)}`, ...texts] : [];
		});
		event.systemPromptOptions.customPrompt = [readFileSync(harnessPrompt, "utf8").trim(), fellowAgents(agent), ...prompts(join(agent, ".pi", "system_prompt")), ...more].filter(Boolean).join("\n\n");
		event.systemPromptOptions.skills = event.systemPromptOptions.skills?.filter((skill) => !skill.filePath.startsWith(homeSkills));
	});
}
