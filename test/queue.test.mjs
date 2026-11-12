// Tests of the queue module alone, against the built code: message states, thread leases, and several processes on one file.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Queue } from "../dist/agent-runtime/pi-package/extensions/message-queue/queue.js";
import { messageIds, render } from "../dist/agent-runtime/pi-package/extensions/message-queue/render.js";
import { messages, onQueueFile } from "./project.mjs";

const agentRoot = () => mkdtempSync(join(tmpdir(), "agentx-queue-"));
const helper = fileURLToPath(new URL("queue-process.mjs", import.meta.url));

/** Runs the helper as another process on the same queue; `done` resolves to what it printed, parsed. */
function otherProcess(root, ...args) {
	const child = spawn(process.execPath, [helper, root, ...args], { stdio: ["pipe", "pipe", "inherit"] });
	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	const lines = () => output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const done = new Promise((resolve) => child.on("close", () => resolve(lines())));
	const exited = new Promise((resolve) => child.on("close", resolve));
	const firstLine = new Promise((resolve) => child.stdout.once("data", () => resolve(lines()[0])));
	return { child, done, exited, firstLine };
}

test("enqueue checks the thread id and the metadata names", () => {
	const queue = new Queue(agentRoot());
	assert.equal(queue.enqueue({ threadId: "main", content: "a" }), 1);
	assert.equal(queue.enqueue({ threadId: "support.ticket-42_x", content: "b", metadata: { from: "ops" } }), 2);
	for (const threadId of ["", "-main", "main-", "a b", "a/b", "x".repeat(201), undefined]) assert.throws(() => queue.enqueue({ threadId, content: "c" }), /Invalid thread id/);
	for (const name of ["agentX-MessageId", "AGENTX-foo", "a:b", "a\nb", "a\u2028b"]) assert.throws(() => queue.enqueue({ threadId: "main", content: "c", metadata: { [name]: 1 } }), /Invalid metadata name/);
	queue.close();
});

test("messages are taken oldest first, by the holder of the thread only", () => {
	const root = agentRoot();
	const queue = new Queue(root);
	for (const content of ["one", "two", "three"]) queue.enqueue({ threadId: "main", content });
	queue.enqueue({ threadId: "other", content: "elsewhere" });
	assert.deepEqual(queue.claim("main"), [], "nothing is taken without the lease");
	assert.equal(queue.acquire("main"), true);
	const taken = queue.claim("main");
	assert.deepEqual(taken.map((message) => [message.content, message.status, message.attempts]), [["one", "in_flight", 1], ["two", "in_flight", 1], ["three", "in_flight", 1]]);
	assert.deepEqual(queue.claim("main"), [], "a message is taken once");
	assert.equal(queue.inFlight("main"), true);
	assert.equal(messages(root).find((message) => message.threadId === "other").status, "queued");
	queue.close();
});

test("a silent message starts no run and a do-not-steer message enters none", () => {
	const queue = new Queue(agentRoot());
	queue.acquire("main");
	queue.enqueue({ threadId: "main", content: "quiet", isSilent: true });
	assert.equal(queue.hasWork("main"), false);
	assert.deepEqual(queue.claim("main"), []);
	queue.enqueue({ threadId: "main", content: "later", doNotSteer: true });
	assert.equal(queue.hasWork("main"), true);
	assert.deepEqual(queue.claim("main", true).map((message) => message.content), ["quiet"], "a steer takes the silent one and leaves the do-not-steer one");
	assert.deepEqual(queue.claim("main").map((message) => message.content), ["later"]);
	queue.close();
});

