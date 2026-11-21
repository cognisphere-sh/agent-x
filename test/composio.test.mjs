// End-to-end tests of Composio: the extension in real Pi sessions, and workflows' ctx.composio under `agentx run`, in a scratch project, against a fake Composio and the fake model.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Queue } from "../dist/agent-runtime/events/queue.js";
import { startFakeComposio } from "./fake-composio.mjs";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, createAgent, editSettings, events, onlySession, runner, until } from "./project.mjs";

// agentx's default policy, and the toolkits a new agent's settings enable: copies, so a test pins exactly what goes to Composio.
const defaults = {
	manage_connections: { enable: true, enable_connection_removal: false },
	workbench: { enable: false },
};
const templateToolkits = { enable: ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "supabase", "hubspot", "telegram"] };

let model;
let composio;
before(async () => {
	model = await startFakeModel();
	composio = await startFakeComposio();
});
after(async () => {
	await model.close();
	await composio.close();
});

/** A fresh project whose Pi processes use the fake Composio, unless `withKey` is false. */
function setup(withKey = true) {
	composio.reset();
	const project = createAgent(model.port);
	if (withKey) Object.assign(project.env, composio.env);
	return project;
}

/** Sets the agent's Composio session policy, `agentx.composio.session`. */
const setSession = (project, session) => editSettings(project.agent, (settings) => ({ ...settings, agentx: { ...settings.agentx, composio: { ...settings.agentx.composio, session } } }));

// The thread's Composio sessions, as its Pi session records them.
const recorded = (project) => onlySession(project).entries.filter((entry) => entry.type === "custom" && entry.customType === "agentx-composio").map((entry) => entry.data.sessionId);

// What the system prompt of the model's request number `index` says about Composio being unavailable, if anything.
const unavailable = (index) => /<composio>\n([^]*?)\n<\/composio>/.exec(model.systemPrompts[index])?.[1];

const composioTools = (index) => model.tools[index].filter((tool) => tool.startsWith("mcp__composio__"));

test("a new agent gets a Composio user id, and its first queued event already sees the Composio tools", async (t) => {
	const project = setup();
	assert.equal(JSON.parse(readFileSync(join(project.agent, ".pi", "settings.json"), "utf8")).agentx.composio.userId, "main@project");
	// Composio answers slower than the event queue extension's first look at the queue; the session still waits for it.
	composio.delayMs = 2000;
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const id = queue.enqueue({ threadId: "main", content: "hello" });
	const server = runner(project);
	t.after(() => server.stop());
	const before = model.tools.length;
	await until(() => events(project.agent).find((event) => event.id === id).status === "done");

	assert.ok(model.tools[before].includes("mcp__composio__COMPOSIO_SEARCH_TOOLS"), String(model.tools[before]));
	assert.equal(unavailable(before), undefined);
	assert.deepEqual(composio.created, [{ ...defaults, toolkits: templateToolkits, user_id: "main@project" }]);
	// Pi sent the key from the environment, never anything else.
	assert.ok(composio.mcpKeys.length > 0);
	assert.ok(composio.mcpKeys.every((key) => key === composio.env.COMPOSIO_API_KEY));
});

test("a thread keeps its Composio session, and gets a new one when the settings change or Composio no longer has it", async () => {
	const project = setup();
	const run = async () => assert.equal((await agentx(project, ["chat", "-p", "hello"])).status, 0);
	await run();
	await run();
	assert.equal(composio.created.length, 1);

	// The agent's own policy goes to Composio, over agentx's defaults.
	// A key it gives replaces agentx's, also inside an object. With "*" among the enabled toolkits, no `toolkits` is sent, so Composio allows every toolkit.
	setSession(project, { manage_connections: { enable: false }, tags: { enabled: ["readOnlyHint"] }, toolkits: { enable: ["gmail", "*"] } });
	await run();
	assert.equal(composio.created.length, 2);
	assert.deepEqual(composio.created[1], {
		manage_connections: { enable: false, enable_connection_removal: false },
		workbench: { enable: false },
		tags: { enabled: ["readOnlyHint"] },
		user_id: "main@project",
	});

	composio.sessions.clear();
	await run();
	assert.equal(composio.created.length, 3);
	assert.equal(recorded(project).length, 3);
});

