// How queue messages look to the model: a metadata block, then the content. The harness prompt explains the block to the agent.

import type { Message } from "./queue.js";

/** The text Pi receives for messages delivered together. Their time is shown in `timeZone`, or in the machine's time zone when none is given. */
export function render(messages: Message[], timeZone?: string): string {
	const now = dayDateTime(Date.now(), timeZone);
	return messages
		.map((message) =>
			[
				"<metadata>",
				`agentX-MessageId: ${message.id}`,
				`agentX-ThreadId: ${message.threadId}`,
				`agentX-CurrentTime: ${now}`,
				`agentX-IsRetry: ${message.attempts > 1}`,
				...(message.attempts > 1 ? [`agentX-RetryAttempt: ${message.attempts - 1}`] : []),
				...(message.isSilent ? ["agentX-IsSilent: true"] : []),
				// The sender's metadata, one fact per line. A line break in a value could fake a line of the harness.
				...Object.entries(message.metadata).map(([name, value]) => `${name}: ${(typeof value === "string" ? value : JSON.stringify(value)).replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ")}`),
				"</metadata>",
				message.content,
			].join("\n"),
		)
		.join("\n\n");
}

/** The ids of the queue messages in a text that `render` produced: the first line of each metadata block. */
export function messageIds(text: string): number[] {
	return [...text.matchAll(/<metadata>\nagentX-MessageId: (\d+)\n/g)].map((match) => Number(match[1]));
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
