// A stand-in for a model endpoint (OpenAI chat-completions, streaming) on 127.0.0.1, so tests run real Pi sessions with no network and no login.
// It answers by the last message of the request.
// After a tool result, text; when the request offers tools, "[sleep N]", a bash tool call that sleeps; "[bash <command>]", a bash tool call of that command;
// "[tool <name> <JSON arguments>]" on a line of its own, a call of that tool; "[fail]", an HTTP 400; otherwise text. `answerWhen(match, directive)` answers
// the first request that asks something with `match` in it, a tool result too, as if it asked `directive`. Each answer reports its usage: a quarter of the
// request's length read, and of its own written.

import { createServer } from "node:http";

/** Starts the endpoint on a free port. `requests` collects, per request, the texts of its user messages, `systemPrompts` its system prompt, and `tools` the names of its tools. */
export async function startFakeModel() {
	const requests = [];
	const systemPrompts = [];
	const tools = [];
	const scripts = [];
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			const { messages, tools: declared } = JSON.parse(body);
			tools.push((declared ?? []).map((tool) => tool.function.name));
			const text = (message) => (typeof message.content === "string" ? message.content : (message.content ?? []).map((part) => part.text ?? "").join("\n"));
			const last = messages.at(-1);
			const asked = text(last);
			requests.push(messages.filter((message) => message.role === "user").map(text));
			systemPrompts.push(messages.filter((message) => message.role === "system" || message.role === "developer").map(text).join("\n"));
			const script = scripts.findIndex(([match]) => asked.includes(match));
			const directed = last.role === "user" || script >= 0;
			const lastText = script >= 0 ? scripts.splice(script, 1)[0][1] : asked;

			const refuse = directed && lastText.includes("[fail]") && "The fake model was told to fail.";
			if (refuse) {
				response.writeHead(400, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: refuse, type: "invalid_request_error" } }));
				return;
			}
			const chunk = (delta, finish = null) =>
				`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			// A request that offers no tools gets text.
			const calls = directed && (declared ?? []).length > 0;
			const sleep = calls && /\[sleep ([\d.]+)\]/.exec(lastText);
			const bash = calls && /\[bash (.+)\]/.exec(lastText);
			const tool = calls && /^\[tool (\w+) (\{.*\})\]$/m.exec(lastText);
			let written;
			if (sleep || bash || tool) {
				const command = sleep ? `sleep ${sleep[1]}` : bash?.[1];
				const call = { index: 0, id: `call_${requests.length}`, type: "function", function: tool ? { name: tool[1], arguments: tool[2] } : { name: "bash", arguments: JSON.stringify({ command }) } };
				response.write(chunk({ role: "assistant", content: null, tool_calls: [call] }));
				response.write(chunk({}, "tool_calls"));
				written = JSON.stringify(call.function);
			} else {
				written = `reply ${requests.length}`;
				response.write(chunk({ role: "assistant", content: written }));
				response.write(chunk({}, "stop"));
			}
			const [read, wrote] = [JSON.stringify(messages).length, written.length].map((chars) => Math.ceil(chars / 4));
			response.write(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [], usage: { prompt_tokens: read, completion_tokens: wrote, total_tokens: read + wrote } })}\n\n`);
			response.end("data: [DONE]\n\n");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		requests,
		systemPrompts,
		tools,
		port: server.address().port,
		answerWhen: (match, directive) => {
			scripts.push([match, directive]);
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