test("when Composio refuses the key, the event still runs, without Composio tools, and the system prompt says why", async (t) => {
	const project = setup();
	composio.refuse = true;
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const id = queue.enqueue({ threadId: "main", content: "hello" });
	const server = runner(project);
	t.after(() => server.stop());
	const before = model.requests.length;
	await until(() => events(project.agent).find((event) => event.id === id).status === "done");

	assert.deepEqual(composioTools(before), []);
	assert.equal(unavailable(before), "Composio tools are unavailable in this session: Composio answered 401: Invalid API key.");
	assert.ok(!JSON.stringify(onlySession(project).entries).includes(composio.env.COMPOSIO_API_KEY));
	assert.deepEqual(recorded(project), []);
});

test("without COMPOSIO_API_KEY an agent has no Composio tools, the system prompt says why, and the conversation stays clean however often it starts", async () => {
	const project = setup(false);
	const sent = [];
	for (const prompt of ["hello", "again", "once more"]) {
		sent.push(prompt);
		const before = model.requests.length;
		assert.equal((await agentx(project, ["chat", "-p", prompt])).status, 0);
		assert.deepEqual(composioTools(before), []);
		assert.equal(unavailable(before), "Composio tools are unavailable in this session: COMPOSIO_API_KEY is not set where the agent runs.");
		// The conversation holds what was typed, and nothing about Composio.
		assert.deepEqual(model.requests[before], sent);
	}
	assert.equal(composio.created.length, 0);
});

test("a session that does not hold its thread records no Composio session, so it writes nothing to the thread's conversation", async (t) => {
	const project = setup();
	assert.equal((await agentx(project, ["chat", "-p", "hello"])).status, 0);
	// New settings: the next start makes a new Composio session.
	setSession(project, { toolkits: { enable: ["gmail"] } });
	const before = onlySession(project).entries;

	// Another process holds the thread. With -c, Pi starts on it and its prompt is refused.
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	assert.ok(queue.acquire("main"));
	const refused = await agentx(project, ["chat", "-c", "-p", "let me in"]);
	assert.equal(refused.status, 1);
	assert.equal(composio.created.length, 2);
	assert.deepEqual(onlySession(project).entries, before);
});

test("when Composio cannot be reached, the session starts without Composio tools and the system prompt says why", async () => {
	const project = setup();
	project.env.COMPOSIO_BASE_URL = "http://127.0.0.1:1";
	const before = model.requests.length;
	assert.equal((await agentx(project, ["chat", "-p", "hello"])).status, 0);

	assert.deepEqual(composioTools(before), []);
	assert.equal(unavailable(before), "Composio tools are unavailable in this session: Composio could not be reached: fetch failed.");
});

test("the project's agent-x/.env gives every agent its keys, and a variable already in the environment wins", async () => {
	const project = setup(false);
	writeFileSync(join(project.agent, "..", "..", ".env"), `COMPOSIO_API_KEY=${composio.env.COMPOSIO_API_KEY}\nCOMPOSIO_BASE_URL=${composio.env.COMPOSIO_BASE_URL}\n`);
	assert.equal((await agentx(project, ["chat", "-p", "hello"])).status, 0);
	assert.equal(composio.created.length, 1);

	project.env.COMPOSIO_BASE_URL = "http://127.0.0.1:1";
	const before = model.requests.length;
	assert.equal((await agentx(project, ["chat", "--thread-id", "other", "-p", "hello"])).status, 0);
	assert.equal(unavailable(before), "Composio tools are unavailable in this session: Composio could not be reached: fetch failed.");
	assert.equal(composio.created.length, 1);
});

