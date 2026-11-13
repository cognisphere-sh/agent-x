// End-to-end tests of Pi threads: the built CLI and `agentx run` in a scratch project, real Pi processes, and a fake model. They cover what a type check cannot:
// delivery and steering through the Pi extensions, retries, threads side by side, `agentx chat` and `agentx run` sharing a thread, and what becomes of events when a process dies.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue } from "../dist/agent-runtime/events/queue.js";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, alive, cli, createAgent, events, holder, onlySession, onQueueFile, open, runner, sessions, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/** A fresh project, its queue, and a way to start `agentx run`, which is stopped when the test ends. */
function setup(t) {
	const project = createAgent(model.port);
	const queue = new Queue(project.agent);
	const servers = [];
	t.after(async () => {
		for (const server of servers) await server.stop();
		queue.close();
	});
	const message = (id) => events(project.agent).find((found) => found.id === id);
	return {
		project,
		queue,
		message,
		start: (maxThreads, stallSeconds) => servers[servers.push(runner(project, maxThreads, stallSeconds)) - 1],
		// Resolves when the events are all in the given status.
		reach: (status, ...ids) => until(() => ids.every((id) => message(id).status === status)),
	};
}

test("a queued event runs in the session of its thread and is linked to its session entry", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "hello", metadata: { from: "test" } });
	start();
	await reach("done", id);

	const session = onlySession(project);
	assert.equal(session.id, "main");
	assert.deepEqual(session.roles, ["system", "user", "assistant"]);
	assert.equal(session.users[0].text, `<agentx-metadata id="${id}">\n${session.users[0].text.split("\n").slice(1, 4).join("\n")}\nagentX-IsRetry: false\nfrom: test\n</agentx-metadata>\nhello`);
	assert.match(session.users[0].text, /\nagentX-ThreadId: main\nagentX-SentTime: \w+day [^\n]+\nagentX-CurrentTime: \w+day [^\n]+\n/);
	assert.equal(message(id).entryId, session.users[0].entryId);
	assert.equal(message(id).attempts, 1);
});

test("an event that arrives during a run is steered into it; one marked do-not-steer waits for the next run", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const first = queue.enqueue({ threadId: "main", content: "[sleep 2] first" });
	start();
	await until(() => message(first).entryId);
	const steered = queue.enqueue({ threadId: "main", content: "steered" });
	const later = queue.enqueue({ threadId: "main", content: "later", doNotSteer: true });
	await reach("done", first, steered, later);

	const [session] = sessions(project);
	// The steered message follows the tool result of the run in progress; the other one follows that run's last answer.
	assert.deepEqual(session.roles, ["system", "user", "assistant", "toolResult", "user", "assistant", "user", "assistant"]);
	assert.deepEqual(session.contents, ["[sleep 2] first", "steered", "later"]);
	assert.deepEqual([first, steered, later].map((id) => message(id).entryId), session.users.map((user) => user.entryId));
});

test("a failed run is retried with retry metadata, and after three attempts the event is failed", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[fail] this" });
	const server = start();
	await reach("failed", id);

	assert.equal(message(id).attempts, 3);
	assert.match(message(id).error, /fake model was told to fail/);
	const [session] = sessions(project);
	assert.deepEqual(session.users.map((user) => /agentX-IsRetry: (\w+)(?:\nagentX-RetryAttempt: (\d))?/.exec(user.text).slice(1, 3)), [["false", undefined], ["true", "1"], ["true", "2"]]);

	// The runner is still serving: a good message on the same thread goes through.
	const next = queue.enqueue({ threadId: "main", content: "fine" });
	await reach("done", next);
	assert.equal(server.child.exitCode, null);
});

