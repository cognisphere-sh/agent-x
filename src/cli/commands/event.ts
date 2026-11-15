// `agentx event send|deliver`: the agent sends an event, and a person delivers one to an agent.

import { basename } from "node:path";
import { parseArgs } from "node:util";
import type { NewEvent } from "../../agent-runtime/events/queue.js";
import { sendEvent, sendingThread } from "../../agent-runtime/events/send-event.js";
import { agentXOf } from "../../agent-runtime/project-config.js";
import { deliverTo } from "../../coordinator-runtime/deliver-event.js";

const usage = `usage:
  agentx event send [options] [--] <content>
                           the agent sends an event, from its own processes, such as the model's bash: into its outbox, which agentx serve delivers
  agentx event deliver [options] [--] <content>
                           a person delivers an event straight into the agent's inbox
    --agent <name>         another agent of the project (default: this one)
    --thread-id <id>       the thread the event belongs to, or workflow.<name> (default: none, the agent's router picks it)
    --key <key>            sending again with the same key adds nothing
    --do-not-steer         wait for the thread's next run instead of joining the one in progress
    --silent               do not start a run for this event
    --meta <name>=<value>  a fact for the agent about the event, such as --meta from=ops; repeat it for more
    --file <path>          a file that goes with the event; repeat it for more`;

/** Runs `agentx event <action> ...` in the agent directory `agentRoot`. */
export function event(agentRoot: string, args: string[]): void {
	const [action, ...rest] = args;
	if (action === "send") send(agentRoot, rest);
	else if (action === "deliver") deliver(agentRoot, rest);
	else throw new Error(usage);
}

// The agent's send, from its own processes, such as the model's bash, which have AGENTX_AGENT.
function send(agentRoot: string, args: string[]): void {
	const runs = process.env.AGENTX_AGENT;
	if (runs === undefined) throw new Error(`agentx event send is the agent's own, run in its processes, such as the model's bash. To give an agent an event, use agentx event deliver.\n${usage}`);
	// It sends only as the agent it runs in, not as one whose directory it went into.
	if (runs !== basename(agentRoot)) throw new Error(`This runs inside agent "${runs}", so it sends only from that agent's directory. To send to another agent, use --agent.`);
	const { event, to, files, said } = parsed(agentRoot, args);
	const id = sendEvent(agentRoot, event, { to, files });
	console.log(`Sent event ${id} ${said}. agentx serve delivers it; a refusal comes back on thread "${sendingThread()}".`);
}

// A person's delivery, straight into the agent's inbox, as the coordinator delivers. Not the agent's, which would pass its canSendTo.
function deliver(agentRoot: string, args: string[]): void {
	if (process.env.AGENTX_AGENT !== undefined) throw new Error(`agentx event deliver is for people, not the agent's processes, which send with agentx event send.\n${usage}`);
	const { event, to = basename(agentRoot), files, said } = parsed(agentRoot, args);
	const id = deliverTo(agentXOf(agentRoot), to, event, { files });
	console.log(`Delivered event ${id} ${said}.`);
}

// The event the arguments give, and how to say where it goes. Strict: an unknown or misspelt option is an error. What follows `--` is content, also when it starts with dashes.
function parsed(agentRoot: string, args: string[]): { event: NewEvent; to: string | undefined; files: string[]; said: string } {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			agent: { type: "string" },
			"thread-id": { type: "string" },
			key: { type: "string" },
			"do-not-steer": { type: "boolean", default: false },
			silent: { type: "boolean", default: false },
			meta: { type: "string", multiple: true, default: [] },
			file: { type: "string", multiple: true, default: [] },
		},
	});
	// Where the event comes from, unless the sender says.
	const metadata: Record<string, string> = { source: "cli" };
	for (const entry of values.meta) {
		const [name, value] = entry.split(/=(.*)/s);
		if (!name || value === undefined) throw new Error(`--meta ${entry} needs a name and a value, such as --meta from=ops.\n${usage}`);
		metadata[name] = value;
	}
	if (positionals.length === 0) throw new Error(`Nothing to send.\n${usage}`);
	const threadId = values["thread-id"];
	const event = { threadId, key: values.key, content: positionals.join(" "), metadata, doNotSteer: values["do-not-steer"], isSilent: values.silent };
	const facts = Object.entries(metadata).map(([name, value]) => `${name}=${value}`);
	const where = threadId === undefined ? "for the router" : `on thread "${threadId}"`;
	const elsewhere = values.agent !== undefined && values.agent !== basename(agentRoot);
	return { event, to: values.agent, files: values.file, said: `${where}${elsewhere ? ` of agent "${values.agent}"` : ""} with ${facts.join(", ")}` };
}
