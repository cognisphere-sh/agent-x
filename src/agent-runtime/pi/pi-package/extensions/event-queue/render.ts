// How queued events look to the model: a metadata block, then the content. The harness prompt explains the block to the agent.

import type { Event } from "../../../../events/queue.js";
import { dayDateTime } from "../../../../time-zone.js";

/** The text Pi receives for events delivered together. Their times are shown in `timeZone`, or in the machine's time zone when none is given. */
export function render(events: Event[], timeZone?: string): string {
	const now = dayDateTime(Date.now(), timeZone);
	return events
		.map((event) =>
			[
				// The queue refuses an event whose text holds this tag, so only the harness writes one.
				`<agentX-metadata id="${event.id}">`,
				`agentX-ThreadId: ${event.threadId}`,
				`agentX-SentTime: ${dayDateTime(event.createdAt, timeZone)}`,
				`agentX-CurrentTime: ${now}`,
				`agentX-IsRetry: ${event.attempts > 1}`,
				...(event.attempts > 1 ? [`agentX-RetryAttempt: ${event.attempts - 1}`] : []),
				...(event.isSilent ? ["agentX-IsSilent: true"] : []),
				// The event's metadata, one fact per line: the sender's, and any `agentX-` fact the harness added, such as agentX-RouterError,
				// which no sender may name. A line break in a value could fake a line of the harness.
				...Object.entries(event.metadata).map(([name, value]) => `${name}: ${(typeof value === "string" ? value : JSON.stringify(value)).replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ")}`),
				"</agentX-metadata>",
				event.content,
			].join("\n"),
		)
		.join("\n\n");
}

/** The ids of the queued events in a text that `render` produced, read from the opening tags of their metadata blocks. */
export function eventIds(text: string): string[] {
	return [...text.matchAll(/<agentX-metadata id="([\w-]+)">/g)].map((match) => match[1]);
}