test("threads run side by side, each in its own session, up to maxThreads", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const a = queue.enqueue({ threadId: "a", content: "[sleep 2] a1" });
	const b = queue.enqueue({ threadId: "b", content: "[sleep 2] b1" });
	const c = queue.enqueue({ threadId: "c", content: "c1" });
	const server = start(2);
	// Both a and b are inside their tool call at the same moment, and c, the newest, waits for a free worker.
	await until(() => message(a).entryId && message(b).entryId);
	assert.deepEqual([message(a).status, message(b).status, message(c).status], ["in_flight", "in_flight", "queued"]);
	await reach("done", a, b, c);

	// The process survived three sessions closing, and a thread that is used again continues its one session.
	const again = queue.enqueue({ threadId: "a", content: "a2" });
	await reach("done", again);
	assert.equal(server.child.exitCode, null);
	const byId = Object.fromEntries(sessions(project).map((session) => [session.id, session.contents]));
	assert.deepEqual(byId, { a: ["[sleep 2] a1", "a2"], b: ["[sleep 2] b1"], c: ["c1"] });
});

test("with one worker, threads run one after another, the thread of the oldest event first", async (t) => {
	const { queue, message, start, reach } = setup(t);
	const first = queue.enqueue({ threadId: "x", content: "[sleep 1] x1" });
	const second = queue.enqueue({ threadId: "y", content: "y1" });
	start(1);
	await until(() => message(first).status === "in_flight");
	assert.equal(message(second).status, "queued");
	await reach("done", first, second);
	assert.ok(message(first).updatedAt <= message(second).updatedAt);
});

test("agentx chat and agentx run continue the same thread in one session file", async (t) => {
	const { project, queue, start, reach } = setup(t);
	const cli = await agentx(project, ["chat", "-p", "from the cli"]);
	assert.equal(cli.status, 0, cli.stderr);
	assert.match(cli.stdout, /reply/);

	const id = queue.enqueue({ threadId: "main", content: "from the queue" });
	const server = start();
	await reach("done", id);
	// Asked to stop, the runner waits for its sessions, which close when their threads have no work and give the threads up.
	assert.equal(await server.end(), 0);
	assert.match(server.output(), /main: session closed/);

	const again = await agentx(project, ["chat", "-p", "from the cli again"]);
	assert.equal(again.status, 0, again.stderr);
	const session = onlySession(project);
	assert.equal(session.id, "main");
	assert.deepEqual(session.contents, ["from the cli", "from the queue", "from the cli again"]);
});

test("a one-shot agentx chat answers its own prompt and leaves the thread's queued events on the queue", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "queued before" });
	const calls = model.requests.length;
	const cli = await agentx(project, ["chat", "-p", "[sleep 2] typed"]);
	assert.equal(cli.status, 0, cli.stderr);
	// Two model calls, both for the typed prompt alone: the tool call, then the answer, which is what gets printed.
	assert.deepEqual(model.requests.slice(calls), [["[sleep 2] typed"], ["[sleep 2] typed"]]);
	assert.equal(cli.stdout.trim(), `reply ${calls + 2}`);
	assert.equal(message(id).status, "queued");
	assert.deepEqual(sessions(project)[0].users.map((user) => user.text), ["[sleep 2] typed"]);

	start();
	await reach("done", id);
	assert.deepEqual(sessions(project)[0].contents, ["[sleep 2] typed", "queued before"]);
});

test("a session that agentx chat keeps open receives the thread's queued events while it is idle", async (t) => {
	const { project, queue, reach } = setup(t);
	// RPC mode stays open until its input ends, as the terminal UI does until the person leaves. No runner is involved.
	const child = open(project, ["chat", "--mode", "rpc"], t);
	const exited = new Promise((resolve) => child.on("exit", resolve));
	await until(() => queue.heldElsewhere("main"));

	const first = queue.enqueue({ threadId: "main", content: "while idle" });
	await reach("done", first);
	const second = queue.enqueue({ threadId: "main", content: "idle again" });
	await reach("done", second);
	assert.deepEqual(sessions(project)[0].contents, ["while idle", "idle again"]);

	child.stdin.end();
	assert.equal(await exited, 0);
	assert.equal(queue.heldElsewhere("main"), false, "the session gave the thread up when it closed");
});