test("settling: done for what Pi saved, three attempts before failed, and an abort cancels everything in flight", () => {
	const root = agentRoot();
	const queue = new Queue(root);
	queue.acquire("main");
	const [saved, failing, unsaved] = ["saved", "failing", "unsaved"].map((content) => queue.enqueue({ threadId: "main", content }));
	const message = (id) => messages(root).find((found) => found.id === id);

	queue.claim("main");
	queue.delivered("main", [saved], "entry-1");
	queue.settle("main", "done");
	assert.deepEqual([message(saved).status, message(saved).entryId], ["done", "entry-1"]);
	assert.equal(message(unsaved).status, "in_flight", "a message Pi has not saved is not done");

	queue.delivered("main", [failing], "entry-2");
	queue.settle("main", { error: "model down" });
	assert.deepEqual([message(failing).status, message(failing).error], ["queued", "model down"]);
	assert.equal(message(unsaved).status, "in_flight", "a failed run settles only what it was given");
	queue.fail("main", "not taken");
	assert.deepEqual([message(unsaved).status, message(unsaved).error], ["queued", "not taken"]);
	for (const attempt of [2, 3]) {
		const retried = queue.claim("main").find((found) => found.id === failing);
		assert.deepEqual([retried.attempts, retried.entryId, retried.error], [attempt, null, null]);
		queue.fail("main", "model down");
	}
	assert.equal(message(failing).status, "failed");
	assert.equal(queue.hasWork("main"), false);

	const [given, held] = ["given", "held by Pi"].map((content) => queue.enqueue({ threadId: "main", content }));
	queue.claim("main");
	queue.delivered("main", [given], "entry-3");
	queue.settle("main", "cancelled");
	assert.deepEqual([message(given).status, message(held).status], ["cancelled", "cancelled"]);
	queue.close();
});

test("a message is rendered with the harness's metadata, then the sender's, then its content", () => {
	const queue = new Queue(agentRoot());
	queue.acquire("main");
	queue.enqueue({ threadId: "main", content: "Hello\nthere", metadata: { from: "ops", tags: ["a", "b"], note: "two\nlines" } });
	queue.enqueue({ threadId: "main", content: "FYI", isSilent: true });
	const text = render(queue.claim("main"));
	assert.match(text, /^<metadata>\nagentX-MessageId: 1\nagentX-ThreadId: main\nagentX-CurrentTime: \w+day \d{4}-\d\d-\d\d \d\d:\d\d:\d\d GMT\S*\nagentX-IsRetry: false\nfrom: ops\ntags: \["a","b"\]\nnote: two lines\n<\/metadata>\nHello\nthere\n\n<metadata>\nagentX-MessageId: 2\n/);
	assert.match(text, /agentX-IsRetry: false\nagentX-IsSilent: true\n<\/metadata>\nFYI$/);
	assert.deepEqual(messageIds(text), [1, 2]);
	assert.deepEqual(messageIds("a line of content:\nagentX-MessageId: 7\n"), [], "only the first line of a metadata block names a message");
	queue.fail("main", "again");
	assert.match(render(queue.claim("main")), /agentX-IsRetry: true\nagentX-RetryAttempt: 1\n/);
	queue.close();
});

test("the time on a message is shown in the time zone that is asked for", () => {
	const queue = new Queue(agentRoot());
	queue.acquire("main");
	queue.enqueue({ threadId: "main", content: "hello" });
	const taken = queue.claim("main");
	assert.match(render(taken, "Asia/Tokyo"), /\nagentX-CurrentTime: \w+day \d{4}-\d\d-\d\d \d\d:\d\d:\d\d GMT\+9\n/);
	assert.match(render(taken, "Asia/Kolkata"), /\nagentX-CurrentTime: [^\n]+ GMT\+5:30\n/);
	queue.close();
});

test("one process holds a thread; another takes it over when the holder is gone", async () => {
	const root = agentRoot();
	const queue = new Queue(root);
	queue.enqueue({ threadId: "main", content: "first" });
	queue.enqueue({ threadId: "idle", content: "untouched" });
	const holder = otherProcess(root, "hold", "main");
	await holder.firstLine;

	assert.equal(queue.heldElsewhere("main"), true);
	assert.equal(queue.acquire("main"), false);
	assert.deepEqual(queue.claim("main"), []);
	assert.equal(queue.nextThread(), "idle", "a held thread is not offered");
	assert.equal(messages(root)[0].status, "in_flight");

	holder.child.kill("SIGKILL");
	await holder.done;
	assert.equal(queue.acquire("main"), false, "the lease outlives its holder for a while");
	onQueueFile(root);
	assert.equal(queue.nextThread(), "main", "the oldest message with work comes first, also when it was left in flight");
	assert.equal(queue.nextThread(["main"]), "idle");
	assert.equal(queue.acquire("main"), true);
	const [message] = messages(root);
	assert.deepEqual([message.status, message.attempts, message.error], ["queued", 1, "The process running this thread stopped."]);
	assert.equal(queue.claim("main")[0].attempts, 2);
	queue.close();
});

