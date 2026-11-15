// Delivers an event: puts it into an agent's inbox, where its router takes it into the queue. The only code that writes an inbox, and the coordinator runtime's:
// the coordinator delivers what agents leave in their outboxes, the events of schedules and its refusals, and later webhooks and polling; a person delivers
// with `agentx event deliver`, which calls it. It reaches the agent's state in the project's central storage, as a sandbox's host does.

import { basename } from "node:path";
import { inbox, type Mail, newMail, put, withFilesLine } from "../agent-runtime/events/mailbox.js";
import type { NewEvent } from "../agent-runtime/events/queue.js";
import { agentIn } from "../agent-runtime/project-config.js";
import { centralStorage, storageProblem } from "../agent-runtime/storage.js";
import { missingWorkflow } from "../agent-runtime/workflows/workflows.js";

/** What goes with a delivered event. */
export interface DeliverOptions {
	/** The harness's `agentX-` lines, which no sender may name. */
	facts?: Record<string, string>;
	/** Files that go with the event, copied into its folder; the last line of its content names them. */
	files?: string[];
	/** When it was sent; now when left out. */
	sentAt?: number;
}

/** An event checked and made ready for an inbox. */
export interface Prepared {
	box: string;
	mail: Mail;
	files: string[];
}

/** Delivers `event` to the agent `name` of the project whose `agent-x/` directory is `agentX`, and returns its id. Throws when agentx.json lists no such agent, or the event is refused. */
export function deliverTo(agentX: string, name: string, event: NewEvent, options: DeliverOptions = {}): string {
	const agentRoot = agentIn(agentX, name);
	if (agentRoot === undefined) throw new Error(`This project has no agent "${name}".`);
	return deliverEvent(agentRoot, event, options);
}

/** Delivers `event` into the inbox of the agent in `agentRoot` and returns its id. Throws when it is refused. */
export function deliverEvent(agentRoot: string, event: NewEvent, options: DeliverOptions = {}): string {
	const prepared = prepareDelivery(agentRoot, event, options);
	put(prepared.box, prepared.mail, prepared.files);
	return prepared.mail.id;
}

/**
 * Checks `event` and makes it ready for the inbox of the agent in `agentRoot`, as `deliverEvent` does, writing nothing; throws why it is refused.
 * Delivery uses it apart from `deliverEvent`, to refuse an event from an outbox that it cannot deliver, but to try again one it could not write.
 */
export function prepareDelivery(agentRoot: string, event: NewEvent, options: DeliverOptions = {}): Prepared {
	const { facts, files = [], sentAt } = options;
	const name = basename(agentRoot);
	const mail = newMail(withFilesLine(event, files), name, files, facts, sentAt);
	// The agent's state is reached in the central folder only. One whose storage/ is a folder of its own reads another inbox, and the coordinator does not run it.
	const problem = storageProblem(agentRoot);
	if (problem !== undefined) throw new Error(problem);
	const workflow = missingWorkflow(agentRoot, event.threadId);
	if (workflow !== undefined) throw new Error(`Agent "${name}" has no workflow "${workflow}".`);
	return { box: inbox(centralStorage(agentRoot)), mail, files };
}
