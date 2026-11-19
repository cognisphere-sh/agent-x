// A thread's context as episodes, the unit the agent folds, reads back and is told the size of. An episode is one of Pi's runs, from its start to its end:
// the message that started it, events steered into it, and all the model did. Each has an id of its own. The extension starts its first message with a
// line that gives its id, which marks where it starts, and adds a message where it ends.

import { estimateTokens, type ExtensionContext, type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";

/** A message as the session holds it. */
export type AgentMessage = Extract<SessionEntry, { type: "message" }>["message"];
type Session = ExtensionContext["sessionManager"];

/** The custom types of the message that ends an episode, and of the extension's fold nudges. */
export const endType = "agentx-episode-end";
export const foldNudgeType = "agentx-fold-nudge";

/** An episode: its id, its entries, each with the message it gives the model, and its size. */
export interface Episode {
	id: string;
	items: { entry: SessionEntry; message: AgentMessage }[];
	tokens: number;
	/** Whether its end message is there: the episode in progress has none yet. */
	ended: boolean;
}

/** A message's text, without images. */
export function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const { content } = message;
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** The line an episode's first message starts with. */
export const startLine = (id: string) => `Episode ${id} started.\n\n`;

/** The episode a message starts, from its first line, or undefined when it starts none. */
export const startedEpisode = (text: string): string | undefined => /^Episode (\S+) started\.\n\n/.exec(text)?.[1];

/** The opening tag of a fold's summary, which names the episodes it folded. */
export const foldTag = (ids: string[]) => `<agentx-folded episodes="${ids.join(" ")}">`;

/** The episodes a fold's summary names, from its text, or none when the text is not one. */
export function foldedEpisodes(text: string): string[] {
	const match = /^<agentx-folded episodes="([^"]*)">/.exec(text);
	return match ? match[1].split(" ") : [];
}

// Only what a fold may omit counts: user, model and tool messages, and custom ones. The system messages that carry the prompt's sections stay.
const foldable = (message: AgentMessage) => ["user", "assistant", "toolResult", "custom"].includes(message.role);

// The thread's episodes, from the first messages of its whole branch as they were written, each with the messages `view` gives for its entries. Membership
// comes from the branch, since a fold or a compaction can have taken an episode's first message out of what the model sees.
function episodesOf(session: Session, view: (entry: SessionEntry) => AgentMessage[]): Episode[] {
	const episodes: Episode[] = [];
	for (const entry of session.getBranch()) {
		const text = entry.type === "message" && entry.message.role === "user" ? textOf(entry.message) : "";
		const id = startedEpisode(text);
		if (id) episodes.push({ id, items: [], tokens: 0, ended: false });
		const episode = episodes.at(-1);
		if (!episode) continue;
		if (entry.type === "custom_message" && entry.customType === endType) episode.ended = true;
		for (const message of view(entry)) {
			if (!foldable(message)) continue;
			episode.items.push({ entry, message });
			episode.tokens += estimateTokens(message);
		}
	}
	return episodes.filter((episode) => episode.items.length > 0);
}

/** The messages the model sees now of each entry, by entry id: none for what folds omitted, the summary for a fold's first message, after the last compaction. */
export function projection(session: Session): Map<string, AgentMessage[]> {
	return new Map(session.buildSessionProjection().entries.map(({ sourceEntry, messages }) => [sourceEntry.id, messages]));
}

/** Whether the model sees anything of the entry with this id, in a `projection`. */
export const isVisible = (projected: Map<string, AgentMessage[]>, id: string) => (projected.get(id)?.length ?? 0) > 0;

/** The episodes as the model sees them now, oldest first: without what folds omitted, with the summaries they put in its place, after the last compaction. */
export function visibleEpisodes(session: Session, projected = projection(session)): Episode[] {
	return episodesOf(session, (entry) => projected.get(entry.id) ?? []);
}

/** The thread's episodes as they were written, folded and compacted ones too, oldest first. */
export const allEpisodes = (session: Session): Episode[] => episodesOf(session, sessionEntryToContextMessages);

/** The index of the episode with this id. */
export function episodeAt(episodes: Episode[], id: string): number {
	const at = episodes.findIndex((episode) => episode.id === id);
	if (at < 0) throw new Error(`This thread has no episode ${id}.`);
	return at;
}

/** A count of things as the agent reads it: "1 episode", "2 episodes". */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A token count as the agent reads it: "830", "4.2K", "86K". */
export function size(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
}

// A fence that the text cannot close.
function fenced(text: string, language = ""): string {
	const fence = text.includes("```") ? "````" : "```";
	return `${fence}${language}\n${text}\n${fence}`;
}

/** Episodes as Markdown to read: each under a heading, its messages, the model's text, its tool calls and their results. Images are named, not shown. */
export function markdown(episodes: Episode[]): string {
	const parts: string[] = [];
	for (const episode of episodes) {
		parts.push(`## Episode ${episode.id}`);
		for (const { message } of episode.items) {
			const images = "content" in message && Array.isArray(message.content) ? message.content.filter((part) => part.type === "image").length : 0;
			const data = images > 0 ? `\n\n[${plural(images, "image")} not shown: open the file with \`read\`]` : "";
			if (message.role === "user") parts.push(`${textOf(message)}${data}`);
			else if (message.role === "custom") parts.push(`> ${textOf(message).replace(/\n/g, "\n> ")}`);
			else if (message.role === "assistant") {
				for (const part of message.content) {
					if (part.type === "text" && part.text.trim() !== "") parts.push(`### You\n\n${part.text}`);
					else if (part.type === "toolCall") parts.push(`### Tool call: ${part.name}\n\n${fenced(JSON.stringify(part.arguments, null, 2), "json")}`);
				}
			} else if (message.role === "toolResult") parts.push(`### Result${message.isError ? " (error)" : ""}\n\n${fenced(textOf(message))}${data}`);
		}
	}
	return parts.join("\n\n");
}
