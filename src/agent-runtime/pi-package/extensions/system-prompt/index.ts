// The system prompt extension, loaded by Pi into every agent from this folder's source, not from dist/.
// Sets the system prompt: harness.md (next to this file) first, then the agent's system_prompt/*.md in filename order.
// This replaces Pi's whole default prompt, including its tool list; Pi still appends the skills list and the working directory.
// Skills from ~/.agents/skills are taken off that list: Pi loads them for every project, and they are not part of the agent.

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const harnessPrompt = fileURLToPath(new URL("harness.md", import.meta.url));
const homeSkills = join(homedir(), ".agents", "skills") + sep;

export default function (pi: ExtensionAPI) {
	// Read on every run, so edits apply without /reload.
	pi.on("before_agent_start", (event) => {
		// The agent directory is Pi's cwd.
		const promptDir = join(event.systemPromptOptions.cwd, "system_prompt");
		const agentPrompts = readdirSync(promptDir)
			.filter((file) => file.endsWith(".md"))
			.sort()
			.map((file) => join(promptDir, file));
		event.systemPromptOptions.customPrompt = [harnessPrompt, ...agentPrompts]
			.map((path) => readFileSync(path, "utf8").trim())
			.join("\n\n");
		event.systemPromptOptions.skills = event.systemPromptOptions.skills?.filter((skill) => !skill.filePath.startsWith(homeSkills));
	});
}
