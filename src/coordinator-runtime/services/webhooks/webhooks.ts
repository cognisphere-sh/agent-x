// The webhooks service, an optional service: each agent's webhooks, URLs that outside services call when something happens, such as a call that
// ended. A request whose URL holds the hook's token goes to the workflow the hook names, with its body and headers as files; the token is the only
// check, so the workflow confirms what a request says by fetching it, such as through Composio. On when agentx.json lists it and has publicUrl.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { workflowPrefix } from "../../../agent-runtime/events/queue.js";
import { agentTimeZone, dayDateTime } from "../../../agent-runtime/time-zone.js";
import { missingWorkflow } from "../../../agent-runtime/workflows/workflows.js";
import { type ApiRequest, type ApiResponse, type Route, sameText } from "../../api-server.js";
import { Service, type ServiceAgent, type ServiceContext } from "../../service.js";
import { hookLog, loadHooks, usableHook } from "./hooks.js";

// One answer for no such agent, no such hook and a wrong token, so a caller learns nothing from it.
const notFound: ApiResponse = { status: 404, body: { error: "Not found." } };

/** Each agent's webhooks: a request with a hook's token runs the workflow it names. */
export class WebhooksService extends Service {
	override readonly routes: Route[] = [
		{
			method: "POST",
			path: ":agent/:name/:token",
			access: "public",
			summary: "An agent's webhook: a request with the hook's token goes to the workflow the hook names, with its body and headers as files.",
			handle: (request: ApiRequest) => this.safely(request),
		},
	];
	private context!: ServiceContext;

	override onStart(context: ServiceContext): void {
		if (context.publicUrl === undefined) throw new Error('it needs "publicUrl" in agentx.json, the address outside services call.');
		this.context = context;
	}

	// Nothing may throw to the API server, which would log the URL, and the token with it: an error is logged with the agent and the webhook's name only.
	private safely(request: ApiRequest): ApiResponse {
		try {
			return this.receive(request);
		} catch (error) {
			console.error(`webhooks: ${request.params.agent}: webhook ${request.params.name}: ${(error as Error).message}`);
			return { status: 500, body: { error: "The request failed." } };
		}
	}

	// 200 once the event is in the inbox; 503 when it cannot be, so the caller sends it again.
	private receive({ params, headers, body }: ApiRequest): ApiResponse {
		const agent = this.context.agents.find((candidate) => candidate.name === params.agent);
		if (agent === undefined) return notFound;
		const log = (status: number, what: string) => logRequest(agent, params.name, status, what);
		let hooks: ReturnType<typeof loadHooks>;
		try {
			hooks = loadHooks(agent.storage);
		} catch (error) {
			console.error(`webhooks: ${agent.name}: ${(error as Error).message}`);
			return { status: 503, body: { error: "The agent's webhooks cannot be read." } };
		}
		const hook = usableHook(hooks, params.name);
		if (hook === undefined || !sameText(hook.token, params.token)) return notFound;
		const threadId = `${workflowPrefix}${hook.workflow}`;
		if (missingWorkflow(agent.root, threadId) !== undefined) return this.noWorkflow(agent, params.name, hook.workflow, log);
		const folder = mkdtempSync(join(tmpdir(), "agentx-webhook-"));
		try {
			const files = [join(folder, "body"), join(folder, "headers.json")];
			writeFileSync(files[0], body);
			writeFileSync(files[1], JSON.stringify(headers, null, "\t"));
			const contentType = headers["content-type"];
			const id = this.context.deliver(
				agent.name,
				{
					threadId,
					// Each request is an event of its own: a provider that sends one again sends the same id, which the workflow keys its work by.
					key: `webhook:${randomUUID()}`,
					content: `Webhook ${params.name} was called. The request's body is in the file body, and its headers are in headers.json.`,
					metadata: { source: "webhook", webhook: params.name, ...(contentType === undefined ? {} : { "content-type": contentType }) },
				},
				files,
			);
			log(200, `event ${id}`);
			return { status: 200, body: { event: id } };
		} catch (error) {
			log(503, `not delivered: ${(error as Error).message}`);
			return { status: 503, body: { error: "The request could not be delivered." } };
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	}

	// A hook whose workflow is gone answers 503, so the caller sends again once the agent has fixed it, and tells the agent's main thread, once per hook and workflow.
	private noWorkflow(agent: ServiceAgent, name: string, workflow: string, log: (status: number, what: string) => void): ApiResponse {
		log(503, `no workflow "${workflow}"`);
		try {
			this.context.deliver(agent.name, {
				threadId: "main",
				key: `webhook:${name}:no-workflow:${workflow}`,
				content: [
					`Webhook \`${name}\` was called, but its workflow \`${workflow}\` is gone, so the request got 503 and its caller may send it again. Its log: \`${hookLog("storage", name)}\`.`,
					`Give the hook a workflow with \`agentx webhook create ${name} --workflow <workflow> --description <text>\`, or delete it with \`agentx webhook delete ${name}\`.`,
				].join("\n"),
				metadata: { source: "webhook", webhook: name },
			});
		} catch (error) {
			console.error(`webhooks: ${agent.name}: the missing workflow of webhook ${name} could not be reported: ${(error as Error).message}`);
		}
		return { status: 503, body: { error: "The request could not be delivered." } };
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