test("agentx chat refuses a thread that agentx run is running, and the session stays as it was", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 3] slow" });
	start();
	await until(() => message(id).entryId);
	const before = sessions(project)[0].users.length;

	// The default thread and a named one are refused before Pi starts.
	const refused = await agentx(project, ["chat", "-p", "let me in"]);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /Thread "main" is running in another process/);
	// With -c Pi picks the session itself, so the queue extension refuses the prompt.
	const continued = await agentx(project, ["chat", "-c", "-p", "let me in"]);
	assert.equal(continued.status, 1);
	assert.match(continued.stderr, /Thread "main" is running in another process/);
	// Another thread is free.
	const other = await agentx(project, ["chat", "--thread-id", "other", "-p", "hello"]);
	assert.equal(other.status, 0, other.stderr);
	assert.equal((await agentx(project, ["chat", "--thread-id=other", "-p", "hello again"])).status, 0);
	assert.equal((await agentx(project, ["chat", "--thread-id=main", "-p", "let me in"])).status, 1);
	assert.equal(sessions(project).find((session) => session.id === "other").users.length, 2);

	await reach("done", id);
	const main = sessions(project).find((session) => session.id === "main");
	assert.equal(main.users.length, before);
	assert.ok(!main.users.some((user) => user.text.includes("let me in")));
});

test("when a thread's Pi process dies, agentx run ends the attempt of its events at once and starts the thread again", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 2] killed" });
	const server = start();
	await until(() => message(id).entryId);
	// Not to enter the run in progress, so the process has not taken it when it dies.
	const waiting = queue.enqueue({ threadId: "main", content: "waiting", doNotSteer: true });
	process.kill(holder(project.agent, "main"), "SIGKILL");

	// Well before the dead process's lease has run out, which takes 110 to 120 s.
	await until(() => message(id).attempts === 2, 10_000);
	await reach("done", id, waiting);
	assert.equal(message(waiting).attempts, 1, "a message the dead process had not taken loses no attempt");
	assert.match(server.output(), /main: Pi was stopped by SIGKILL/);
	assert.equal(server.child.exitCode, null);
	const session = onlySession(project);
	assert.match(session.users.at(-1).text, /agentX-IsRetry: true\nagentX-RetryAttempt: 1\n/);
});

test("a Pi process that is told to stop ends the attempt of its events itself, and agentx run counts no second one", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 2] stopped" });
	const server = start();
	await until(() => message(id).entryId);
	// What a process manager does to every process of a service it stops.
	process.kill(holder(project.agent, "main"), "SIGTERM");
	await until(() => /main: Pi stopped with exit code 143/.test(server.output()));
	assert.equal(message(id).error, "The session was closed during the run.");

	await reach("done", id);
	assert.equal(message(id).attempts, 2);
});

test("an agentx run that is killed takes its sessions with it, and their events get another attempt from the next one", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 2] interrupted" });
	const first = start();
	await until(() => message(id).entryId);
	const pi = holder(project.agent, "main");
	await first.stop();

	// The runner's end closes the input of its Pi processes. Each closes its session, which aborts the run, and the queue extension ends the attempt.
	await until(() => message(id).status === "queued");
	assert.deepEqual([message(id).attempts, message(id).error], [1, "The session was closed during the run."]);
	await until(() => !alive(pi));
	assert.equal(queue.heldElsewhere("main"), false, "the session gave the thread up, so the next runner does not wait for a lease to run out");

	start();
	await reach("done", id);
	assert.equal(message(id).attempts, 2);
	const session = onlySession(project);
	assert.match(session.users.at(-1).text, /agentX-IsRetry: true\nagentX-RetryAttempt: 1\n/);
});

test("an agent that cannot start fails its events after three attempts, with what Pi said", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	writeFileSync(join(project.agent, ".pi", "extensions", "broken.ts"), `throw new Error("broken on purpose");`);
	const id = queue.enqueue({ threadId: "main", content: "never runs" });
	const server = start();
	await reach("failed", id);

	assert.equal(message(id).attempts, 3);
	assert.match(message(id).error, /^Error: Failed to load extension .*broken on purpose/);
	// Each of the three starts ended with Pi's own words, which can reach the output after the event failed.
	await until(() => server.output().match(/main: Error: Failed to load extension/g)?.length === 3);
	assert.equal(server.child.exitCode, null);
});

