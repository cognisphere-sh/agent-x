// A second process on a queue, for queue.test.mjs. Usage: node queue-process.mjs <agentRoot> open | hold <thread> | hold-one <thread> | work
// open: opens the queue, which makes the tables of a new file, and closes it.
// hold: takes the thread and its events, says so, then waits to be killed.
// hold-one: takes the thread and its oldest event, as a workflow run does, says which, then waits to be killed.
// work: takes threads and their events as a session does, the oldest waiting event's thread first, until none are left; prints the ids it took.

import { Queue } from "../dist/agent-runtime/events/queue.js";

const [agentRoot, mode, threadId] = process.argv.slice(2);
const queue = new Queue(agentRoot);
const print = (value) => console.log(JSON.stringify(value));

if (mode === "open") {
	queue.close();
} else if (mode === "hold") {
	print({ acquired: queue.acquire(threadId), ids: queue.claim(threadId).map((event) => event.id) });
	setInterval(() => queue.renew(threadId), 1000);
} else if (mode === "hold-one") {
	queue.acquire(threadId);
	print({ id: queue.claimOldest(threadId)?.id });
	setInterval(() => queue.renew(threadId), 1000);
} else {
	for (let thread = queue.nextThread(); thread !== undefined; thread = queue.nextThread()) {
		if (!queue.acquire(thread)) continue;
		const ids = queue.claim(thread).map((event) => event.id);
		queue.delivered(thread, ids, `entry-${process.pid}`);
		queue.settle(thread, "done");
		queue.release(thread);
		print({ ids });
	}
	queue.close();
}
