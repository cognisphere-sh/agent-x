// End-to-end tests: the built CLI and the runner in a scratch project, real Pi processes, and a fake model. They cover what a type check cannot:
// delivery and steering through the Pi extensions, retries, threads side by side, the CLI and the runner sharing a thread, and what becomes of messages when a process dies.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { Queue } from "../dist/agent-runtime/pi-package/extensions/message-queue/queue.js";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, alive, cli, createAgent, holder, messages, onlySession, onQueueFile, open, runner, sessions, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/** A fresh project, its queue, and a way to start the runner, which is stopped when the test ends. */
function setup(t) {
	const project = createAgent(model.port);
	const queue = new Queue(project.agent);
	const servers = [];
	t.after(async () => {
		for (const server of servers) await server.stop();
		queue.close();
	});
	const message = (id) => messages(project.agent).find((found) => found.id === id);
	return {
		project,
		queue,
		message,
		start: (maxWorkers) => servers[servers.push(runner(project, maxWorkers)) - 1],
		// Resolves when the messages are all in the given status.
		reach: (status, ...ids) => until(() => ids.every((id) => message(id).status === status)),
	};
}

test("a queued message runs in the session of its thread and is linked to its session entry", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "hello", metadata: { from: "test" } });
	start();
	await reach("done", id);

	const session = onlySession(project);
	assert.equal(session.id, "main");
	assert.deepEqual(session.roles, ["system", "user", "assistant"]);
	assert.match(session.users[0].text, /^<metadata>\nagentX-MessageId: 1\nagentX-ThreadId: main\nagentX-CurrentTime: \w+day [^\n]+\nagentX-IsRetry: false\nfrom: test\n<\/metadata>\nhello$/);
	assert.equal(message(id).entryId, session.users[0].entryId);
	assert.equal(message(id).attempts, 1);
});

