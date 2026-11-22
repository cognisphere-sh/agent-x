// The Composio service, a core service: Composio's webhook. Composio sends every trigger event of the Composio project to one URL, signed with the
// project's secret; the service checks the signature and delivers each event to the agent whose Composio user id the trigger was made for. On only
// when COMPOSIO_WEBHOOK_SECRET is set.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentTimeZone, dayDateTime } from "../../../agent-runtime/time-zone.js";
import type { ApiRequest, ApiResponse, Route } from "../../api-server.js";
import { Service, type ServiceContext } from "../../service.js";
import { composioUserId } from "./composio-user-id.js";

// How far a request's timestamp may be from now, as Composio's SDK allows, so a request recorded and sent again later is refused.
const toleranceSeconds = 300;

// The parts of Composio's V3 event the service reads.
interface ComposioEvent {
	type?: unknown;
	timestamp?: unknown;
	metadata?: { trigger_slug?: unknown; trigger_id?: unknown; connected_account_id?: unknown; user_id?: unknown };
	data?: unknown;
}

/** Composio's webhook: each trigger event, signed with COMPOSIO_WEBHOOK_SECRET, goes into the inbox of the agent whose `agentx.composio.userId` it names. */
export class ComposioService extends Service {
	override readonly secrets = ["COMPOSIO_WEBHOOK_SECRET"];
	override readonly routes: Route[] = [
		{
			method: "POST",
			path: "webhook",
			access: "public",
			summary: "Composio's trigger events, signed with COMPOSIO_WEBHOOK_SECRET; each goes to the agent whose Composio user id it names.",
			handle: (request: ApiRequest) => this.receive(request),
		},
	];
	private context!: ServiceContext;
	private secret = "";

	override onStart(context: ServiceContext): void {
		const secret = context.secrets.COMPOSIO_WEBHOOK_SECRET;
		if (!secret) throw new Error("COMPOSIO_WEBHOOK_SECRET is not set, in the environment or agent-x/.env.services.");
		this.context = context;
		this.secret = secret;
	}

	// 200 for an event delivered and for one to ignore, which Composio would only send again; 503 when it cannot be written, so Composio sends it again.
	private receive({ headers, body }: ApiRequest): ApiResponse {
		const id = signedId(this.secret, headers, body);
		if (id === undefined) return { status: 401, body: { error: "The request is not signed with COMPOSIO_WEBHOOK_SECRET, or is too old." } };
		const ignore = (why: string): ApiResponse => {
			console.error(`composio: event ${id} is ignored: ${why}`);
			return { status: 200, body: { ignored: why } };
		};
		let event: ComposioEvent;
		try {
			event = JSON.parse(body.toString("utf8")) as ComposioEvent;
		} catch {
			return ignore("its body is not JSON.");
		}
		if (event?.type !== "composio.trigger.message") return ignore(`its type is ${JSON.stringify(event?.type)}.`);
		const { trigger_slug: trigger, trigger_id: triggerId, connected_account_id: account, user_id: userId } = event.metadata ?? {};
		const agent = typeof userId === "string" ? this.context.agents.find((candidate) => composioUserId(candidate.root) === userId) : undefined;
		if (agent === undefined) return ignore(`no agent has Composio user id ${JSON.stringify(userId)}.`);
		// Composio gives the event's time in UTC; the agent reads every time in its own time zone. One that does not parse goes in as it is.
		const sentAt = Date.parse(String(event.timestamp));
		const eventTime = Number.isNaN(sentAt) ? event.timestamp : dayDateTime(sentAt, agentTimeZone(agent.root));
		// Composio's data can be large, as a raw email, so it goes in as a file the agent reads when it needs to.
		const folder = mkdtempSync(join(tmpdir(), "agentx-composio-"));
		try {
			const data = join(folder, "data.json");
			writeFileSync(data, JSON.stringify(event.data ?? null, null, "\t"));
			const delivered = this.context.deliver(
				agent.name,
				{
					key: `composio:${id}`,
					content: `Composio trigger ${String(trigger)} fired. Its event's data is in data.json.`,
					metadata: { source: "composio", trigger, "trigger-id": triggerId, account, "event-time": eventTime },
				},
				[data],
			);
			return { status: 200, body: { event: delivered } };
		} catch (error) {
			console.error(`composio: event ${id} for agent ${agent.name} was not delivered, and Composio sends it again: ${(error as Error).message}`);
			return { status: 503, body: { error: "The event could not be delivered." } };
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	}
}

// The request's webhook-id when it is signed with `secret` within the tolerance: any `v1,<base64>` value of webhook-signature, which may hold several
// separated by spaces, is the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`, keyed with the secret's text as it is.
function signedId(secret: string, headers: IncomingHttpHeaders, body: Buffer): string | undefined {
	const [id, timestamp, signatures] = ["webhook-id", "webhook-timestamp", "webhook-signature"].map((name) => headers[name]);
	if (typeof id !== "string" || typeof timestamp !== "string" || typeof signatures !== "string") return undefined;
	if (!(Math.abs(Date.now() / 1000 - Number(timestamp)) <= toleranceSeconds)) return undefined;
	const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.`).update(body).digest();
	const matches = signatures.split(" ").some((signature) => {
		const [version, value = ""] = signature.split(",");
		const given = Buffer.from(value, "base64");
		return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
	});
	return matches ? id : undefined;
}
