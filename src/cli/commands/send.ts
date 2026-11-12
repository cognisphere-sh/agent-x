// `agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--<name> <value> ...] <content>`: puts a message on the agent's queue.

import { Queue } from "../../agent-runtime/pi-package/extensions/message-queue/queue.js";

const usage = `usage: agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--<name> <value> ...] [--] <content>
  --thread-id <id>     the conversation the message belongs to (default: main)
  --do-not-steer       wait for the thread's next run instead of joining the one in progress
  --silent             do not start a run for this message
  --<name> <value>     any other option is metadata for the agent, such as --from ops`;

/** Adds a message to the queue of the agent in `agentRoot` and says what was queued. */
export function sendMessage(agentRoot: string, args: string[]): void {
	let threadId = "main";
	let doNotSteer = false;
	let isSilent = false;
	const metadata: Record<string, string> = {};
	const content: string[] = [];
	for (let at = 0; at < args.length; at++) {
		const arg = args[at];
		// What follows `--` is content, also when it starts with dashes.
		if (arg === "--") {
			content.push(...args.slice(at + 1));
			break;
		}
		if (!arg.startsWith("--")) content.push(arg);
		else if (arg === "--do-not-steer") doNotSteer = true;
		else if (arg === "--silent") isSilent = true;
		else {
			// --name value, or --name=value. Every option that is not one of agentx's is metadata.
			const [name, inline] = arg.slice(2).split(/=(.*)/s);
			const value = inline ?? args[++at];
			if (name === "" || value === undefined) throw new Error(`${arg} needs a value.\n${usage}`);
			if (name === "thread-id") threadId = value;
			else metadata[name] = value;
		}
	}
	// A misspelt option becomes metadata and takes the next word as its value, which can be the content.
	if (content.length === 0) throw new Error(`Nothing to send: no content was left after the options.\n${usage}`);
	const queue = new Queue(agentRoot);
	const id = queue.enqueue({ threadId, content: content.join(" "), metadata, doNotSteer, isSilent });
	queue.close();
	const facts = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
	console.log(`Queued message ${id} on thread "${threadId}"${facts.length > 0 ? ` with ${facts.join(", ")}` : ""}.`);
}
