// End-to-end tests of `agentx run` beyond Pi threads: the event router, workflows and their failure reports, the supervisor, and `agentx event` for audits.
// Real `agentx run` processes in a scratch project, with the fake model for the Pi threads that events reach.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, createAgent, events, onQueueFile, runner, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/** A fresh project; `send` runs `agentx event send` and returns the event's id; `start` starts `agentx run`, which is stopped when the test ends. */
function setup(t) {
	const project = createAgent(model.port);
	const servers = [];
	t.after(async () => {
		for (const server of servers) await server.stop();
	});
	const event = (id, agent = project.agent) => events(agent).find((found) => found.id === id);
	return {
		project,
		event,
		send: async (...args) => {
			const sent = await agentx(project, ["event", "send", ...args]);
			assert.equal(sent.status, 0, sent.stderr);
			return /^Queued event ([\w-]{12})/.exec(sent.stdout)[1];
		},
		start: (...args) => servers[servers.push(runner(project, ...args)) - 1],
		// Resolves when the event is in the given status.
		reach: (status, id) => until(() => event(id)?.status === status),
		file: (path, text) => {
			mkdirSync(join(project.agent, path, ".."), { recursive: true });
			writeFileSync(join(project.agent, path), text);
		},
	};
}

/** A router that answers `{ thread }` from a line of the event's content, `route: <thread>`; "throw" and "hang" make it fail. */
const testRouter = `
export default async function route(event, ctx) {
	const wanted = /route: (\\S+)/.exec(event.content)?.[1] ?? "main";
	if (wanted === "throw") { console.log("printed before throwing"); throw new Error("the router broke"); }
	if (wanted === "hang") for (;;);
	if (wanted === "workflows") return { thread: ctx.workflows.map((workflow) => workflow.name).join("-") || "none" };
	return { thread: wanted };
}
`;

test("an event without a thread goes through the starter router to main, and a deleted router is written again", async (t) => {
	const { project, event, send, start, reach } = setup(t);
	const router = join(project.agent, "storage", "knowledge", "event_router.mjs");
	const first = await send("hello");
	assert.equal(event(first).threadId, null);
	start();
	await reach("done", first);
	assert.equal(event(first).threadId, "main");
	assert.match(readFileSync(router, "utf8"), /return \{ thread: "main" \}/);

	rmSync(router);
	const second = await send("hello again");
	await reach("done", second);
	assert.ok(existsSync(router));
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
	const settings = JSON.parse(readFileSync(join(project.agent, ".pi", "settings.json"), "utf8"));
	writeFileSync(join(project.agent, ".pi", "settings.json"), JSON.stringify({ ...settings, agentx: { ...settings.agentx, runner: { routerSeconds: 2 } } }));
	const [threw, hung, missing, bad] = [await send("route: throw"), await send("route: hang"), await send("route: workflow.nope"), await send("route: no/good")];
	start();
	for (const id of [threw, hung, missing, bad]) await reach("done", id);
	assert.deepEqual(
		[threw, hung, missing, bad].map((id) => [event(id).threadId, event(id).metadata["agentX-RouterError"].split(":")[0]]),
		[
			["main", "failed"],
			["main", "timeout"],
			["main", "unknown workflow"],
			["main", "bad answer"],
		],
	);
	// Why, in one line the model sees with the event, and what the router printed, in a log.
	assert.equal(event(threw).metadata["agentX-RouterError"], `failed: the router broke What it printed: storage/workspace/router-logs/${threw}.log`);
	assert.match(readFileSync(join(project.agent, "storage", "workspace", "router-logs", `${threw}.log`), "utf8"), /^printed before throwing\n/);
	assert.match(event(hung).metadata["agentX-RouterError"], /^timeout: it took longer than 2 s/);

	const shown = await agentx(project, ["event", "show", threw]);
	assert.equal(shown.status, 0, shown.stderr);
	assert.match(shown.stdout, /Thread: main, because the router failed\n/);
	assert.match(shown.stdout, /agentX-RouterError: failed: the router broke/);
	// No sender can name it, so a router failure cannot be faked.
	assert.match((await agentx(project, ["event", "send", "--meta", "agentX-RouterError=fake", "hello"])).stderr, /Invalid metadata name "agentX-RouterError"/);
});

/** Workflows for the tests: `ok` prints, changes directory, sends an event to main, and returns what JSON cannot carry; `broken` throws; `slow` outlives its 1 s; `timed` notes when it ran. */
function workflows(file, failureReportTo) {
	file(
		".pi/workflows.json",
		JSON.stringify({
			ok: { description: "Sends a note to main.", script: "workflows/ok.mjs" },
			broken: { description: "Always fails.", script: "workflows/broken.mjs", ...(failureReportTo ? { failureReportTo } : {}) },
			slow: { description: "Takes too long.", script: "workflows/slow.mjs", timeoutSeconds: 1 },
			timed: { description: "Notes when it ran.", script: "workflows/timed.mjs" },
		}),
	);
	file(
		".pi/workflows/ok.mjs",
		`export default async function (event, ctx) { console.log("params", event.content); process.chdir("/"); await ctx.send("note from ok", { threadId: "main" }); const loop = {}; loop.self = loop; return loop; }`,
	);
	file(".pi/workflows/broken.mjs", `export default async function () { console.log("about to fail"); throw new Error("broken on purpose"); }`);
	file(".pi/workflows/slow.mjs", `import { setTimeout } from "node:timers/promises"; export default async function () { await setTimeout(30_000); }`);
	file(
		".pi/workflows/timed.mjs",
		`import { appendFileSync } from "node:fs"; import { setTimeout } from "node:timers/promises";
		export default async function (event) { appendFileSync("storage/workspace/timed", "start " + Date.now() + "\\n"); await setTimeout(1000); appendFileSync("storage/workspace/timed", "end " + Date.now() + "\\n"); }`,
	);
}

