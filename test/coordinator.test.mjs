// Tests of the coordinator: the AgentManager with stand-in processes, and `agentx serve` end to end, with two agents, delivery between them,
// refusals, restarts and stopping. Real `agentx serve` processes in a scratch project, with the fake model for the Pi threads that events reach.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sendEvent } from "../dist/agent-runtime/events/send-event.js";
import { AgentManager } from "../dist/coordinator-runtime/agent-manager.js";
import { deliverOutbox } from "../dist/coordinator-runtime/delivery.js";
import { Scheduler } from "../dist/coordinator-runtime/scheduler.js";
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

/** Starts `agentx serve` in the project's root on a free port; killed when the test ends. */
async function serve(t, project) {
	const server = background(projectRoot(project), project.env, ["serve", "--port", "0"]);
	t.after(() => {
		try {
			process.kill(-server.child.pid, "SIGKILL");
		} catch {
			// Gone already.
		}
	});
	const address = await until(() => / on (http:\/\/\S+) /.exec(server.output())?.[1], 10_000);
	const get = async (path) => {
		const response = await fetch(`${address}${path}`);
		return { status: response.status, body: await response.json() };
	};
	return { ...server, get };
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
	assert.ok(model.systemPrompts.some((prompt) => prompt.includes("# Agents you can send events to") && prompt.includes("\n\n- `b`: Files invoices.\n\n# Identity")));
	await send({ ...project, agent: b }, "--thread-id", "main", "hello b");
	await until(() => model.systemPrompts.some((prompt) => prompt.includes("\n\n- `c`\n- `main`\n\n# Identity")));
});

test("a workflow sends from its babysitter thread, which gets its refusals and is the thread the receiver answers, and the receiver is told which workflow sent it", async (t) => {
	const project = createAgent(model.port);
	const b = addAgent(project, "b");
	addAgent(project, "c");
	editConfig(project, (config) => ({ agents: { ...config.agents, main: { canSendTo: ["b"] } } }));
	writeFileSync(join(project.agent, ".pi", "workflows.json"), JSON.stringify({ tell: { description: "Tells b and c.", script: "workflows/tell.mjs", babysitterThread: "alerts" } }));
	writeFileSync(
		join(project.agent, ".pi", "workflows", "tell.mjs"),
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
			broken: { cron: "nope", content: "x" },
		}),
	);
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

test("a killed agent process is started again; Ctrl-C lets running work finish and agentx serve exits 0; a failing agent makes /agents 503", async (t) => {
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

	const id = await send(project, "--thread-id", "main", "[sleep 2] finish me");
	await until(() => events(project.agent).find((found) => found.id === id)?.entryId);
	// To the whole process group, as a terminal sends it.
	process.kill(-server.child.pid, "SIGINT");
	assert.equal(await server.exited, 0);
	assert.equal(events(project.agent).find((found) => found.id === id).status, "done");
	assert.equal(alive(restarted.pid), false);
});

test("killing agentx serve ends the agents' processes", async (t) => {
	const project = createAgent(model.port);
	const server = await serve(t, project);
	const pid = await until(async () => (await server.get("/agents")).body.agents[0]?.pid);
	server.child.kill("SIGKILL");
	await until(() => !alive(pid), 10_000);
});
