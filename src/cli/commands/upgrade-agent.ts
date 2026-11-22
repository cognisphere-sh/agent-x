// `agentx upgrade-agent <name>`: brings an agent up to the agentx the project pins: the agentx settings and the keys of its templates that the agent
// lacks, and the versions of the Pi packages it already uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentEnvFile } from "../../agent-runtime/agent-env.js";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { isAgentFolder } from "../../agent-runtime/project-config.js";
import { projectAgentX } from "../agent-root.js";
import { writeJson } from "../copy-template.js";
import { added, addMissingEnv, addMissingKeys, type Change, printChanges, templateText } from "../template-sync.js";

/** Upgrades the agent `name` of the project whose root, `agent-x/` or `agent-x/agents/` is `cwd`, and prints what changed. */
export function upgradeAgent(name: string, cwd: string): void {
	const root = join(projectAgentX(cwd), "agents", name);
	if (!nameRule.test(name) || !isAgentFolder(root)) throw new Error(`The project has no agent "${name}" with a .pi/settings.json in agent-x/agents/.`);
	printChanges(cwd, upgradeAgentFiles(root));
}

/**
 * Brings the agent in `root` up to the agent template: adds to `.pi/settings.json` each `agentx` setting it lacks, with the template's value; moves each
 * Pi package it lists that the template pins too to the template's version; and adds to its `.env` each key the template has and it does not name.
 */
export function upgradeAgentFiles(root: string): Change[] {
	const file = join(root, ".pi", "settings.json");
	const settings = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	const template = JSON.parse(templateText("agent/.pi/settings.json")) as { agentx: Record<string, unknown>; packages: string[] };
	// Only agentx's own settings come back: Pi's, such as which packages to load, are the developer's to keep or drop.
	const changes = added(file, addMissingKeys(settings, { agentx: template.agentx }));
	if (Array.isArray(settings.packages)) {
		settings.packages = settings.packages.map((source: unknown) => {
			const pinned = typeof source === "string" ? template.packages.find((other) => packageName(other) === packageName(source) && other !== source) : undefined;
			if (pinned === undefined) return source;
			changes.push([file, `${source} -> ${pinned}`]);
			return pinned;
		});
	}
	if (changes.length > 0) writeJson(file, settings);
	const env = agentEnvFile(root);
	return [...changes, ...added(env, addMissingEnv(env, templateText("agent/env")))];
}

// A Pi package source without its version: npm:@scope/name@1.2.3 -> npm:@scope/name, git:github.com/a/b@v1 -> git:github.com/a/b.
const packageName = (source: string) => source.replace(/@[^@/]*$/, "");
