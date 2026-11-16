// End-to-end tests of `agentx run` beyond Pi threads: the event router, workflows and their failure reports, and the supervisor.
// Real `agentx run` processes in a scratch project, with the fake model for the Pi threads that events reach.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sendEvent } from "../dist/agent-runtime/events/send-event.js";
import { deliverOutbox } from "../dist/coordinator-runtime/services/relay/relay.js";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, editSettings, events, inboxEvents, onQueueFile, scratch, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/**
 * A fresh project (see `scratch`); `file` writes a file in its agent directory. What the agent sends itself, as its workflows' events and failure reports,
 * goes through its outbox, so the test delivers it as agentx serve does, a few times a second.
 */
function setup(t) {
	const base = scratch(t, model.port);
	const courier = setInterval(() => deliverOutbox(base.project.agent), 100);
	t.after(() => clearInterval(courier));
	return {
		...base,
		file: (path, text) => {
			mkdirSync(join(base.project.agent, path, ".."), { recursive: true });
			writeFileSync(join(base.project.agent, path), text);
		},
	};
}

/** A router that answers `{ thread }` from a line of the event's content, `route: <thread>`; "throw" and "hang" make it fail, and "pass" returns nothing. */
const testRouter = `
export default async function route(event, ctx) {
	const wanted = /route: (\\S+)/.exec(event.content)?.[1] ?? "main";
	if (wanted === "throw") { console.log("printed before throwing"); throw new Error("the router broke"); }
	if (wanted === "hang") for (;;);
	if (wanted === "pass") return;
	if (wanted === "workflows") return { thread: ctx.workflows.map((workflow) => workflow.name).join("-") || "none" };
	return { thread: wanted };
}
`;

test("a new agent's router, the developer's, sends an event without a thread to main, and agentx writes no router of the agent's own", async (t) => {
	const { project, event, send, start, reach } = setup(t);
	assert.match(readFileSync(join(project.agent, ".pi", "event_router.mjs"), "utf8"), /return \{ thread: "main" \};/);
	const first = await send("hello");
	// It waits in the inbox, and only the router loop adds it to the queue.
	assert.equal(event(first), undefined);
	assert.deepEqual(inboxEvents(project.agent).map((mail) => mail.id), [first]);
	start();
	await reach("done", first);
	assert.equal(event(first).threadId, "main");
	assert.equal(event(first).metadata["agentX-RouterError"], undefined);
	assert.ok(!existsSync(join(project.agent, "storage", "knowledge", "event_router.mjs")));
});

test("the agent's router is asked first, then the developer's; one that fails or picks no thread leaves the event to the next, and then to main", async (t) => {
	const { event, send, start, reach, file } = setup(t);
	file("storage/knowledge/event_router.mjs", testRouter);
	// The developer's router answers `dev: <thread>`, nothing without it, and throws on `dev: throw`.
	file(
		".pi/event_router.mjs",
		`export default async function route(event) {
			const wanted = /dev: (\\S+)/.exec(event.content)?.[1];
			if (wanted === "throw") throw new Error("the developer's router broke");
			return wanted === undefined ? undefined : { thread: wanted };
		}`,
	);
	start();
	const agents = await send("route: support\ndev: throw");
	const developers = await send("route: pass\ndev: billing");
	const neither = await send("route: pass");
	const agentFailed = await send("route: throw\ndev: billing");
	const bothFailed = await send("route: throw\ndev: throw");
	const all = [agents, developers, neither, agentFailed, bothFailed];
	for (const id of all) await reach("done", id);
	assert.deepEqual(
		all.map((id) => [event(id).threadId, event(id).metadata["agentX-RouterError"]?.match(/(\S+event_router\.mjs): failed/g)]),
		[
			["support", undefined],
			["billing", undefined],
			["main", undefined],
			["billing", ["storage/knowledge/event_router.mjs: failed"]],
			["main", ["storage/knowledge/event_router.mjs: failed", ".pi/event_router.mjs: failed"]],
		],
	);
});

