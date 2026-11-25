// The context extension, loaded by Pi into every agent: the agent folds its own context, by episodes (../episodes/).
// - When an episode ends and the episodes since the last fold nudge added more than `foldNudgeEvery` tokens, as their end messages give, a fold nudge asks
//   the agent to fold and says how, and Pi gives it one more turn: the only time `fold` folds. When that turn ends, the fold nudge and everything the agent
//   did for it leave the context.
// - `fold` folds ranges of whole episodes, each from one episode up to, not including, another, into a summary the agent writes. At the turn's end the
//   extension puts each summary in place of the first message the model sees of the range and omits everything else of it, with Pi's `context_edit`
//   entries. The session file keeps everything, and the memory extension's `episode_read` gives any episode back.
// - Pi compacts by itself when the context nears the window's end.
// The ideas of folds the agent decides on and nudges to fold come from billion-context (https://github.com/ranxianglei/billion-context).

import type { ContextEditEntryDraft, ExtensionAPI, SessionBoundaryDraft, SessionEntry } from "@earendil-works/pi-coding-agent";
import { allEpisodes, editable, endOf, episodeAt, isVisible, plural, projection, size, textOf, visibleEpisodes } from "../episodes/episodes.js";

const foldNudgeType = "agentx-fold-nudge";

interface Settings {
	agentx?: { memory?: { compaction?: { enabled?: boolean; foldNudgeEvery?: number } } };
}

const omit = (targetId: string): ContextEditEntryDraft => ({ type: "context_edit", targetId, replacement: null });
const isFoldNudge = (entry: SessionEntry) => entry.type === "custom_message" && entry.customType === foldNudgeType;

// A fold's summary as the model sees it, in a tag that names the episodes it folded, which the extension reads back.
const foldText = (ids: string[], summary: string) => [`<agentx-folded episodes="${ids.join(" ")}">`, summary.trim(), "</agentx-folded>"].join("\n");
const foldedEpisodes = (text: string): string[] => /^<agentx-folded episodes="([^"]*)">/.exec(text)?.[1].split(" ") ?? [];