test("a workflow gets its event, logs its output, and is done without a report; what it sent shows in its audit", async (t) => {
	const { project, event, send, start, reach, file } = setup(t);
	workflows(file);
	const id = await send("--thread-id", "workflow.ok", '{"invoice": "4411"}');
	start();
	await reach("done", id);
	assert.equal(readFileSync(join(project.agent, "storage", "workspace", "workflow-logs", "ok", `${id}.log`), "utf8"), 'params {"invoice": "4411"}\n');
	const [note] = events(project.agent).filter((found) => found.content === "note from ok");
	assert.deepEqual(note.metadata, { source: "workflow.ok", "agentX-WorkflowRun": id });
	await reach("done", note.id);
	assert.equal(events(project.agent).length, 2, "no report");

	const shown = await agentx(project, ["event", "show", id]);
	assert.match(shown.stdout, new RegExp(`Log: storage/workspace/workflow-logs/ok/${id}\\.log\n`));
	assert.match(shown.stdout, new RegExp(`Events it sent: ${note.id} to main \\(done\\)\n`));
	assert.match(shown.stdout, /Failure report: none/);
	const listed = await agentx(project, ["event", "list"]);
	assert.match(listed.stdout, new RegExp(`${note.id}  done +main  workflow\\.ok\n`));
});

test("a failed run is failed once and reported to main with its log, a run past its time is killed, and the report's fate shows in the audit", async (t) => {
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
	assert.match(report.content, new RegExp(`^Workflow \`broken\` of agent \`main\` failed on event \`${broken}\`: broken on purpose\n\nIts log: \`storage/workspace/workflow-logs/broken/${broken}\\.log\``));
	assert.match(readFileSync(join(project.agent, "storage", "workspace", "workflow-logs", "broken", `${broken}.log`), "utf8"), /about to fail\n[^]*broken on purpose/);
	assert.ok(events(project.agent).some((found) => found.key === `failed:${slow}`));
	await reach("done", report.id);

	const shown = await agentx(project, ["event", "show", broken]);
	assert.match(shown.stdout, new RegExp(`Failure report: ${report.id} on main\\.main, done, session entry \\S+`));
});

test("a failure report goes to the agent and thread the workflow names", async (t) => {
	const { project, send, start, reach, file } = setup(t);
	const root = join(project.agent, "..", "..", "..");
	assert.equal((await agentx({ agent: root, env: project.env }, ["init-agent", "ops"])).status, 0);
	workflows(file, "ops.alerts");
	const broken = await send("--thread-id", "workflow.broken", "{}");
	start();
	await reach("failed", broken);
	const ops = join(project.agent, "..", "ops");
	const report = await until(() => events(ops).find((found) => found.key === `failed:${broken}`));
	assert.equal(report.threadId, "alerts");
	assert.match(report.content, new RegExp(`See the run with \`agentx event show ${broken} --agent main\``));
	const shown = await agentx(project, ["event", "show", broken]);
	assert.match(shown.stdout, new RegExp(`Failure report: ${report.id} on ops\\.alerts, queued`));
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
	await until(() => event(id).status === "in_flight");
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
	await until(() => event(id).entryId);
	assert.ok(Date.now() - Number(readFileSync(join(project.agent, "storage", "heartbeat"), "utf8")) < 15_000, "the heartbeat is fresh");
	// To the whole process group, as a terminal sends it: Pi has a group of its own, so only agentx run gets it.
	process.kill(-server.child.pid, "SIGINT");
	process.kill(-server.child.pid, "SIGTERM");
	assert.equal(await server.exited, 0);
	assert.equal(event(id).status, "done");
});

test("a loop that crashes is started again, and its work goes on", async (t) => {
	const { project, event, send, start, reach } = setup(t);
	// The router cannot be written while storage/knowledge is a file, so the router's loop crashes.
	rmSync(join(project.agent, "storage", "knowledge"), { recursive: true });
	writeFileSync(join(project.agent, "storage", "knowledge"), "");
	const id = await send("hello");
	const server = start();
	await until(() => /router: the loop crashed/.test(server.output()));
	assert.match(server.output(), /router: starting the loop again in 1 s/);
	rmSync(join(project.agent, "storage", "knowledge"));
	await reach("done", id);
	assert.equal(event(id).threadId, "main");
});