test("the router's answer puts the event on its thread, the router can import the project's packages, and an event that names a thread skips the router", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	// A package installed in the project's agent-x/, which the router imports.
	const helper = join(project.agent, "..", "..", "node_modules", "route-helper");
	mkdirSync(helper);
	writeFileSync(join(helper, "package.json"), JSON.stringify({ name: "route-helper", type: "module", main: "index.js" }));
	writeFileSync(join(helper, "index.js"), 'export const helped = (thread) => thread === "helped" ? "support-2" : thread;');
	file("storage/knowledge/event_router.mjs", `import { helped } from "route-helper";\n${testRouter.replace("return { thread: wanted };", "return { thread: helped(wanted) };")}`);
	file(".pi/workflows.json", JSON.stringify({ w: { description: "Does nothing.", script: "workflows/w.mjs" } }));
	file(".pi/workflows/w.mjs", "export default async function () {}");
	start();
	const routed = await send("route: support");
	const imported = await send("route: helped");
	const listed = await send("route: workflows");
	// The router would throw, so this one did not go through it.
	const given = await send("--thread-id", "main", "route: throw");
	for (const id of [routed, imported, listed, given]) await reach("done", id);
	assert.deepEqual([routed, imported, listed, given].map((id) => event(id).threadId), ["support", "support-2", "w", "main"]);
	assert.equal(event(given).metadata["agentX-RouterError"], undefined);
});

test("a router that throws, hangs or names a missing workflow sends the event to main with agentX-RouterError, and the event keeps why", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	file("storage/knowledge/event_router.mjs", testRouter);
	editSettings(project.agent, (settings) => ({ ...settings, agentx: { ...settings.agentx, runner: { routerSeconds: 2 } } }));
	const [threw, hung, missing, bad] = [await send("route: throw"), await send("route: hang"), await send("route: workflow.nope"), await send("route: no/good")];
	start();
	for (const id of [threw, hung, missing, bad]) await reach("done", id);
	assert.deepEqual(
		[threw, hung, missing, bad].map((id) => [event(id).threadId, event(id).metadata["agentX-RouterError"].split(": ")[1]]),
		[
			["main", "failed"],
			["main", "timeout"],
			["main", "unknown workflow"],
			["main", "bad answer"],
		],
	);
	// Why, in one line the model sees with the event, and what the router printed, in a log.
	assert.equal(event(threw).metadata["agentX-RouterError"], `storage/knowledge/event_router.mjs: failed: the router broke What it printed: storage/workspace/router-logs/${threw}.agent.log`);
	assert.match(readFileSync(join(project.agent, "storage", "workspace", "router-logs", `${threw}.agent.log`), "utf8"), /^printed before throwing\n/);
	assert.match(event(hung).metadata["agentX-RouterError"], /^storage\/knowledge\/event_router\.mjs: timeout: it took longer than 2 s/);

	// No sender can name it, so a router failure cannot be faked.
	assert.match((await agentx(project, ["event", "deliver", "--meta", "agentX-RouterError=fake", "hello"])).stderr, /Invalid metadata name "agentX-RouterError"/);
});

/** Workflows for the tests: `ok` prints, changes directory, sends an event to main, and returns what JSON cannot carry; `broken` throws; `slow` outlives its 1 s; `timed` notes when it ran. */
function workflows(file, babysitterThread) {
	file(
		".pi/workflows.json",
		JSON.stringify({
			ok: { description: "Sends a note to main.", script: "workflows/ok.mjs" },
			broken: { description: "Always fails.", script: "workflows/broken.mjs", ...(babysitterThread ? { babysitterThread } : {}) },
			slow: { description: "Takes too long.", script: "workflows/slow.mjs", timeoutSeconds: 1 },
			timed: { description: "Notes when it ran.", script: "workflows/timed.mjs" },
		}),
	);
	file(
		".pi/workflows/ok.mjs",
		`export default async function (event, ctx) { console.log("params", event.content, event.metadata.month); process.chdir("/"); await ctx.send("note from ok", { threadId: "main" }); const loop = {}; loop.self = loop; return loop; }`,
	);
	file(".pi/workflows/broken.mjs", `export default async function () { console.log("about to fail"); throw new Error("broken on purpose"); }`);
	file(".pi/workflows/slow.mjs", `import { setTimeout } from "node:timers/promises"; export default async function () { await setTimeout(30_000); }`);
	file(
		".pi/workflows/timed.mjs",
		`import { appendFileSync } from "node:fs"; import { setTimeout } from "node:timers/promises";
		export default async function (event) { appendFileSync("storage/workspace/timed", "start " + Date.now() + "\\n"); await setTimeout(1000); appendFileSync("storage/workspace/timed", "end " + Date.now() + "\\n"); }`,
	);
}