/** Gives each Pi session fold nudges and the `fold` tool. */
export default function (pi: ExtensionAPI) {
	const own = () => (pi.getSettings() as Settings).agentx?.memory?.compaction ?? {};
	const enabled = () => own().enabled !== false;

	pi.registerTool({
		name: "fold",
		label: "Fold episodes",
		description: "Folds ranges of earlier episodes into summaries. Use it only when a message asks you to fold: that message says how.",
		parameters: {
			type: "object",
			properties: {
				ranges: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							from: { type: "string", description: "The id of the first episode to fold." },
							to: { type: "string", description: "The id of the first episode after the range, which stays." },
							summary: { type: "string", description: "What takes the folded episodes' place." },
						},
						required: ["from", "to", "summary"],
					},
				},
			},
			required: ["ranges"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const { ranges } = params as { ranges: { from: string; to: string; summary: string }[] };
			if (!enabled()) throw new Error("Folding is turned off for this agent (agentx.memory.compaction.enabled in its settings).");
			const projected = projection(ctx.sessionManager);
			const visible = (id: string) => isVisible(projected, id);
			const nudge = ctx.sessionManager.getBranch().findLast(isFoldNudge);
			if (!nudge || !visible(nudge.id)) throw new Error("Fold only when a message asks you to; none does now.");
			// Folds apply at the turn's end, so two calls of one answer would each be checked against the context before either, and could overlap.
			// Pi saves the answer before it runs its tools, so the branch's last answer is the one that called this.
			const answer = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
			const calls = answer?.type === "message" && answer.message.role === "assistant" ? answer.message.content.filter((part) => part.type === "toolCall" && part.name === "fold") : [];
			if (calls.length > 1) throw new Error("Only one fold call is allowed in an answer. It can have multiple ranges: call fold again, once, with all of them.");
			const episodes = allEpisodes(ctx.sessionManager);
			const index = (id: string) => episodeAt(episodes, id);
			// The earlier folds the model sees, each as the indexes of its first and last episodes, which its tag names in order. Only messages a fold
			// replaced are read: any other, such as a tool's output, can start with the same tag.
			const summaries = new Set(ctx.sessionManager.getBranch().flatMap((entry) => (entry.type === "context_edit" && entry.replacement !== null ? [entry.targetId] : [])));
			const earlier = [...projected]
				.filter(([id]) => summaries.has(id))
				.flatMap(([, messages]) => messages.map((message) => foldedEpisodes(textOf(message))))
				.filter((ids) => ids.length > 0)
				.map((ids) => [index(ids[0]), index(ids[ids.length - 1])]);
			// A wrong id would make Pi refuse every edit of the turn, so each range is checked here.
			const spans = ranges.map(({ from, to, summary }) => {
				const first = index(from);
				const end = index(to);
				if (end <= first) throw new Error(end === first ? `\`to\` is the first episode to keep, after the range: episode ${to} is the range's own first episode.` : `Episode ${to} comes before episode ${from}.`);
				const last = end - 1;
				// An earlier fold is in a range whole, or not at all: its summary stands for all its episodes.
				for (const [low, high] of earlier) {
					if (high < first || low > last || (low >= first && high <= last)) continue;
					throw new Error(`The range from episode ${from} cuts the earlier fold of episodes ${episodes[low].id} to ${episodes[high].id}: take in all of it or none of it.`);
				}
				// The first message the model sees of the range: its first episode's event, or an earlier fold's summary. Pi's compaction can have taken all of it.
				const target = episodes[first].items.find((item) => visible(item.entry.id));
				if (!target) throw new Error(`Episode ${from} was summarized when your context was compacted.`);
				return { first, last, targetId: target.entry.id, summary };
			});
			const sorted = spans.toSorted((a, b) => a.first - b.first);
			for (const [i, span] of sorted.entries()) {
				if (i > 0 && span.first <= sorted[i - 1].last) throw new Error(`The ranges from episode ${episodes[sorted[i - 1].first].id} and from episode ${episodes[span.first].id} overlap.`);
			}
			const edits = spans.flatMap(({ first, last, targetId, summary }) => {
				const folded = episodes.slice(first, last + 1);
				// What the model sees of them now, earlier folds' summaries included; what an earlier fold omitted stays so.
				const entryIds = [...new Set(folded.flatMap((episode) => episode.items.map((item) => item.entry.id)))].filter(visible);
				const text = foldText(
					folded.map((episode) => String(episode.id)),
					summary,
				);
				return [{ type: "context_edit" as const, targetId, replacement: { content: text } }, ...entryIds.filter((id) => id !== targetId).map(omit)];
			});
			return { content: [{ type: "text", text: `Folded ${plural(spans.length, "range")}, from the end of this turn.` }], details: { edits } };
		},
	});

	// Applies what the turn's `fold` calls folded. The calls stay until the fold nudge's turn is over, so the model sees what it did for the nudge.
	pi.on("turn_end", (event, ctx) => {
		if (event.outcome !== "completed" || ctx.signal?.aborted) return;
		const edits = event.toolResults.flatMap((result) => (result.toolName === "fold" && !result.isError ? (result.details as unknown as { edits: ContextEditEntryDraft[] }).edits : []));
		if (edits.length > 0) return { entries: [...event.entries, ...edits] };
	});

	// Once an episode is over, after its end message, which the episode extension adds first: a fold nudge when one is due, with one more turn to fold. When
	// that turn is over, or the next episode when the turn was cut off, the fold nudge and what came after it leave the context, up to the next episode or a
	// message a person typed into the turn. It says how to fold, so that leaves too.
	pi.on("agent_before_settle", (event, ctx) => {
		const session = ctx.sessionManager;
		const branch = session.getBranch();
		const projected = projection(session);
		const visible = (id: string) => isVisible(projected, id);
		const entries: SessionBoundaryDraft[] = [...event.entries];
		const nudgeAt = branch.findLastIndex(isFoldNudge);
		if (nudgeAt >= 0 && visible(branch[nudgeAt].id)) {
			const next = branch.findIndex((entry, at) => at > nudgeAt && entry.type === "message" && entry.message.role === "user");
			entries.push(...branch.slice(nudgeAt, next < 0 ? undefined : next).flatMap((entry) => (editable(entry) && visible(entry.id) ? [omit(entry.id)] : [])));
		}
		const ended = event.entries.map(endOf).find((end) => end !== undefined);
		if (!ended || !enabled() || event.outcome !== "completed") return { entries };
		const window = ctx.model?.contextWindow ?? 0;
		const every = own().foldNudgeEvery ?? 0.1;
		const since = branch.slice(nudgeAt + 1).reduce((sum, entry) => sum + (endOf(entry)?.tokens ?? 0), ended.tokens ?? 0);
		// A fold needs an episode besides the newest, which stays.
		if (since <= (Number.isInteger(every) ? every : every * window) || visibleEpisodes(session, projected).length < 2) return { entries };
		const holds = ctx.getContextUsage()?.tokens ?? since;
		entries.push({
			type: "custom_message",
			customType: foldNudgeType,
			display: true,
			content: [
				`Your context holds about ${size(holds)} of ${size(window)} tokens. Fold the earlier episodes your work no longer needs with \`fold\`.`,
				"",
				"- Fold the oldest finished tasks first: work that is done, whose details your next steps will not need. Never fold an episode whose task is still going on, even when the episode has ended.",
				"- Fold long explorations, multi-step processes and executions once they are over, such as a search through files, a debugging session or a run of commands: the summary keeps only what was learned and the information that matters, not the steps.",
				"- Give all the ranges in a single `fold` call: one or more that do not overlap, each from episode `from` up to episode `to`, the first episode to keep, with its summary. Give `from` and `to` as the ids the episodes' end messages give. The newest episode stays.",
				"- A range takes in an earlier fold whole or not at all. When it takes one in, its summary must cover the old one too, and a summary in parts puts the old one's episodes, by the ids its tag or its parts give, in their tasks' parts.",
				"- Each summary takes its range's place, marked as folded with its episode ids. `episode_read` gives a folded episode back.",
				"- When a range's episodes worked on different, independent tasks or subjects, write its summary in parts, one per task: put the episodes of each task together, also ones that are not next to each other, and start each part with their ids, as their end messages give them: `<id>, <id>: <the part>`. A range of one task needs no parts.",
				"- Write the summary, and each of its parts, to stand alone: whoever reads it has not seen what it replaces.",
				"- Keep the goals and how they changed, decisions with their reasons, and the exact paths, names, values, commands and errors of the work, and the ids of what it touched, such as files, events and issues: what was done and what was found.",
				"- Drop tool output that has been used, failed attempts that taught nothing, and repetition.",
				"- Write the state of the work as history, not as orders, and end the summary, or each of its parts, with what is still open.",
				"",
				"When nothing should be folded, say only that. This message and what you do for it then leave your context.",
			].join("\n"),
		});
		return { entries, continue: true };
	});
}