/** Gives the agent the developer's workflows `scripts`, by name, each the body of its default export, and runs each once under `agentx run`. Resolves to their events once all are settled. */
async function runWorkflows(t, project, scripts) {
	const listed = Object.fromEntries(Object.keys(scripts).map((name) => [name, { description: `The test's ${name}.`, script: `workflows/${name}.ts` }]));
	writeFileSync(join(project.agent, ".pi", "workflows.json"), JSON.stringify(listed));
	for (const [name, body] of Object.entries(scripts)) writeFileSync(join(project.agent, ".pi", "workflows", `${name}.ts`), `export default async function (event, ctx) {\n${body}\n}\n`);
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const ids = Object.keys(scripts).map((name) => queue.enqueue({ threadId: `workflow.${name}`, content: "" }));
	const server = runner(project);
	t.after(() => server.stop());
	const settled = () => ids.map((id) => events(project.agent).find((event) => event.id === id));
	await until(() => settled().every((event) => event.status === "done" || event.status === "failed"));
	return settled();
}

test("a workflow runs Composio tools with ctx.composio, in one session per run made with the agent's user id and policy, and a tool that fails fails the run", async (t) => {
	const project = setup();
	setSession(project, { toolkits: { enable: ["gmail"] } });
	const [mail, failing] = await runWorkflows(t, project, {
		// Two calls at once, which share the run's session.
		mail: `const results = await Promise.all([ctx.composio("GMAIL_SEND_EMAIL", { recipient_email: "a@example.com" }), ctx.composio("COMPOSIO_SEARCH_TOOLS")]);
(await import("node:fs")).writeFileSync("storage/workspace/results.json", JSON.stringify(results));`,
		failing: `await ctx.composio("FAILING_TOOL");`,
	});

	assert.equal(mail.status, "done", mail.error);
	assert.deepEqual(JSON.parse(readFileSync(join(project.agent, "storage", "workspace", "results.json"), "utf8")), [
		{ ran: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "a@example.com" } },
		{ ran: "COMPOSIO_SEARCH_TOOLS", arguments: {} },
	]);
	assert.deepEqual([failing.status, failing.error], ["failed", "Composio tool FAILING_TOOL failed: the fake tool failed (log log_fake)"]);
	// A session per run, with the policy the agent's threads get.
	const policy = { ...defaults, toolkits: { enable: ["gmail"] }, user_id: "main@project" };
	assert.deepEqual(composio.created, [policy, policy]);
	const sessionOf = (tool) => composio.executed.find((executed) => executed.tool === tool).sessionId;
	assert.equal(composio.executed.length, 3);
	assert.equal(sessionOf("GMAIL_SEND_EMAIL"), sessionOf("COMPOSIO_SEARCH_TOOLS"));
	assert.notEqual(sessionOf("GMAIL_SEND_EMAIL"), sessionOf("FAILING_TOOL"));
});

test("without COMPOSIO_API_KEY, a workflow's ctx.composio fails the run and says why", async (t) => {
	const project = setup(false);
	const [run] = await runWorkflows(t, project, { mail: `await ctx.composio("GMAIL_SEND_EMAIL", {});` });
	assert.deepEqual([run.status, run.error], ["failed", "Composio is not available: COMPOSIO_API_KEY is not set where the agent runs."]);
	assert.equal(composio.created.length, 0);
});

test("a developer's extension that registers an MCP server after awaiting in session_start still has its tools in the first queued event", async (t) => {
	// No Composio key: only the developer's server is in play.
	const project = setup(false);
	writeFileSync(
		join(project.agent, ".pi", "extensions", "slow-server.ts"),
		`export default function (pi) {
	pi.on("session_start", async () => {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		pi.registerMcpServer("slow", { url: "${composio.url}/slow/mcp", exposure: "direct" });
	});
}
`,
	);
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const id = queue.enqueue({ threadId: "main", content: "hello" });
	const server = runner(project);
	t.after(() => server.stop());
	const before = model.tools.length;
	await until(() => events(project.agent).find((event) => event.id === id).status === "done");

	assert.ok(model.tools[before].includes("mcp__slow__COMPOSIO_SEARCH_TOOLS"), String(model.tools[before]));
});
