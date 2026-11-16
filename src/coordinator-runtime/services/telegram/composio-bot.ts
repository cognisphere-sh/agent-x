// Connects an agent's Telegram bot in Composio, for the agent's Composio user id, so Composio's Telegram tools send as that bot. The Telegram service
// calls it at start with the coordinator's Composio key: the agents' own key may only make sessions, and cannot connect accounts.

import { createHmac } from "node:crypto";

// Marks the accounts the service connects, so it changes only its own and leaves alone one a person connected. Composio keeps an alias unique per user id and toolkit.
const aliasPrefix = "agentx-telegram-";

/** Composio's API, with the coordinator's key. */
export interface ComposioApi {
	base: string;
	key: string;
}

// The parts of a connected account the service reads.
interface Account {
	id: string;
	alias?: string | null;
	status?: string;
}

/**
 * Makes `token` the bot of the Telegram account the service keeps for `userId`. The account's alias is made from the token, so a start with the same
 * token changes nothing, and a new token replaces the account of the old one.
 */
export async function connectBot(composio: ComposioApi, userId: string, token: string): Promise<void> {
	const alias = aliasPrefix + createHmac("sha256", token).update("agentx composio alias").digest("hex").slice(0, 16);
	const query = new URLSearchParams({ user_ids: userId, toolkit_slugs: "telegram", limit: "100" });
	const { items } = (await call(composio, "GET", `/api/v3.1/connected_accounts?${query}`)) as { items: Account[] };
	const current = (account: Account) => account.alias === alias && account.status === "ACTIVE";
	// The accounts of an earlier token, and one of this token that is not active, which would hold its alias.
	for (const account of items) if (account.alias?.startsWith(aliasPrefix) && !current(account)) await call(composio, "DELETE", `/api/v3.1/connected_accounts/${account.id}`);
	if (items.some(current)) return;
	const connection = { user_id: userId, alias, state: { authScheme: "API_KEY", val: { status: "ACTIVE", generic_api_key: token } } };
	await call(composio, "POST", "/api/v3.1/connected_accounts", { auth_config: { id: await authConfig(composio) }, connection });
}

// The project's auth config for Telegram's bot tokens: an enabled one there is that sessions use, else a new one. Composio manages none for Telegram,
// and a session that names no auth config uses only the accounts under one with `is_enabled_for_tool_router`, as one made in Composio's dashboard is.
async function authConfig(composio: ComposioApi): Promise<string> {
	type Config = { id: string; status?: string; auth_scheme?: string; is_enabled_for_tool_router?: boolean };
	const { items } = (await call(composio, "GET", "/api/v3.1/auth_configs?toolkit_slug=telegram")) as { items: Config[] };
	const found = items.find((config) => config.status === "ENABLED" && config.auth_scheme === "API_KEY" && config.is_enabled_for_tool_router === true);
	if (found !== undefined) return found.id;
	const created = (await call(composio, "POST", "/api/v3.1/auth_configs", {
		toolkit: { slug: "telegram" },
		auth_config: { type: "use_custom_auth", authScheme: "API_KEY", name: "Telegram bots (agentx)", credentials: {}, is_enabled_for_tool_router: true },
	})) as { auth_config: { id: string } };
	return created.auth_config.id;
}

// Calls Composio's API, giving up after 10 seconds, and returns its answer; throws Composio's message for a failure.
async function call(composio: ComposioApi, method: string, path: string, body?: object): Promise<unknown> {
	const response = await fetch(`${composio.base}${path}`, {
		method,
		headers: { "x-api-key": composio.key, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});
	const answer = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
	if (!response.ok) throw new Error(`Composio's ${method} ${path.split("?")[0]}: ${answer?.error?.message ?? `answered ${response.status}`}`);
	return answer;
}
