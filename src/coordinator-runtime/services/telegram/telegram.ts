// The Telegram service, an optional one: each agent that `services.telegram` in agentx.json lists gets a Telegram bot. At start it points each bot's
// webhook at the bot's route, and connects the bot in Composio for the agent's Composio user id; each message from a chat the agent lists goes into its
// inbox, with the message's files downloaded into the event. The agent answers with Composio's Telegram tools, which send as its bot.

import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { withoutBlockTag } from "../../../agent-runtime/events/queue.js";
import { type ApiRequest, type ApiResponse, type Route, sameText } from "../../api-server.js";
import { Service, type ServiceContext } from "../../service.js";
import { composioUserId } from "../composio/composio-user-id.js";
import { connectBot } from "./composio-bot.js";

// Each agent's bot token is a variable of its own: TELEGRAM_BOT_TOKEN_MAIN for the agent main, TELEGRAM_BOT_TOKEN_MY_AGENT for my-agent.
const tokenPrefix = "TELEGRAM_BOT_TOKEN_";

// An agent's bot.
interface Bot {
	agent: string;
	token: string;
	// The chats the agent takes messages from, by id.
	chats: string[];
	// What Telegram sends in X-Telegram-Bot-Api-Secret-Token, made from the token, so it needs no setting of its own and only the token's holder knows it.
	secret: string;
	// The agent's Composio user id, which the bot is connected for.
	userId?: string;
}

// The parts of a Telegram message the service reads.
interface Message {
	message_id?: number;
	chat: { id: number; type?: string };
	from?: { id: number; username?: string; first_name?: string; last_name?: string };
	text?: string;
	caption?: string;
	photo?: { file_id: string }[];
	[kind: string]: unknown;
}

// The kinds of file a message can carry, besides photos, which come in several sizes.
const fileKinds = ["document", "audio", "video", "voice", "video_note", "animation", "sticker"];

/** Telegram: each listed agent's bot sends the messages of the agent's chats into its inbox. */
export class TelegramService extends Service {
	// The coordinator's Composio key, which may connect accounts, unlike the agents' own; COMPOSIO_BASE_URL points elsewhere, such as at a fake in tests.
	override readonly secrets = [`${tokenPrefix}*`, "COMPOSIO_COORDINATOR_API_KEY", "COMPOSIO_BASE_URL"];
	override readonly routes: Route[] = [
		{
			method: "POST",
			path: ":agent",
			access: "public",
			summary: "Telegram's updates for the agent's bot, with the bot's secret token; a message from a chat the agent lists goes into its inbox.",
			handle: (request) => this.receive(request),
		},
	];
	private context!: ServiceContext;
	private api = "https://api.telegram.org";
	private readonly bots = new Map<string, Bot>();

	/** Checks the config and each agent's token, and sets each bot's webhook, any failure leaving the service off; then connects each bot in Composio. */
	override async onStart(context: ServiceContext): Promise<void> {
		const { apiUrl, agents } = (context.config ?? {}) as { apiUrl?: unknown; agents?: unknown };
		if (context.publicUrl === undefined) throw new Error('it needs "publicUrl" in agentx.json, the address Telegram sends to.');
		if (typeof agents !== "object" || agents === null || Array.isArray(agents)) throw new Error('services.telegram needs "agents": { "<agent>": { "chats": [<chat id>] } }.');
		// Another address of the Bot API, such as a Bot API server of one's own.
		if (typeof apiUrl === "string") this.api = apiUrl;
		this.context = context;
		for (const [agent, entry] of Object.entries(agents)) {
			const running = context.agents.find((candidate) => candidate.name === agent);
			if (running === undefined) throw new Error(`services.telegram names agent "${agent}", which agentx serve does not run.`);
			const chats = (entry as { chats?: unknown } | null)?.chats;
			if (!Array.isArray(chats) || !chats.every((chat) => typeof chat === "number" || typeof chat === "string")) throw new Error(`services.telegram: agent "${agent}" needs "chats", the ids of the chats it takes messages from.`);
			const variable = tokenPrefix + agent.toUpperCase().replaceAll("-", "_");
			const token = context.secrets[variable];
			if (!token) throw new Error(`${variable}, the bot token of agent "${agent}", is not set in the environment or agent-x/.env.services.`);
			// A bot has one webhook, so the second agent's would take the first's messages.
			const sharing = [...this.bots.values()].find((other) => other.token === token);
			if (sharing !== undefined) throw new Error(`agents "${sharing.agent}" and "${agent}" have the same bot token; each agent needs a bot of its own.`);
			const secret = createHmac("sha256", token).update("agentx webhook").digest("base64url");
			const bot = { agent, token, chats: chats.map(String), secret, userId: composioUserId(running.root) };
			await this.call(bot, "setWebhook", { url: `${context.publicUrl.replace(/\/$/, "")}/services/telegram/${agent}`, secret_token: bot.secret, allowed_updates: ["message"] });
			this.bots.set(agent, bot);
		}
		// Messages come in without Composio, so a bot that cannot be connected is logged, and the service stays on.
		const key = context.secrets.COMPOSIO_COORDINATOR_API_KEY;
		if (!key) {
			console.error("telegram: COMPOSIO_COORDINATOR_API_KEY is not set, in the environment or agent-x/.env.services, so no bot is connected in Composio; an agent answers only with a bot connected by hand.");
			return;
		}
		const composio = { base: context.secrets.COMPOSIO_BASE_URL ?? "https://backend.composio.dev", key };
		for (const { agent, token, userId } of this.bots.values()) {
			try {
				if (userId === undefined) throw new Error("it has no agentx.composio.userId in its .pi/settings.json.");
				await connectBot(composio, userId, token);
			} catch (error) {
				console.error(`telegram: agent ${agent}'s bot is not connected in Composio, so the agent cannot answer in Telegram: ${(error as Error).message}`);
			}
		}
	}

