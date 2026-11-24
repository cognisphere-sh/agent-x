// `agentx webhook create|list|rotate|delete`: the agent's webhooks, URLs that outside services call to run one of its workflows. Each is kept with a
// random token in the agent's .pi/knowledge/webhooks/webhooks.json, which the coordinator's webhooks service reads on every request.

import { basename } from "node:path";
import { parseArgs } from "node:util";
import { nameRule } from "../../agent-runtime/events/queue.js";
import { agentXOf, projectConfig, publicUrl as publicUrlOf } from "../../agent-runtime/project-config.js";
import { storageOf } from "../../agent-runtime/storage.js";
import { loadWorkflows } from "../../agent-runtime/workflows/workflows.js";
import { deleteHook, hookUrl, lastLogLine, loadHooks, rotateHook, setHook } from "../../coordinator-runtime/services/webhooks/hooks.js";

const usage = `usage:
  agentx webhook create <name> --workflow <workflow> --description <text>
                           make a webhook whose requests run the workflow, and print its URL; for a name that exists, change its workflow and
                           description and keep its URL. The description says who calls it and where its URL is set
  agentx webhook list      every webhook: its URL, workflow, description and last request
  agentx webhook rotate <name>
                           give a webhook a new URL; the old one answers 404 from now on
  agentx webhook delete <name>
                           delete a webhook; its URL answers 404 from now on`;

/** Runs `agentx webhook <action> ...` in the agent directory `agentRoot`. */
export function webhook(agentRoot: string, args: string[]): void {
	const [action, ...rest] = args;
	if (action === "create") create(agentRoot, rest);
	else if (action === "list" && rest.length === 0) list(agentRoot);
	else if (action === "rotate" && rest.length === 1) rotate(agentRoot, rest[0]);
	else if (action === "delete" && rest.length === 1) remove(agentRoot, rest[0]);
	else throw new Error(usage);
}

function create(agentRoot: string, args: string[]): void {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { workflow: { type: "string" }, description: { type: "string" } } });
	const [name] = positionals;
	const { workflow, description = "" } = values;
	if (positionals.length !== 1 || workflow === undefined || description.trim() === "") throw new Error(usage);
	if (!nameRule.test(name)) throw new Error(`A webhook's name has only letters, digits and dashes: "${name}" does not.`);
	if (!loadWorkflows(agentRoot).has(workflow)) throw new Error(`This agent has no workflow "${workflow}": write it first, in .pi/knowledge/workflows/workflows.json.`);
	const publicUrl = servedAt(agentRoot);
	const { token, kept } = setHook(agentRoot, name, workflow, description);
	const url = hookUrl(publicUrl, basename(agentRoot), name, token);
	if (kept) console.log(`Changed webhook ${name}: it runs workflow ${workflow}. Its URL is the same:\n${url}`);
	else console.log(`Made webhook ${name}: it runs workflow ${workflow}. Set this URL where the service that calls it is set up:\n${url}`);
}

function list(agentRoot: string): void {
	const hooks = Object.entries(loadHooks(agentRoot));
	if (hooks.length === 0) return console.log("This agent has no webhooks.");
	const publicUrl = publicUrlOf(projectConfig(agentXOf(agentRoot)));
	for (const [name, hook] of hooks) {
		const url = publicUrl === undefined ? '(none: agentx.json has no "publicUrl")' : hookUrl(publicUrl, basename(agentRoot), name, String(hook.token));
		console.log([`${name}: ${url}`, `  workflow: ${hook.workflow}`, `  description: ${hook.description}`, `  last request: ${lastLogLine(storageOf(agentRoot), name) ?? "none"}`].join("\n"));
	}
}

function rotate(agentRoot: string, name: string): void {
	const publicUrl = servedAt(agentRoot);
	const hook = rotateHook(agentRoot, name);
	console.log(`Webhook ${name} has a new URL, and its old one answers 404. Set it where the old one was (${hook.description}):\n${hookUrl(publicUrl, basename(agentRoot), name, hook.token)}`);
}

function remove(agentRoot: string, name: string): void {
	const { description } = deleteHook(agentRoot, name);
	console.log(`Deleted webhook ${name}: its URL answers 404. If it is still set where it was (${description}), take it off there.`);
}

// The project's public address, which a webhook's URL starts with. Throws when the webhooks service cannot take requests: a person must set it up.
function servedAt(agentRoot: string): string {
	const config = projectConfig(agentXOf(agentRoot));
	const { services = {} } = config;
	const publicUrl = publicUrlOf(config);
	const setUp = 'a person sets it up in agent-x/agentx.json and restarts agentx serve: "publicUrl", the address the outside reaches agentx serve at, and "webhooks": {} under "services".';
	if (publicUrl === undefined) throw new Error(`agentx.json has no "publicUrl", so a webhook has no URL: ${setUp}`);
	if (!Object.hasOwn(services, "webhooks")) throw new Error(`agentx.json does not turn on the webhooks service, so a webhook's URL would answer 404: ${setUp}`);
	return publicUrl;
}
