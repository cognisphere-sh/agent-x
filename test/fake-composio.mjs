// A stand-in for Composio on 127.0.0.1: its session routes, and each session's MCP endpoint with two meta tools, so tests run real Pi sessions against it.
// The MCP endpoint answers JSON-RPC over HTTP POST with plain JSON, as the Streamable HTTP transport allows, and refuses GET, as Composio's does.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const key = "test-composio-key";
const tools = ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MANAGE_CONNECTIONS"].map((name) => ({ name, description: `The fake ${name}.`, inputSchema: { type: "object", properties: {} } }));

/**
 * Starts the fake on a free port. `env` is what a Pi process needs to use it. `created` collects the body of each session it creates,
 * `sessions` maps session ids to them, `mcpKeys` collects the x-api-key of each MCP request. `delayMs` delays session routes; `refuse` makes them answer 401.
 */
export async function startFakeComposio() {
	const fake = { created: [], sessions: new Map(), mcpKeys: [], delayMs: 0, refuse: false };
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", async () => {
			const send = (status, value) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(value));
			};
			const session = (id) => ({ session_id: id, mcp: { type: "http", url: `${fake.url}/tool_router/${id}/mcp` }, config: fake.sessions.get(id) });
			const path = request.url ?? "";
			if (path.endsWith("/mcp")) {
				fake.mcpKeys.push(request.headers["x-api-key"]);
				if (request.method !== "POST") return send(405, { error: "GET is not supported" });
				const rpc = JSON.parse(body);
				if (rpc.id === undefined) {
					response.writeHead(202).end();
					return;
				}
				const result =
					rpc.method === "initialize"
						? { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-composio", version: "1.0.0" } }
						: rpc.method === "tools/list"
							? { tools }
							: rpc.method === "tools/call"
								? { content: [{ type: "text", text: `ran ${rpc.params.name}` }] }
								: {};
				return send(200, { jsonrpc: "2.0", id: rpc.id, result });
			}
			await new Promise((resolve) => setTimeout(resolve, fake.delayMs));
			if (fake.refuse || request.headers["x-api-key"] !== key) return send(401, { error: { message: "Invalid API key", code: 401, status: 401 } });
			const id = /\/api\/v3\.1\/tool_router\/session\/([\w-]+)$/.exec(path)?.[1];
			if (request.method === "POST" && path === "/api/v3.1/tool_router/session") {
				const created = `trs_${randomBytes(6).toString("hex")}`;
				const config = JSON.parse(body);
				fake.created.push(config);
				fake.sessions.set(created, config);
				return send(201, session(created));
			}
			if (request.method === "GET" && id) {
				return fake.sessions.has(id) ? send(200, session(id)) : send(404, { error: { message: "Session not found", code: 404, status: 404 } });
			}
			send(404, { error: { message: `No route ${request.method} ${path}` } });
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	fake.url = `http://127.0.0.1:${server.address().port}`;
	fake.env = { COMPOSIO_API_KEY: key, COMPOSIO_BASE_URL: fake.url };
	fake.close = () => new Promise((resolve) => server.close(resolve));
	return fake;
}
