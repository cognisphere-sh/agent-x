// A workflow's ctx.composio: runs one Composio tool as the agent, through a Composio session made with the agent's user id and policy, as its threads get.
// A workflow has no Pi session to keep a Composio session in, so each run makes its own, at its first call, and its other calls use it too.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { policy } from "../pi/pi-package/extensions/composio/policy.js";

// Making a session waits as long as a thread's start does. A tool may take longer; the workflow's own time limit bounds it.
const sessionTimeoutMs = 10_000;

// The part of Composio's answers that is used here.
interface Answer {
	session_id?: string;
	result_type?: string;
	data?: Record<string, unknown>;
	error?: string | { message?: string } | null;
	message?: string;
	log_id?: string;
}

// This run's session: the promise, so calls made at once share one.
let session: Promise<string> | undefined;

/** Runs the Composio tool `tool` with `args` as the agent in `agentRoot`, and resolves to the tool's data. Throws when Composio is not set up, refuses, or the tool does not complete. */
export async function composioTool(agentRoot: string, tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
	session ??= makeSession(agentRoot);
	const answer = await call(`/api/v3.1/tool_router/session/${encodeURIComponent(await session)}/execute`, { tool_slug: tool, arguments: args });
	// Only "completed" is success; a failed tool can come with no error text.
	if (answer.result_type === "completed") return answer.data ?? {};
	const why = (typeof answer.error === "string" ? answer.error : undefined) || answer.message || "Composio gave no reason";
	throw new Error(`Composio tool ${tool} ${answer.result_type ?? "did not run"}: ${why}${answer.log_id ? ` (log ${answer.log_id})` : ""}`);
}

// Makes the run's session, from the agent's own settings, never from what the agent writes, and resolves to its id.
async function makeSession(agentRoot: string): Promise<string> {
	const settings = JSON.parse(readFileSync(join(agentRoot, ".pi", "settings.json"), "utf8")) as { agentx?: { composio?: { userId?: string; session?: Record<string, unknown> } } };
	const composio = settings.agentx?.composio;
	if (!composio?.userId) throw new Error("Composio is not available: the agent has no Composio user id, agentx.composio.userId in its .pi/settings.json.");
	const answer = await call("/api/v3.1/tool_router/session", { ...policy(composio.session), user_id: composio.userId }, AbortSignal.timeout(sessionTimeoutMs));
	if (!answer.session_id) throw new Error("Composio made no session.");
	return answer.session_id;
}

// A POST to Composio's API with the agent's key. COMPOSIO_BASE_URL points elsewhere, such as at a fake in tests.
async function call(path: string, body: unknown, signal?: AbortSignal): Promise<Answer> {
	const key = process.env.COMPOSIO_API_KEY;
	if (!key) throw new Error("Composio is not available: COMPOSIO_API_KEY is not set where the agent runs.");
	const response = await fetch(new URL(path, process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev"), {
		method: "POST",
		headers: { "x-api-key": key, "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	}).catch((error: unknown) => {
		throw new Error(`Composio could not be reached: ${error instanceof Error ? error.message : String(error)}.`);
	});
	const answer = (await response.json().catch(() => ({}))) as Answer;
	if (!response.ok) {
		const message = typeof answer.error === "object" && answer.error !== null ? answer.error.message : undefined;
		throw new Error(`Composio answered ${response.status}${message ? `: ${message}` : ""}.`);
	}
	return answer;
}
