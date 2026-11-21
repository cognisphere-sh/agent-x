// The episode extension, loaded by Pi into every agent: where each of Pi's runs ends, a message that gives the episode's id and the tokens it added to the
// context, which starts no model call by itself. The context extension folds episodes and the memory extension indexes them (episodes.ts).

import { type ExtensionAPI, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { newId } from "../../../../events/queue.js";
import { endOf, endType, episodesIn, size, tokensOf } from "./episodes.js";

/** Ends each episode with its end message. */
export default function (pi: ExtensionAPI) {
	pi.on("agent_before_settle", (event, ctx) => {
		// A one-shot run, such as `agentx chat -p`, gets none: Pi's print mode answers with the last message only when it is the model's.
		if (ctx.mode === "print" || ctx.mode === "json") return;
		// The episode in progress is all after the last end message.
		const branch = ctx.sessionManager.getBranch();
		const after = branch.slice(branch.findLastIndex((entry) => endOf(entry) !== undefined) + 1);
		const [episode] = episodesIn(after, sessionEntryToContextMessages);
		// None in progress: the run was a fold nudge's turn, after the episode's end.
		if (!episode) return;
		const id = newId();
		// After a compaction inside the episode, its answers read contexts that cannot be compared.
		const compacted = after.slice(after.indexOf(episode.items[0].entry)).some((entry) => entry.type === "compaction");
		const tokens = compacted ? undefined : tokensOf(episode);
		const used = tokens === undefined ? "" : ` It used about ${size(tokens)} tokens of your context.`;
		return { entries: [...event.entries, { type: "custom_message", customType: endType, display: true, content: `Episode ${id} ended.${used}`, details: { id, tokens } }] };
	});
}
