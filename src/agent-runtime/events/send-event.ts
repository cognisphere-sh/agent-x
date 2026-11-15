// Sends an event from inside an agent. Only the agent sends: the model, with `agentx event send` in its bash, and its workflows, with `ctx.send`; the workflow
// runner reports a failed run the same way. Every event goes into the agent's own outbox, the one place a sandbox lets it write, also one for the agent itself:
// the coordinator takes it, checks it and delivers it, with the agent whose outbox it is, so the agent never names itself. The event carries the thread that
// sent it, so the receiver knows where to answer, and the coordinator where to say it could not deliver it.

import { basename, dirname } from "node:path";
import { newMail, outbox, put } from "./mailbox.js";
import { isThreadId, nameRule, type NewEvent } from "./queue.js";
import { storageOf } from "../storage.js";

/** Where an event goes, and what goes with it. */
export interface SendEventOptions {
	/** The agent the event is for; the sending agent itself when left out. */
	to?: string;
	/** The thread that sends: the receiver can answer it, and it hears of a send that cannot be delivered. `sendingThread()` when left out. */
	thread?: string;
	/** The workflow that sends, which the receiver is told of. */
	workflow?: string;
	/** Files that go with the event; its content gets a line that names them. */
	files?: string[];
}

/** The thread this process sends from: the folder of the Pi session whose bash runs it, as Pi puts the session's file in the environment; `main` in any other process. */
export function sendingThread(): string {
	const file = process.env.PI_SESSION_FILE;
	const thread = file === undefined ? undefined : basename(dirname(file));
	return isThreadId(thread) ? thread : "main";
}

/** Sends `event` from the agent in `agentRoot` and returns its id. Throws when it is refused here; the coordinator can still refuse it, and says so on the sending thread. */
export function sendEvent(agentRoot: string, event: NewEvent, options: SendEventOptions = {}): string {
	const { to = basename(agentRoot), thread = sendingThread(), workflow, files = [] } = options;
	if (!isThreadId(thread)) throw new Error(`Invalid sending thread "${thread}".`);
	if (!nameRule.test(to)) throw new Error(`"${to}" is not an agent name.`);
	const mail = newMail(event, to, files);
	put(outbox(storageOf(agentRoot)), { ...mail, to, from: { thread, workflow } }, files);
	return mail.id;
}
