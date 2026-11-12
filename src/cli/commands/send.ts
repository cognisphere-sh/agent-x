// `agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--meta <name>=<value> ...] <content>`: puts a message on the agent's queue.

import { parseArgs } from "node:util";
import { Queue } from "../../agent-runtime/pi-package/extensions/message-queue/queue.js";

const usage = `usage: agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--meta <name>=<value> ...] [--] <content>
  --thread-id <id>       the conversation the message belongs to (default: main)
  --do-not-steer         wait for the thread's next run instead of joining the one in progress
  --silent               do not start a run for this message
  --meta <name>=<value>  a fact for the agent about the message, such as --meta from=ops; repeat it for more`;

/** Adds a message to the queue of the agent in `agentRoot` and says what was queued. */
export function sendMessage(agentRoot: string, args: string[]): void {
	// Strict: an unknown or misspelt option is an error. What follows `--` is content, also when it starts with dashes.
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			"thread-id": { type: "string", default: "main" },
			"do-not-steer": { type: "boolean", default: false },
			silent: { type: "boolean", default: false },
			meta: { type: "string", multiple: true, default: [] },
		},
	});
	const metadata: Record<string, string> = {};
	for (const entry of values.meta) {
		const [name, value] = entry.split(/=(.*)/s);
		if (!name || value === undefined) throw new Error(`--meta ${entry} needs a name and a value, such as --meta from=ops.\n${usage}`);
		metadata[name] = value;
	}
	if (positionals.length === 0) throw new Error(`Nothing to send.\n${usage}`);
	const threadId = values["thread-id"];
	const queue = new Queue(agentRoot);
	const id = queue.enqueue({ threadId, content: positionals.join(" "), metadata, doNotSteer: values["do-not-steer"], isSilent: values.silent });
	queue.close();
	const facts = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
	console.log(`Queued message ${id} on thread "${threadId}"${facts.length > 0 ? ` with ${facts.join(", ")}` : ""}.`);
}
