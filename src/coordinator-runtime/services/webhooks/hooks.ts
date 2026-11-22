// An agent's webhooks: URLs of the coordinator that outside services call, each running one of the agent's workflows. They are listed with their
// tokens in the agent's own storage/knowledge/webhooks.json, which `agentx webhook` keeps and the webhooks service reads on every request.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** The shortest token a hook may have, so one shortened by hand cannot be guessed. `newToken` makes 43 characters. */
export const minTokenLength = 32;

/** The agent's webhooks file, in its storage folder `storage`. */
export const hooksFile = (storage: string) => join(storage, "knowledge", "webhooks.json");

/** The log of the hook `name`, a line per request, in the agent's storage folder `storage`. */
export const hookLog = (storage: string, name: string) => join(storage, "workspace", "webhook-logs", `${name}.log`);

/** A new token: 32 random bytes, which a URL carries as they are. */
export const newToken = () => randomBytes(32).toString("base64url");

/** The URL of the hook `name` of the agent `agent`, at the project's public address. */
export const hookUrl = (publicUrl: string, agent: string, name: string, token: string) => `${publicUrl.replace(/\/$/, "")}/services/webhooks/${agent}/${name}/${token}`;

/** The webhooks in the agent's storage folder `storage`, by name; none without the file. Throws when the file is not a JSON object. */
export function loadHooks(storage: string): Record<string, Partial<Hook>> {
	const file = hooksFile(storage);
	if (!existsSync(file)) return {};
	const hooks = JSON.parse(readFileSync(file, "utf8")) as unknown;
	if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) throw new Error(`${file} is not a JSON object.`);
	return hooks as Record<string, Partial<Hook>>;
}

/** Writes `hooks` to the webhooks file in the agent's storage folder `storage`. */
export const saveHooks = (storage: string, hooks: Record<string, Partial<Hook>>) => writeFileSync(hooksFile(storage), `${JSON.stringify(hooks, null, "\t")}\n`);

/** The hook `name` when it can take requests: it is in `hooks`, names a workflow and has a token long enough. */
export function usableHook(hooks: Record<string, Partial<Hook>>, name: string): Hook | undefined {
	const hook = Object.hasOwn(hooks, name) ? hooks[name] : undefined;
	if (typeof hook?.workflow !== "string" || typeof hook.token !== "string" || hook.token.length < minTokenLength) return undefined;
	return { workflow: hook.workflow, description: typeof hook.description === "string" ? hook.description : "", token: hook.token };
}
