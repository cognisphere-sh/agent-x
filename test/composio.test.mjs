// End-to-end tests of the Composio extension: real Pi sessions in a scratch project, against a fake Composio and the fake model.

// agentx's default policy, as the extension sends it.
const defaults = {
	toolkits: { enable: ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "supabase", "hubspot", "telegram"] },
	manage_connections: { enable: true, enable_connection_removal: false },
	workbench: { enable: false },
};

import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Queue } from "../dist/agent-runtime/pi-package/extensions/message-queue/queue.js";
import { startFakeComposio } from "./fake-composio.mjs";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, createAgent, messages, onlySession, runner, until } from "./project.mjs";

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
	composio.created.length = 0;
	composio.mcpKeys.length = 0;
	composio.delayMs = 0;
	composio.refuse = false;
	const project = createAgent(model.port);
	if (withKey) Object.assign(project.env, composio.env);
	return project;
}

// The text of the agent's only session file.
const sessionText = ({ agent }) => {
	const [file] = readdirSync(join(agent, "storage", "sessions")).filter((name) => name.endsWith(".jsonl"));
	return readFileSync(join(agent, "storage", "sessions", file), "utf8");
};

// The thread's Composio sessions, as its Pi session records them.
const recorded = (project) =>
	sessionText(project)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((entry) => entry.type === "custom" && entry.customType === "agentx-composio")
		.map((entry) => entry.data.sessionId);

const settingsPath = (project) => join(project.agent, ".pi", "settings.json");

test("a new agent gets a Composio user id, and its first queued message already sees the Composio tools", async (t) => {
	const project = setup();
	const settings = JSON.parse(readFileSync(settingsPath(project), "utf8"));
	assert.equal(settings.agentx.composio.userId, "main@project");
	// Composio answers slowly; the session still waits for it before the first message goes in.
	composio.delayMs = 2000;
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const id = queue.enqueue({ threadId: "main", content: "hello" });
	const server = runner(project);
	t.after(() => server.stop());
	const before = model.tools.length;
	await until(() => messages(project.agent).find((message) => message.id === id).status === "done");

	assert.ok(model.tools[before].includes("mcp__composio__COMPOSIO_SEARCH_TOOLS"), String(model.tools[before]));
	assert.deepEqual(composio.created, [{ ...defaults, user_id: "main@project" }]);
	// Pi sent the key from the environment, never anything else.
	assert.ok(composio.mcpKeys.length > 0);
	assert.ok(composio.mcpKeys.every((key) => key === composio.env.COMPOSIO_API_KEY));
});

test("a thread keeps its Composio session, and gets a new one when the settings change or Composio no longer has it", async () => {
	const project = setup();
	const run = async () => assert.equal((await agentx(project, ["run", "-p", "hello"])).status, 0);
	await run();
	await run();
	assert.equal(composio.created.length, 1);

	// The agent's own policy goes to Composio, over agentx's defaults.
	const settings = JSON.parse(readFileSync(settingsPath(project), "utf8"));
	settings.agentx.composio.session = { toolkits: { enable: ["gmail"] }, workbench: { enable: true } };
	writeFileSync(settingsPath(project), JSON.stringify(settings));
	await run();
	assert.equal(composio.created.length, 2);
	assert.deepEqual(composio.created[1], { ...defaults, workbench: { enable: true }, toolkits: { enable: ["gmail"] }, user_id: "main@project" });

	composio.sessions.clear();
	await run();
	assert.equal(composio.created.length, 3);
	assert.equal(recorded(project).length, 3);
});

test("when Composio refuses the key, the message still runs, without Composio tools, and the model is told why", async (t) => {
	const project = setup();
	composio.refuse = true;
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	const id = queue.enqueue({ threadId: "main", content: "hello" });
	const server = runner(project);
	t.after(() => server.stop());
	const before = model.requests.length;
	await until(() => messages(project.agent).find((message) => message.id === id).status === "done");

	assert.ok(!model.tools[before].some((tool) => tool.startsWith("mcp__composio__")));
	assert.deepEqual(model.notes[before], ["Composio tools are unavailable in this session: Composio answered 401: Invalid API key."]);
	// The note does not disturb the queue: the message is linked to its own session entry.
	const session = onlySession(project);
	assert.equal(messages(project.agent)[0].entryId, session.users.find((user) => user.text.includes("hello")).entryId);
	assert.ok(!sessionText(project).includes(composio.env.COMPOSIO_API_KEY));
	assert.deepEqual(recorded(project), []);
});

test("without COMPOSIO_API_KEY an agent has no Composio tools, and the model is told why", async () => {
	const project = setup(false);
	const before = model.requests.length;
	assert.equal((await agentx(project, ["run", "-p", "hello"])).status, 0);

	assert.ok(!model.tools[before].some((tool) => tool.startsWith("mcp__composio__")));
	assert.deepEqual(model.notes[before], ["Composio tools are unavailable in this session: COMPOSIO_API_KEY is not set where the agent runs."]);
	assert.equal(composio.created.length, 0);
});

test("a session that does not hold its thread records no Composio session, so it writes nothing to the thread's conversation", async (t) => {
	const project = setup();
	assert.equal((await agentx(project, ["run", "-p", "hello"])).status, 0);
	// New settings: the next start makes a new Composio session.
	const settings = JSON.parse(readFileSync(settingsPath(project), "utf8"));
	settings.agentx.composio.session = { toolkits: { enable: ["gmail"] } };
	writeFileSync(settingsPath(project), JSON.stringify(settings));
	const before = sessionText(project);

	// Another process holds the thread. With -c, Pi starts on it and its prompt is refused.
	const queue = new Queue(project.agent);
	t.after(() => queue.close());
	assert.ok(queue.acquire("main"));
	const refused = await agentx(project, ["run", "-c", "-p", "let me in"]);
	assert.equal(refused.status, 1);
	assert.equal(composio.created.length, 2);
	assert.equal(sessionText(project), before);
});

test("when Composio cannot be reached, the session starts without Composio tools and the model is told why", async () => {
	const project = setup();
	project.env.COMPOSIO_BASE_URL = "http://127.0.0.1:1";
	const before = model.requests.length;
	assert.equal((await agentx(project, ["run", "-p", "hello"])).status, 0);

	assert.ok(!model.tools[before].some((tool) => tool.startsWith("mcp__composio__")));
	assert.deepEqual(model.notes[before], ["Composio tools are unavailable in this session: Composio could not be reached: fetch failed."]);
});

test("the project's agent-x/.env gives every agent its keys, and a variable already in the environment wins", async () => {
	const project = setup(false);
	const envFile = join(project.agent, "..", "..", ".env");
	writeFileSync(envFile, `COMPOSIO_API_KEY=${composio.env.COMPOSIO_API_KEY}\nCOMPOSIO_BASE_URL=${composio.env.COMPOSIO_BASE_URL}\n`);
	assert.equal((await agentx(project, ["run", "-p", "hello"])).status, 0);
	assert.equal(composio.created.length, 1);

	project.env.COMPOSIO_BASE_URL = "http://127.0.0.1:1";
	const before = model.requests.length;
	assert.equal((await agentx(project, ["run", "--thread-id", "other", "-p", "hello"])).status, 0);
	assert.deepEqual(model.notes[before], ["Composio tools are unavailable in this session: Composio could not be reached: fetch failed."]);
	assert.equal(composio.created.length, 1);
});