test("a workflow gets its event, with its content and metadata as parameters, logs its output, and is done without a report", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	workflows(file);
	const id = await send("--thread-id", "workflow.ok", "--meta", "month=january", '{"invoice": "4411"}');
	// With its parameters in metadata alone, as a schedule may give them.
	const bare = await send("--thread-id", "workflow.ok", "--meta", "month=march", "");
	start();
	await reach("done", id, bare);
	const log = (eventId) => readFileSync(join(project.agent, "storage", "workspace", "workflow-logs", "ok", `${eventId}.log`), "utf8");
	assert.deepEqual([log(id), log(bare)], ['params {"invoice": "4411"} january\n', "params  march\n"]);
	const note = await until(() => events(project.agent).find((found) => found.content === "note from ok"));
	// Delivered from the agent's outbox, as sent by the workflow from its babysitter thread, main, which the receiving thread would answer.
	assert.deepEqual(note.metadata, { source: "workflow.ok", "agentX-FromAgent": "main", "agentX-FromThread": "main", "agentX-FromWorkflow": "ok" });
	await reach("done", note.id);
	assert.equal(events(project.agent).length, 4, "no report");
});

test("a failed run is failed once and reported to main with its log, and a run past its time is killed", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	workflows(file);
	const broken = await send("--thread-id", "workflow.broken", "{}");
	const slow = await send("--thread-id", "workflow.slow", "{}");
	start();
	await reach("failed", broken);
	await reach("failed", slow);
	assert.deepEqual([event(broken).error, event(broken).attempts], ["broken on purpose", 1]);
	assert.match(event(slow).error, /^timeout: it took longer than 1 s/);
	const report = events(project.agent).find((found) => found.key === `failed:${broken}`);
	assert.equal(report.threadId, "main");
	assert.equal(report.metadata.source, "workflow.broken");
	assert.match(report.content, new RegExp(`^Workflow \`broken\` failed on event \`${broken}\`: broken on purpose\n\nIts log: \`storage/workspace/workflow-logs/broken/${broken}\\.log\``));
	assert.match(readFileSync(join(project.agent, "storage", "workspace", "workflow-logs", "broken", `${broken}.log`), "utf8"), /about to fail\n[^]*broken on purpose/);
	await until(() => events(project.agent).some((found) => found.key === `failed:${slow}`));
	await reach("done", report.id);
});

test("a failure report goes to the thread the workflow names, which is a thread of its own agent", async (t) => {
	const { project, send, start, reach, file } = setup(t);
	workflows(file, "alerts");
	const broken = await send("--thread-id", "workflow.broken", "{}");
	start();
	await reach("failed", broken);
	const report = await until(() => events(project.agent).find((found) => found.key === `failed:${broken}`));
	assert.equal(report.threadId, "alerts");
});

test("the router adds an event sent again with its key once, asks no router for the copy, and keeps its folder", async (t) => {
	const { project, send, start, reach, file } = setup(t);
	// Notes each event it is asked about, and leaves it to main.
	file("storage/knowledge/event_router.mjs", `import { appendFileSync } from "node:fs";\nexport default async function route(event) { appendFileSync("storage/workspace/asked", event.id + "\\n"); }`);
	const first = await send("--key", "k", "1");
	start();
	await reach("done", first);
	assert.equal(await send("--key", "k", "2"), first);
	await until(() => inboxEvents(project.agent).length === 0);
	assert.equal(events(project.agent).filter((found) => found.key === "k").length, 1);
	assert.equal(readFileSync(join(project.agent, "storage", "workspace", "asked"), "utf8"), `${first}\n`);
	assert.ok(existsSync(join(project.agent, "storage", "workspace", "inbox", first, "event.json")), "the event's folder is kept");
});

test("events that one process sends in a row reach the queue in that order, also within one millisecond", async (t) => {
	const { project, start } = setup(t);
	// Straight from this process, several in each millisecond; silent, so that no Pi starts.
	const sent = Array.from({ length: 20 }, (_, n) => sendEvent(project.agent, { threadId: "main", content: String(n), isSilent: true }));
	start();
	await until(() => events(project.agent).length === sent.length);
	assert.deepEqual(events(project.agent).map((found) => found.id), sent);
});

