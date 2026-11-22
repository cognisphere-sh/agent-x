// The memory extension, loaded by Pi into every agent: the agent searches the episodes of all its threads and reads them back.
// - The index, storage/knowledge/memory/index.db (episode-index.ts), takes what the session's own file holds past what was indexed of it when each run
//   settles, so an episode is in it once it ends. Each thread's session indexes its own file only.
// - `episode_search` finds episodes by keyword, in every thread or one, by when they started. Only episodes that ended are in the index.
// - `episode_read` gives back an episode, and those before and after it in its thread, folded and compacted ones too.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dayDateTime, knownTimeZone } from "../../../../time-zone.js";
import { plural } from "../episodes/episodes.js";
import { EpisodeIndex, type StoredEpisode } from "./episode-index.js";

// The most `episode_read` returns at once, about 8K tokens.
const pageChars = 32_000;

const answer = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

// A count the agent gives, whole and at least 0: SQLite takes a negative LIMIT as none.
const count = (value: number) => Math.max(0, Math.trunc(value));

// How far `timeZone` is ahead of UTC at `at`, in milliseconds, from the offset Intl gives it, such as "GMT+05:30". Near a change of the clocks, a wall time
// read with the offset of the other side is an hour off.
function offsetOf(at: number, timeZone: string | undefined): number {
	const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
	const [, sign = "+", hours = "0", minutes = "0"] = /GMT([+-])(\d{2}):(\d{2})/.exec(name) ?? [];
	return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
}

/** Gives each Pi session the agent's episode index and its tools. */
export default function (pi: ExtensionAPI) {
	let index: EpisodeIndex | undefined;
	const opened = (ctx: ExtensionContext) => (index ??= new EpisodeIndex(ctx.cwd));

	// Times in the agent's time zone, `agentx.timezone`, as on its events; the event queue extension reports a zone that Node does not know.
	const zone = () => knownTimeZone((pi.getSettings() as { agentx?: { timezone?: string | null } }).agentx?.timezone);
	const when = (time: number) => dayDateTime(time, zone());
	const heading = (episode: StoredEpisode) => `## Episode ${episode.id}\n\nThread \`${episode.thread}\`, from ${when(episode.startedAt)} to ${when(episode.endedAt)}.`;
	// A time the agent gives. One without an offset is in its time zone, as its events show times: JavaScript would read a date in UTC, and a date and
	// time in the machine's zone.
	const time = (value: string | undefined) => {
		if (value === undefined) return undefined;
		const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
		const parsed = Date.parse(zoned ? value : `${value.includes("T") ? value : `${value}T00:00`}Z`);
		if (Number.isNaN(parsed)) throw new Error(`"${value}" is not a time: use ISO 8601, such as 2026-11-20 or 2026-11-20T14:00+05:30.`);
		return zoned ? parsed : parsed - offsetOf(parsed, zone());
	};

	// Within the handler, which Pi awaits: a worker session may end once its run has settled.
	pi.on("agent_settled", (_event, ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		try {
			if (file) opened(ctx).updateSession(file, ctx.sessionManager.getEntries());
		} catch (error) {
			// A failure, such as an index that another process keeps locked, leaves the episode to the thread's next run, which indexes from the same point.
			// Said, so that one that keeps failing is seen: `agentx run` logs it, and `agentx chat` shows it.
			ctx.ui.notify(`The memory index could not be updated, and the thread's next run tries again: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});

	pi.on("session_shutdown", () => {
		index?.close();
		index = undefined;
	});

	pi.registerTool({
		name: "episode_search",
		label: "Search episodes",
		description:
			"Searches the episodes of all your threads, your past work, by keywords: the messages, your text, your tool calls and their results. Each hit gives an episode's id, its thread, when it ran and the lines around the match. `episode_read` gives one back.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Words to find, each in any of its forms (fix, fixed, fixing). Episodes with more of them, and with rarer ones, come first." },
				thread: { type: "string", description: "Only this thread's episodes." },
				since: { type: "string", description: "Only episodes that started at or after this time, in ISO 8601, such as 2026-11-20 or 2026-11-20T14:00+05:30; without an offset, in your time zone." },
				until: { type: "string", description: "Only episodes that started before this time, in ISO 8601; without an offset, in your time zone." },
				limit: { type: "number", description: "How many episodes at most, up to 50; 10 when left out." },
			},
			required: ["query"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const { query, thread, since, until, limit = 10 } = params as { query: string; thread?: string; since?: string; until?: string; limit?: number };
			const window = { since: time(since), until: time(until) };
			const hits = opened(ctx).search({ words: query, thread, ...window, limit: Math.min(Math.max(count(limit), 1), 50) });
			if (hits.length === 0) return answer("No episode found.");
			const found = hits.map((hit) => `${heading(hit)}\n\n> ${hit.snippet.replace(/\n/g, "\n> ")}`);
			return answer([`${plural(hits.length, "episode")} found, best first.`, ...found].join("\n\n"));
		},
	});

	pi.registerTool({
		name: "episode_read",
		label: "Read episodes back",
		description:
			"Gives back an episode of any of your threads as Markdown, also when it was folded or summarized: its messages, your text, your tool calls and their results. Images are named, not shown: open their files with `read`.",
		parameters: {
			type: "object",
			properties: {
				episode: { type: "string", description: "The episode's id, as its end message, a fold or `episode_search` give it." },
				before: { type: "number", description: "How many episodes of its thread before it to add; none when left out." },
				after: { type: "number", description: "How many episodes of its thread after it to add; none when left out." },
				page: { type: "number", description: "Which page of a long answer, from 1." },
			},
			required: ["episode"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const { episode, before = 0, after = 0, page = 1 } = params as { episode: string; before?: number; after?: number; page?: number };
			const episodes = opened(ctx).read(episode, count(before), count(after));
			const text = episodes.map((found) => `${heading(found)}\n\n${found.text}`).join("\n\n");
			const pages = Math.max(1, Math.ceil(text.length / pageChars));
			if (!Number.isInteger(page) || page < 1 || page > pages) throw new Error(`There is no page ${page}: the answer has ${plural(pages, "page")}.`);
			const part = text.slice((page - 1) * pageChars, page * pageChars);
			if (pages === 1) return answer(part);
			return answer(`${part}\n\n[Page ${page} of ${pages}${page < pages ? `. Call episode_read with page ${page + 1} for more.` : ", the last."}]`);
		},
	});
}