test("a thread is freed at once from a holder that was seen to end, by its process id", async () => {
	const root = agentRoot();
	const queue = new Queue(root);
	queue.enqueue({ threadId: "main", content: "first" });
	const holder = otherProcess(root, "hold", "main");
	await holder.firstLine;
	holder.child.kill("SIGKILL");
	await holder.done;
	const state = () => [messages(root)[0].status, messages(root)[0].attempts, messages(root)[0].error];

	assert.equal(queue.acquire("main"), false, "the lease has not run out");
	queue.abandon("main", Math.trunc(holder.child.pid / 10));
	assert.equal(queue.heldElsewhere("main"), true, "another process id, although it starts the same");
	queue.abandon("main", holder.child.pid);
	assert.equal(queue.heldElsewhere("main"), false);
	assert.deepEqual(state(), ["queued", 1, "The process running this thread stopped."]);

	// A holder that failed and left nothing in flight could not run the thread: the waiting messages lose an attempt.
	queue.abandon("main", undefined, "Pi could not start.");
	assert.deepEqual(state(), ["queued", 2, "Pi could not start."]);
	queue.close();
});

test("eight processes working one queue take every message exactly once", async () => {
	const root = agentRoot();
	const queue = new Queue(root);
	const threads = 40;
	const perThread = 5;
	for (let thread = 0; thread < threads; thread++) for (let n = 0; n < perThread; n++) queue.enqueue({ threadId: `t${thread}`, content: `${thread}-${n}` });
	const taken = (await Promise.all(Array.from({ length: 8 }, () => otherProcess(root, "work").done))).flat().flatMap((line) => line.ids);
	assert.equal(taken.length, threads * perThread);
	assert.equal(new Set(taken).size, threads * perThread);
	assert.deepEqual([...new Set(messages(root).map((message) => message.status))], ["done"]);
	assert.equal(queue.nextThread(), undefined);
	queue.close();
});

test("processes that open a new queue file at the same moment all get it", async () => {
	for (let round = 0; round < 20; round++) {
		const root = agentRoot();
		const codes = await Promise.all(Array.from({ length: 12 }, () => otherProcess(root, "work").exited));
		assert.deepEqual(codes, Array(12).fill(0));
	}
});

test("a holder writes its lease again only once it is 10 s old, and learns when the lease is no longer its own", () => {
	const root = agentRoot();
	const queue = new Queue(root);
	queue.acquire("main");
	const written = () => onQueueFile(root, (db) => db.prepare("SELECT heartbeat_at FROM threads").get().heartbeat_at);
	const first = written();
	assert.equal(queue.renew("main"), true);
	assert.equal(written(), first, "a fresh lease is not written");
	onQueueFile(root, `UPDATE threads SET heartbeat_at = ${Date.now() - 15_000}`);
	assert.equal(queue.renew("main"), true);
	assert.ok(written() > Date.now() - 1000, "an older one is");
	onQueueFile(root, "UPDATE threads SET owner = 'another process'");
	assert.equal(queue.renew("main"), false);
	queue.close();
});

test("taking messages renews the lease, so a holder that was paused keeps its thread once it works again", async () => {
	const root = agentRoot();
	const queue = new Queue(root);
	queue.acquire("main");
	queue.enqueue({ threadId: "main", content: "one" });
	onQueueFile(root);
	assert.equal(queue.claim("main").length, 1);
	const other = otherProcess(root, "hold", "main");
	assert.equal((await other.firstLine).acquired, false);
	other.child.kill("SIGKILL");
	await other.exited;
	queue.close();
});
