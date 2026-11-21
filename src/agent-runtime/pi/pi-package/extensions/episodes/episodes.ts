// A thread's context as episodes, the unit the agent folds, searches and reads back. An episode is one of Pi's runs: the message that started it, events
// steered into it, and all the model did, up to the message the episode extension adds where it ends, which gives its id and the tokens it used. It starts
// at the first user message after the end of the episode before it, or at the session's first: every event reaches Pi as a user message.

import { estimateTokens, type ExtensionContext, type SessionBoundaryDraft, type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";

/** A message as the session holds it. */
export type AgentMessage = Extract<SessionEntry, { type: "message" }>["message"];
type Session = ExtensionContext["sessionManager"];

/** The custom type of the message that ends an episode. */
export const endType = "agentx-episode-end";

/** What an end message holds besides its text: the episode's id, and the tokens it used, when they are known. */
export interface End {
	id: string;
	tokens?: number;
}

/** An episode: its id, and its entries, each with the message it gives the model. */
export interface Episode {
	/** From its end message; the episode in progress has none yet. */
	id: string | undefined;
	items: { entry: SessionEntry; message: AgentMessage }[];
}

/** The end message's details, when the entry, or the draft of one, is one. */
export const endOf = (entry: SessionEntry | SessionBoundaryDraft): End | undefined =>
	entry.type === "custom_message" && entry.customType === endType ? (entry.details as End) : undefined;

/** A message's text, without images. */
export function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const { content } = message;
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/** Whether a `context_edit` may target the entry, as Pi allows: custom messages, and user, model and tool result messages. Only these are an episode's;
 * the system messages that carry the prompt's sections stay. */
export const editable = (entry: SessionEntry) => entry.type === "custom_message" || (entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message.role));

/** The episodes of `entries`, each with the messages `view` gives for its entries. Where each starts and ends comes from the entries as they were written,
 * since a fold or a compaction can have taken its first message or its end message out of what the model sees. What comes between an end and the next user
 * message, such as a fold nudge's turn, is in no episode. */
export function episodesIn(entries: SessionEntry[], view: (entry: SessionEntry) => AgentMessage[]): Episode[] {
	const episodes: Episode[] = [];
	let open: Episode | undefined;
	for (const entry of entries) {
		if (!open && entry.type === "message" && entry.message.role === "user") episodes.push((open = { id: undefined, items: [] }));
		if (!open) continue;
		if (editable(entry)) for (const message of view(entry)) open.items.push({ entry, message });
		const end = endOf(entry);
		if (end) {
			open.id = end.id;
			open = undefined;
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
export function visibleEpisodes(session: Session, projected: Map<string, AgentMessage[]>): Episode[] {
	return episodesIn(session.getBranch(), (entry) => projected.get(entry.id) ?? []);
}

/** The thread's episodes as they were written, folded and compacted ones too, oldest first. */
export const allEpisodes = (session: Session): Episode[] => episodesIn(session.getBranch(), sessionEntryToContextMessages);

/** The index of the episode with this id. */
export function episodeAt(episodes: Episode[], id: string): number {
	const at = episodes.findIndex((episode) => episode.id === id);
	if (at < 0) throw new Error(`This thread has no episode ${id}.`);
	return at;
}

// What an answer of the model read: its whole context, cached or not.
const read = (message: AgentMessage) => (message.role === "assistant" ? message.usage.input + message.usage.cacheRead + message.usage.cacheWrite : 0);

/** The tokens an episode added to the context: what its last answer read and wrote, less what its first answer read, which held everything before the episode,
 * plus its messages before that answer, estimated as Pi does, a quarter of their text. Answers without usage, such as failed ones, do not count; with none,
 * all of it is estimated. */
export function tokensOf(episode: Episode): number {
	const messages = episode.items.map((item) => item.message);
	const first = messages.findIndex((message) => read(message) > 0);
	const last = messages.findLast((message) => read(message) > 0);
	const estimated = messages.slice(0, first < 0 ? undefined : first).reduce((sum, message) => sum + estimateTokens(message), 0);
	return last?.role === "assistant" ? read(last) + last.usage.output - read(messages[first]) + estimated : estimated;
}

/** A count of things as the agent reads it: "1 episode", "2 episodes". */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A token count as the agent reads it: "830", "4.2K", "86K". */
export function size(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
}
