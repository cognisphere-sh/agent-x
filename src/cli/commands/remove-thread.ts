// `agentx remove-thread <thread-id> [--yes]`: deletes one of the agent's Pi threads, its sessions in storage/sessions/<thread>/, and takes its episodes out
// of the agent's memory. A person's command, which the agent's own processes cannot run. Without --yes it says what it deletes and asks first.

import { existsSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { isThreadId, type Queue, withQueue } from "../../agent-runtime/events/queue.js";
import { threadFolder } from "../../agent-runtime/pi/pi-launch.js";
import { forgetThread } from "../../agent-runtime/pi/pi-package/extensions/memory/index-db.js";
import { confirmed } from "../confirmed.js";

/** Runs `agentx remove-thread <thread-id> [--yes]` for the agent in `agentRoot`; without --yes, asks first. */
export async function removeThread(agentRoot: string, args: string[]): Promise<void> {
	if (process.env.AGENTX_AGENT !== undefined) throw new Error("agentx remove-thread is for people, not the agent's processes.");
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { yes: { type: "boolean", default: false } } });
	const [thread] = positionals;
	if (positionals.length !== 1 || !isThreadId(thread)) throw new Error("usage: agentx remove-thread <thread-id> [--yes]");
	const folder = threadFolder(agentRoot, thread);
	if (!existsSync(folder)) throw new Error(`This agent has no thread "${thread}".`);
	const what = `its sessions, ${folder}, and its episodes in the agent's memory`;
	const running = `Thread "${thread}" is running. Close its agentx chat, or let agentx run finish its events, first.`;
	// Checked before the question and again after it, which may wait a long time.
	const refuseIfBusy = (queue: Queue) => {
		if (queue.heldElsewhere(thread)) throw new Error(running);
		// Events waiting for the thread would start it again.
		if (queue.hasWork(thread)) throw new Error(`Thread "${thread}" has events waiting. Remove it once they are done.`);
	};
	if (!values.yes) {
		withQueue(agentRoot, refuseIfBusy);
		console.log(`Removing thread "${thread}" deletes ${what}.`);
		if (!(await confirmed("Delete them? [y/N] "))) {
			console.log("Nothing deleted.");
			return;
		}
	}
	withQueue(agentRoot, (queue) => {
		refuseIfBusy(queue);
		// Holding the thread keeps agentx run from starting it meanwhile.
		if (!queue.acquire(thread)) throw new Error(running);
		try {
			rmSync(folder, { recursive: true, force: true });
			forgetThread(agentRoot, thread);
		} finally {
			queue.release(thread);
		}
	});
	console.log(`Removed thread "${thread}": ${what}.`);
}
