// A stand-in for a model endpoint (OpenAI chat-completions, streaming) on 127.0.0.1, so tests run real Pi sessions with no network and no login.
// It answers by the last message of the request: after a tool result, text; "[sleep N]" in a user message, a bash tool call; "[fail]", an HTTP 400; otherwise text.

import { createServer } from "node:http";

/** Starts the endpoint on a free port. `requests` collects, per request, the texts of its user messages, and `systemPrompts` its system prompt. */
export async function startFakeModel() {
	const requests = [];
	const systemPrompts = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			const { messages } = JSON.parse(body);
			const text = (message) => (typeof message.content === "string" ? message.content : (message.content ?? []).map((part) => part.text ?? "").join("\n"));
			const last = messages.at(-1);
			const lastText = text(last);
			requests.push(messages.filter((message) => message.role === "user").map(text));
			systemPrompts.push(messages.filter((message) => message.role === "system" || message.role === "developer").map(text).join("\n"));

			if (last.role === "user" && lastText.includes("[fail]")) {
				response.writeHead(400, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "The fake model was told to fail.", type: "invalid_request_error" } }));
				return;
			}
			const chunk = (delta, finish = null) =>
				`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			const sleep = last.role === "user" && /\[sleep ([\d.]+)\]/.exec(lastText);
			if (sleep) {
				const call = { index: 0, id: `call_${requests.length}`, type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `sleep ${sleep[1]}` }) } };
				response.write(chunk({ role: "assistant", content: null, tool_calls: [call] }));
				response.write(chunk({}, "tool_calls"));
			} else {
				response.write(chunk({ role: "assistant", content: `reply ${requests.length}` }));
				response.write(chunk({}, "stop"));
			}
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { requests, systemPrompts, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}