	// 200 for a message delivered and for an update to ignore; 503 when the event cannot be written, so Telegram sends it again.
	private async receive({ params, headers, body }: ApiRequest): Promise<ApiResponse> {
		const bot = this.bots.get(params.agent);
		if (bot === undefined) return { status: 404, body: { error: `Agent "${params.agent}" has no Telegram bot.` } };
		if (!sameText(String(headers["x-telegram-bot-api-secret-token"] ?? ""), bot.secret)) return { status: 401, body: { error: "The request does not carry the bot's secret token." } };
		const update = JSON.parse(body.toString("utf8")) as { update_id?: number; message?: Message };
		const message = update.message;
		if (message === undefined) return { status: 200, body: { ignored: "not a message" } };
		if (!bot.chats.includes(String(message.chat.id))) {
			console.error(`telegram: a message to agent ${bot.agent} from chat ${message.chat.id}, which it does not list, is dropped.`);
			return { status: 200, body: { ignored: "a chat the agent does not list" } };
		}
		const attached = attachments(message);
		// Joins, pins, locations and the like carry nothing for the agent to read, and would each cost a model run.
		if (!message.text && !message.caption && attached.length === 0) return { status: 200, body: { ignored: "no text and no file" } };
		const folder = mkdtempSync(join(tmpdir(), "agentx-telegram-"));
		try {
			const { files, failures } = await this.download(bot, attached, folder);
			const { from } = message;
			const sender = from?.username ? `@${from.username}` : [from?.first_name, from?.last_name].filter(Boolean).join(" ");
			const delivered = this.context.deliver(
				bot.agent,
				{
					key: `telegram:${update.update_id}`,
					content: withoutBlockTag([message.text ?? message.caption ?? "", ...failures].filter(Boolean).join("\n\n")),
					metadata: { source: "telegram", chat: message.chat.id, "chat-type": message.chat.type, from: withoutBlockTag(sender), "from-id": from?.id, "message-id": message.message_id },
				},
				files,
			);
			return { status: 200, body: { event: delivered } };
		} catch (error) {
			console.error(`telegram: update ${update.update_id} for agent ${bot.agent} was not delivered, and Telegram sends it again: ${(error as Error).message}`);
			return { status: 503, body: { error: "The message could not be delivered." } };
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	}

	// Downloads the message's files into `folder`. One that cannot be, such as one over the Bot API's 20 MB, is said in `failures` instead, so the
	// message still arrives and holds up none after it.
	private async download(bot: Bot, ids: string[], folder: string): Promise<{ files: string[]; failures: string[] }> {
		const files: string[] = [];
		const failures: string[] = [];
		for (const id of ids) {
			try {
				const { file_path: path } = (await this.call(bot, "getFile", { file_id: id })) as { file_path: string };
				const response = await fetch(`${this.api}/file/bot${bot.token}/${path}`);
				if (!response.ok) throw new Error(`Telegram answered ${response.status}.`);
				// Named by Telegram, such as file_3.jpg, with its number first should two have the same name, so the event never refuses them.
				const name = basename(path);
				const file = join(folder, files.some((other) => basename(other) === name) ? `${files.length + 1}-${name}` : name);
				writeFileSync(file, Buffer.from(await response.arrayBuffer()));
				files.push(file);
			} catch (error) {
				failures.push(`A file of this message could not be downloaded: ${(error as Error).message}`);
			}
		}
		return { files, failures };
	}

	// Calls the Bot API's `method` for `bot`, and returns its result; throws Telegram's description of a failure.
	private async call(bot: Bot, method: string, params: object): Promise<unknown> {
		const response = await fetch(`${this.api}/bot${bot.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
		const answer = (await response.json()) as { ok?: boolean; result?: unknown; description?: string };
		if (!answer.ok) throw new Error(`Telegram's ${method}: ${answer.description ?? `answered ${response.status}`}`);
		return answer.result;
	}
}

// The ids of the files a message carries: the largest size of a photo, and each other kind, once each, as an animation comes as a document too.
function attachments(message: Message): string[] {
	const files = [message.photo?.at(-1), ...fileKinds.map((kind) => message[kind] as { file_id?: unknown } | undefined)];
	return [...new Set(files.flatMap((file) => (typeof file?.file_id === "string" ? [file.file_id] : [])))];
}