test("a message that arrives during a run is steered into it; one marked do-not-steer waits for the next run", async (t) => {
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

test("a failed run is retried with retry metadata, and after three attempts the message is failed", async (t) => {
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

test("threads run side by side, each in its own session, up to the runner's limit", async (t) => {
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

test("with one worker, threads run one after another, the thread of the oldest message first", async (t) => {
	const { queue, message, start, reach } = setup(t);
	const first = queue.enqueue({ threadId: "x", content: "[sleep 1] x1" });
	const second = queue.enqueue({ threadId: "y", content: "y1" });
	start(1);
	await until(() => message(first).status === "in_flight");
	assert.equal(message(second).status, "queued");
	await reach("done", first, second);
	assert.ok(message(first).updatedAt <= message(second).updatedAt);
});

test("agentx run and the runner continue the same thread in one session file", async (t) => {
	const { project, queue, start, reach } = setup(t);
	const cli = await agentx(project, ["run", "-p", "from the cli"]);
	assert.equal(cli.status, 0, cli.stderr);
	assert.match(cli.stdout, /reply/);

	const id = queue.enqueue({ threadId: "main", content: "from the queue" });
	const server = start();
	await reach("done", id);
	// Asked to stop, the runner waits for its sessions, which close when their threads have no work and give the threads up.
	assert.equal(await server.end(), 0);
	assert.match(server.output(), /main: session closed/);

	const again = await agentx(project, ["run", "-p", "from the cli again"]);
	assert.equal(again.status, 0, again.stderr);
	const session = onlySession(project);
	assert.equal(session.id, "main");
	assert.deepEqual(session.contents, ["from the cli", "from the queue", "from the cli again"]);
});

test("a one-shot agentx run answers its own prompt and leaves the thread's queued messages on the queue", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "queued before" });
	const calls = model.requests.length;
	const cli = await agentx(project, ["run", "-p", "[sleep 2] typed"]);
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

test("a session that agentx run keeps open receives the thread's queued messages while it is idle", async (t) => {
	const { project, queue, reach } = setup(t);
	// RPC mode stays open until its input ends, as the terminal UI does until the person leaves. No runner is involved.
	const child = open(project, ["run", "--mode", "rpc"], t);
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

test("agentx run refuses a thread that the runner is running, and the session stays as it was", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 3] slow" });
	start();
	await until(() => message(id).entryId);
	const before = sessions(project)[0].users.length;

	// The default thread and a named one are refused before Pi starts.
	const refused = await agentx(project, ["run", "-p", "let me in"]);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /Thread "main" is running in another process/);
	// With -c Pi picks the session itself, so the queue extension refuses the prompt.
	const continued = await agentx(project, ["run", "-c", "-p", "let me in"]);
	assert.equal(continued.status, 1);
	assert.match(continued.stderr, /Thread "main" is running in another process/);
	// Another thread is free.
	const other = await agentx(project, ["run", "--thread-id", "other", "-p", "hello"]);
	assert.equal(other.status, 0, other.stderr);
	assert.equal((await agentx(project, ["run", "--thread-id=other", "-p", "hello again"])).status, 0);
	assert.equal((await agentx(project, ["run", "--thread-id=main", "-p", "let me in"])).status, 1);
	assert.equal(sessions(project).find((session) => session.id === "other").users.length, 2);

	await reach("done", id);
	const main = sessions(project).find((session) => session.id === "main");
	assert.equal(main.users.length, before);
	assert.ok(!main.users.some((user) => user.text.includes("let me in")));
});

test("when a thread's Pi process dies, the runner ends the attempt of its messages at once and starts the thread again", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 2] killed" });
	const server = start();
	await until(() => message(id).entryId);
	// Not to enter the run in progress, so the process has not taken it when it dies.
	const waiting = queue.enqueue({ threadId: "main", content: "waiting", doNotSteer: true });
	process.kill(holder(project.agent, "main"), "SIGKILL");

	// Well before the dead process's lease has run out, which takes 20 to 30 s.
	await until(() => message(id).attempts === 2, 10_000);
	await reach("done", id, waiting);
	assert.equal(message(waiting).attempts, 1, "a message the dead process had not taken loses no attempt");
	assert.match(server.output(), /main: Pi was stopped by SIGKILL/);
	assert.equal(server.child.exitCode, null);
	const session = onlySession(project);
	assert.match(session.users.at(-1).text, /agentX-IsRetry: true\nagentX-RetryAttempt: 1\n/);
});

test("a Pi process that is told to stop ends the attempt of its messages itself, and the runner counts no second one", async (t) => {
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

test("a runner that is killed takes its sessions with it, and their messages get another attempt from the next one", async (t) => {
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

test("an agent that cannot start fails its messages after three attempts, with what Pi said", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	writeFileSync(join(project.agent, ".pi", "extensions", "broken.ts"), `throw new Error("broken on purpose");`);
	const id = queue.enqueue({ threadId: "main", content: "never runs" });
	const server = start();
	await reach("failed", id);

	assert.equal(message(id).attempts, 3);
	assert.match(message(id).error, /^Error: Failed to load extension .*broken on purpose/);
	// Each of the three starts ended with Pi's own words.
	assert.equal(server.output().match(/main: Error: Failed to load extension/g).length, 3);
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
	start();
	await reach("done", id);
	assert.deepEqual(sessions(project)[0].roles, ["system", "user", "assistant", "toolResult", "assistant"]);
});

test("a worker session that does not get its thread ends itself", async (t) => {
	const { project, queue } = setup(t);
	queue.enqueue({ threadId: "main", content: "for whoever holds the thread" });
	// Another process took the thread between the runner's look at the queue and the start of the session.
	onQueueFile(project.agent, `INSERT INTO threads (thread_id, owner, heartbeat_at) VALUES ('main', 'another process', ${Date.now() + 3_600_000})`);
	// With --session-id Pi picks the session, so the check is the queue extension's, as for the runner's own Pi processes.
	const child = open(project, ["run", "--session-id", "main", "--mode", "rpc", "--agentx-worker"], t);
	let said = "";
	child.stdout.on("data", (chunk) => (said += chunk));
	// Its input stays open, so nothing but the session itself ends it.
	await until(() => child.exitCode !== null);
	assert.equal(child.exitCode, 0);
	assert.match(said, /Thread \\"main\\" is running in another process/);
	assert.equal(messages(project.agent)[0].status, "queued");
});

test("a message that arrives while a thread's session is closing waits for it and continues the same conversation", async (t) => {
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

test("aborting a run cancels the message it was working on and leaves a waiting one for the next run", async (t) => {
	const { project, queue, message, reach } = setup(t);
	const child = open(project, ["run", "--mode", "rpc"], t);
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

test("without a usable model a message fails at once, with the reason", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	rmSync(join(project.agent, "..", "..", ".pi", "models.json"));
	const id = queue.enqueue({ threadId: "main", content: "nobody to answer" });
	const server = start();
	await reach("failed", id);
	assert.equal(message(id).attempts, 3);
	assert.match(message(id).error, /^No model selected/);
	assert.equal(server.child.exitCode, null);
});

test("a send that an extension of the agent gets refused during a run leaves the run's queue messages alone", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	// Without deliverAs, Pi refuses a send during a run and reports it to the host, as it does for a queue message it does not take.
	writeFileSync(join(project.agent, ".pi", "extensions", "noisy.ts"), `export default function (pi) { pi.on("tool_execution_start", () => pi.sendUserMessage("x")); }`);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 1] with a noisy extension" });
	const server = start();
	await reach("done", id);
	assert.equal(message(id).attempts, 1);
	assert.match(server.output(), /send_user_message/);
});

test("a session that loses its thread to another process lets go of it, and the runner takes the thread back when that process is gone", async (t) => {
	const { project, queue, message, start, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[sleep 3] taken away" });
	const server = start();
	await until(() => message(id).entryId);
	// What a paused Pi process finds when it wakes: another process holds the thread.
	onQueueFile(project.agent, `UPDATE threads SET owner = 'another process', heartbeat_at = ${Date.now() + 3_600_000}`);
	await until(() => /main: session closed/.test(server.output()));
	assert.equal(message(id).status, "in_flight", "nothing is settled on a thread that is no longer held");

	// That process ends without finishing the message.
	onQueueFile(project.agent, "DELETE FROM threads");
	await reach("done", id);
	assert.equal(message(id).attempts, 2);
	assert.equal(server.child.exitCode, null);
	assert.deepEqual(sessions(project).map((session) => session.id), ["main"]);
});

test("agentx send takes the thread, its flags, and every other option as metadata", async (t) => {
	const { project, message } = setup(t);
	const sent = await agentx(project, ["send", "--thread-id", "support", "--from", "ops", "--ticket=42", "--do-not-steer", "--silent", "two", "words"]);
	assert.equal(sent.status, 0, sent.stderr);
	assert.equal(sent.stdout.trim(), 'Queued message 1 on thread "support" with from=ops, ticket=42.');
	const { threadId, content, metadata, doNotSteer, isSilent, status } = message(1);
	assert.deepEqual({ threadId, content, metadata, doNotSteer, isSilent, status }, { threadId: "support", content: "two words", metadata: { from: "ops", ticket: "42" }, doNotSteer: true, isSilent: true, status: "queued" });

	// After `--`, everything is content, however many words and whatever they look like. Without --thread-id the thread is main.
	assert.equal((await agentx(project, ["send", "--", "--not-an-option", "and", "--more", "words"])).status, 0);
	assert.deepEqual([message(2).threadId, message(2).content, message(2).metadata], ["main", "--not-an-option and --more words", {}]);

	// A misspelt flag reads as metadata and takes the content as its value: nothing is queued.
	const typo = await agentx(project, ["send", "--do-not-ster", "hello"]);
	assert.equal(typo.status, 1);
	assert.match(typo.stderr, /Nothing to send/);
	assert.equal((await agentx(project, ["send", "--from"])).status, 1);
	assert.equal((await agentx(project, ["send", "--agentX-MessageId", "9", "hello"])).status, 1);
	assert.equal(messages(project.agent).length, 2);
});

test("the built CLI file runs as a command by itself, which is how an installed or linked agentx is started", () => {
	// Not through `node <file>`: the file needs its executable bit, which tsc does not set.
	const result = spawnSync(cli, [], { encoding: "utf8" });
	assert.equal(result.error, undefined);
	assert.match(result.stdout + result.stderr, /usage:/);
});

test("run and send refuse a directory that is not an agent", async (t) => {
	const { project } = setup(t);
	for (const elsewhere of [dirname(project.agent), join(project.agent, "storage"), join(project.agent, "..", "..", "..")]) {
		for (const command of [["send", "hello"], ["run", "-p", "hello"]]) {
			const result = await agentx({ agent: elsewhere, env: project.env }, command);
			assert.equal(result.status, 1, `${command[0]} in ${elsewhere}`);
			assert.match(result.stderr, /is not an agent directory/);
		}
	}
});

test("a new agent has a knowledge folder of its own, and Pi loads what the agent writes there", async (t) => {
	const { project } = setup(t);
	const knowledge = join(project.agent, "storage", "knowledge");
	assert.deepEqual(readdirSync(knowledge).sort(), ["extensions", "skills", "system_prompt"]);
	// Its settings load that folder, and name no time zone.
	const settings = JSON.parse(readFileSync(join(project.agent, ".pi", "settings.json"), "utf8"));
	assert.deepEqual([settings.extensions, settings.skills, settings.agentx], [["../storage/knowledge/extensions"], ["../storage/knowledge/skills"], { timezone: null, systemPrompt: ["../storage/knowledge/system_prompt"] }]);

	// What an agent can write for itself: a skill, an extension, and a note for its system prompt.
	mkdirSync(join(knowledge, "skills", "greet"));
	writeFileSync(join(knowledge, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: How to greet people. Use it when greeting.\n---\n\nSay hello.\n");
	writeFileSync(join(knowledge, "extensions", "marker.ts"), `import { writeFileSync } from "node:fs";\nexport default function (pi) { pi.on("session_start", (_event, ctx) => writeFileSync(ctx.cwd + "/storage/marker", "")); }`);
	writeFileSync(join(knowledge, "system_prompt", "learned.md"), "LEARNED: the build runs with pnpm.");
	// And what its developer adds, which comes first.
	writeFileSync(join(project.agent, ".pi", "system_prompt", "10-rules.md"), "DEVELOPER: answer briefly.");

	const run = await agentx(project, ["run", "-p", "hi"]);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(existsSync(join(project.agent, "storage", "marker")), "the extension was loaded");
	// The harness's prompt, the developer's files, the agent's own under a heading that names their folder, then Pi's list of skills.
	const prompt = model.systemPrompts.at(-1);
	const places = ["# Harness", "DEVELOPER: answer briefly.", "# From storage/knowledge/system_prompt", "LEARNED: the build runs with pnpm.", "How to greet people."].map((part) => prompt.indexOf(part));
	assert.deepEqual(places, [...places].sort((a, b) => a - b), prompt);
	assert.ok(places[0] >= 0, prompt);
});

test("an agent whose storage has no knowledge folder, as after a fresh clone, starts all the same", async (t) => {
	const { project } = setup(t);
	rmSync(join(project.agent, "storage", "knowledge"), { recursive: true });
	const run = await agentx(project, ["run", "-p", "hi"]);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(!model.systemPrompts.at(-1).includes("# From storage/knowledge"));
});

test("messages show the machine's time, or the time zone that the agent's settings name", async (t) => {
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

test("a model that an extension of the agent provides serves queued messages like any other", async (t) => {
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
	const typed = await agentx(project, ["run", "--thread-id", "typed", "-p", "hi"]);
	assert.equal(typed.status, 0, typed.stderr);
	assert.match(typed.stdout, /reply/);

	const id = queue.enqueue({ threadId: "main", content: "queued" });
	start();
	await reach("done", id);
	assert.equal(message(id).attempts, 1);
});
