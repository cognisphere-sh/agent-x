// `agentx init-agent <name>`: creates an agent in the project's agent-x/agents/ directory and lists it in agent-x/agentx.json.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { agentEnvFile } from "../../agent-runtime/agent-env.js";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { configFile, type ProjectConfig, projectConfig, saveProjectConfig } from "../../agent-runtime/project-config.js";
import { ensureStorage } from "../../agent-runtime/storage.js";
import { copyTemplate, writeJson } from "../copy-template.js";
import { projectAgentX } from "../agent-root.js";

/** Creates `agent-x/agents/<name>` from templates/agent and lists it in agentx.json. `cwd` is the project root, its agent-x/ or agent-x/agents/. */
export function initAgent(name: string, cwd: string): void {
	// The name is a folder name, so it cannot point outside agents/.
	if (!nameRule.test(name)) throw new Error(`"${name}" is not an agent name. Use letters, digits and dashes.`);
	const agentX = projectAgentX(cwd);
	const root = join(agentX, "agents", name);
	copyTemplate("agent", root);
	// The agent's identity in Composio, under which its connected accounts are kept. Written once, so renaming the agent or the project keeps its accounts.
	// Shaped like an email address, which Composio suggests for user ids; no two agents of a Composio project may share one.
	const project = basename(dirname(agentX)).replace(/[^a-zA-Z0-9-]/g, "-");
	const settingsPath = join(root, ".pi", "settings.json");
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	settings.agentx.composio = { userId: `${name}@${project}`, ...settings.agentx.composio };
	writeJson(settingsPath, settings);
	// Its state, in agent-x/storage/<name>/, which storage/ links to; neither is checked in.
	ensureStorage(root);
	// Listed with an empty description, which the developer fills in: the agents that may send to it see it. An entry already there is kept.
	const config: ProjectConfig = existsSync(configFile(agentX)) ? projectConfig(agentX) : { agents: {} };
	config.agents[name] ??= { description: "" };
	saveProjectConfig(agentX, config);
	console.log(`Created ${root}

Next:
  describe it in ${configFile(agentX)}, for the other agents
  put its keys, such as COMPOSIO_API_KEY, in ${agentEnvFile(root)}
  cd ${root} && agentx chat    # talk to the agent; agentx run runs it on its own`);
}
