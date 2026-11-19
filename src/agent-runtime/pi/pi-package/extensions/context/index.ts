// The context extension, loaded by Pi into every agent: the agent knows its model and window, and how many tokens each episode used, and folds its own context.
// - `agentx-model`, a section of the system prompt: the model, its window and its output limit.
// - Episodes: each of Pi's runs is one, with an id of its own. Its first message starts with a line that gives its id, and a message where it ends gives
//   the tokens it used, which starts no model call by itself.
// - `fold` folds ranges of whole episodes, each from one episode up to, not including, another, into a summary the agent writes. A range that takes in
//   part of an earlier fold takes all of it, and the new summary replaces the old. At the turn's end the extension puts each summary in place of the first
//   message the model sees of the range and omits everything else of it, with Pi's `context_edit` entries; the call leaves with the fold nudge's turn. The
//   session file keeps everything, and `episode_read` gives any episode back.
// - When an episode ends and the episodes since the last fold nudge used more than `foldNudgeEvery` tokens, a fold nudge asks the agent to fold and says how,
//   and Pi gives it one more turn: the only time `fold` folds. When that turn ends, the fold nudge and everything the agent did for it leave the context.
// - When Pi compacts, the extension keeps the last `keepEpisodes` episodes within Pi's `compaction.keepRecentTokens`, or, when not even the newest fits, what
//   Pi's own cut keeps, and has the session's model summarize everything before, fold summaries too, in the form of a fold.
// The ideas of folds the agent decides on, nudges to fold and summaries of summaries come from billion-context (https://github.com/ranxianglei/billion-context).

import {
	type ContextEditEntryDraft,
	convertToLlm,
	estimateTokens,
	type ExtensionAPI,
	type SessionBoundaryDraft,
	type SessionEntry,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { newId } from "../../../../events/queue.js";
import {
	allEpisodes,
	endType,
	episodeAt,
	foldedEpisodes,
	foldNudgeType,
	foldTag,
	isVisible,
	markdown,
	plural,
	projection,
	size,
	startLine,
	textOf,
	visibleEpisodes,
} from "./episodes.js";

// The most `episode_read` returns at once, about 8K tokens.
const pageChars = 32_000;

interface Settings {
	agentx?: { memory?: { compaction?: { enabled?: boolean; foldNudgeEvery?: number; keepEpisodes?: number } } };
}

const omit = (targetId: string): ContextEditEntryDraft => ({ type: "context_edit", targetId, replacement: null });
// What a `context_edit` may target: custom messages, and user, model and tool result messages, not the system messages of the prompt's sections.
const editable = (entry: SessionEntry) => entry.type === "custom_message" || (entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message.role));

/** A fold's summary as the model sees it: the episodes it folded, their size, and the summary. */
function foldText(ids: string[], tokens: number, summary: string, partOf?: string): string {
	const episodes = `${plural(ids.length, "episode")} (${ids.join(", ")})${partOf ? `, and the start of episode ${partOf}, whose latest messages follow` : ""}`;
	const ofAll = partOf ? [...ids, partOf] : ids;
	return [foldTag(ofAll), `Folded: ${episodes}, about ${size(tokens)} tokens. \`episode_read\` with an episode id gives it back.`, "", summary.trim(), "</agentx-folded>"].join(
		"\n",
	);
}

// The rules for a summary, the agent's in a fold nudge and those of the model call that writes a compaction's.
const summaryRules = [
	"Write the summary to stand alone: whoever reads it has not seen what it replaces.",
	"Keep the goals and how they changed, decisions with their reasons, and the exact paths, names, values, commands and errors of the work, and the ids of what it touched, such as files, events and issues: what was done and what was found.",
	"Drop tool output that has been used, failed attempts that taught nothing, and repetition.",
	"Write the state of the work as history, not as orders, and end with what is still open.",
	"Do not name the episodes it covers: its tag lists them.",
];

