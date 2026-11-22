// The Telegram service, an optional one: each agent that `services.telegram` in agentx.json lists gets a Telegram bot. At start it points each bot's
// webhook at the bot's route, and connects the bot in Composio for the agent's Composio user id; each message from a chat the agent lists goes into its
// inbox, with the message's files downloaded into the event, and so does a tap on an inline button, after which the service takes the message's buttons
// off. An album, which Telegram sends as one message per photo or file, goes in as one event. The agent answers with Composio's Telegram tools, which
// send as its bot.

import { createHmac } from "node:crypto";
import { basename } from "node:path";
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
	// The bot's own user id, the part of its token before the colon, to tell a reply to the bot from a reply to a person.
	id: string;
	// The chats the agent takes messages from, by id.
	chats: string[];
	// What Telegram sends in X-Telegram-Bot-Api-Secret-Token, made from the token, so it needs no setting of its own and only the token's holder knows it.
	secret: string;
	// The agent's Composio user id, which the bot is connected for.
	userId?: string;
}

// A Telegram user, as the service reads one.
interface User {
	id: number;
	username?: string;
	first_name?: string;
	last_name?: string;
}

// The parts of a Telegram message the service reads.
interface Message {
	message_id?: number;
	// 0 in a tap on a message Telegram no longer gives.
	date?: number;
	chat: { id: number; type?: string };
	from?: User;
	text?: string;
	entities?: unknown[];
	caption?: string;
	photo?: { file_id: string }[];
	// The album the message is a part of: each of an album's photos and files comes as a message of its own, with the same media_group_id.
	media_group_id?: string;
	reply_to_message?: { message_id?: number; from?: User };
	reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
	[kind: string]: unknown;
}

// The parts of a tap on an inline button the service reads: the button's `callback_data`, and the message it is on.
interface Tap {
	id: string;
	from: User;
	message?: Message;
	data?: string;
}

// The kinds of file a message can carry, besides photos, which come in several sizes.
const fileKinds = ["document", "audio", "video", "voice", "video_note", "animation", "sticker"];

// How long the service waits, in ms, after an album's last part for another, before the album goes into the inbox. Telegram sends a chat's messages
// one at a time, each once the one before is answered, so the service answers each part at once and goes by quiet instead.
const albumQuiet = 2000;
// How long the service remembers an album's delivered parts, in ms, to drop one Telegram sends again.
const albumMemory = 10 * 60_000;

// A message's files, downloaded: each goes into the event's folder by its name, and one that could not be downloaded is said in `failures`.
interface Download {
	files: { name: string; content: Buffer }[];
	failures: string[];
}

// An album on its way in.
interface Album {
	bot: Bot;
	parts: { updateId: number | undefined; message: Message; download: Promise<Download> }[];
	timer?: NodeJS.Timeout;
}

