// The Composio extension, loaded by Pi into every agent session: gives the model Composio's tools, which act in external services through the agent's own accounts.
// Each thread gets a Composio session of its own, made for the agent's Composio user id (`agentx.composio.userId`) with the policy in its settings
// (`agentx.composio.session`), and the session's MCP server is registered with Pi. The thread's Pi session keeps the Composio session's id, so the
// thread finds the same Composio session when it starts again, until the settings change.
// When anything is missing or fails, such as COMPOSIO_API_KEY, the session starts without Composio tools and the system prompt says why.

import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { policy } from "./policy.js";

// The custom entry in the thread's Pi session that records its Composio session, and the system prompt section that says why Composio is unavailable.
const customType = "agentx-composio";
const section = "composio";
// A session start waits for Composio; a Composio that does not answer must not hold the session.
const timeoutMs = 10_000;

interface Settings {
	agentx?: { composio?: { userId?: string; session?: Record<string, unknown> } };
}

// What the thread's Pi session keeps: the Composio session, and the settings it was made from.
interface Entry {
	sessionId: string;
	settings: string;
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
		return { ok: response.ok, status: response.status, session: (await response.json().catch(() => ({}))) as ComposioSession };
	};

	// Registers the thread's Composio session with Pi. Returns why it could not, or nothing.
	const connect = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const key = process.env.COMPOSIO_API_KEY;
		if (!key) return "COMPOSIO_API_KEY is not set where the agent runs.";
		const composio = (pi.getSettings() as Settings).agentx?.composio;
		if (!composio?.userId) return "the agent has no Composio user id: agentx.composio.userId in its .pi/settings.json.";
		const settings = JSON.stringify(composio);

		// The thread's latest Composio session, used again if it was made from the settings as they are and Composio still has it.
		const kept = ctx.sessionManager.getEntries().findLast((entry): entry is CustomEntry<Entry> => entry.type === "custom" && entry.customType === customType)?.data;
		let found = kept?.settings === settings ? await call("GET", `/api/v3.1/tool_router/session/${encodeURIComponent(kept.sessionId)}`, key) : undefined;
		if (!found || found.status === 404) {
			found = await call("POST", "/api/v3.1/tool_router/session", key, { ...policy(composio.session), user_id: composio.userId });
			if (found.ok && found.session.session_id) pending = { sessionId: found.session.session_id, settings };
		}
		if (!found.ok) return `Composio answered ${found.status}${found.session.error?.message ? `: ${found.session.error.message}` : ""}.`;
		const url = found.session.mcp?.url;
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
		if (unavailable) event.systemPromptOptions.sections[section] = `Composio tools are unavailable in this session: ${unavailable}`;
		else delete event.systemPromptOptions.sections[section];
		// Recorded when a run starts, not when the session does: a session that does not hold its thread runs nothing, and its write would fork the conversation.
		if (!pending) return;
		pi.appendEntry<Entry>(customType, pending);
		pending = undefined;
	});
}