export default function (pi: ExtensionAPI) {
	const own = () => (pi.getSettings() as Settings).agentx?.memory?.compaction ?? {};
	const enabled = () => own().enabled !== false;

	// An input while Pi is idle starts an episode: the message it becomes starts with the episode's line, after the system message Pi writes first. An input
	// while a run starts or goes on joins that run. A command typed with "/", a skill's or a prompt template's, must start its text, so it starts none.
	pi.on("input", (event, ctx) => {
		if (!ctx.isIdle() || event.text.startsWith("/")) return;
		return { action: "transform", text: `${startLine(newId())}${event.text}` };
	});

	pi.on("before_agent_start", (event, ctx) => {
		const model = ctx.model;
		if (!model) return;
		event.systemPromptOptions.sections["agentx-model"] = [
			"# Your model",
			"",
			`You run on \`${model.provider}/${model.id}\`, with a context window of ${size(model.contextWindow)} tokens and up to ${size(model.maxTokens)} tokens of output.`,
		].join("\n");
	});

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
			const nudge = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "custom_message" && entry.customType === foldNudgeType);
			if (!nudge || !visible(nudge.id)) throw new Error("Fold only when a message asks you to; none does now.");
			const episodes = allEpisodes(ctx.sessionManager);
			const index = (id: string) => episodeAt(episodes, id);
			// The earlier folds the model sees, each as the indexes of its first and last episodes, which its tag names in order.
			const earlier = [...projected.values()]
				.flatMap((messages) => messages.map((message) => foldedEpisodes(textOf(message))))
				.filter((ids) => ids.length > 0)
				.map((ids) => [index(ids[0]), index(ids[ids.length - 1])]);
			// A wrong id would make Pi refuse every edit of the turn, so each range is checked here.
			const spans = ranges.map(({ from, to, summary }) => {
				let first = index(from);
				const end = index(to);
				if (end <= first) throw new Error(end === first ? `\`to\` is the first episode to keep, after the range: episode ${to} is the range's own first episode.` : `Episode ${to} comes before episode ${from}.`);
				let last = end - 1;
				// Part of an earlier fold takes in all of it, until nothing more joins.
				for (let grown = true; grown; ) {
					grown = false;
					for (const [low, high] of earlier) {
						if (high < first || low > last) continue;
						if (low < first || high > last) grown = true;
						first = Math.min(first, low);
						last = Math.max(last, high);
					}
				}
				// The first message the model sees of the range. A compaction can have summarized the start of its first episode, or all of it.
				const target = episodes[first].items.find((item) => visible(item.entry.id));
				if (!target) throw new Error(`Episode ${episodes[first].id} was summarized when your context was compacted.`);
				return { first, last, targetId: target.entry.id, summary };
			});
			const sorted = spans.toSorted((a, b) => a.first - b.first);
			for (const [i, span] of sorted.entries()) {
				if (i > 0 && span.first <= sorted[i - 1].last) throw new Error(`The ranges from episode ${episodes[sorted[i - 1].first].id} and from episode ${episodes[span.first].id} overlap.`);
			}
			let before = 0;
			let after = 0;
			const edits = spans.flatMap(({ first, last, targetId, summary }) => {
				const folded = episodes.slice(first, last + 1);
				// What the model sees of them now, earlier folds' summaries included; what an earlier fold omitted stays so.
				const entryIds = [...new Set(folded.flatMap((episode) => episode.items.map((item) => item.entry.id)))].filter(visible);
				const tokens = entryIds.reduce((sum, id) => sum + (projected.get(id) ?? []).reduce((total, message) => total + estimateTokens(message), 0), 0);
				const text = foldText(
					folded.map((episode) => episode.id),
					tokens,
					summary,
				);
				before += tokens;
				after += Math.ceil(text.length / 4);
				return [{ type: "context_edit" as const, targetId, replacement: { content: text } }, ...entryIds.filter((id) => id !== targetId).map(omit)];
			});
			return {
				content: [{ type: "text", text: `Folded ${plural(spans.length, "range")}: about ${size(before)} tokens become ${size(after)}, from the end of this turn.` }],
				details: { edits },
			};
		},
	});

	pi.registerTool({
		name: "episode_read",
		label: "Read an episode back",
		description:
			"Gives back an episode of this thread, as Markdown, also when it was folded or summarized: its messages, your text, your tool calls and their results. Images are named, not shown: open their files with `read`.",
		parameters: {
			type: "object",
			properties: {
				episode: { type: "string", description: "The episode's id, as its start and end messages give it." },
				before: { type: "number", description: "How many episodes before it to add; none when left out." },
				after: { type: "number", description: "How many episodes after it to add; none when left out." },
				page: { type: "number", description: "Which page of a long answer, from 1." },
			},
			required: ["episode"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const { episode, before = 0, after = 0, page = 1 } = params as { episode: string; before?: number; after?: number; page?: number };
			const episodes = allEpisodes(ctx.sessionManager);
			const at = episodeAt(episodes, episode);
			const text = markdown(episodes.slice(Math.max(0, at - before), at + after + 1));
			const pages = Math.max(1, Math.ceil(text.length / pageChars));
			const part = text.slice((page - 1) * pageChars, page * pageChars);
			return { content: [{ type: "text", text: pages === 1 ? part : `${part}\n\n[Page ${page} of ${pages}. Call episode_read with page ${page + 1} for more.]` }], details: undefined };
		},
	});

	// Applies what the turn's `fold` calls folded. The calls stay until the fold nudge's turn is over, so the model sees what it did for the nudge.
	pi.on("turn_end", (event, ctx) => {
		if (event.outcome !== "completed" || ctx.signal?.aborted) return;
		const edits = event.toolResults.flatMap((result) => (result.toolName === "fold" && !result.isError ? (result.details as unknown as { edits: ContextEditEntryDraft[] }).edits : []));
		if (edits.length > 0) return { entries: [...event.entries, ...edits] };
	});

	// Once an episode is over: its end message, and a fold nudge when one is due, with one more turn to fold. When that turn is over, or the next episode when
	// the turn was cut off, the fold nudge and what came after it leave the context, up to the next episode or a message a person typed into the turn. It says
	// how to fold, so that leaves too.
	pi.on("agent_before_settle", (event, ctx) => {
		const session = ctx.sessionManager;
		const branch = session.getBranch();
		const projected = projection(session);
		const visible = (id: string) => isVisible(projected, id);
		const entries: SessionBoundaryDraft[] = [...event.entries];
		const nudgeAt = branch.findLastIndex((entry) => entry.type === "custom_message" && entry.customType === foldNudgeType);
		if (nudgeAt >= 0 && visible(branch[nudgeAt].id)) {
			const next = branch.findIndex((entry, at) => at > nudgeAt && entry.type === "message" && entry.message.role === "user");
			entries.push(...branch.slice(nudgeAt, next < 0 ? undefined : next).flatMap((entry) => (editable(entry) && visible(entry.id) ? [omit(entry.id)] : [])));
		}
		const episodes = visibleEpisodes(session, projected);
		const episode = episodes.at(-1);
		// A one-shot run, such as `agentx chat -p`, gets no end message: Pi's print mode answers with the last message only when it is the model's.
		if (!episode || episode.ended || ctx.mode === "print" || ctx.mode === "json") return { entries };
		entries.push({ type: "custom_message", customType: endType, display: true, content: `Episode ${episode.id} ended. It used about ${size(episode.tokens)} tokens of your context.` });
		// A fold needs an episode besides the newest, which stays.
		if (!enabled() || event.outcome !== "completed" || episodes.length < 2) return { entries };
		const window = ctx.model?.contextWindow ?? 0;
		const every = own().foldNudgeEvery ?? 0.1;
		const order = new Map(branch.map((entry, at) => [entry.id, at]));
		const since = episodes.filter((found) => (order.get(found.items[0].entry.id) ?? 0) > nudgeAt).reduce((sum, found) => sum + found.tokens, 0);
		if (since <= (Number.isInteger(every) ? every : every * window)) return { entries };
		const tokens = ctx.getContextUsage()?.tokens ?? episodes.reduce((sum, found) => sum + found.tokens, 0);
		entries.push({
			type: "custom_message",
			customType: foldNudgeType,
			display: true,
			content: [
				`Your context holds about ${size(tokens)} of ${size(window)} tokens. Fold the earlier episodes your work no longer needs with \`fold\`.`,
				"",
				"- Fold the oldest finished tasks first: work that is done, whose details your next steps will not need. Never fold an episode whose task is still going on, even when the episode has ended.",
				"- Give one or more ranges that do not overlap, each from episode `from` up to episode `to`, the first episode to keep, with its summary. Name episodes by the ids their first messages and end messages give. The newest episode stays.",
				"- A range that takes in part of an earlier fold takes all of it, so its summary must cover the old one too.",
				"- Each summary takes its range's place, marked as folded with its episode ids. `episode_read` gives a folded episode back.",
				...summaryRules.map((rule) => `- ${rule}`),
				"",
				"When nothing should be folded, say only that. This message and what you do for it then leave your context.",
			].join("\n"),
		});
		return { entries, continue: true };
	});

	// Pi compacts when the context nears the window's end, and when a person asks with /compact. The extension keeps the last episodes whole when it can.
	// Pi compacts by itself when the handler returns nothing, and also when it throws, after it reports the error.
	pi.on("session_before_compact", async (event, ctx) => {
		if (!enabled()) return;
		const { preparation } = event;
		const episodes = visibleEpisodes(ctx.sessionManager);
		// The newest episodes, as many as `keepEpisodes` and as fit in Pi's `keepRecentTokens`. None fits, or all do: Pi's own cut, which keeps a tool call
		// with its result.
		const keep = Math.min(own().keepEpisodes ?? 10, episodes.length);
		let kept = 0;
		let tokens = 0;
		while (kept < keep && tokens + episodes[episodes.length - 1 - kept].tokens <= preparation.settings.keepRecentTokens) tokens += episodes[episodes.length - 1 - kept++].tokens;
		const firstKeptEntryId = kept > 0 && kept < episodes.length ? episodes[episodes.length - kept].items[0].entry.id : preparation.firstKeptEntryId;
		// What the model sees before the first kept entry, which Pi's cut can put on one it does not see, such as a refused answer.
		const order = new Map(ctx.sessionManager.getBranch().map((entry, at) => [entry.id, at]));
		const keptAt = order.get(firstKeptEntryId) ?? Number.POSITIVE_INFINITY;
		const items = episodes.flatMap((episode) => episode.items.map((item) => ({ ...item, episode: episode.id })));
		const found = items.findIndex((item) => (order.get(item.entry.id) ?? 0) >= keptAt);
		const cut = found < 0 ? items.length : found;
		if (cut === 0) return;
		const older = items.slice(0, cut);
		const model = ctx.model;
		if (!model) return;
		const previous = preparation.previousSummary;
		const prompt = [
			...(previous ? ["The summary so far:", "<summary>", previous, "</summary>", ""] : []),
			"The conversation to add to it, in which `<agentx-folded>` parts are the agent's own summaries of earlier episodes:",
			"<conversation>",
			serializeConversation(convertToLlm(older.map((item) => item.message))),
			"</conversation>",
			"",
			"Write one summary of all of it, for the agent to go on from.",
			...summaryRules,
			...(event.customInstructions ? ["", event.customInstructions] : []),
		].join("\n");
		const response = await ctx.modelRegistry.complete(
			model,
			{
				systemPrompt: "You summarize a conversation between people and an AI agent, so that the agent can go on with its work. Do not continue the conversation. Write only the summary.",
				messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
			},
			{ signal: event.signal },
		);
		// Only a finished answer: not one cut off at the token limit, nor one that calls a tool.
		if (response.stopReason !== "stop") return;
		const summary = response.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
		if (summary === "") return;
		// The episodes it summarizes: the previous summary's, and those before the cut. One the cut is inside goes on after it: the episode of the first kept
		// message, or, when the cut is after all the model sees, the episode in progress.
		const newest = episodes[episodes.length - 1];
		const partOf = cut < items.length ? (items[cut].episode === older[cut - 1].episode ? items[cut].episode : undefined) : newest.ended ? undefined : newest.id;
		const ids = [...new Set([...foldedEpisodes(previous ?? ""), ...older.map((item) => item.episode)])].filter((id) => id !== partOf);
		const summarized = older.reduce((sum, item) => sum + estimateTokens(item.message), 0);
		return {
			compaction: { summary: foldText(ids, summarized, summary, partOf), firstKeptEntryId, tokensBefore: preparation.tokensBefore, usage: response.usage, details: { agentx: true } },
		};
	});
}