/** Telegram: each listed agent's bot sends the messages of the agent's chats into its inbox. */
export class TelegramService extends Service {
	// The coordinator's Composio key, which may connect accounts, unlike the agents' own; COMPOSIO_BASE_URL points elsewhere, such as at a fake in tests.
	override readonly secrets = [`${tokenPrefix}*`, "COMPOSIO_COORDINATOR_API_KEY", "COMPOSIO_BASE_URL"];
	override readonly routes: Route[] = [
		{
			method: "POST",
			path: ":agent",
			access: "public",
			summary: "Telegram's updates for the agent's bot, with the bot's secret token; a message or a button tap from a chat the agent lists goes into its inbox.",
			handle: (request) => this.receive(request),
		},
	];
	private context!: ServiceContext;
	private api = "https://api.telegram.org";
	private readonly bots = new Map<string, Bot>();
	// The albums on their way in, by agent, chat and media_group_id.
	private readonly albums = new Map<string, Album>();
	// When each part of an album delivered lately was delivered, by its album's id and its message_id.
	private readonly delivered = new Map<string, number>();

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
			if (!token) throw new Error(`${variable}, the bot token of agent "${agent}", is not set in the environment or agent-x/.env.`);
			// A bot has one webhook, so the second agent's would take the first's messages.
			const sharing = [...this.bots.values()].find((other) => other.token === token);
			if (sharing !== undefined) throw new Error(`agents "${sharing.agent}" and "${agent}" have the same bot token; each agent needs a bot of its own.`);
			const secret = createHmac("sha256", token).update("agentx webhook").digest("base64url");
			const bot = { agent, token, id: token.split(":")[0], chats: chats.map(String), secret, userId: composioUserId(running.root) };
			await this.call(bot, "setWebhook", { url: `${context.publicUrl.replace(/\/$/, "")}/services/telegram/${agent}`, secret_token: bot.secret, allowed_updates: ["message", "callback_query"] });
			this.bots.set(agent, bot);
		}
		// Messages come in without Composio, so a bot that cannot be connected is logged, and the service stays on.
		const key = context.secrets.COMPOSIO_COORDINATOR_API_KEY;
		if (!key) {
			console.error("telegram: COMPOSIO_COORDINATOR_API_KEY is not set, in the environment or agent-x/.env, so no bot is connected in Composio; an agent answers only with a bot connected by hand.");
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

	// 200 for a message or tap delivered and for an update to ignore; 503 when the event cannot be written, so Telegram sends it again.
	private async receive({ params, headers, body }: ApiRequest): Promise<ApiResponse> {
		const bot = this.bots.get(params.agent);
		if (bot === undefined) return { status: 404, body: { error: `Agent "${params.agent}" has no Telegram bot.` } };
		if (!sameText(String(headers["x-telegram-bot-api-secret-token"] ?? ""), bot.secret)) return { status: 401, body: { error: "The request does not carry the bot's secret token." } };
		const update = JSON.parse(body.toString("utf8")) as { update_id?: number; message?: Message; callback_query?: Tap };
		if (update.callback_query !== undefined) return this.tap(bot, update.update_id, update.callback_query);
		const message = update.message;
		if (message === undefined) return { status: 200, body: { ignored: "not a message" } };
		if (!listed(bot, message, "message")) return { status: 200, body: { ignored: "a chat the agent does not list" } };
		const attached = attachments(message);
		// Joins, pins, locations and the like carry nothing for the agent to read, and would each cost a model run.
		if (!message.text && !message.caption && attached.length === 0) return { status: 200, body: { ignored: "no text and no file" } };
		if (typeof message.media_group_id === "string") {
			try {
				return this.gather(bot, update.update_id, message, attached);
			} catch (error) {
				console.error(`telegram: update ${update.update_id} for agent ${bot.agent} was not delivered, and Telegram sends it again: ${(error as Error).message}`);
				return { status: 503, body: { error: "The message could not be delivered." } };
			}
		}
		try {
			const { files, failures } = await this.download(bot, attached);
			const { from } = message;
			const delivered = this.context.deliver(
				bot.agent,
				{
					key: `telegram:${update.update_id}`,
					content: withoutBlockTag([message.text ?? message.caption ?? "", ...failures].filter(Boolean).join("\n\n")),
					metadata: { source: "telegram", chat: message.chat.id, "chat-type": message.chat.type, from: withoutBlockTag(senderName(from)), "from-id": from?.id, "message-id": message.message_id, ...replyTo(bot, message) },
				},
				files,
			);
			return { status: 200, body: { event: delivered } };
		} catch (error) {
			console.error(`telegram: update ${update.update_id} for agent ${bot.agent} was not delivered, and Telegram sends it again: ${(error as Error).message}`);
			return { status: 503, body: { error: "The message could not be delivered." } };
		}
	}

	/** Delivers the albums still on their way in, so a stop loses none. */
	override async onStop(): Promise<void> {
		for (const album of this.albums.values()) clearTimeout(album.timer);
		await Promise.all([...this.albums.keys()].map((id) => this.flush(id)));
	}

	// Takes a part of an album, starting its files' download, and answers at once, so Telegram sends the next part. Once no part has come for
	// albumQuiet, flush delivers the album. Answered before it is delivered, an album the service cannot deliver, or has when it stops abruptly, is lost.
	private gather(bot: Bot, updateId: number | undefined, message: Message, attached: string[]): ApiResponse {
		const id = `${bot.agent}:${message.chat.id}:${message.media_group_id}`;
		for (const [part, at] of this.delivered) {
			if (Date.now() - at < albumMemory) break;
			this.delivered.delete(part);
		}
		// A part Telegram sends again after its album went in would otherwise be an event of its own, or, with a late part, take that one's place.
		if (this.delivered.has(`${id}:${message.message_id}`)) return { status: 200, body: { ignored: "a part of an album delivered already" } };
		let album = this.albums.get(id);
		if (album === undefined) {
			album = { bot, parts: [] };
			this.albums.set(id, album);
		}
		// A part Telegram sends again, as when its answer was lost, is in already.
		if (!album.parts.some((part) => part.message.message_id === message.message_id)) {
			album.parts.push({ updateId, message, download: this.download(bot, attached) });
		}
		clearTimeout(album.timer);
		album.timer = setTimeout(() => void this.flush(id), albumQuiet);
		return { status: 200, body: { album: message.media_group_id } };
	}

	// Delivers an album as one event once its files are in: its parts' text and files in the order they were sent, and the metadata of its first part,
	// its key that part's update. A part that comes while the files download waits for quiet again, and takes the album with it; one that comes after
	// is an event of its own.
	private async flush(id: string): Promise<void> {
		const album = this.albums.get(id);
		if (album === undefined) return;
		const count = album.parts.length;
		const downloads = await Promise.all(album.parts.map((part) => part.download));
		if (album.parts.length !== count || this.albums.get(id) !== album) return;
		this.albums.delete(id);
		for (const part of album.parts) this.delivered.set(`${id}:${part.message.message_id}`, Date.now());
		const { bot } = album;
		const order = album.parts.map((part, i) => ({ ...part, ...downloads[i] })).sort((a, b) => (a.message.message_id ?? 0) - (b.message.message_id ?? 0));
		const [first] = order;
		const { message } = first;
		// Two parts may have files of the same name; the event refuses that, so the second gets its number first.
		const files: Download["files"] = [];
		for (const part of order) {
			for (const file of part.files) files.push(files.some((other) => other.name === file.name) ? { ...file, name: `${files.length + 1}-${file.name}` } : file);
		}
		const text = order.map((part) => part.message.caption ?? part.message.text ?? "");
		const event = {
			key: `telegram:${first.updateId}`,
			content: withoutBlockTag([...text, ...order.flatMap((part) => part.failures)].filter(Boolean).join("\n\n")),
			metadata: {
				source: "telegram",
				chat: message.chat.id,
				"chat-type": message.chat.type,
				from: withoutBlockTag(senderName(message.from)),
				"from-id": message.from?.id,
				"message-id": message.message_id,
				album: message.media_group_id,
				...(order.map((part) => replyTo(bot, part.message)).find((reply) => "reply-to" in reply) ?? {}),
			},
		};
		try {
			// An inbox that cannot take the event now, as when its database is busy, may a moment later; Telegram does not send the parts again.
			for (let attempt = 1; ; attempt++) {
				try {
					this.context.deliver(bot.agent, event, files);
					return;
				} catch (error) {
					if (attempt === 3) throw error;
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}
		} catch (error) {
			console.error(`telegram: an album of ${order.length} messages from ${event.metadata.from} in chat ${message.chat.id}, for agent ${bot.agent}, was not delivered and is lost: ${(error as Error).message}`);
		}
	}

	// Delivers a tap on an inline button: its content the button's text, its `button` the button's `callback_data`, and its `message-id` the message
	// the button is on. Then takes the message's buttons off, so each question is answered once.
	private async tap(bot: Bot, updateId: number | undefined, tap: Tap): Promise<ApiResponse> {
		// Stops the button's spinner. Telegram refuses a second answer, such as to an update it sends again, which does no harm.
		await this.call(bot, "answerCallbackQuery", { callback_query_id: tap.id }).catch(() => undefined);
		const { message } = tap;
		if (!message?.date) return { status: 200, body: { ignored: "a tap on a message Telegram no longer gives" } };
		if (!listed(bot, message, "tap")) return { status: 200, body: { ignored: "a chat the agent does not list" } };
		const choice = message.reply_markup?.inline_keyboard?.flat().find((button) => button.callback_data === tap.data)?.text ?? tap.data ?? "";
		const sender = senderName(tap.from);
		let delivered: string;
		try {
			delivered = this.context.deliver(bot.agent, {
				key: `telegram:${updateId}`,
				content: withoutBlockTag(choice),
				metadata: { source: "telegram", chat: message.chat.id, "chat-type": message.chat.type, from: withoutBlockTag(sender), "from-id": tap.from.id, "message-id": message.message_id, button: withoutBlockTag(tap.data ?? "") },
			});
		} catch (error) {
			console.error(`telegram: update ${updateId} for agent ${bot.agent} was not delivered, and Telegram sends it again: ${(error as Error).message}`);
			return { status: 503, body: { error: "The tap could not be delivered." } };
		}
		// The choice goes under the message's text, so the chat shows it. A message without text, such as a photo, or one too long to add to, only loses its buttons.
		const target = { chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [] } };
		const text = `${message.text}\n\n✅ ${sender}: ${choice}`;
		const edited = message.text !== undefined && (await this.call(bot, "editMessageText", { ...target, text, entities: message.entities }).then(() => true, () => false));
		if (!edited) {
			await this.call(bot, "editMessageReplyMarkup", target).catch((error: Error) => console.error(`telegram: the buttons of message ${message.message_id} in chat ${message.chat.id} were not taken off, so it can be answered again: ${error.message}`));
		}
		return { status: 200, body: { event: delivered } };
	}

	// Downloads the message's files. One that cannot be, such as one over the Bot API's 20 MB, is said in `failures` instead, so the message still
	// arrives and holds up none after it.
	private async download(bot: Bot, ids: string[]): Promise<Download> {
		const files: Download["files"] = [];
		const failures: string[] = [];
		for (const id of ids) {
			try {
				const { file_path: path } = (await this.call(bot, "getFile", { file_id: id })) as { file_path: string };
				const response = await fetch(`${this.api}/file/bot${bot.token}/${path}`);
				if (!response.ok) throw new Error(`Telegram answered ${response.status}.`);
				// Named by Telegram, such as file_3.jpg, with its number first should two have the same name, so the event never refuses them.
				const name = basename(path);
				files.push({ name: files.some((other) => other.name === name) ? `${files.length + 1}-${name}` : name, content: Buffer.from(await response.arrayBuffer()) });
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

// Whether the message, or the message of a tap, is from a chat the agent lists; logs one that is not, which is dropped.
function listed(bot: Bot, message: Message, what: "message" | "tap"): boolean {
	if (bot.chats.includes(String(message.chat.id))) return true;
	console.error(`telegram: a ${what} to agent ${bot.agent} from chat ${message.chat.id}, which it does not list, is dropped.`);
	return false;
}

// The message a reply answers, and whether it is the bot's, so a router can send answers to the agent and leave people's talk among themselves.
function replyTo(bot: Bot, message: Message): Record<string, number | boolean> {
	const replied = message.reply_to_message;
	if (replied?.message_id === undefined) return {};
	return { "reply-to": replied.message_id, "reply-to-bot": String(replied.from?.id) === bot.id };
}

// How the event names a sender: `@username`, or the name.
function senderName(from: User | undefined): string {
	return from?.username ? `@${from.username}` : [from?.first_name, from?.last_name].filter(Boolean).join(" ");
}
