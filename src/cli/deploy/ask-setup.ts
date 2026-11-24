// What a project lacks to run, which `agentx dev` and `agentx server` ask a person for before they start it: each agent's model login, the agents'
// keys, and the secrets of the coordinator's services. The coordinator's API token is made. Without a terminal, it lists what is missing and goes on.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { agentEnvFile, readEnvFile } from "../../agent-runtime/agent-env.js";
import { hasModelLogin, modelProvider } from "../../agent-runtime/pi/model-login.js";
import type { Coordinator } from "../../coordinator-runtime/coordinator.js";
import { isSecret } from "../../coordinator-runtime/service.js";
import { chatAgent } from "../commands/chat.js";
import { answer, confirmed } from "../confirmed.js";
import { templateText, variables } from "../template-sync.js";

// A key an env file lacks, and what it is for.
interface Key {
	file: string;
	variable: string;
	why: string;
}

/** Asks for each login and key the project in `agentX` lacks, for the agents and services `coordinator` would run, and writes each key into its env file. */
export async function askSetup(agentX: string, coordinator: Coordinator): Promise<void> {
	const terminal = process.stdin.isTTY === true;
	const shown = (file: string) => relative(dirname(agentX), file);
	for (const { agent, root } of coordinator.agents) {
		const provider = modelProvider(root);
		if (provider === undefined) console.error(`Agent "${agent}" names no model provider (defaultProvider in its .pi/settings.json), so its login is not checked.`);
		else if (!(await hasModelLogin(root, provider))) {
			const missing = `Agent "${agent}" has no ${provider} login, so it cannot think.`;
			if (!terminal) console.error(`${missing} Log in with: cd ${shown(root)} && agentx chat auth login ${provider}`);
			// Agents share the project's login, so the next agent with this provider is ready once this one logs in. Over SSH, no browser opens here:
			// Pi signs in another way, such as with a pasted address.
			else if (await confirmed(`${missing} Log in now? (y/n) `)) {
				chatAgent(root, ["auth", "login", provider, ...(process.env.SSH_CONNECTION ? ["--no-browser"] : [])]);
			}
		}
	}

	// The API token is the coordinator's own, which no person needs to choose.
	const projectEnv = join(agentX, ".env");
	if (!process.env.AGENTX_API_TOKEN && !readEnvFile(projectEnv).AGENTX_API_TOKEN) {
		setEnv(projectEnv, "AGENTX_API_TOKEN", randomBytes(32).toString("hex"));
		console.log(`Made AGENTX_API_TOKEN, the token of agentx serve's API, in ${shown(projectEnv)}.`);
	}

	for (const { file, variable, why } of await missingKeys(agentX, coordinator)) {
		if (!terminal) {
			console.error(`${variable} is not set in ${shown(file)}: ${why}`);
			continue;
		}
		console.log(`\n${why}`);
		const value = await answer(`${variable}, for ${shown(file)} (empty to skip): `);
		if (value === undefined) throw new Error("Stopped: nothing was started.");
		setEnv(file, variable, value);
	}
}

// The keys each agent's template names, and the secrets the services that would start need, that the environment does not set and the env files do
// not answer. A key answered empty, as when a person skipped it, is not asked again.
async function missingKeys(agentX: string, coordinator: Coordinator): Promise<Key[]> {
	const agentTemplate = templateText("agent/env");
	const projectTemplate = templateText("project/agent-x/env");
	const agentKeys = [...variables(agentTemplate)].map((variable) => ({ variable, why: explanation(agentTemplate, variable) ?? "The agent needs it." }));
	const keys: Key[] = coordinator.agents.flatMap(({ root }) => agentKeys.map((key) => ({ ...key, file: agentEnvFile(root) })));
	for (const { service, secret, variable } of await coordinator.secretsNeeded()) {
		keys.push({ file: join(agentX, ".env"), variable, why: explanation(projectTemplate, secret) ?? `The service "${service}" needs it.` });
	}
	const unique = keys.filter((key, at) => keys.findIndex((other) => other.file === key.file && other.variable === key.variable) === at);
	return unique.filter(({ file, variable }) => !process.env[variable] && !Object.hasOwn(readEnvFile(file), variable));
}

// What the env template `template` says of the secret `secret`, or of the first variable that starts with it when it is one per agent (`PREFIX*`):
// the comment of its paragraph, without the commented-out line that names it.
function explanation(template: string, secret: string): string | undefined {
	const paragraph = template.split(/\n\s*\n/).find((text) => [...variables(text)].some((name) => isSecret(secret, name)));
	if (paragraph === undefined) return undefined;
	return paragraph
		.split("\n")
		.filter((line) => variables(line).size === 0)
		.map((line) => line.replace(/^#\s?/, "").trim())
		.filter(Boolean)
		.join(" ");
}

// Sets `variable` to `value` in the env file `file`: on the line that sets it or names it in a comment, else on a new line at the end.
function setEnv(file: string, variable: string, value: string): void {
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	const line = new RegExp(`^#?\\s*${variable}=.*$`, "m");
	const set = `${variable}=${value}`;
	writeFileSync(file, line.test(text) ? text.replace(line, () => set) : `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${set}\n`);
}
