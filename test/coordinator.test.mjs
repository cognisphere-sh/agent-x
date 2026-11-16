// Tests of the coordinator: its services with test services, the AgentManager with stand-in processes, and `agentx serve` end to end, with two agents, delivery between them,
// refusals, restarts and stopping. Real `agentx serve` processes in a scratch project, with the fake model for the Pi threads that events reach.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { read } from "../dist/agent-runtime/events/mailbox.js";
import { sendEvent } from "../dist/agent-runtime/events/send-event.js";
import { AgentManager } from "../dist/coordinator-runtime/agent-manager.js";
import { Coordinator } from "../dist/coordinator-runtime/coordinator.js";
import { Service } from "../dist/coordinator-runtime/service.js";
import { deliverOutbox } from "../dist/coordinator-runtime/services/relay/relay.js";
import { Scheduler, SchedulerService } from "../dist/coordinator-runtime/services/scheduler/scheduler.js";
import { startFakeComposio } from "./fake-composio.mjs";
import { startFakeModel } from "./fake-model.mjs";
import { addAgent, agentSend, agentx, alive, background, cli, createAgent, editConfig, editSettings, events, inboxEvents, projectRoot, send, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/** Limits that make a test of the AgentManager quick. */
const quick = { firstDelayMs: 20, lastDelayMs: 40, goodRunMs: 60_000, hungMs: 400, maxRestarts: 5, checkMs: 50 };

/** An AgentManager for a scratch agent directory whose process runs `script`, stopped when the test ends. */
function manager(t, script) {
	const root = mkdtempSync(join(tmpdir(), "agentx-manager-"));
	mkdirSync(join(root, "storage"));
	writeFileSync(join(root, "process.mjs"), script);
	const managed = new AgentManager(root, join(root, "storage"), [join(root, "process.mjs")], quick);
	t.after(() => managed.stop(true));
	return { root, managed };
}

test("an agent whose process always exits at once is started again with a backoff, and failed after 5 restarts", async (t) => {
	const { managed } = manager(t, "process.exit(3);");
	managed.start();
	await until(() => managed.status().state === "failed", 5000);
	assert.deepEqual([managed.status().restarts, managed.status().lastExit], [5, "exited with code 3"]);
});

test("a process is starting until it writes a heartbeat, and one that stops writing it is killed and started again", async (t) => {
	// Writes its heartbeat for its first 300 ms, then never again.
	const { root, managed } = manager(
		t,
		`import { writeFileSync } from "node:fs"; const beat = setInterval(() => writeFileSync("storage/heartbeat", String(Date.now())), 50); setTimeout(() => clearInterval(beat), 300); setInterval(() => {}, 1000);`,
	);
	// A heartbeat an earlier process left counts for nothing.
	writeFileSync(join(root, "storage", "heartbeat"), String(Date.now() - 60_000));
	managed.start();
	assert.equal(managed.status().state, "starting");
	await until(() => managed.status().state === "running", 5000);
	const first = managed.status().pid;
	await until(() => managed.status().restarts === 1, 5000);
	assert.match(managed.status().lastExit, /^was hung: no heartbeat for 0\.4 s, and was killed$/);
	await until(() => managed.status().pid !== null && managed.status().pid !== first, 5000);
	assert.equal(alive(first), false);
});

test("a process that never writes a heartbeat is hung too", async (t) => {
	const { managed } = manager(t, "setInterval(() => {}, 1000);");
	managed.start();
	await until(() => managed.status().restarts >= 1, 5000);
	assert.match(managed.status().lastExit, /^was hung/);
});

/** Calls the API at `address`, with the API token when given; the body of the answer as text. */
async function request(address, method, path, { body, token } = {}) {
	const response = await fetch(`${address}${path}`, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
	return { status: response.status, body: await response.text() };
}

/** Starts `agentx serve` in the project's root on a free port, with an API token and the lines `secrets` of agent-x/.env.services; killed when the test ends. */
async function serve(t, project, secrets = "") {
	writeFileSync(join(projectRoot(project), "agent-x", ".env.services"), `AGENTX_API_TOKEN=the-token\n${secrets}`);
	const server = background(projectRoot(project), project.env, ["serve", "--port", "0"]);
	t.after(() => {
		try {
			process.kill(-server.child.pid, "SIGKILL");
		} catch {
			// Gone already.
		}
	});
	const address = await until(() => / on (http:\/\/\S+) /.exec(server.output())?.[1], 10_000);
	const call = (method) => async (path) => {
		const { status, body } = await request(address, method, path, { token: "the-token" });
		return { status, body: JSON.parse(body) };
	};
	return { ...server, address, get: call("GET"), post: call("POST") };
}

/** Writes an event into the outbox of the agent in `root` by hand, as a sender that does not go through agentx could: `event` is the text of its event.json. */
function handWritten(root, id, event, at = 1) {
	const box = join(root, "storage", "workspace", "outbox");
	mkdirSync(join(box, id), { recursive: true });
	writeFileSync(join(box, id, "event.json"), event);
	mkdirSync(join(box, ".pending"), { recursive: true });
	writeFileSync(join(box, ".pending", `${String(at).padStart(15, "0")}-${id}`), "");
}

test("delivery takes the sender from its outbox, drops the facts it wrote, copies the files in the event's folder but no link, keeps one key to two agents apart, and sets aside what it cannot read", async () => {
	const project = createAgent(model.port);
	const main = project.agent;
	const b = addAgent(project, "b");
	const c = addAgent(project, "c");
	// What it cannot read comes first, and does not hold up what follows: not an event, a folder that is a link, and an agent name with the harness's tag.
	handWritten(main, "nullnullnull", "null");
	const elsewhere = mkdtempSync(join(tmpdir(), "agentx-link-"));
	writeFileSync(join(elsewhere, "event.json"), JSON.stringify({ id: "linklinklink", sentAt: 1, to: "b", event: { content: "via a link", key: "l" }, facts: {}, files: [] }));
	mkdirSync(join(main, "storage", "workspace", "outbox"), { recursive: true });
	symlinkSync(elsewhere, join(main, "storage", "workspace", "outbox", "linklinklink"));
	handWritten(main, "linklinklink", "", 2);
	handWritten(main, "tagtagtagtag", JSON.stringify({ id: "tagtagtagtag", sentAt: 1, to: "<agentx-metadata", from: { agent: "main", thread: "main" }, event: { content: "x", key: "t" }, facts: {}, files: [] }), 3);
	// An id the sender picked, not made from its key, as one that would take the place of another event of b.
	handWritten(main, "forgedforged", JSON.stringify({ id: "forgedforged", sentAt: 1, to: "b", from: { agent: "main", thread: "main" }, event: { content: "x", key: "f" }, facts: {}, files: [] }), 3);

	writeFileSync(join(main, "storage", "workspace", "f.txt"), "the file");
	const toB = sendEvent(main, { content: "hi", key: "k" }, { to: "b", facts: { "agentX-FromAgent": "someone else" }, files: [join(main, "storage", "workspace", "f.txt")] });
	const toC = sendEvent(main, { content: "hi", key: "k" }, { to: "c" });
	assert.notEqual(toB, toC);
	// The folder is copied as it is, whatever its event.json lists, but a link in it is refused, not followed.
	writeFileSync(join(main, "storage", "workspace", "outbox", toB, "extra.txt"), "dropped in");
	const linked = sendEvent(main, { content: "with a link", key: "l2" }, { to: "b" });
	symlinkSync(join(main, ".pi", "settings.json"), join(main, "storage", "workspace", "outbox", linked, "secret"));
	// Sent on from the host as every event is, so the host's refusals hold too, as for an agent whose storage/ is a folder of its own.
	const d = addAgent(project, "d");
	unlinkSync(join(d, "storage"));
	mkdirSync(join(d, "storage"));
	const toD = sendEvent(main, { content: "for d" }, { to: "d" });
	// An event of main for itself goes through its outbox too, naming only its thread: until the coordinator delivers it, it is not in main's inbox.
	const toSelf = sendEvent(main, { threadId: "main", content: "to myself" }, { thread: "notes" });
	assert.deepEqual(JSON.parse(readFileSync(join(main, "storage", "workspace", "outbox", toSelf, "event.json"), "utf8")).from, { thread: "notes" });
	assert.ok(!existsSync(join(main, "storage", "workspace", "inbox", toSelf)));
	deliverOutbox(main);
	// Delivered back into main's own inbox, which canSendTo does not limit, from main's thread notes.
	assert.deepEqual(inboxEvents(main).find((mail) => mail.id === toSelf).facts, { "agentX-FromAgent": "main", "agentX-FromThread": "notes" });

	const [gotB] = inboxEvents(b);
	assert.deepEqual([gotB.id, gotB.facts], [toB, { "agentX-FromAgent": "main", "agentX-FromThread": "main" }]);
	// The line that names the files is written as the event goes into b's inbox, for every file of its folder.
	assert.equal(gotB.event.content, "hi\n\nFiles: `extra.txt`, `f.txt`");
	assert.match(inboxEvents(main).find((mail) => mail.event.key === `undeliverable:${toD}`).event.content, /is not a link to \S+, so the host cannot reach the agent's state/);
	assert.equal(readFileSync(join(b, "storage", "workspace", "inbox", toB, "f.txt"), "utf8"), "the file");
	assert.equal(readFileSync(join(b, "storage", "workspace", "inbox", toB, "extra.txt"), "utf8"), "dropped in");
	assert.ok(!inboxEvents(b).some((mail) => mail.id === linked));
	assert.match(inboxEvents(main).find((mail) => mail.event.key === `undeliverable:${linked}`).event.content, /was not delivered: `secret` in its folder is not a plain file\./);
	assert.equal(inboxEvents(c)[0].id, toC);
	assert.deepEqual(readdirSync(join(main, "storage", "workspace", "outbox", ".rejected")).map((marker) => marker.split("-")[1]).sort(), ["linklinklink", "nullnullnull"]);
	const back = inboxEvents(main).find((mail) => mail.event.key === "undeliverable:tagtagtagtag");
	const forged = inboxEvents(main).find((mail) => mail.event.key === "undeliverable:forgedforged");
	assert.match(back.event.content, /was not delivered: it names no agent to send it to\./);
	assert.match(forged.event.content, /^Your event `forgedforged` to agent `b` was not delivered: its id was not made from its key\./);

	// Delivered again, as after a coordinator stopped before it ended the wait: the event that waits in b's inbox is not added twice.
	handWritten(main, toB, readFileSync(join(main, "storage", "workspace", "outbox", toB, "event.json"), "utf8"), 4);
	deliverOutbox(main);
	assert.equal(inboxEvents(b).length, 1);
});

test("agentx serve runs every agent agentx.json lists, says how each is, fires schedules, and delivers between agents with the sending agent and thread", async (t) => {
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	// An agent folder that agentx.json does not list is not run.
	mkdirSync(join(project.agent, "..", "stray", ".pi"), { recursive: true });
	writeFileSync(join(project.agent, "..", "stray", ".pi", "settings.json"), "{}");
	// Fires within a second of starting, once.
	writeFileSync(join(project.agent, ".pi", "schedules.json"), JSON.stringify({ tick: { cron: "* * * * * *", content: "tick", threadId: "ticks", fireOnce: true } }));
	// Sent from inside main while agentx serve is down: it waits in main's outbox.
	const early = await agentSend(project, "--agent", "b", "--thread-id", "notes", "early");
	const server = await serve(t, project);
	assert.match(server.output(), /Serving agents b, main of project on http:\/\/127\.0\.0\.1:\d+ /);
	assert.match(server.output(), /agents\/stray is not listed in \S+agentx\.json; it is not run\./);
	// Without its secret, Composio's service is off, and its webhook is not served.
	assert.match(server.output(), /Service "composio" is off: COMPOSIO_WEBHOOK_SECRET is not set/);
	assert.equal((await fetch(`${server.address}/services/composio/webhook`, { method: "POST" })).status, 404);
	const tick = await until(() => events(project.agent).find((found) => found.metadata["agentX-Schedule"] === "tick"));
	assert.deepEqual([tick.threadId, tick.content, tick.metadata.source], ["ticks", "tick", "schedule"]);
	assert.deepEqual(await server.get("/health"), { status: 200, body: { ok: true } });
	const agents = await until(async () => {
		const answer = await server.get("/agents");
		return answer.status === 200 && answer.body.agents;
	});
	assert.deepEqual(agents.map((agent) => [agent.agent, agent.state, agent.restarts]), [
		["b", "running", 0],
		["main", "running", 0],
	]);

	await until(() => events(b).find((found) => found.id === early));

	// A message to each agent is done.
	const own = [await send(project, "--thread-id", "main", "hello main"), await send({ ...project, agent: b }, "--thread-id", "main", "hello b")];
	await until(() => events(project.agent).find((found) => found.id === own[0])?.status === "done");
	await until(() => events(b).find((found) => found.id === own[1])?.status === "done");

	// From a person's terminal in main's directory: straight into b's inbox, as from the coordinator, from no agent.
	const direct = await send(project, "--agent", "b", "--thread-id", "notes", "from a person");
	assert.equal((await until(() => events(b).find((found) => found.id === direct))).metadata["agentX-FromAgent"], undefined);
	assert.ok(!existsSync(join(project.agent, "storage", "workspace", "outbox", direct)));

	// From inside main, with a file: b gets it from main's thread main.
	writeFileSync(join(project.agent, "storage", "workspace", "note.txt"), "a note");
	const id = await agentSend(project, "--agent", "b", "--thread-id", "notes", "--file", "storage/workspace/note.txt", "for b");
	const got = await until(() => events(b).find((found) => found.id === id));
	assert.deepEqual([got.threadId, got.metadata["agentX-FromAgent"], got.metadata["agentX-FromThread"]], ["notes", "main", "main"]);
	assert.equal(readFileSync(join(b, "storage", "workspace", "inbox", id, "note.txt"), "utf8"), "a note");
	assert.equal(got.content, "for b\n\nFiles: `note.txt`");
	// main's outbox keeps the content as main wrote it: the line that names the files is written as the event goes into b's inbox.
	assert.equal(JSON.parse(readFileSync(join(project.agent, "storage", "workspace", "outbox", id, "event.json"), "utf8")).event.content, "for b");

	// From the model's bash in main's thread "support": Pi says which thread runs the command.
	await send(project, "--thread-id", "support", `[bash node ${cli} event send --agent b --thread-id notes from-pi]`);
	const fromPi = await until(() => events(b).find((found) => found.content === "from-pi"));
	assert.equal(fromPi.metadata["agentX-FromThread"], "support");
});

test("an agent sends only to the agents its canSendTo names, which its prompt lists; a refusal comes back on the sending thread", async (t) => {
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	const c = addAgent(project, "c");
	editConfig(project, (config) => ({ agents: { ...config.agents, main: { canSendTo: ["b", "nobody"] }, b: { description: "Files invoices." } } }));
	await serve(t, project);

	const nobody = await agentSend(project, "--agent", "nobody", "lost");
	const back = await until(() => events(project.agent).find((found) => found.key === `undeliverable:${nobody}`));
	assert.equal(back.threadId, "main");
	assert.match(back.content, new RegExp(`^Your event \`${nobody}\` to agent \`nobody\` was not delivered: this project has no agent "nobody"\\.\n\nIt said:\n\n> lost\n\nWhat you sent, with its files, is in \`storage/workspace/outbox/${nobody}/\`\\.$`));
	const toC = await agentSend(project, "--agent", "c", "--thread-id", "notes", "for c");
	assert.match((await until(() => events(project.agent).find((found) => found.key === `undeliverable:${toC}`))).content, /: this agent may send events only to b, by its canSendTo in agentx\.json\./);
	assert.equal(events(c).length, 0);
	// A person's send is held to no agent's canSendTo: from a terminal in main's directory, it goes straight into c's inbox, from no agent.
	const fromPerson = await send(project, "--agent", "c", "--thread-id", "notes", "from a person");
	assert.equal((await until(() => events(c).find((found) => found.id === fromPerson))).metadata["agentX-FromAgent"], undefined);

	// Each prompt lists the agents its agent can send to, with what each does: main only b, which it names; b, without canSendTo, every other agent.
	await until(() => events(project.agent).find((found) => found.id === back.id)?.status === "done");
	assert.ok(model.systemPrompts.some((prompt) => prompt.includes("<agentx-core-agents>\n# Agents you can send events to") && prompt.includes("\n\n- `b`: Files invoices.\n</agentx-core-agents>")));
	await send({ ...project, agent: b }, "--thread-id", "main", "hello b");
	await until(() => model.systemPrompts.some((prompt) => prompt.includes("\n\n- `c`\n- `main`\n</agentx-core-agents>")));
});

test("a workflow sends from its babysitter thread, which gets its refusals and is the thread the receiver answers, and the receiver is told which workflow sent it", async (t) => {
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	addAgent(project, "c");
	editConfig(project, (config) => ({ agents: { ...config.agents, main: { canSendTo: ["b"] } } }));
	writeFileSync(join(project.agent, ".pi", "workflows.json"), JSON.stringify({ tell: { description: "Tells b and c.", script: "workflows/tell.ts", babysitterThread: "alerts" } }));
	writeFileSync(
		join(project.agent, ".pi", "workflows", "tell.ts"),
		`export default async function (event, ctx) { await ctx.send("from a workflow", { agent: "b", threadId: "notes" }); await ctx.send("from a workflow", { agent: "c" }); }`,
	);
	await serve(t, project);

	const run = await send(project, "--thread-id", "workflow.tell", "{}");
	const got = await until(() => events(b).find((found) => found.content === "from a workflow"));
	assert.deepEqual([got.threadId, got.metadata["agentX-FromAgent"], got.metadata["agentX-FromThread"], got.metadata["agentX-FromWorkflow"]], ["notes", "main", "alerts", "tell"]);
	const report = await until(() => events(project.agent).find((found) => found.content.includes("may send events only to b")));
	assert.equal(report.threadId, "alerts");
	await until(() => events(project.agent).find((found) => found.id === run)?.status === "done");
});

test("a schedule fires when its cron pattern is due, once with fireOnce, never when inactive, and missed fires once with catchUp; a broken entry, and a fire the agent refuses, are reported on main", () => {
	const project = createAgent(model.port);
	const main = project.agent;
	editSettings(main, (settings) => ({ ...settings, agentx: { ...settings.agentx, timezone: "UTC" } }));
	writeFileSync(
		join(main, ".pi", "schedules.json"),
		JSON.stringify({
			// First, so that a fire it could not send would hold up the others.
			ghost: { cron: "* * * * *", content: "for a workflow the agent lacks", threadId: "workflow.gone" },
			minutely: { cron: "* * * * *", content: "every minute", threadId: "ticks", metadata: { from: "cron" } },
			once: { cron: "* * * * *", content: "once", fireOnce: true },
			off: { cron: "* * * * *", content: "off", isActive: false },
			hourly: { cron: "0 * * * *", content: "hourly" },
			// A workflow's schedule may give its parameters in metadata alone; any other needs content.
			report: { cron: "* * * * *", threadId: "workflow.report", metadata: { month: "january", pages: 2 } },
			broken: { cron: "nope", content: "x" },
			mute: { cron: "* * * * *", threadId: "ticks" },
		}),
	);
	writeFileSync(join(main, ".pi", "workflows.json"), JSON.stringify({ report: { description: "Writes the month's report.", script: "workflows/report.ts" } }));
	mkdirSync(join(main, ".pi", "workflows"), { recursive: true });
	writeFileSync(join(main, ".pi", "workflows", "report.ts"), "export default async function () {}");
	// The agent's own: the developer's "minutely" wins.
	writeFileSync(join(main, "storage", "knowledge", "schedules.json"), JSON.stringify({ minutely: { cron: "0 0 1 1 *", content: "mine" }, late: { cron: "0 * * * *", content: "late", catchUp: true } }));
	const fired = (content) => inboxEvents(main).filter((mail) => mail.event.content === content);
	const minute = 60_000;
	const t0 = Date.UTC(2026, 0, 1, 0, 0, 30);

	const scheduler = new Scheduler(main, join(main, "storage"));
	scheduler.tick(t0);
	assert.equal(inboxEvents(main).filter((mail) => mail.event.metadata.source === "schedule" && mail.event.threadId !== "main").length, 0, "nothing before a schedule was seen");
	assert.match(inboxEvents(main).find((mail) => mail.event.threadId === "main").event.content, /schedule "broken" is skipped: CronPattern/);
	scheduler.tick(t0 + minute);
	scheduler.tick(t0 + 2 * minute);
	const [first, second] = fired("every minute");
	assert.deepEqual([first.sentAt, second.sentAt], [Date.UTC(2026, 0, 1, 0, 1), Date.UTC(2026, 0, 1, 0, 2)]);
	assert.deepEqual([first.event.threadId, first.event.metadata, first.facts], ["ticks", { from: "cron", source: "schedule" }, { "agentX-Schedule": "minutely" }]);
	assert.deepEqual([fired("once").length, fired("off").length, fired("mine").length], [1, 0, 0]);
	const report = inboxEvents(main).find((mail) => mail.event.threadId === "workflow.report");
	assert.deepEqual([report.event.content, report.event.metadata], ["", { month: "january", pages: 2, source: "schedule" }]);
	assert.ok(inboxEvents(main).some((mail) => mail.event.content.endsWith('schedule "mute" is skipped: it needs content, the text of its event, unless it runs a workflow.')));
	// Sent as every sender's events are, the fire for a workflow the agent does not have is refused: it is reported once, and the others fire.
	assert.deepEqual(fired("for a workflow the agent lacks"), []);
	assert.deepEqual(
		inboxEvents(main).filter((mail) => mail.event.key.startsWith("schedule-error:ghost:")).map((mail) => mail.event.content),
		[`${join(main, ".pi", "schedules.json")}: schedule "ghost" did not fire: Agent "main" has no workflow "gone".`],
	);

	// agentx serve was down for three hours: a new coordinator reads what this one kept. Without catchUp the missed fires are skipped; with it, one late fire.
	new Scheduler(main, join(main, "storage")).tick(t0 + 180 * minute);
	assert.deepEqual([fired("every minute").length, fired("hourly").length], [2, 0]);
	assert.deepEqual(fired("late").map((mail) => mail.sentAt), [Date.UTC(2026, 0, 1, 1)]);
});

test("the scheduler fires nothing while the coordinator stops", () => {
	const project = createAgent(model.port);
	const main = project.agent;
	writeFileSync(join(main, ".pi", "schedules.json"), JSON.stringify({ tick: { cron: "* * * * * *", content: "tick" } }));
	let stopping = true;
	let work;
	const agents = [{ name: "main", root: main, storage: join(main, "storage") }];
	new SchedulerService().onStart({ name: "scheduler", config: {}, secrets: {}, agents, stopping: () => stopping, every: (_ms, run) => (work = run) });
	// The first look at a schedule writes what was seen; while stopping there is none.
	work();
	assert.ok(!existsSync(join(main, "storage", "schedule-state.json")));
	stopping = false;
	work();
	assert.ok(existsSync(join(main, "storage", "schedule-state.json")));
});

test("a killed agent process is started again; the API stops and starts an agent; Ctrl-C lets running work finish and agentx serve exits 0; a failing agent makes /agents 503", async (t) => {
	const project = createAgent(model.port);
	// An agent whose agentx run stops at once: its settings are wrong.
	addAgent(project, "broken", { runner: { maxThreads: -1 } });
	const server = await serve(t, project);
	const pid = await until(async () => (await server.get("/agents")).body.agents.find((agent) => agent.agent === "main" && agent.state === "running")?.pid);
	const agents = await server.get("/agents");
	assert.equal(agents.status, 503);
	assert.match(agents.body.agents.find((agent) => agent.agent === "broken").lastExit ?? "", /exited with code 1/);
	assert.equal((await server.get("/health")).status, 200);

	process.kill(pid, "SIGKILL");
	const restarted = await until(async () => (await server.get("/agents")).body.agents.find((agent) => agent.agent === "main" && agent.state === "running" && agent.pid !== pid));
	assert.equal(restarted.restarts, 1);
	assert.match(restarted.lastExit, /stopped by SIGKILL/);

	// The API stops and starts an agent, with the API token only. A stopped agent is no fault, so /agents is 503 still only for the broken one.
	assert.equal((await fetch(`${server.address}/agents/main/stop`, { method: "POST" })).status, 401);
	assert.equal((await server.post("/agents/nobody/stop")).status, 404);
	assert.equal((await server.post("/agents/main/stop")).status, 202);
	await until(async () => (await server.get("/agents")).body.agents.find((agent) => agent.agent === "main").state === "stopped");
	assert.equal(alive(restarted.pid), false);
	assert.equal((await server.post("/agents/main/start")).status, 202);
	const again = await until(async () => (await server.get("/agents")).body.agents.find((agent) => agent.agent === "main" && agent.state === "running"));
	assert.equal(again.restarts, 0);

	const id = await send(project, "--thread-id", "main", "[sleep 2] finish me");
	await until(() => events(project.agent).find((found) => found.id === id)?.entryId);
	// To the whole process group, as a terminal sends it.
	process.kill(-server.child.pid, "SIGINT");
	assert.equal(await server.exited, 0);
	assert.equal(events(project.agent).find((found) => found.id === id).status, "done");
	assert.equal(alive(again.pid), false);
});

test("killing agentx serve ends the agents' processes", async (t) => {
	const project = createAgent(model.port);
	const server = await serve(t, project);
	const pid = await until(async () => (await server.get("/agents")).body.agents[0]?.pid);
	server.child.kill("SIGKILL");
	await until(() => !alive(pid), 10_000);
});

test("services start with their config, the public URL and only their own secrets, poll without overlap, serve their routes under /services/<name>/, private with the API token or public, and stop last; one that fails to start is off", async (t) => {
	const errors = t.mock.method(console, "error", () => {}).mock;
	const agentX = mkdtempSync(join(tmpdir(), "agentx-services-"));
	writeFileSync(join(agentX, "agentx.json"), JSON.stringify({ agents: {}, publicUrl: "https://agents.example.com", services: { probe: { greeting: "hi" }, broken: {}, missing: {} } }));
	writeFileSync(join(agentX, ".env.services"), "PROBE_KEY=from-file\nOTHER_KEY=not-its-own\nAGENTX_API_TOKEN=the-token\n");
	process.env.PROBE_ENV = "from-env";
	const log = [];
	let running = 0;
	let runs = 0;
	class Probe extends Service {
		secrets = ["PROBE_KEY", "PROBE_ENV", "PROBE_MISSING"];
		onStart(context) {
			log.push(["start", context.config, context.secrets, context.publicUrl, context.stopping()]);
			// A run slower than its interval, which must never overlap itself, and one that always throws.
			context.every(5, async () => {
				running += 1;
				runs += 1;
				if (running > 1) log.push("overlapped");
				await sleep(20);
				running -= 1;
			});
			context.every(5, () => {
				throw new Error("a failing run");
			});
		}
		routes = [
			{ method: "POST", path: "hook/:id", access: "public", summary: "A webhook.", handle: ({ params, body }) => ({ status: 200, body: { params, body: body.toString() } }) },
			{ method: "GET", path: "mine", summary: "Needs the API token.", handle: () => ({ status: 200, body: { ok: true } }) },
			{ method: "POST", path: "throws", access: "public", summary: "Fails.", handle: () => { throw new Error("a failing request"); } },
			{ method: "POST", path: "nothing", access: "public", summary: "Answers nothing.", handle: () => undefined },
		];
		onStop() {
			log.push(["stop", running]);
		}
	}
	class Broken extends Service {
		routes = [{ method: "POST", path: "hook", access: "public", summary: "Never served.", handle: () => ({ status: 200 }) }];
		onStart(context) {
			context.every(5, () => log.push("broken ran"));
			throw new Error("no token");
		}
	}
	// `unlisted` is not in agentx.json, so it is not started.
	const coordinator = new Coordinator(agentX, { probe: Probe, broken: Broken, unlisted: Probe });
	const address = await coordinator.start("127.0.0.1", 0);
	t.after(() => coordinator.stop(true));
	assert.deepEqual(coordinator.servicesOn(), ["relay", "scheduler", "probe"]);
	assert.deepEqual(log[0], ["start", { greeting: "hi" }, { PROBE_KEY: "from-file", PROBE_ENV: "from-env" }, "https://agents.example.com", false]);

	const call = (method, path, options) => request(address, method, path, options);
	const post = (path, body) => call("POST", path, { body });
	assert.deepEqual(await post("/services/probe/hook/a?x=1", "payload"), { status: 200, body: JSON.stringify({ params: { id: "a" }, body: "payload" }) });
	assert.equal((await call("GET", "/services/probe/hook/a")).status, 405);
	// A private route needs the API token.
	assert.equal((await call("GET", "/services/probe/mine")).status, 401);
	assert.equal((await call("GET", "/services/probe/mine", { token: "a-wrong-token" })).status, 401);
	assert.deepEqual(await call("GET", "/services/probe/mine", { token: "the-token" }), { status: 200, body: '{"ok":true}' });
	const { routes } = JSON.parse((await call("GET", "/routes", { token: "the-token" })).body);
	assert.deepEqual(routes.find((route) => route.path === "/services/probe/hook/:id"), { method: "POST", path: "/services/probe/hook/:id", access: "public", summary: "A webhook." });
	assert.deepEqual(routes.find((route) => route.path === "/agents/:agent/stop").access, "private");
	assert.equal(routes.find((route) => route.path === "/health").access, "public");
	assert.equal((await post("/services/probe/hook/a", Buffer.alloc(1024 * 1024 + 1))).status, 413);
	assert.equal((await post("/services/broken/hook", "")).status, 404);
	assert.equal((await post("/services/unlisted/hook", "")).status, 404);
	assert.equal((await post("/health", "")).status, 405);
	// A request the service fails on answers 500, and the coordinator goes on.
	assert.equal((await post("/services/probe/throws", "")).status, 500);
	assert.equal((await post("/services/probe/nothing", "")).status, 500);
	assert.equal((await fetch(`${address}/health`)).status, 200);

	await until(() => runs >= 3, 5000);
	await coordinator.stop();
	// The run in progress ended before onStop, and none runs after it.
	assert.deepEqual(log.at(-1), ["stop", 0]);
	const ran = runs;
	await sleep(30);
	assert.equal(runs, ran);
	assert.ok(!log.includes("overlapped") && !log.includes("broken ran"));
	const said = errors.calls.map((call) => call.arguments[0]);
	assert.ok(said.includes('Service "broken" is off: no token'));
	assert.ok(said.some((line) => /names service "missing", which neither agentx nor agent-x\/services\/ has; it is skipped\.$/.test(line)));
	assert.ok(said.includes("probe: a failing run"));
});

test("a service delivers into an agent's inbox with agentX-Service, once per key, and not to an agent the project does not have", async (t) => {
	const project = createAgent(model.port);
	editConfig(project, (config) => ({ ...config, services: { courier: {} } }));
	const outcomes = [];
	class Courier extends Service {
		onStart(context) {
			// Services start before the agents, so the event waits in the inbox.
			const event = { content: "from a webhook", key: "delivery-1", metadata: { source: "courier" } };
			const first = context.deliver("main", event);
			outcomes.push(first, context.deliver("main", event) === first);
			try {
				context.deliver("nobody", event);
			} catch (error) {
				outcomes.push(error.message);
			}
		}
	}
	const coordinator = new Coordinator(join(projectRoot(project), "agent-x"), { courier: Courier });
	t.after(() => coordinator.stop(true));
	await coordinator.start("127.0.0.1", 0);
	await coordinator.stop(true);
	const [id, same, refused] = outcomes;
	assert.deepEqual([same, refused], [true, 'This project has no agent "nobody".']);
	const mail = read(join(project.agent, "storage", "workspace", "inbox"), id);
	assert.deepEqual([mail.event.content, mail.event.metadata, mail.facts], ["from a webhook", { source: "courier" }, { "agentX-Service": "courier" }]);
});

test("the project's own services, in agent-x/services/<name>/index.ts, run when agentx.json lists them, with their config, only their secrets and their routes; one that cannot load is off alone", async (t) => {
	const errors = t.mock.method(console, "error", () => {}).mock;
	const project = createAgent(model.port);
	const agentX = join(projectRoot(project), "agent-x");
	const service = (name, source) => {
		mkdirSync(join(agentX, "services", name), { recursive: true });
		writeFileSync(join(agentX, "services", name, "index.ts"), source);
	};
	// TypeScript as a developer writes it: Node strips the types.
	service(
		"echo",
		`import type { ApiRequest, ApiResponse, ServiceContext, ServiceDefinition } from "agent-x";
import { started } from "./started.ts";

export default class Echo implements ServiceDefinition {
	secrets = ["ECHO_KEY"];
	routes = [{ method: "POST" as const, path: "in", access: "public" as const, summary: "Delivers the body to main.", handle: (request: ApiRequest) => this.receive(request) }];
	private context!: ServiceContext;

	onStart(context: ServiceContext): void {
		this.context = context;
		started.push({ config: context.config, secrets: context.secrets });
	}

	private receive({ body }: ApiRequest): ApiResponse {
		const id: string = this.context.deliver("main", { key: "echo-1", content: body.toString("utf8"), metadata: { source: "echo" } });
		return { status: 200, body: { event: id } };
	}
}
`,
	);
	writeFileSync(join(agentX, "services", "echo", "started.ts"), "export const started: unknown[] = [];\n(globalThis as Record<string, unknown>).echoStarted = started;\n");
	service("unlisted", "export default class Unlisted {}\n");
	service("throws", 'throw new Error("it broke on import");\n');
	service("noclass", "export default 42;\n");
	service("badshape", 'export default class BadShape { routes = "not a list"; }\n');
	service("relay", "export default class Relay {}\n");
	editConfig(project, (config) => ({ ...config, services: { echo: { greeting: "hi" }, throws: {}, noclass: {}, badshape: {} } }));
	writeFileSync(join(agentX, ".env.services"), "ECHO_KEY=the-key\nOTHER_KEY=not-its-own\nAGENTX_API_TOKEN=the-token\n");

	const coordinator = new Coordinator(agentX);
	t.after(() => coordinator.stop(true));
	const address = await coordinator.start("127.0.0.1", 0);
	assert.deepEqual(coordinator.servicesOn(), ["relay", "scheduler", "echo"]);
	assert.deepEqual(globalThis.echoStarted, [{ config: { greeting: "hi" }, secrets: { ECHO_KEY: "the-key" } }]);
	const response = await request(address, "POST", "/services/echo/in", { body: "hello from a webhook" });
	assert.equal(response.status, 200);
	const mail = read(join(project.agent, "storage", "workspace", "inbox"), JSON.parse(response.body).event);
	assert.deepEqual([mail.event.content, mail.event.metadata, mail.facts], ["hello from a webhook", { source: "echo" }, { "agentX-Service": "echo" }]);
	const { routes } = JSON.parse((await request(address, "GET", "/routes", { token: "the-token" })).body);
	assert.ok(routes.some((route) => route.path === "/services/echo/in" && route.access === "public"));
	await coordinator.stop(true);

	const said = errors.calls.map((call) => call.arguments[0]);
	assert.ok(said.includes('Service "throws" is off: it broke on import'));
	assert.ok(said.includes('Service "noclass" is off: services/noclass/index.ts has no default export class.'));
	assert.ok(said.some((line) => line.startsWith('Service "badshape" is off: services/badshape/index.ts: each route needs')));
	assert.ok(said.includes("agent-x/services/relay has the name of one of agentx's services; it is not run."));
	assert.ok(said.some((line) => line.startsWith("agent-x/services/unlisted is not listed under \"services\"")));
});

test("the host follows no link in an agent's storage to a mailbox: an inbox that is a link gets no event, and an outbox that is a link is not read", () => {
	const project = createAgent(model.port);
	const main = project.agent;
	const b = addAgent(project, "b");
	const mainInbox = join(main, "storage", "workspace", "inbox");
	// b points its inbox at main's: an event for b must not land there.
	const bInbox = join(b, "storage", "workspace", "inbox");
	rmSync(bInbox, { recursive: true, force: true });
	symlinkSync(mainInbox, bInbox);
	const toB = sendEvent(main, { content: "for b" }, { to: "b" });
	deliverOutbox(main);
	assert.ok(!inboxEvents(main).some((mail) => mail.id === toB));
	const refusal = inboxEvents(main).find((mail) => mail.event.key === `undeliverable:${toB}`);
	assert.match(refusal.event.content, /is a link, which the host does not follow in an agent's storage/);
	// b points its outbox at main's inbox: the relay does not read it, so it neither takes main's events nor quotes them back to b.
	const bOutbox = join(b, "storage", "workspace", "outbox");
	rmSync(bOutbox, { recursive: true, force: true });
	symlinkSync(mainInbox, bOutbox);
	assert.throws(() => deliverOutbox(b), /is a link, which the host does not follow/);
	assert.ok(inboxEvents(main).some((mail) => mail.id === refusal.id));
});

/** The headers Composio signs `body` with: `secret` as it is, the key of a base64 HMAC-SHA256 of `<id>.<seconds>.<body>`. */
function composioHeaders(secret, id, body, seconds = Math.floor(Date.now() / 1000)) {
	const signature = createHmac("sha256", secret).update(`${id}.${seconds}.${body}`).digest("base64");
	return { "webhook-id": id, "webhook-timestamp": String(seconds), "webhook-signature": `v1,${signature}` };
}

test("Composio's webhook delivers a signed trigger event to the agent whose Composio user id it names, once per webhook-id, with its data in data.json; a request not signed with the secret, or old, gets 401, and one for no agent 200 and no event", async (t) => {
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	const userId = JSON.parse(readFileSync(join(b, ".pi", "settings.json"), "utf8")).agentx.composio.userId;
	const secret = "0f".repeat(32);
	const server = await serve(t, project, `COMPOSIO_WEBHOOK_SECRET=${secret}\n`);
	const webhook = async (body, headers) => (await fetch(`${server.address}/services/composio/webhook`, { method: "POST", body, headers })).status;
	const composioEvent = (id, user, type = "composio.trigger.message") =>
		JSON.stringify({
			id,
			timestamp: "2026-11-15T10:00:00.000Z",
			type,
			metadata: { trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE", toolkit_slug: "gmail", trigger_id: "ti_1", connected_account_id: "ca_1", auth_config_id: "ac_1", user_id: user, log_id: "log_1" },
			data: { subject: "hello" },
		});

	const body = composioEvent("msg_1", userId);
	const signed = composioHeaders(secret, "msg_1", body);
	// Composio sends it again, as after an answer it did not get: one event. Another signature beside the right one is allowed.
	assert.equal(await webhook(body, signed), 200);
	assert.equal(await webhook(body, { ...signed, "webhook-signature": `v1,${Buffer.alloc(32).toString("base64")} ${signed["webhook-signature"]}` }), 200);
	const got = await until(() => events(b).find((found) => found.metadata.source === "composio"));
	assert.equal(got.threadId, "main");
	assert.equal(got.content, "Composio trigger GMAIL_NEW_GMAIL_MESSAGE fired. Its event's data is in data.json.\n\nFiles: `data.json`");
	const { trigger, "trigger-id": triggerId, account, "event-time": eventTime, "agentX-Service": service } = got.metadata;
	assert.deepEqual([trigger, triggerId, account, eventTime, service], ["GMAIL_NEW_GMAIL_MESSAGE", "ti_1", "ca_1", "2026-11-15T10:00:00.000Z", "composio"]);
	assert.deepEqual(JSON.parse(readFileSync(join(b, "storage", "workspace", "inbox", got.id, "data.json"), "utf8")), { subject: "hello" });

	// Not signed with the secret, a signature of another length, none, a changed body, or older than 300 s: 401.
	assert.equal(await webhook(body, composioHeaders("1e".repeat(32), "msg_1", body)), 401);
	assert.equal(await webhook(body, { ...signed, "webhook-signature": "v1,c2hvcnQ=" }), 401);
	assert.equal(await webhook(body, {}), 401);
	assert.equal(await webhook(body.replace("hello", "hullo"), signed), 401);
	assert.equal(await webhook(body, composioHeaders(secret, "msg_1", body, Math.floor(Date.now() / 1000) - 301)), 401);
	// For no agent of the project, or of another type: 200, so Composio does not send it again, and no event.
	for (const [id, ignored] of [["msg_2", composioEvent("msg_2", "someone@else")], ["msg_3", composioEvent("msg_3", null)], ["msg_4", composioEvent("msg_4", userId, "composio.trigger.disabled")]]) {
		assert.equal(await webhook(ignored, composioHeaders(secret, id, ignored)), 200);
	}
	assert.match(server.output(), /composio: event msg_2 is ignored: no agent has Composio user id "someone@else"\./);
	assert.deepEqual(readdirSync(join(b, "storage", "workspace", "inbox")).filter((name) => !name.startsWith(".")), [got.id]);
	assert.equal(events(project.agent).filter((found) => found.metadata.source === "composio").length, 0);
	assert.equal(events(b).filter((found) => found.metadata.source === "composio").length, 1);
});

/** A fake Telegram Bot API on a free port: it records each call, refuses a token it does not know, and serves one small file and one too big. */
async function fakeTelegram(t, tokens) {
	const calls = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const [, kind, token, ...rest] = /^\/(file\/)?bot([^/]+)\/(.*)$/.exec(request.url) ?? [];
		const answer = (status, body) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		if (!tokens.includes(token)) return answer(401, { ok: false, description: "Unauthorized" });
		if (kind) return response.end(`the bytes of ${rest.join("/")}`);
		const params = JSON.parse(Buffer.concat(chunks).toString() || "{}");
		calls.push({ token, method: rest[0], params });
		if (rest[0] === "getFile") return params.file_id === "big" ? answer(400, { ok: false, description: "Bad Request: file is too big" }) : answer(200, { ok: true, result: { file_path: `photos/${params.file_id}.jpg` } });
		answer(200, { ok: true, result: true });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	return { url: `http://127.0.0.1:${server.address().port}`, calls };
}

test("Telegram: each listed agent's bot gets its webhook at start, and a message from a chat the agent lists goes into its inbox once, with its files; a request without the bot's secret token gets 401, a message from another chat 200 and no event", async (t) => {
	const project = createAgent(model.port);
	const telegram = await fakeTelegram(t, ["1:main-token"]);
	editConfig(project, (config) => ({ ...config, publicUrl: "https://agents.example.com/", services: { telegram: { apiUrl: telegram.url, agents: { main: { chats: [111] } } } } }));
	const server = await serve(t, project, "TELEGRAM_BOT_TOKEN_MAIN=1:main-token\n");
	assert.match(server.output(), /with services relay, scheduler, telegram/);
	const [webhook] = telegram.calls;
	assert.deepEqual([webhook.method, webhook.params.url, webhook.params.allowed_updates], ["setWebhook", "https://agents.example.com/services/telegram/main", ["message"]]);
	const secret = webhook.params.secret_token;
	const post = async (path, update, token = secret) =>
		(await fetch(`${server.address}/services/telegram/${path}`, { method: "POST", body: JSON.stringify(update), headers: { "x-telegram-bot-api-secret-token": token } })).status;
	const message = (chat, extra) => ({ message_id: 7, date: 1, chat: { id: chat, type: "private" }, from: { id: 5, username: "ana" }, ...extra });

	// A photo, in two sizes, with a caption: the largest is downloaded. Telegram sends it again: one event.
	const update = { update_id: 1, message: message(111, { caption: "look", photo: [{ file_id: "small" }, { file_id: "large" }] }) };
	assert.equal(await post("main", update), 200);
	assert.equal(await post("main", update), 200);
	const got = await until(() => events(project.agent).find((found) => found.metadata.source === "telegram"));
	assert.equal(got.content, "look\n\nFiles: `large.jpg`");
	const { chat, "chat-type": chatType, from, "from-id": fromId, "message-id": messageId, "agentX-Service": service } = got.metadata;
	assert.deepEqual([chat, chatType, from, fromId, messageId, service], [111, "private", "@ana", 5, 7, "telegram"]);
	assert.equal(readFileSync(join(project.agent, "storage", "workspace", "inbox", got.id, "large.jpg"), "utf8"), "the bytes of photos/large.jpg");

	// A file too big for the Bot API: the message arrives, and says so.
	assert.equal(await post("main", { update_id: 2, message: message(111, { text: "a big one", document: { file_id: "big" } }) }), 200);
	const big = await until(() => events(project.agent).find((found) => found.content.startsWith("a big one")));
	assert.equal(big.content, "a big one\n\nA file of this message could not be downloaded: Telegram's getFile: Bad Request: file is too big");

	// Without the bot's secret token: 401. From a chat main does not list: 200, and no event. An agent without a bot: 404.
	assert.equal(await post("main", { update_id: 3, message: message(111, { text: "forged" }) }, "a-guess"), 401);
	assert.equal(await post("main", { update_id: 4, message: message(222, { text: "a stranger" }) }), 200);
	assert.equal(await post("b", { update_id: 5, message: message(111, { text: "to b" }) }), 404);
	// A message with no text and no file, such as a pin: 200, and no event.
	assert.equal(await post("main", { update_id: 6, message: message(111, { pinned_message: { message_id: 7 } }) }), 200);
	assert.match(server.output(), /telegram: a message to agent main from chat 222, which it does not list, is dropped\./);
	await sleep(1500);
	assert.deepEqual(events(project.agent).filter((found) => found.metadata.source === "telegram").map((found) => found.content.split("\n")[0]), ["look", "a big one"]);
});

test("Telegram is off without publicUrl, or without an agent's bot token, or when Telegram refuses the token, or when two agents have the same bot", async (t) => {
	const errors = t.mock.method(console, "error", () => {}).mock;
	const telegram = await fakeTelegram(t, ["1:good"]);
	const project = createAgent(model.port);
	addAgent(project, "b");
	const agentX = join(projectRoot(project), "agent-x");
	const main = { main: { chats: [1] } };
	const cases = [
		[{}, "", 'it needs "publicUrl" in agentx.json'],
		[{ publicUrl: "https://agents.example.com" }, "", "TELEGRAM_BOT_TOKEN_MAIN, the bot token of agent \"main\", is not set"],
		[{ publicUrl: "https://agents.example.com" }, "TELEGRAM_BOT_TOKEN_MAIN=1:bad\n", "Telegram's setWebhook: Unauthorized"],
		[{ publicUrl: "https://agents.example.com" }, "TELEGRAM_BOT_TOKEN_MAIN=1:good\nTELEGRAM_BOT_TOKEN_B=1:good\n", 'agents "main" and "b" have the same bot token', { ...main, b: { chats: [2] } }],
	];
	for (const [config, secrets, why, bots = main] of cases) {
		editConfig(project, (old) => ({ agents: old.agents, ...config, services: { telegram: { apiUrl: telegram.url, agents: bots } } }));
		writeFileSync(join(agentX, ".env.services"), secrets);
		const coordinator = new Coordinator(agentX);
		await coordinator.start("127.0.0.1", 0);
		await coordinator.stop(true);
		assert.ok(!coordinator.servicesOn().includes("telegram"));
		assert.ok(errors.calls.some((call) => String(call.arguments[0]).startsWith(`Service "telegram" is off: ${why}`)), why);
	}
});

test("Telegram connects each agent's bot in Composio for the agent's user id, with the coordinator's key: once, again after a new token, leaving a bot a person connected; without the key, or with the agents' key, it stays on", async (t) => {
	const errors = t.mock.method(console, "error", () => {}).mock;
	const composio = await startFakeComposio();
	t.after(() => composio.close());
	const telegram = await fakeTelegram(t, ["1:main", "2:b", "3:b-new"]);
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	const userId = (dir) => JSON.parse(readFileSync(join(dir, ".pi", "settings.json"), "utf8")).agentx.composio.userId;
	const [mainId, bId] = [userId(project.agent), userId(b)];
	const agentX = join(projectRoot(project), "agent-x");
	editConfig(project, (old) => ({ ...old, publicUrl: "https://agents.example.com", services: { telegram: { apiUrl: telegram.url, agents: { main: { chats: [1] }, b: { chats: [2] } } } } }));
	const start = async (key, bToken = "2:b") => {
		writeFileSync(join(agentX, ".env.services"), `COMPOSIO_BASE_URL=${composio.url}\n${key ? `COMPOSIO_COORDINATOR_API_KEY=${key}\n` : ""}TELEGRAM_BOT_TOKEN_MAIN=1:main\nTELEGRAM_BOT_TOKEN_B=${bToken}\n`);
		const coordinator = new Coordinator(agentX);
		await coordinator.start("127.0.0.1", 0);
		await coordinator.stop(true);
		assert.ok(coordinator.servicesOn().includes("telegram"));
	};
	const bots = () => composio.accounts.map((account) => `${account.user_id} ${account.token} ${account.status}`).sort();
	// A bot a person connected for b by hand, in Composio's dashboard, under an auth config that sessions do not use.
	composio.authConfigs.push({ id: "ac_sessions_skip_it", toolkit: { slug: "telegram" }, status: "ENABLED", auth_scheme: "API_KEY", is_enabled_for_tool_router: false });
	composio.accounts.push({ id: "ca_by_hand", user_id: bId, alias: null, status: "ACTIVE", toolkit: { slug: "telegram" }, auth_config: { id: "ac_sessions_skip_it" }, token: "by hand" });

	await start(composio.coordinatorKey);
	const webhooks = telegram.calls.filter((call) => call.method === "setWebhook").map((call) => [call.token, call.params.url]);
	assert.deepEqual(webhooks, [["1:main", "https://agents.example.com/services/telegram/main"], ["2:b", "https://agents.example.com/services/telegram/b"]]);
	assert.deepEqual(bots(), [`${bId} 2:b ACTIVE`, `${bId} by hand ACTIVE`, `${mainId} 1:main ACTIVE`].sort());
	// The service's accounts are under an auth config of its own that sessions use without being told.
	const [, made] = composio.authConfigs;
	assert.deepEqual([made.toolkit.slug, made.auth_scheme, made.is_enabled_for_tool_router, composio.authConfigs.length], ["telegram", "API_KEY", true, 2]);
	assert.ok(composio.accounts.filter((account) => account.token !== "by hand").every((account) => account.auth_config.id === made.id));
	// The same tokens again: nothing changes.
	const ids = composio.accounts.map((account) => account.id);
	await start(composio.coordinatorKey);
	assert.deepEqual(composio.accounts.map((account) => account.id), ids);
	// A new token for b: the account of its old one goes, and the one connected by hand stays.
	await start(composio.coordinatorKey, "3:b-new");
	assert.deepEqual(bots(), [`${bId} 3:b-new ACTIVE`, `${bId} by hand ACTIVE`, `${mainId} 1:main ACTIVE`].sort());
	assert.equal(composio.authConfigs.length, 2);

	// Without the coordinator's key, or with the agents' key, which cannot connect accounts: the service is on, and says why no bot is connected.
	await start(undefined);
	assert.ok(errors.calls.some((call) => String(call.arguments[0]).startsWith("telegram: COMPOSIO_COORDINATOR_API_KEY is not set")));
	await start(composio.env.COMPOSIO_API_KEY);
	const refused = "telegram: agent main's bot is not connected in Composio, so the agent cannot answer in Telegram: Composio's GET /api/v3.1/connected_accounts: Invalid API key";
	assert.ok(errors.calls.some((call) => String(call.arguments[0]) === refused));
});
