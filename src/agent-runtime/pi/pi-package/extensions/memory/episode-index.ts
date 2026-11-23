// The index of an agent's episodes, storage/memory/index.db: every thread's episodes, read from its session files, as Markdown in chunks that
// FTS5 finds by keyword and ranks by BM25. Pi's session files stay the record. Each session indexes only its own file, which no other process writes,
// while the agent's other sessions index theirs into the same index.

import { basename, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { transaction } from "../../../../sqlite.js";
import { type Episode, endOf, episodesIn } from "../episodes/episodes.js";
import { openIndex } from "./index-db.js";
import { transcript } from "./transcript.js";

// About 1K tokens: what a hit points into.
const chunkChars = 4000;

const columns = "id, thread, started_at, ended_at";

/** An episode as the index holds it: its thread, and when its first and last messages were written. */
export interface StoredEpisode {
	id: string;
	thread: string;
	startedAt: number;
	endedAt: number;
}

/** What a search looks for: words, and only in a thread, only episodes started in a window of time. */
export interface Query {
	words: string;
	thread?: string;
	since?: number;
	until?: number;
	limit: number;
}

const stored = (row: Record<string, unknown>): StoredEpisode => ({ id: String(row.id), thread: String(row.thread), startedAt: Number(row.started_at), endedAt: Number(row.ended_at) });

/** The episode index of the agent in `agentRoot`. */
export class EpisodeIndex {
	private readonly db: DatabaseSync;

	constructor(agentRoot: string) {
		this.db = openIndex(agentRoot);
	}

	/** Closes the file. The index must not be used afterwards. */
	close(): void {
		this.db.close();
	}

	/** The episodes with the most of `words`, rarer words counting more (BM25), each once, with the lines around the match in its best chunk. */
	search({ words, thread, since, until, limit }: Query): (StoredEpisode & { snippet: string })[] {
		// Each word is a phrase of its own, so nothing in it is FTS5's syntax: "auth.ts" finds "auth" followed by "ts".
		const match = (words.match(/[^\s"]+/g) ?? []).map((word) => `"${word}"`).join(" OR ");
		if (match === "") throw new Error("Give words to search for.");
		const rows = this.db
			.prepare(
				`SELECT episodes.id, thread, started_at, ended_at, snippet(chunks_text, 0, '**', '**', '…', 24) AS snippet
				 FROM chunks_text JOIN chunks ON chunks.id = chunks_text.rowid JOIN episodes ON episodes.id = chunks.episode
				 WHERE chunks_text MATCH :match AND (:thread IS NULL OR thread = :thread) AND (:since IS NULL OR started_at >= :since)
				 AND (:until IS NULL OR started_at < :until)
				 ORDER BY bm25(chunks_text) LIMIT :rows`,
			)
			.all({ match, thread: thread ?? null, since: since ?? null, until: until ?? null, rows: limit * 5 });
		// One hit per episode, from its best chunk; asking for more chunks than hits leaves room for episodes with several.
		const hits = new Map<string, StoredEpisode & { snippet: string }>();
		for (const row of rows) if (!hits.has(String(row.id))) hits.set(String(row.id), { ...stored(row), snippet: String(row.snippet) });
		return [...hits.values()].slice(0, limit);
	}

	/** The episode `id` with its text, and as many episodes of its thread before it and after it, oldest first. */
	read(id: string, before: number, after: number): (StoredEpisode & { text: string })[] {
		const row = this.db.prepare(`SELECT ${columns} FROM episodes WHERE id = ?`).get(id);
		if (row === undefined) throw new Error(`There is no episode ${id}.`);
		const episode = stored(row);
		const near = (side: string, order: string, count: number) =>
			this.db
				.prepare(`SELECT ${columns} FROM episodes WHERE thread = ? AND (started_at, id) ${side} (?, ?) ORDER BY started_at ${order}, id ${order} LIMIT ?`)
				.all(episode.thread, episode.startedAt, episode.id, count)
				.map(stored);
		return [...near("<", "DESC", before).reverse(), episode, ...near(">", "ASC", after)].map((found) => ({
			...found,
			text: this.db
				.prepare("SELECT text FROM chunks WHERE episode = ? ORDER BY part")
				.all(found.id)
				.map((chunk) => String(chunk.text))
				.join(""),
		}));
	}

	/** Indexes the episodes that ended in the session file `file`, storage/sessions/<thread>/<name>.jsonl, whose entries, in the order they were written, are
	 * `entries`: those after the last end message indexed, or all when the index holds none of the file or no longer finds that message. */
	updateSession(file: string, entries: SessionEntry[]): void {
		const thread = basename(dirname(file));
		const path = join(thread, basename(file));
		const indexed = this.db.prepare("SELECT last_end FROM sessions WHERE path = ?").get(path)?.last_end;
		const after = entries.slice(entries.findLastIndex((entry) => entry.id === indexed) + 1);
		const ended = episodesIn(after, sessionEntryToContextMessages).filter((episode) => episode.id !== undefined);
		const lastEnd = after.findLast((entry) => endOf(entry) !== undefined);
		if (!lastEnd) return;
		transaction(this.db, () => {
			for (const episode of ended) this.put(thread, episode);
			this.db.prepare("INSERT INTO sessions (path, last_end) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET last_end = excluded.last_end").run(path, lastEnd.id);
		});
	}

	// Puts an episode of `thread` that ended in the index, in place of what it held of it. A forked session repeats its source's episodes, under the same ids.
	private put(thread: string, episode: Episode): void {
		const id = String(episode.id);
		const time = (at: number) => Date.parse(episode.items[at].entry.timestamp);
		this.db.prepare(`INSERT OR REPLACE INTO episodes (${columns}) VALUES (?, ?, ?, ?)`).run(id, thread, time(0), time(episode.items.length - 1));
		this.db.prepare("DELETE FROM chunks WHERE episode = ?").run(id);
		const add = this.db.prepare("INSERT INTO chunks (episode, part, text) VALUES (?, ?, ?)");
		for (const [part, text] of chunked(transcript(episode)).entries()) add.run(id, part, text);
	}
}

// An episode's turns in chunks of about `chunkChars`: as many whole turns as fit, and a longer turn by itself, cut. Each turn but the last keeps the blank
// line after it, so the chunks joined are the episode's text.
function chunked(turns: string[]): string[] {
	const chunks: string[] = [];
	let chunk = "";
	for (const [at, turn] of turns.entries()) {
		const text = at < turns.length - 1 ? `${turn}\n\n` : turn;
		if (chunk !== "" && chunk.length + text.length > chunkChars) {
			chunks.push(chunk);
			chunk = "";
		}
		if (text.length <= chunkChars) chunk += text;
		else chunks.push(...cut(text));
	}
	if (chunk !== "") chunks.push(chunk);
	return chunks;
}

// A long turn in chunks of about `chunkChars`, each cut at a blank line when one is in its second half. Joined, they are the turn again.
function cut(text: string): string[] {
	const chunks: string[] = [];
	for (let start = 0; start < text.length; ) {
		let end = start + chunkChars;
		// Only within the chunk: a search back past its start would cost the whole text for each chunk of a text without blank lines.
		const blank = start + text.slice(start, end + 2).lastIndexOf("\n\n");
		if (end < text.length && blank > start + chunkChars / 2) end = blank + 2;
		chunks.push(text.slice(start, end));
		start = end;
	}
	return chunks;
}
