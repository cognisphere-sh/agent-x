// The Composio extension, loaded by Pi into every agent session: gives the model Composio's tools, which act in external services through the agent's own accounts.
// Each thread gets a Composio session of its own, made for the agent's Composio user id (`agentx.composio.userId`) with the policy in its settings
// (`agentx.composio.session`), and the session's MCP server is registered with Pi. The thread's Pi session keeps the Composio session's id, so the
// thread finds the same Composio session when it starts again, until the settings change.
// When anything is missing or fails, such as COMPOSIO_API_KEY, the session starts without Composio tools and the model is told why.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// The custom entry in the thread's Pi session, and the custom message that tells the model why Composio is unavailable.
const customType = "agentx-composio";
// A session start waits for Composio; a Composio that does not answer must not hold the session.
const timeoutMs = 10_000;

// agentx's defaults for a session's policy. A key of the same name in `agentx.composio.session` replaces each.
// A set of common services; the agent may ask a person to connect accounts for them but may not delete one,
// and gets no remote sandbox: it has its own shell and workspace.
const defaults = {
	toolkits: { enable: ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "supabase", "hubspot", "telegram"] },
	manage_connections: { enable: true, enable_connection_removal: false },
	workbench: { enable: false },
};

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
	// A session made at this start, which the thread's Pi session does not record yet.
	let pending: Entry | undefined;

	const call = async (method: string, path: string, key: string, body?: unknown): Promise<{ status: number; session: ComposioSession }> => {
		const response = await fetch(new URL(path, base), {
			method,
			headers: { "x-api-key": key, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return { status: response.status, session: (await response.json().catch(() => ({}))) as ComposioSession };
	};
	const refusal = (status: number, session: ComposioSession) => `Composio answered ${status}${session.error?.message ? `: ${session.error.message}` : ""}.`;

	// Registers the thread's Composio session with Pi. Returns why it could not, or nothing.
	const connect = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const key = process.env.COMPOSIO_API_KEY;
		if (!key) return "COMPOSIO_API_KEY is not set where the agent runs.";
		const composio = (pi.getSettings() as Settings).agentx?.composio;
		if (!composio?.userId) return "the agent has no Composio user id: agentx.composio.userId in its .pi/settings.json.";
		const settings = JSON.stringify(composio);

		// The thread's latest Composio session, if it was made from the settings as they are.
		const entries = ctx.sessionManager.getEntries();
		const last = entries.findLast((entry) => entry.type === "custom" && entry.customType === customType);
		const kept = last?.type === "custom" ? (last.data as Entry) : undefined;
		let found = kept?.settings === settings ? await call("GET", `/api/v3.1/tool_router/session/${encodeURIComponent(kept.sessionId)}`, key) : undefined;
		if (found && found.status !== 200 && found.status !== 404) return refusal(found.status, found.session);
		if (found?.status !== 200) {
			found = await call("POST", "/api/v3.1/tool_router/session", key, { ...defaults, ...composio.session, user_id: composio.userId });
			if (found.status !== 200 && found.status !== 201) return refusal(found.status, found.session);
			if (found.session.session_id) pending = { sessionId: found.session.session_id, settings };
		}
		const url = found.session.mcp?.url;
		// The key goes only to Composio's own address, as Composio's SDK checks before it sends it.
		if (!url || new URL(url).origin !== new URL(base).origin) return `Composio gave no MCP address on ${new URL(base).origin}.`;
		// The header names the variable, so the key is not in the server's config, which every extension can read. Pi fills it in when it connects.
		// "direct": the model sees the meta tools as ordinary tools, instead of reaching them through codemode scripts.
		pi.registerMcpServer("composio", { url, headers: { "x-api-key": "${COMPOSIO_API_KEY}" }, exposure: "direct" });
		return undefined;
	};

	// Awaited, so the server is registered before the message queue extension, which the package's manifest loads after this one, starts a run:
	// Pi waits for direct servers only when a run starts.
	pi.on("session_start", async (_event, ctx) => {
		const reason = await connect(ctx).catch((error: unknown) => `Composio could not be reached: ${error instanceof Error ? error.message : String(error)}.`);
		// Goes in with the session's next message and starts nothing. The model tells a person when a task needs Composio.
		if (reason) pi.sendMessage({ customType, content: `Composio tools are unavailable in this session: ${reason}`, display: true }, { deliverAs: "nextTurn" });
	});

	// Recorded when a run starts, not when the session does: a session that does not hold its thread runs nothing, and its write would fork the conversation.
	pi.on("before_agent_start", () => {
		if (!pending) return;
		pi.appendEntry<Entry>(customType, pending);
		pending = undefined;
	});
}
