// How queued events look to the model: a metadata block, then the content. The harness prompt explains the block to the agent.

import type { Event } from "../../../../events/queue.js";

/** The text Pi receives for events delivered together. Their times are shown in `timeZone`, or in the machine's time zone when none is given. */
export function render(events: Event[], timeZone?: string): string {
	const now = dayDateTime(Date.now(), timeZone);
	return events
		.map((event) =>
			[
				// The queue refuses an event whose text holds this tag, so only the harness writes one.
				`<agentx-metadata id="${event.id}">`,
				`agentX-ThreadId: ${event.threadId}`,
				`agentX-SentTime: ${dayDateTime(event.createdAt, timeZone)}`,
				`agentX-CurrentTime: ${now}`,
				`agentX-IsRetry: ${event.attempts > 1}`,
				...(event.attempts > 1 ? [`agentX-RetryAttempt: ${event.attempts - 1}`] : []),
				...(event.isSilent ? ["agentX-IsSilent: true"] : []),
				// The event's metadata, one fact per line: the sender's, and any `agentX-` fact the harness added, such as agentX-RouterError,
				// which no sender may name. A line break in a value could fake a line of the harness.
				...Object.entries(event.metadata).map(([name, value]) => `${name}: ${(typeof value === "string" ? value : JSON.stringify(value)).replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ")}`),
				"</agentx-metadata>",
				event.content,
			].join("\n"),
		)
		.join("\n\n");
}

/** The ids of the queued events in a text that `render` produced, read from the opening tags of their metadata blocks. */
export function eventIds(text: string): string[] {
	return [...text.matchAll(/<agentx-metadata id="([\w-]+)">/g)].map((match) => match[1]);
}

// "Wednesday 2026-11-11 21:59:54 GMT+5:30".
function dayDateTime(time: number, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "shortOffset",
		timeZone,
	}).formatToParts(time);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((found) => found.type === type)?.value;
	return `${part("weekday")} ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} ${part("timeZoneName")}`;
}