test("an extension's dialog is answered as cancelled, because nobody is there, and the run goes on", async (t) => {
	const { project, queue, start, reach } = setup(t);
	// A gate that asks before every shell command and blocks it unless the answer is yes.
	writeFileSync(
		join(project.agent, ".pi", "extensions", "gate.ts"),
		`export default function (pi) {
			pi.on("tool_call", async (event, ctx) => {
				if (event.toolName === "bash" && !(await ctx.ui.confirm("Run it?", event.input.command))) return { block: true, reason: "Not confirmed." };
			});
		}`,
	);
	// Unanswered, the dialog would hold the run forever; answered yes, the command would outlast the test.
	const id = queue.enqueue({ threadId: "main", content: "[sleep 60] behind a gate" });
	const server = start();
	await reach("done", id);
	assert.deepEqual(sessions(project)[0].roles, ["system", "user", "assistant", "toolResult", "assistant"]);
	assert.match(server.output(), /main: an extension asked "Run it\?" \(confirm\); nobody is there to answer, so it was cancelled/);
});

test("a worker session that does not get its thread ends itself", async (t) => {
	const { project, queue } = setup(t);
	queue.enqueue({ threadId: "main", content: "for whoever holds the thread" });
	// Another process took the thread between the runner's look at the queue and the start of the session.
	onQueueFile(project.agent, `INSERT INTO threads (thread_id, owner, heartbeat_at) VALUES ('main', 'another process', ${Date.now() + 3_600_000})`);
	// With --session-id Pi picks the session, so the check is the queue extension's, as for the runner's own Pi processes.
	const child = open(project, ["chat", "--session-id", "main", "--mode", "rpc", "--agentx-worker"], t);
	let said = "";
	child.stdout.on("data", (chunk) => (said += chunk));
	// Its input stays open, so nothing but the session itself ends it.
	await until(() => child.exitCode !== null);
	assert.equal(child.exitCode, 0);
	assert.match(said, /Thread \\"main\\" is running in another process/);
	assert.equal(events(project.agent)[0].status, "queued");
});

test("an event that arrives while a thread's session is closing waits for it and continues the same conversation", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	// An extension of the agent that is slow to shut down keeps the session closing after the queue extension gave the thread up.
	writeFileSync(
		join(project.agent, ".pi", "extensions", "slow-shutdown.ts"),
		`export default function (pi) { pi.on("session_shutdown", () => new Promise((resolve) => setTimeout(resolve, 2500))); }`,
	);
	const first = queue.enqueue({ threadId: "main", content: "first" });
	const server = start();
	await reach("done", first);
	// The worker notices within a second that the thread is empty and starts closing; the next message lands in that time.
	await until(() => !queue.heldElsewhere("main"));
	const second = queue.enqueue({ threadId: "main", content: "second" });
	await reach("done", second);
	const third = queue.enqueue({ threadId: "main", content: "third" });
	await reach("done", third);

	assert.deepEqual([first, second, third].map((id) => message(id).attempts), [1, 1, 1]);
	const session = onlySession(project);
	assert.deepEqual(session.roles, ["system", "user", "assistant", "user", "assistant", "user", "assistant"]);
	// Each model call saw the whole conversation so far: nothing was answered from an older copy of the session.
	assert.deepEqual(model.requests.slice(-3).map((users) => users.length), [1, 2, 3]);
	// The second session was opened only after the first had closed.
	assert.deepEqual(server.output().match(/main: session (opened|closed)/g).slice(0, 3), ["main: session opened", "main: session closed", "main: session opened"]);
});

