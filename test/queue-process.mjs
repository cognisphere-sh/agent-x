// A second process on a queue, for queue.test.mjs. Usage: node queue-process.mjs <agentRoot> hold <thread> | work
// hold: takes the thread and its messages, says so, then waits to be killed.
// work: takes threads and their messages as a session does, the oldest waiting message's thread first, until none are left; prints the ids it took.

import { Queue } from "../dist/agent-runtime/pi-package/extensions/message-queue/queue.js";

const [agentRoot, mode, threadId] = process.argv.slice(2);
const queue = new Queue(agentRoot);
const print = (value) => console.log(JSON.stringify(value));

if (mode === "hold") {
	print({ acquired: queue.acquire(threadId), ids: queue.claim(threadId).map((message) => message.id) });
	setInterval(() => queue.renew(threadId), 1000);
} else {
	for (let thread = queue.nextThread(); thread !== undefined; thread = queue.nextThread()) {
		if (!queue.acquire(thread)) continue;
		const ids = queue.claim(thread).map((message) => message.id);
		queue.delivered(thread, ids, `entry-${process.pid}`);
		queue.settle(thread, "done");
		queue.release(thread);
		print({ ids });
	}
	queue.close();
}
