// A stand-in for Composio on 127.0.0.1: its session routes, and each session's MCP endpoint with two meta tools, so tests run real Pi sessions against it;
// and the auth config and connected account routes the coordinator calls, which take only the coordinator's key.
// The MCP endpoint answers JSON-RPC over HTTP POST with plain JSON, as the Streamable HTTP transport allows, and refuses GET, as Composio's does.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const key = "test-composio-key";
const coordinatorKey = "test-coordinator-key";
const tools = ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MANAGE_CONNECTIONS"].map((name) => ({ name, description: `The fake ${name}.`, inputSchema: { type: "object", properties: {} } }));
const results = {
	initialize: (params) => ({ protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-composio", version: "1.0.0" } }),
	"tools/list": () => ({ tools }),
	"tools/call": (params) => ({ content: [{ type: "text", text: `ran ${params.name}` }] }),
};

/**
 * Starts the fake on a free port. `env` is what a Pi process needs to use it. `created` collects the body of each session it creates,
 * `sessions` holds the ids of those it still has, `mcpKeys` collects the x-api-key of each MCP request. `delayMs` delays session routes; `refuse` makes them answer 401.
 * `authConfigs` and `accounts` hold the auth configs and connected accounts the coordinator's key made, an account with the bot token it was given as
 * `token`. `reset()` forgets all of that.
 */
export async function startFakeComposio() {
	const fake = {
		reset() {
			Object.assign(fake, { created: [], sessions: new Set(), mcpKeys: [], delayMs: 0, refuse: false, authConfigs: [], accounts: [] });
		},
	};
	fake.reset();
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", async () => {
			const send = (status, value) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(value));
			};
			const session = (id) => ({ session_id: id, mcp: { url: `${fake.url}/tool_router/${id}/mcp` } });
			const path = request.url ?? "";
			if (path.endsWith("/mcp")) {
				fake.mcpKeys.push(request.headers["x-api-key"]);
				if (request.method !== "POST") return send(405, { error: "GET is not supported" });
				const rpc = JSON.parse(body);
				if (rpc.id === undefined) return response.writeHead(202).end();
				return send(200, { jsonrpc: "2.0", id: rpc.id, result: results[rpc.method]?.(rpc.params) ?? {} });
			}
			await new Promise((resolve) => setTimeout(resolve, fake.delayMs));
			if (/^\/api\/v3\.1\/(auth_configs|connected_accounts)/.test(path)) {
				if (fake.refuse || request.headers["x-api-key"] !== coordinatorKey) return send(401, { error: { message: "Invalid API key" } });
				return send(...accountRoute(fake, request.method, new URL(path, fake.url), body));
			}
			if (fake.refuse || request.headers["x-api-key"] !== key) return send(401, { error: { message: "Invalid API key" } });
			if (request.method === "POST" && path === "/api/v3.1/tool_router/session") {
				const id = `trs_${randomBytes(6).toString("hex")}`;
				fake.created.push(JSON.parse(body));
				fake.sessions.add(id);
				return send(201, session(id));
			}
			const id = /\/api\/v3\.1\/tool_router\/session\/([\w-]+)$/.exec(path)?.[1];
			if (request.method === "GET" && id && fake.sessions.has(id)) return send(200, session(id));
			send(404, { error: { message: "Not found" } });
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	fake.url = `http://127.0.0.1:${server.address().port}`;
	fake.env = { COMPOSIO_API_KEY: key, COMPOSIO_BASE_URL: fake.url };
	fake.coordinatorKey = coordinatorKey;
	fake.close = () => new Promise((resolve) => server.close(resolve));
	return fake;
}

// Answers a call to the auth config and connected account routes, as [status, body]. An alias is unique per user id and toolkit, as in Composio.
function accountRoute(fake, method, url, body) {
	const given = body ? JSON.parse(body) : {};
	const toolkit = (config) => config.toolkit.slug;
	if (method === "GET" && url.pathname === "/api/v3.1/auth_configs") return [200, { items: fake.authConfigs.filter((config) => toolkit(config) === url.searchParams.get("toolkit_slug")) }];
	if (method === "POST" && url.pathname === "/api/v3.1/auth_configs") {
		const config = { id: `ac_${fake.authConfigs.length + 1}`, toolkit: given.toolkit, status: "ENABLED", auth_scheme: given.auth_config.authScheme, is_enabled_for_tool_router: given.auth_config.is_enabled_for_tool_router ?? false };
		fake.authConfigs.push(config);
		return [201, { toolkit: given.toolkit, auth_config: { id: config.id, auth_scheme: config.auth_scheme } }];
	}
	if (method === "GET" && url.pathname === "/api/v3.1/connected_accounts") {
		const users = url.searchParams.get("user_ids")?.split(",");
		return [200, { items: fake.accounts.filter((account) => (!users || users.includes(account.user_id)) && toolkit(account) === url.searchParams.get("toolkit_slugs")) }];
	}
	if (method === "POST" && url.pathname === "/api/v3.1/connected_accounts") {
		const config = fake.authConfigs.find((found) => found.id === given.auth_config.id);
		if (config === undefined) return [404, { error: { message: "Auth config not found" } }];
		const { user_id, alias, state } = given.connection;
		if (alias && fake.accounts.some((account) => account.user_id === user_id && toolkit(account) === toolkit(config) && account.alias === alias)) return [400, { error: { message: `Alias "${alias}" is already in use` } }];
		const account = { id: `ca_${fake.accounts.length + 1}_${randomBytes(3).toString("hex")}`, user_id, alias, status: state.val.status, toolkit: config.toolkit, auth_config: { id: config.id }, token: state.val.generic_api_key };
		fake.accounts.push(account);
		return [201, { id: account.id, status: account.status }];
	}
	const id = /^\/api\/v3\.1\/connected_accounts\/([\w-]+)$/.exec(url.pathname)?.[1];
	if (method === "DELETE" && fake.accounts.some((account) => account.id === id)) {
		fake.accounts = fake.accounts.filter((account) => account.id !== id);
		return [200, { success: true }];
	}
	return [404, { error: { message: "Not found" } }];
}