test("aborting a run cancels the event it was working on and leaves a waiting one for the next run", async (t) => {
	const { project, queue, message, reach } = setup(t);
	const child = open(project, ["chat", "--mode", "rpc"], t);
	await until(() => queue.heldElsewhere("main"));

	const working = queue.enqueue({ threadId: "main", content: "[sleep 8] long" });
	await until(() => message(working).entryId);
	const waiting = queue.enqueue({ threadId: "main", content: "arrived during the tool call" });
	child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`);
	await reach("cancelled", working);
	await reach("done", waiting);

	assert.equal(message(waiting).attempts, 1);
	// The model was asked about the waiting message: it was not swallowed by the aborted run.
	assert.ok(model.requests.at(-1).at(-1).endsWith("arrived during the tool call"));
	child.stdin.end();
});

test("without a usable model an event fails at once, with the reason", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	rmSync(join(project.agent, "..", "..", ".pi", "models.json"));
	const id = queue.enqueue({ threadId: "main", content: "nobody to answer" });
	const server = start();
	await reach("failed", id);
	assert.equal(message(id).attempts, 3);
	assert.match(message(id).error, /^No model selected/);
	assert.equal(server.child.exitCode, null);
});

test("a send that an extension of the agent gets refused during a run leaves the run's queued events alone", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	// Without deliverAs, Pi refuses a send during a run and reports it to the host, as it does for a queue message it does not take.
	writeFileSync(join(project.agent, ".pi", "extensions", "noisy.ts"), `export default function (pi) { pi.on("tool_execution_start", () => pi.sendUserMessage("x")); }`);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 1] with a noisy extension" });
	const server = start();
	await reach("done", id);
	assert.equal(message(id).attempts, 1);
	assert.match(server.output(), /send_user_message/);
});

test("agentx run ends a worker that stops renewing its lease, and the thread's event gets another attempt", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	// An extension that blocks Pi's main thread for good, once: while the file is there.
	writeFileSync(join(project.agent, "hang"), "");
	writeFileSync(join(project.agent, ".pi", "extensions", "hang.ts"), `import { existsSync, rmSync } from "node:fs"; export default function (pi) { pi.on("turn_start", () => { if (!existsSync("hang")) return; rmSync("hang"); for (;;); }); }`);
	const id = queue.enqueue({ threadId: "main", content: "blocked" });
	const server = start();
	await until(() => !existsSync(join(project.agent, "hang")));
	// As two minutes later: the blocked process has not renewed its lease.
	onQueueFile(project.agent);
	await reach("done", id);
	assert.equal(message(id).attempts, 2);
	assert.match(server.output(), /main: Pi stopped renewing its lease, so the runner ends it/);
	assert.match(server.output(), /main: Pi was stopped by SIGKILL/);
});

test("agentx run stops a worker that writes nothing for its stall time, and the event is tried again, three times at most", async (t) => {
	const { queue, message, start, reach } = setup(t);
	// A tool that runs longer than the stall time without output.
	const id = queue.enqueue({ threadId: "main", content: "[sleep 30] stuck" });
	const server = start(4, 2);
	await reach("failed", id);
	assert.equal(message(id).attempts, 3);
	assert.match(server.output(), /main: Pi wrote nothing for 2 s, so the runner stops it/);
});

test("a forced stop ends the running threads at once, and their events wait for the next start", async (t) => {
	const { queue, message, start } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 30] long" });
	const server = start();
	await until(() => message(id).entryId);
	// The first signal lets the run finish; the second stops it.
	server.child.kill("SIGINT");
	await sleep(500);
	const stoppedAt = Date.now();
	assert.equal(await server.end(), 0);
	assert.ok(Date.now() - stoppedAt < 10_000, "the run is not waited for");
	assert.deepEqual([message(id).status, message(id).attempts], ["queued", 1]);
});

test("a session that loses its thread to another process lets go of it, and agentx run takes the thread back when that process is gone", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 5] taken away" });
	const server = start();
	await until(() => message(id).entryId);
	// What a paused Pi process finds when it wakes: another process holds the thread.
	const takenAt = Date.now();
	onQueueFile(project.agent, `UPDATE threads SET owner = 'another process', heartbeat_at = ${Date.now() + 3_600_000}`);
	await until(() => /main: session closed/.test(server.output()));
	assert.ok(Date.now() - takenAt < 3_000, "the run in progress is aborted, not run to its end, so it writes no more to the session");
	assert.equal(message(id).status, "in_flight", "nothing is settled on a thread that is no longer held");

	// That process ends without finishing the message.
	onQueueFile(project.agent, "DELETE FROM threads");
	await reach("done", id);
	assert.equal(message(id).attempts, 2);
	assert.equal(server.child.exitCode, null);
	assert.deepEqual(sessions(project).map((session) => session.id), ["main"]);
});

test("agentx event send takes the thread, its flags, a key and metadata as --meta name=value", async (t) => {
	const { project, message } = setup(t);
	const sent = await agentx(project, ["event", "send", "--thread-id", "support", "--meta", "from=ops", "--meta=ticket=42", "--do-not-steer", "--silent", "two", "words"]);
	assert.equal(sent.status, 0, sent.stderr);
	const [, id] = /^Queued event ([\w-]{12}) on thread "support" with source=cli, from=ops, ticket=42\.$/.exec(sent.stdout.trim()) ?? [];
	const { threadId, content, metadata, doNotSteer, isSilent, status } = message(id);
	assert.deepEqual({ threadId, content, metadata, doNotSteer, isSilent, status }, { threadId: "support", content: "two words", metadata: { source: "cli", from: "ops", ticket: "42" }, doNotSteer: true, isSilent: true, status: "queued" });

	// After `--`, everything is content, however many words and whatever they look like. Without --thread-id the event waits for the router.
	const routed = await agentx(project, ["event", "send", "--meta", "source=ops-script", "--", "--not-an-option", "and", "--more", "words"]);
	assert.match(routed.stdout, /^Queued event [\w-]{12} for the router with source=ops-script\.$/m);
	const second = events(project.agent)[1];
	assert.deepEqual([second.threadId, second.content, second.metadata], [null, "--not-an-option and --more words", { source: "ops-script" }]);

	// The same key twice is one event.
	const keyed = [await agentx(project, ["event", "send", "--key", "k1", "once"]), await agentx(project, ["event", "send", "--key", "k1", "once again"])];
	assert.equal(new Set(keyed.map((result) => /Queued event ([\w-]{12})/.exec(result.stdout)[1])).size, 1);

	// A misspelt flag is an error, and so is metadata without a name, without a value, or with a name the harness keeps for itself,
	// an agent that does not exist, and a workflow the agent does not have.
	const typo = await agentx(project, ["event", "send", "--do-not-ster", "hello"]);
	assert.equal(typo.status, 1);
	assert.match(typo.stderr, /Unknown option '--do-not-ster'/);
	assert.match((await agentx(project, ["event", "send", "--meta", "from", "hello"])).stderr, /needs a name and a value/);
	assert.equal((await agentx(project, ["event", "send", "--meta", "=ops", "hello"])).status, 1);
	assert.equal((await agentx(project, ["event", "send", "--meta", "agentX-MessageId=9", "hello"])).status, 1);
	assert.match((await agentx(project, ["event", "send", "--silent"])).stderr, /Nothing to send/);
	assert.match((await agentx(project, ["event", "send", "--agent", "nobody", "hello"])).stderr, /no agent "nobody"/);
	assert.match((await agentx(project, ["event", "send", "--thread-id", "workflow.missing", "hello"])).stderr, /has no workflow "missing"/);
	assert.equal(events(project.agent).length, 3);
});

test("the built CLI file runs as a command by itself, which is how an installed or linked agentx is started", () => {
	// Not through `node <file>`: the file needs its executable bit, which tsc does not set.
	const result = spawnSync(cli, [], { encoding: "utf8" });
	assert.equal(result.error, undefined);
	assert.match(result.stdout + result.stderr, /usage:/);
});

test("chat, run and event refuse a directory that is not an agent", async (t) => {
	const { project } = setup(t);
	for (const elsewhere of [dirname(project.agent), join(project.agent, "storage"), join(project.agent, "..", "..", "..")]) {
		for (const command of [["event", "send", "hello"], ["chat", "-p", "hello"], ["run"]]) {
			const result = await agentx({ agent: elsewhere, env: project.env }, command);
			assert.equal(result.status, 1, `${command[0]} in ${elsewhere}`);
			assert.match(result.stderr, /is not an agent directory/);
		}
	}
});

test("every command but init-project runs the agentx the project installed, and stops when it has none", async () => {
	const project = createAgent(model.port);
	const agentX = join(project.agent, "..", "..");
	const installed = join(agentX, "node_modules", "agent-x");
	// Unlinked first: writing through the link would change this checkout.
	unlinkSync(installed);
	for (const [dir, command] of [[project.agent, ["event", "send", "hello"]], [dirname(agentX), ["init-agent", "other"]]]) {
		const result = await agentx({ agent: dir, env: project.env }, command);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /not installed.*pnpm install/);
	}
	assert.equal(existsSync(join(agentX, "agents", "other")), false);
	// Another copy installed: a stand-in that prints where and with what it was started, and exits 3.
	mkdirSync(join(installed, "dist", "cli"), { recursive: true });
	writeFileSync(join(installed, "dist", "cli", "agentx.js"), "console.log(JSON.stringify([process.cwd(), ...process.argv.slice(2)])); process.exitCode = 3;");
	for (const dir of [dirname(agentX), agentX, project.agent]) {
		const result = await agentx({ agent: dir, env: project.env }, ["event", "send", "--thread-id", "t", "hello"]);
		assert.equal(result.status, 3);
		// A process sees its working directory resolved, and on macOS the temp directory is a symlink.
		assert.deepEqual(JSON.parse(result.stdout), [realpathSync(dir), "event", "send", "--thread-id", "t", "hello"]);
	}
	// A SIGTERM sent to the started agentx alone, as by a process manager, reaches the installed copy, and agentx ends with it.
	writeFileSync(join(installed, "dist", "cli", "agentx.js"), 'process.on("SIGTERM", () => { console.log("stopped"); process.exit(4); }); console.log("ready"); setInterval(() => {}, 1000);');
	const outer = spawn(process.execPath, [cli, "run"], { cwd: project.agent, env: project.env, stdio: ["ignore", "pipe", "inherit"] });
	let said = "";
	outer.stdout.on("data", (chunk) => (said += chunk));
	await until(() => said.includes("ready"));
	outer.kill("SIGTERM");
	const [code] = await once(outer, "exit");
	assert.equal(code, 4);
	assert.match(said, /stopped/);
});

test("init-agent takes only names of letters, digits and dashes, and init-project says when git init fails", async () => {
	const project = createAgent(model.port);
	const root = join(project.agent, "..", "..", "..");
	for (const name of ["../escape", "a/b", "under_score"]) {
		const result = await agentx({ agent: root, env: project.env }, ["init-agent", name]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /is not an agent name/);
	}
	assert.equal(existsSync(join(root, "escape")), false);
	assert.equal((await agentx({ agent: root, env: project.env }, ["init-agent", "second-agent-2"])).status, 0);
	// No git on the PATH.
	const noGit = await agentx({ agent: dirname(root), env: { ...project.env, PATH: "" } }, ["init-project", "without-git"]);
	assert.equal(noGit.status, 1);
	assert.match(noGit.stderr, /git init failed/);
});

test("a new agent has a knowledge folder of its own, and Pi loads what the agent writes there", async (t) => {
	const { project } = setup(t);
	const knowledge = join(project.agent, "storage", "knowledge");
	assert.deepEqual(readdirSync(knowledge).sort(), ["extensions", "skills", "system_prompt"]);
	// Its settings load that folder, name no time zone, and give it a Composio user id.
	const settings = JSON.parse(readFileSync(join(project.agent, ".pi", "settings.json"), "utf8"));
	assert.deepEqual([settings.extensions, settings.skills, settings.agentx], [["../storage/knowledge/extensions"], ["../storage/knowledge/skills"], { timezone: null, systemPrompt: ["../storage/knowledge/system_prompt"], composio: { userId: "main@project" } }]);

	// What an agent can write for itself: a skill, an extension, and a note for its system prompt.
	mkdirSync(join(knowledge, "skills", "greet"));
	writeFileSync(join(knowledge, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: How to greet people. Use it when greeting.\n---\n\nSay hello.\n");
	writeFileSync(join(knowledge, "extensions", "marker.ts"), `import { writeFileSync } from "node:fs";\nexport default function (pi) { pi.on("session_start", (_event, ctx) => writeFileSync(ctx.cwd + "/storage/marker", "")); }`);
	writeFileSync(join(knowledge, "system_prompt", "learned.md"), "LEARNED: the build runs with pnpm.");
	// And what its developer adds, which comes first.
	writeFileSync(join(project.agent, ".pi", "system_prompt", "10-rules.md"), "DEVELOPER: answer briefly.");

	const run = await agentx(project, ["chat", "-p", "hi"]);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(existsSync(join(project.agent, "storage", "marker")), "the extension was loaded");
	// The harness's prompt, the developer's files, the agent's own under a heading that names their folder, then Pi's list of skills.
	const prompt = model.systemPrompts.at(-1);
	const places = ["# Harness", "DEVELOPER: answer briefly.", "# From storage/knowledge/system_prompt", "LEARNED: the build runs with pnpm.", "How to greet people."].map((part) => prompt.indexOf(part));
	assert.deepEqual(places, [...places].sort((a, b) => a - b), prompt);
	assert.ok(places[0] >= 0, prompt);
});

test("each thread keeps its sessions in a folder of its own, and opening the thread again goes on with its session", async (t) => {
	const { project } = setup(t);
	const sessionsDir = join(project.agent, "storage", "sessions");
	assert.equal((await agentx(project, ["chat", "-p", "on main"])).status, 0);
	assert.equal((await agentx(project, ["chat", "--thread-id", "support", "-p", "on support"])).status, 0);
	assert.deepEqual(readdirSync(sessionsDir).sort(), ["main", "support"]);
	const [file] = readdirSync(join(sessionsDir, "support"));
	assert.match(file, /_support\.jsonl$/);

	assert.equal((await agentx(project, ["chat", "--thread-id", "support", "-p", "again"])).status, 0);
	assert.deepEqual(readdirSync(join(sessionsDir, "support")), [file]);
	assert.deepEqual(sessions(project).find((session) => session.id === "support").contents, ["on support", "again"]);
});

test("an agent whose storage has no knowledge folder, as after a fresh clone, starts all the same", async (t) => {
	const { project } = setup(t);
	rmSync(join(project.agent, "storage", "knowledge"), { recursive: true });
	const run = await agentx(project, ["chat", "-p", "hi"]);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(!model.systemPrompts.at(-1).includes("# From storage/knowledge"));
});

test("events show the machine's time, or the time zone that the agent's settings name", async (t) => {
	const { project, queue, start, reach } = setup(t);
	const settingsPath = join(project.agent, ".pi", "settings.json");
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	const withZone = (timezone) => writeFileSync(settingsPath, JSON.stringify({ ...settings, agentx: { ...settings.agentx, timezone } }));
	const server = start();
	// Each message gets a session of its own, which reads the settings when it starts.
	const answered = async (content, sessions) => {
		await reach("done", queue.enqueue({ threadId: "main", content }));
		await until(() => server.output().match(/main: session closed/g)?.length === sessions);
	};

	// A new agent's settings say null: the machine's time zone, and nothing to report.
	assert.equal(settings.agentx.timezone, null);
	await answered("no zone named", 1);
	assert.match(sessions(project)[0].users[0].text, /\nagentX-CurrentTime: \w+day [^\n]+ GMT[^\n]*\n/);
	assert.doesNotMatch(server.output(), /time zone/);

	withZone("Asia/Tokyo");
	await answered("a zone named", 2);
	assert.match(sessions(project)[0].users[1].text, /\nagentX-CurrentTime: [^\n]+ GMT\+9\n/);

	// A zone that does not exist is reported, and the message still arrives, with the machine's time.
	withZone("Mars/Olympus");
	await answered("a zone that is not one", 3);
	assert.match(server.output(), /main: Unknown time zone "Mars\/Olympus"/);
});

test("a model that an extension of the agent provides serves queued events like any other", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	// No provider in Pi's own files: the agent's extension registers the one its settings name.
	rmSync(join(project.agent, "..", "..", ".pi", "models.json"));
	writeFileSync(
		join(project.agent, ".pi", "extensions", "provider.ts"),
		`export default function (pi) {
			pi.registerProvider("fake", {
				baseUrl: "http://127.0.0.1:${model.port}/v1",
				apiKey: "not-a-key",
				api: "openai-completions",
				models: [{ id: "fake-model", name: "Fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
			});
		}`,
	);
	const typed = await agentx(project, ["chat", "--thread-id", "typed", "-p", "hi"]);
	assert.equal(typed.status, 0, typed.stderr);
	assert.match(typed.stdout, /reply/);

	const id = queue.enqueue({ threadId: "main", content: "queued" });
	start();
	await reach("done", id);
	assert.equal(message(id).attempts, 1);
});
