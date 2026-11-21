// An episode as Markdown, the form the memory index keeps, searches and gives back.

import { type AgentMessage, type Episode, endOf, plural, textOf } from "../episodes/episodes.js";

// A fence that the text cannot close.
function fenced(text: string, language = ""): string {
	const fence = text.includes("```") ? "````" : "```";
	return `${fence}${language}\n${text}\n${fence}`;
}

/** An episode as Markdown, a text per turn, which joined with blank lines are the episode's: its messages, the model's text, its tool calls and their
 * results. A turn is one answer of the model with the results of its tool calls, after the messages that led to it. Images are named, not shown. Its end
 * message is left out. */
export function transcript(episode: Episode): string[] {
	const turns: string[][] = [];
	let parts: string[] = [];
	let last: AgentMessage["role"] | undefined;
	for (const { entry, message } of episode.items) {
		if (endOf(entry)) continue;
		// Taken from the messages, not the Markdown, which may hold anything a person or the model wrote.
		if ((last === "assistant" || last === "toolResult") && message.role !== "toolResult") {
			turns.push(parts);
			parts = [];
		}
		last = message.role;
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
	return [...turns, parts].map((turn) => turn.join("\n\n")).filter((turn) => turn !== "");
}
