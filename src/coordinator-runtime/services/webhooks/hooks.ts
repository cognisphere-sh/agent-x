// An agent's webhooks: URLs of the coordinator that outside services call, each running one of the agent's workflows. They are listed with their
// tokens in the agent's own storage/knowledge/webhooks.json, which `agentx webhook` keeps and the webhooks service reads on every request.

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One webhook of an agent. */
export interface Hook {
	/** The workflow each request runs. */
	workflow: string;
	/** Who calls it and where its URL is set, so the agent can take it off there. */
	description: string;
	/** The secret part of its URL. */
	token: string;
}

/** The agent's webhooks by name, as its file holds them: an edit by hand may leave a field out. */
export type Hooks = Record<string, Partial<Hook>>;

// The shortest token a hook may have, so one shortened by hand cannot be guessed. A new one has 43 characters.
const minTokenLength = 32;

const hooksFile = (storage: string) => join(storage, "knowledge", "webhooks.json");

const saveHooks = (storage: string, hooks: Hooks) => writeFileSync(hooksFile(storage), `${JSON.stringify(hooks, null, "\t")}\n`);

// 32 random bytes, which a URL carries as they are.
const newToken = () => randomBytes(32).toString("base64url");

/** The log of the hook `name`, a line per request, in the agent's storage folder `storage`. */
export const hookLog = (storage: string, name: string) => join(storage, "workspace", "webhook-logs", `${name}.log`);

/** The URL of the hook `name` of the agent `agent`, at the project's public address. */
export const hookUrl = (publicUrl: string, agent: string, name: string, token: string) => `${publicUrl.replace(/\/$/, "")}/services/webhooks/${agent}/${name}/${token}`;

/** The webhooks in the agent's storage folder `storage`; none without the file. Throws when the file is not a JSON object. */
export function loadHooks(storage: string): Hooks {
	const file = hooksFile(storage);
	if (!existsSync(file)) return {};
	const hooks = JSON.parse(readFileSync(file, "utf8")) as unknown;
	if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) throw new Error(`${file} is not a JSON object.`);
	return hooks as Hooks;
}

/** The hook `name` when it can take requests: it is in `hooks`, names a workflow and has a token long enough. */
export function usableHook(hooks: Hooks, name: string): Hook | undefined {
	const hook = Object.hasOwn(hooks, name) ? hooks[name] : undefined;
	return typeof hook?.workflow === "string" && typeof hook.token === "string" && hook.token.length >= minTokenLength ? (hook as Hook) : undefined;
}

/** Makes the hook `name`, or gives the one of that name `workflow` and `description` and keeps its token, so its URL stays. Returns its token and whether it was kept. */
export function setHook(storage: string, name: string, workflow: string, description: string): { token: string; kept: boolean } {
	const hooks = loadHooks(storage);
	const old = Object.hasOwn(hooks, name) ? hooks[name].token : undefined;
	const token = typeof old === "string" && old.length >= minTokenLength ? old : newToken();
	hooks[name] = { workflow, description, token };
	saveHooks(storage, hooks);
	return { token, kept: token === old };
}

/** Gives the hook `name` a new token, so its old URL stops at once, and returns it. Throws when there is no such hook. */
export function rotateHook(storage: string, name: string): Partial<Hook> & { token: string } {
	const hooks = loadHooks(storage);
	const hook = { ...existing(hooks, name), token: newToken() };
	hooks[name] = hook;
	saveHooks(storage, hooks);
	return hook;
}

/** Deletes the hook `name` and returns it. Throws when there is no such hook. */
export function deleteHook(storage: string, name: string): Partial<Hook> {
	const hooks = loadHooks(storage);
	const hook = existing(hooks, name);
	delete hooks[name];
	saveHooks(storage, hooks);
	return hook;
}

/** The last line of the hook `name`'s log, or undefined when it has none. Read from the end, since nothing prunes the log. */
export function lastLogLine(storage: string, name: string): string | undefined {
	const file = hookLog(storage, name);
	if (!existsSync(file)) return undefined;
	const fd = openSync(file, "r");
	try {
		const size = fstatSync(fd).size;
		const tail = Buffer.alloc(Math.min(size, 4096));
		readSync(fd, tail, 0, tail.length, size - tail.length);
		return tail.toString("utf8").trimEnd().split("\n").at(-1);
	} finally {
		closeSync(fd);
	}
}

function existing(hooks: Hooks, name: string): Partial<Hook> {
	if (!Object.hasOwn(hooks, name)) throw new Error(`This agent has no webhook "${name}". agentx webhook list shows its webhooks.`);
	return hooks[name];
}
