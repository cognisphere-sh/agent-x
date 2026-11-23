// The webhooks service, an optional service: each agent's webhooks, URLs that outside services call when something happens, such as a call that
// ended. A request whose URL holds the hook's token goes to the workflow the hook names, with its body and headers as files; the token is the only
// check, so the workflow confirms what a request says by fetching it, such as through Composio. On when agentx.json lists it and has publicUrl.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { newId, withoutBlockTag, workflowPrefix } from "../../../agent-runtime/events/queue.js";
import { agentTimeZone, dayDateTime } from "../../../agent-runtime/time-zone.js";
import { type ApiRequest, type ApiResponse, type Route, sameText } from "../../api-server.js";
import { Service, type ServiceAgent, type ServiceContext } from "../../service.js";
import { type Hooks, hookLog, loadHooks, usableHook } from "./hooks.js";

// One answer for no such agent, no such hook and a wrong token, so a caller learns nothing from it.
const notFound: ApiResponse = { status: 404, body: { error: "Not found." } };
// A 503, so the caller sends the request again.
const notDelivered: ApiResponse = { status: 503, body: { error: "The request could not be delivered." } };

/** Each agent's webhooks: a request with a hook's token runs the workflow it names. */
export class WebhooksService extends Service {
	override readonly routes: Route[] = [
		{
			method: "POST",
			path: ":agent/:name/:token",
			access: "public",
			summary: "An agent's webhook: a request with the hook's token goes to the workflow the hook names, with its body and headers as files.",
			handle: (request: ApiRequest) => this.receive(request),
		},
	];
	private context!: ServiceContext;

	override onStart(context: ServiceContext): void {
		if (context.publicUrl === undefined) throw new Error('it needs "publicUrl" in agentx.json, the address outside services call.');
		this.context = context;
	}

	// 200 once the event is in the inbox; 503 when it cannot be, so the caller sends it again.
	private receive({ params, headers, body }: ApiRequest): ApiResponse {
		const agent = this.context.agents.find((candidate) => candidate.name === params.agent);
		if (agent === undefined) return notFound;
		let hooks: Hooks;
		try {
			hooks = loadHooks(agent.root);
		} catch (error) {
			console.error(`webhooks: ${agent.name}: ${(error as Error).message}`);
			return notDelivered;
		}
		const hook = usableHook(hooks, params.name);
		if (hook === undefined || !sameText(hook.token, params.token)) return notFound;
		try {
			const id = this.context.deliver(
				agent.name,
				{
					threadId: `${workflowPrefix}${hook.workflow}`,
					// Each request is an event of its own: a provider that sends one again sends the same id, which the workflow keys its work by.
					key: `webhook:${newId()}`,
					content: `Webhook ${params.name} was called. The request's body is in the file body, and its headers are in headers.json.`,
					metadata: { source: "webhook", webhook: params.name, "content-type": headers["content-type"] },
				},
				[
					{ name: "body", content: body },
					{ name: "headers.json", content: JSON.stringify(headers, null, "\t") },
				],
			);
			logRequest(agent, params.name, 200, `event ${id}`);
			return { status: 200, body: { event: id } };
		} catch (error) {
			this.refused(agent, params.name, (error as Error).message);
			return notDelivered;
		}
	}

	// A request the agent refuses, such as one for a workflow it no longer has, is logged and told to its main thread, once for each reason, as the scheduler tells of a fire.
	private refused(agent: ServiceAgent, name: string, why: string): void {
		logRequest(agent, name, 503, `not delivered: ${why}`);
		try {
			this.context.deliver(agent.name, {
				threadId: "main",
				key: `webhook:${name}:${why}`.slice(0, 200),
				content: [
					`Webhook \`${name}\` was called, but the request could not be delivered, so it got 503 and its caller may send it again: ${withoutBlockTag(why)}`,
					`Its log: \`${hookLog("storage", name)}\`. When its workflow is gone, give it one with \`agentx webhook create ${name} --workflow <workflow> --description <text>\`, or delete it with \`agentx webhook delete ${name}\`.`,
				].join("\n"),
				metadata: { source: "webhook", webhook: name },
			});
		} catch (error) {
			console.error(`webhooks: ${agent.name}: a request to webhook ${name} that could not be delivered could not be reported: ${(error as Error).message}`);
		}
	}
}

// Adds a line for a request to the hook's log, with the time in the agent's time zone. A log that cannot be written loses the line, not the request.
function logRequest(agent: ServiceAgent, name: string, status: number, what: string): void {
	try {
		const file = hookLog(agent.storage, name);
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${dayDateTime(Date.now(), agentTimeZone(agent.root))} ${status} ${what}\n`);
	} catch (error) {
		console.error(`webhooks: ${agent.name}: the log of webhook ${name} cannot be written: ${(error as Error).message}`);
	}
}
