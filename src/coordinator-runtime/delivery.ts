// Delivery between agents: the coordinator takes each agent's outbox and delivers every event into the inbox of the agent it is for, as it delivers
// every event, or tells the sending thread why it cannot. The outbox is the sender's own folder, so it names the sender; everything else in it is the sender's word,
// and is checked as input from outside, as it will be from a sandbox. Mailboxes are reached in the project's central storage, as a sandbox's host has no link to them. Whom the sender may send to comes from the project's agentx.json, never from the outbox.

import { basename } from "node:path";
import { deliverEvent, type Prepared, prepareDelivery } from "./deliver-event.js";
import { done, filesIn, type Mail, mailId, outbox, put, waiting } from "../agent-runtime/events/mailbox.js";
import { isThreadId, nameRule, withoutBlockTag } from "../agent-runtime/events/queue.js";
import { agentIn, agentXOf, canSendTo } from "../agent-runtime/project-config.js";
import { centralStorage } from "../agent-runtime/storage.js";
import { missingWorkflow } from "../agent-runtime/workflows/workflows.js";

/** Delivers the waiting events in the outbox of the agent in `senderRoot`, oldest first. Throws on a file that cannot be written; the event then waits for the next call. */
export function deliverOutbox(senderRoot: string): void {
	const box = outbox(centralStorage(senderRoot));
	const rejected = (marker: string, why: string) => console.error(`outbox of ${senderRoot}: ${marker} cannot be read and is set aside in .rejected/: ${why}`);
	for (const { marker, mail } of waiting(box, rejected)) {
		// The thread that sent it, which hears of a refusal and gets the answers: main when the sender names none it has, so a refusal can always reach it.
		const fromThread = isThreadId(mail.from?.thread) && missingWorkflow(senderRoot, mail.from.thread) === undefined ? mail.from.thread : "main";
		const prepared = check(senderRoot, box, mail, fromThread);
		if (typeof prepared === "string") refuse(senderRoot, mail, fromThread, prepared);
		// Written as deliverEvent writes it. A write that fails throws, and the event is tried again on the next call.
		else put(prepared.box, prepared.mail, prepared.files);
		done(box, marker);
	}
}

// The event made ready for the receiver's inbox, as every delivered event is, or why it cannot be delivered. First what only an event from another agent
// must pass: the agent it names, the sender's canSendTo and an id made from its key. Only the sender's own fields are kept; its agentX- facts give way to
// the coordinator's, which name the agent whose outbox it is.
function check(senderRoot: string, box: string, mail: Mail, fromThread: string): Prepared | string {
	const { id, to, event } = mail;
	if (typeof to !== "string" || !nameRule.test(to)) return "it names no agent to send it to.";
	const receiver = agentIn(agentXOf(senderRoot), to);
	if (receiver === undefined) return `this project has no agent "${to}".`;
	const allowed = canSendTo(senderRoot).map((agent) => agent.name);
	// An agent's events to itself come this way too, which canSendTo does not limit.
	if (to !== basename(senderRoot) && !allowed.includes(to)) return `this agent may send events only to ${allowed.length === 0 ? "no agent" : allowed.join(", ")}, by its canSendTo in agentx.json.`;
	if (typeof event !== "object" || event === null) return "it has no event.";
	// The id is made from the receiver and the key, so a sender cannot give its event the id of another event of the receiver.
	if (typeof event.key !== "string" || mailId(to, event.key) !== id) return "its id was not made from its key.";
	const facts: Record<string, string> = { "agentX-FromAgent": basename(senderRoot), "agentX-FromThread": fromThread };
	if (typeof mail.from?.workflow === "string" && nameRule.test(mail.from.workflow)) facts["agentX-FromWorkflow"] = mail.from.workflow;
	const clean = { threadId: event.threadId, content: event.content, metadata: event.metadata, key: event.key, doNotSteer: event.doNotSteer === true, isSilent: event.isSilent === true };
	try {
		// The folder's files as they are, whatever its event.json lists. A link is refused, not followed: the coordinator can read every file, the sender cannot.
		return prepareDelivery(receiver, clean, { facts, files: filesIn(box, id), sentAt: Number(mail.sentAt) || Date.now() });
	} catch (error) {
		return (error as Error).message;
	}
}

// Tells the sending thread that its event was not delivered, and why.
function refuse(senderRoot: string, mail: Mail, thread: string, why: string): void {
	const { id } = mail;
	const said = typeof mail.event?.content === "string" ? mail.event.content : "";
	const content = [
		`Your event \`${id}\` to agent \`${withoutBlockTag(String(mail.to))}\` was not delivered: ${withoutBlockTag(why)}`,
		"",
		"It said:",
		"",
		withoutBlockTag(said).replace(/^/gm, "> "),
		"",
		`What you sent, with its files, is in \`storage/workspace/outbox/${id}/\`.`,
	].join("\n");
	deliverEvent(senderRoot, { threadId: thread, content, key: `undeliverable:${id}`, metadata: { source: "coordinator" } });
	console.error(`${basename(senderRoot)}: event ${id} was not delivered: ${why}`);
}