test("an event the queue cannot hold is refused when it is sent, and one written into the inbox by hand is set aside without holding up the next", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	// As a workflow's ctx.send could pass it.
	assert.throws(() => sendEvent(project.agent, { threadId: "main", content: { text: "not text" } }), /Invalid event: its content must be text/);
	// First in the inbox, with no content.
	file("storage/workspace/inbox/badbadbadbad/event.json", JSON.stringify({ id: "badbadbadbad", sentAt: 1, event: { threadId: "main", key: "bad" }, facts: {} }));
	file("storage/workspace/inbox/.pending/000000000000001-badbadbadbad", "");
	const next = await send("--thread-id", "main", "after it");
	start();
	await reach("done", next);
	assert.equal(event("badbadbadbad"), undefined);
	assert.ok(existsSync(join(project.agent, "storage", "workspace", "inbox", ".rejected", "000000000000001-badbadbadbad")));
});

test("a workflow runs one event at a time, and of two workflows with one name the developer's runs", async (t) => {
	const { project, send, start, reach, file } = setup(t);
	workflows(file);
	file("storage/knowledge/workflows.json", JSON.stringify({ ok: { description: "The agent's own, never used.", script: "mine.mjs" } }));
	file("storage/knowledge/mine.mjs", `export default async function () { throw new Error("the agent's own ran"); }`);
	const [first, second] = [await send("--thread-id", "workflow.timed", "1"), await send("--thread-id", "workflow.timed", "2")];
	const ok = await send("--thread-id", "workflow.ok", "{}");
	const server = start();
	for (const id of [first, second, ok]) await reach("done", id);
	const [start1, end1, start2] = readFileSync(join(project.agent, "storage", "workspace", "timed"), "utf8").trim().split("\n").map((line) => Number(line.split(" ")[1]));
	assert.ok(end1 <= start2, "the second run started after the first ended");
	assert.ok(start1 < end1);
	assert.match(server.output(), /workflow "ok" is skipped: \.pi\/workflows\.json has one of that name/);
});

test("after agentx run is killed during a run, the next one fails the event once and reports that the run was cut off", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	workflows(file);
	const id = await send("--thread-id", "workflow.slow", "{}");
	// The run is long enough to be cut off.
	file(".pi/workflows.json", JSON.stringify({ slow: { description: "Takes long.", script: "workflows/slow.mjs", timeoutSeconds: 60 } }));
	const first = start();
	await until(() => event(id)?.status === "in_flight");
	await first.stop();
	// As two minutes later: the dead process's lease on the workflow's thread has run out.
	onQueueFile(project.agent);
	start();
	await reach("failed", id);
	const reports = await until(() => {
		const found = events(project.agent).filter((other) => other.key === `failed:${id}`);
		return found.length > 0 && found;
	});
	assert.equal(reports.length, 1);
	assert.match(reports[0].content, /cut off: agentx run stopped during the run, so the workflow may still have been running/);
	assert.equal(event(id).attempts, 1);
});

test("a terminal's Ctrl-C lets a running thread finish, also with a SIGTERM right after it, and agentx run then exits 0", async (t) => {
	const { project, event, send, start, reach } = setup(t);
	const id = await send("--thread-id", "main", "[sleep 2] finish me");
	const server = start();
	await until(() => event(id)?.entryId);
	assert.ok(Date.now() - Number(readFileSync(join(project.agent, "storage", "heartbeat"), "utf8")) < 15_000, "the heartbeat is fresh");
	// To the whole process group, as a terminal sends it: Pi has a group of its own, so only agentx run gets it.
	process.kill(-server.child.pid, "SIGINT");
	process.kill(-server.child.pid, "SIGTERM");
	assert.equal(await server.exited, 0);
	assert.equal(event(id).status, "done");
});

test("a loop that crashes is started again, and its work goes on", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	// A router that prints and fails has its output logged, which cannot be done while router-logs is a file, so the router's loop crashes.
	file("storage/knowledge/event_router.mjs", testRouter);
	file("storage/workspace/router-logs", "");
	const id = await send("route: throw");
	const server = start();
	await until(() => /router: the loop crashed/.test(server.output()));
	assert.match(server.output(), /router: starting the loop again in 1 s/);
	rmSync(join(project.agent, "storage", "workspace", "router-logs"));
	await reach("done", id);
	assert.equal(event(id).threadId, "main");
});
