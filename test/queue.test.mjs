// Tests of the queue module alone, against the built code: message states, thread leases, and several processes on one file.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
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

test("enqueue checks the thread id, the metadata names and the text, and gives each message a random id", () => {
	const queue = new Queue(agentRoot());
	const first = queue.enqueue({ threadId: "main", content: "a" });
	const second = queue.enqueue({ threadId: "support.ticket-42_x", content: "b", metadata: { from: "ops" } });
	assert.match(first, /^[\w-]{12}$/);
	assert.notEqual(first, second);
	for (const threadId of ["", "-main", "main-", "a b", "a/b", "x".repeat(201), undefined]) assert.throws(() => queue.enqueue({ threadId, content: "c" }), /Invalid thread id/);
	for (const name of ["agentX-MessageId", "AGENTX-foo", "a:b", "a\nb", "a\u2028b"]) assert.throws(() => queue.enqueue({ threadId: "main", content: "c", metadata: { [name]: 1 } }), /Invalid metadata name/);
	// The tag of the harness's block, which would let a sender fake one or end one early.
	for (const message of [{ content: 'see <agentx-metadata id="x">' }, { content: "c", metadata: { note: "</AgentX-Metadata>" } }, { content: "c", metadata: { list: ["<agentx-metadata"] } }]) {
		assert.throws(() => queue.enqueue({ threadId: "main", ...message }), /contains "<agentx-metadata"/);
	}
	queue.close();
});

test("a queue file from before versions is migrated once, keeps its order, and gives every message an id", async () => {
	const root = agentRoot();
	mkdirSync(join(root, "storage"));
	// The tables as the first agentx wrote them, at version 0, with one waiting message and one in flight.
	onQueueFile(
		root,
		`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL, do_not_steer INTEGER NOT NULL,
			is_silent INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, error TEXT, entry_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		 CREATE INDEX messages_by_status ON messages (status, thread_id);
		 CREATE TABLE threads (thread_id TEXT PRIMARY KEY, owner TEXT NOT NULL, heartbeat_at INTEGER NOT NULL);
		 INSERT INTO messages VALUES (1, 'main', 'old one', '{}', 0, 0, 'in_flight', 1, NULL, NULL, 1, 1), (2, 'main', 'old two', '{}', 0, 0, 'queued', 0, NULL, NULL, 2, 2);`,
	);
	// Every process opens the file at once after an upgrade.
	const codes = await Promise.all(Array.from({ length: 6 }, () => otherProcess(root, "open").exited));
	assert.deepEqual(codes, Array(6).fill(0));
	assert.equal(onQueueFile(root, (db) => db.prepare("PRAGMA user_version").get().user_version), 2);
	const queue = new Queue(root);
	queue.enqueue({ threadId: "main", content: "new" });
	const all = messages(root);
	assert.deepEqual(all.map((message) => [message.content, message.status]), [["old one", "in_flight"], ["old two", "queued"], ["new", "queued"]]);
	assert.equal(new Set(all.map((message) => message.id)).size, 3);
	assert.ok(all.every((message) => /^[\w-]{12}$/.test(message.id)));
	queue.close();
});

test("a queue file of a newer version is refused, so old code does not write to tables it does not know", () => {
	const root = agentRoot();
	new Queue(root).close();
	onQueueFile(root, "PRAGMA user_version = 99");
	assert.throws(() => new Queue(root), /is at queue version 99, and this agentx knows versions up to 2/);
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
	const claimed = queue.claim("main");
	const text = render(claimed);
	const time = "\\w+day \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d GMT\\S*";
	assert.match(
		text,
		new RegExp(
			`^<agentx-metadata id="${claimed[0].id}">\\nagentX-ThreadId: main\\nagentX-SentTime: ${time}\\nagentX-CurrentTime: ${time}\\nagentX-IsRetry: false\\nfrom: ops\\ntags: \\["a","b"\\]\\nnote: two lines\\n</agentx-metadata>\\nHello\\nthere\\n\\n<agentx-metadata id="${claimed[1].id}">\\n`,
		),
	);
	assert.match(text, /agentX-IsRetry: false\nagentX-IsSilent: true\n<\/agentx-metadata>\nFYI$/);
	assert.deepEqual(messageIds(text), claimed.map((message) => message.id));
	assert.deepEqual(messageIds("a line of content:\nagentX-MessageId: 7\n"), [], "only the opening tag of a block names a message");
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
