// The project's agentx config, `agent-x/agentx.json`: its agents, each with what it does and the agents it may send events to.
// An agent is an agent of the project when it is listed there and has its folder in agents/. Read again each time, so an edit applies at once.
// Loaded twice, like events/queue.ts: compiled, and from source, by the system prompt extension in pi/pi-package, which Pi loads as source. So it imports only queue.ts, which ships as source too.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { nameRule } from "./events/queue.js";

/** An agent as the project's config lists it. */
export interface AgentEntry {
	/** What the agent does, in a line, for the agents that may send to it. */
	description?: string;
	/** The agents it may send events to; every other agent of the project when left out. */
	canSendTo?: string[];
}

/** The project's agentx config. */
export interface ProjectConfig {
	agents: Record<string, AgentEntry>;
}

/** The config file of the project whose `agent-x/` directory is `agentX`. */
export const configFile = (agentX: string) => join(agentX, "agentx.json");

/** The config of the project whose `agent-x/` directory is `agentX`. Throws when it cannot be read. */
export function projectConfig(agentX: string): ProjectConfig {
	const file = configFile(agentX);
	const config = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectConfig> | null;
	const agents = config?.agents;
	if (typeof agents !== "object" || agents === null || Array.isArray(agents)) throw new Error(`${file} has no "agents" object.`);
	return { ...config, agents };
}

/** Writes `config` to the project's agentx.json. */
export const saveProjectConfig = (agentX: string, config: ProjectConfig) => writeFileSync(configFile(agentX), `${JSON.stringify(config, null, "\t")}\n`);

/** Whether `dir` is an agent's folder: it holds the agent's checked-in settings. */
export const isAgentFolder = (dir: string) => existsSync(join(dir, ".pi", "settings.json"));

/** The directory of the agent `name` of the project in `agentX`; undefined when the config does not list it or its folder is missing. Throws when the config cannot be read. */
export function agentIn(agentX: string, name: string): string | undefined {
	const dir = join(agentX, "agents", name);
	return nameRule.test(name) && Object.hasOwn(projectConfig(agentX).agents, name) && isAgentFolder(dir) ? dir : undefined;
}

/** The `agent-x/` directory of the agent in `agentRoot`, which is agent-x/agents/<name>. */
export const agentXOf = (agentRoot: string) => dirname(dirname(agentRoot));

/**
 * The agents of the project that the agent in `agentRoot` may send events to, by name and description: from the config alone, which is all a sandbox will see.
 * Throws when the config cannot be read.
 */
export function canSendTo(agentRoot: string): { name: string; description: string }[] {
	const { agents } = projectConfig(agentXOf(agentRoot));
	const self = basename(agentRoot);
	const listed = agents[self]?.canSendTo;
	const names = Array.isArray(listed) ? listed.map(String) : Object.keys(agents);
	return [...new Set(names)]
		.filter((name) => name !== self && nameRule.test(name) && Object.hasOwn(agents, name))
		.sort()
		.map((name) => ({ name, description: typeof agents[name]?.description === "string" ? agents[name].description.trim() : "" }));
}
