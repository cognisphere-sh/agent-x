// The coordinator's API server: one HTTP server for the coordinator's own routes and every service's, each declared as a Route. A private route needs
// the API token, which only the project's own systems hold, such as the web app's server. A public route is open: one that must know its caller, such
// as a webhook, checks the caller's signature or token itself. People are never authenticated here: the web app does that, and calls with the token.

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** A route of the API, the coordinator's or a service's. */
export interface Route {
	method: "GET" | "POST";
	/** Its path, such as `agents/:agent/stop`; a segment that starts with `:` is a parameter. A service's routes are below `services/<name>/`. */
	path: string;
	/** Who may call it. `private`, the default: the project's own systems, with the API token. `public`: anyone; a webhook checks its caller itself. */
	access?: "private" | "public";
	/** What it does, in a line, for `GET /routes`. */
	summary: string;
	handle(request: ApiRequest): ApiResponse | Promise<ApiResponse>;
}

/** A request, with the parameters its route's path names. */
export interface ApiRequest {
	params: Record<string, string>;
	headers: IncomingHttpHeaders;
	body: Buffer;
}

/** An answer, sent as JSON. */
export interface ApiResponse {
	status: number;
	body?: unknown;
}

// The largest request body a route is given.
const maxBody = 1024 * 1024;

/** The API server, for the routes it is given. */
export class ApiServer {
	private readonly server: Server = createServer((request, response) => void this.handle(request, response));
	private routes: Route[] = [];
	private token: string | undefined;

	/** Serves `routes` on `host`:`port`, with `token` as the API token; resolves to the address. Without a token, private routes answer 503. */
	async listen(host: string, port: number, routes: Route[], token: string | undefined): Promise<string> {
		this.routes = routes;
		this.token = token;
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(port, host, resolve);
		});
		const address = this.server.address();
		return typeof address === "object" && address !== null ? `http://${host}:${address.port}` : String(address);
	}

	/** Stops taking requests; resolves when the open ones have ended. */
	close(): Promise<void> {
		return new Promise((resolve) => this.server.close(() => resolve()));
	}

	// Whatever goes wrong answers 500, never ends the coordinator.
	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const { status, body } = await this.answer(request);
			response.writeHead(status, { "content-type": "application/json" }).end(body === undefined ? "" : JSON.stringify(body));
		} catch (error) {
			console.error(`${request.method} ${request.url}: ${(error as Error).message}`);
			if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "The request failed." }));
		}
	}

	private async answer(request: IncomingMessage): Promise<ApiResponse> {
		const segments = new URL(request.url ?? "/", "http://coordinator").pathname.split("/").filter(Boolean);
		const matches = this.routes.flatMap((route) => {
			const params = match(route.path, segments);
			return params === undefined ? [] : [{ route, params }];
		});
		if (matches.length === 0) return { status: 404, body: { error: "Not found." } };
		const found = matches.find(({ route }) => route.method === request.method);
		if (found === undefined) return { status: 405, body: { error: `Only ${matches.map(({ route }) => route.method).join(", ")}.` } };
		if ((found.route.access ?? "private") === "private") {
			if (this.token === undefined) return { status: 503, body: { error: "No API token is set: set AGENTX_API_TOKEN in agent-x/.env.services." } };
			if (!sameText(request.headers.authorization ?? "", `Bearer ${this.token}`)) return { status: 401, body: { error: "This route needs the API token." } };
		}
		const body = await readBody(request);
		if (body === undefined) return { status: 413, body: { error: "The body is larger than 1 MB." } };
		return found.route.handle({ params: found.params, headers: request.headers, body });
	}
}

// The parameters of `segments` by the route path `pattern`, or undefined when it does not match.
function match(pattern: string, segments: string[]): Record<string, string> | undefined {
	const parts = pattern.split("/").filter(Boolean);
	if (parts.length !== segments.length) return undefined;
	const params: Record<string, string> = {};
	for (const [i, part] of parts.entries()) {
		if (part.startsWith(":")) params[part.slice(1)] = segments[i];
		else if (part !== segments[i]) return undefined;
	}
	return params;
}

/** Whether `a` and `b` are the same text, compared in constant time, so the answer's timing tells nothing of a token. */
export function sameText(a: string, b: string): boolean {
	const digest = (text: string) => createHash("sha256").update(text).digest();
	return timingSafeEqual(digest(a), digest(b));
}

// The request's body, or undefined when it is larger than `maxBody`. It is read to its end either way, so the answer reaches the client.
async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size <= maxBody) chunks.push(chunk);
	}
	return size > maxBody ? undefined : Buffer.concat(chunks);
}
