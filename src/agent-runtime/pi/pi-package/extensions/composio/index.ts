// The Composio extension, loaded by Pi into every agent session: gives the model Composio's tools, which act in external services through the agent's own accounts.
// Each thread gets a Composio session of its own, made for the agent's Composio user id (`agentx.composio.userId`) with the policy in its settings
// (`agentx.composio.session`), and the session's MCP server is registered with Pi. The thread's Pi session keeps the Composio session's id, so the
// thread finds the same Composio session when it starts again, until the request that made it changes, with the settings or agentx's defaults.
// When anything is missing or fails, such as COMPOSIO_API_KEY, the session starts without Composio tools and the system prompt says why.
// A search's answer reaches the model trimmed (trim.ts).

import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { policy } from "./policy.js";
import { trimSearch } from "./trim.js";

// The custom entry in the thread's Pi session that records its Composio session, and the system prompt section that says why Composio is unavailable.
const customType = "agentx-composio";
const section = "composio";
// A session start waits for Composio; a Composio that does not answer must not hold the session.
const timeoutMs = 10_000;

interface Settings {
	agentx?: { composio?: { userId?: string; session?: Record<string, unknown> } };
}

// What the thread's Pi session keeps: the Composio session, and the request that made it.
interface Entry {
	sessionId: string;
	request: string;
}

// The part of Composio's session that is used here.
interface ComposioSession {
	session_id?: string;
	mcp?: { url?: string };
	error?: { message?: string };
}

/** Gives every session of the agent the tools of its thread's Composio session. */
export default function (pi: ExtensionAPI) {
	// Composio's API. COMPOSIO_BASE_URL points elsewhere, such as at a fake in tests.
	const base = process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev";
	const origin = new URL(base).origin;
	// A session made at this start, which the thread's Pi session does not record yet.
	let pending: Entry | undefined;
	// Why this session has no Composio tools, if it has none.
	let unavailable: string | undefined;

	const call = async (method: string, path: string, key: string, body?: unknown) => {
		const response = await fetch(new URL(path, base), {
			method,
			headers: { "x-api-key": key, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return { ok: response.ok, status: response.status, answer: (await response.json().catch(() => ({}))) as ComposioSession };
	};

	// Registers the thread's Composio session with Pi. Returns why it could not, or nothing.
	const connect = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const key = process.env.COMPOSIO_API_KEY;
		if (!key) return "COMPOSIO_API_KEY is not set where the agent runs.";
		const composio = (pi.getSettings() as Settings).agentx?.composio;
		if (!composio?.userId) return "the agent has no Composio user id: agentx.composio.userId in its .pi/settings.json.";
		const body = { ...policy(composio.session), user_id: composio.userId };
		const request = JSON.stringify(body);

		// The thread's latest Composio session, used again if it was made by this same request and Composio still has it. Comparing the request, not
		// the settings, means a change to agentx's defaults also makes a new session: Composio's sessions never expire, so an old policy would stay.
		const kept = ctx.sessionManager.getEntries().findLast((entry): entry is CustomEntry<Entry> => entry.type === "custom" && entry.customType === customType)?.data;
		let found = kept?.request === request ? await call("GET", `/api/v3.1/tool_router/session/${encodeURIComponent(kept.sessionId)}`, key) : undefined;
		if (!found || found.status === 404) {
			found = await call("POST", "/api/v3.1/tool_router/session", key, body);
			if (found.ok && found.answer.session_id) pending = { sessionId: found.answer.session_id, request };
		}
		if (!found.ok) return `Composio answered ${found.status}${found.answer.error?.message ? `: ${found.answer.error.message}` : ""}.`;
		const url = found.answer.mcp?.url;
		// The key goes only to Composio's own address, as Composio's SDK checks before it sends it.
		if (!url || new URL(url).origin !== origin) return `Composio gave no MCP address on ${origin}.`;
		// The header names the variable, so the key is not in the server's config, which every extension can read. Pi fills it in when it connects.
		// "direct": the model sees the meta tools as ordinary tools, instead of reaching them through codemode scripts.
		pi.registerMcpServer("composio", { url, headers: { "x-api-key": "${COMPOSIO_API_KEY}" }, exposure: "direct" });
		return undefined;
	};

	// Awaited: the event queue extension starts runs only after every session_start handler has finished, and Pi waits for direct servers
	// only when the first run starts, so the server must be registered by then.
	pi.on("session_start", async (_event, ctx) => {
		unavailable = await connect(ctx).catch((error: unknown) => `Composio could not be reached: ${error instanceof Error ? error.message : String(error)}.`);
	});

	pi.on("before_agent_start", (event) => {
		// In the system prompt, not a message: a thread that starts many times without Composio does not collect the same note in its conversation.
		// Pi gives each run fresh sections, so a session with Composio sets none.
		if (unavailable) event.systemPromptOptions.sections[section] = `Composio tools are unavailable in this session: ${unavailable}`;
		// Recorded when a run starts, not when the session does: a session that does not hold its thread runs nothing, and its write would fork the conversation.
		if (!pending) return;
		pi.appendEntry<Entry>(customType, pending);
		pending = undefined;
	});

	// Before the model reads the answer and before Pi saves it, so the session file keeps the answer as the model read it.
	pi.on("tool_result", (event) => {
		if (event.toolName !== "mcp__composio__COMPOSIO_SEARCH_TOOLS" || event.isError || event.content.length !== 1 || event.content[0].type !== "text") return;
		const text = trimSearch(event.content[0].text);
		return text === undefined ? undefined : { content: [{ type: "text", text }] };
	});
}
