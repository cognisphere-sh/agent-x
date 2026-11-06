// Replaces Pi's default system prompt preamble with system_prompt/*.md, joined in filename order.
// Pi still appends tool descriptions, the skills list and the working directory after it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const promptDir = fileURLToPath(new URL("../system_prompt", import.meta.url));

export default function (pi: ExtensionAPI) {
	// Read on every run, so edits apply without /reload.
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.customPrompt = readdirSync(promptDir)
			.filter((file) => file.endsWith(".md"))
			.sort()
			.map((file) => readFileSync(join(promptDir, file), "utf8").trim())
			.join("\n\n");
	});
}
