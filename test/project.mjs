// Test helpers: a scratch agentx project whose agent talks to the fake model, and the built CLI run in it with a clean environment.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { markerId, pending, read } from "../dist/agent-runtime/events/mailbox.js";

/** The CLI under test. Tests run after `tsc`, so dist/ is current. */
export const cli = fileURLToPath(new URL("../dist/cli/agentx.js", import.meta.url));

/** Creates a project with one agent, `main`, set up to use the fake model on `port`. Returns `{ agent, env }`: its directory and the environment to run agentx in. */
export function createAgent(port) {
	// On macOS the temp directory is reached through a symlink, which is the case Pi's session lookup is sensitive to.
	const root = mkdtempSync(join(tmpdir(), "agentx-test-"));
	const home = join(root, "home");
	mkdirSync(home);
	const env = { PATH: process.env.PATH, HOME: home, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
	setUp(["init-project", "project"], root, env);
	// The project's agentx is this checkout, linked as `pnpm link` does: without an installed agentx, commands in a project stop.
	mkdirSync(join(root, "project", "agent-x", "node_modules", "@cognisphere-sh"), { recursive: true });
	symlinkSync(fileURLToPath(new URL("..", import.meta.url)), join(root, "project", "agent-x", "node_modules", "@cognisphere-sh", "agentx"));
	// Pi's agent directory of the project: a provider that needs no login.
	mkdirSync(join(root, "project", "agent-x", ".pi"));
	writeFileSync(
		join(root, "project", "agent-x", ".pi", "models.json"),
		JSON.stringify({
			providers: {
				fake: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "not-a-key",
					models: [{ id: "fake-model", name: "Fake", contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				},
			},
		}),
	);
	const project = { agent: join(root, "project", "agent-x", "agents", "main"), env };
	addAgent(project, "main");
	return project;
}

/** Writes `file` as an executable sh script with `body`: a stand-in for a command a test must not run for real, such as ngrok or next. */
export function stub(file, body) {
	writeFileSync(file, `#!/bin/sh\n${body}\n`);
	chmodSync(file, 0o755);
}

/** The root of the project. */
export const projectRoot = ({ agent }) => join(agent, "..", "..", "..");

/** Adds the agent `name` to the project, set up for the fake model, with `agentx` merged into its agentx settings. Returns its directory. */
export function addAgent(project, name, agentx = {}) {
	setUp(["init-agent", name], projectRoot(project), project.env);
	const dir = join(project.agent, "..", name);
	// No retries inside Pi, so a failing model call fails the run at once.
	editSettings(dir, (settings) => ({ ...settings, defaultProvider: "fake", defaultModel: "fake-model", retry: { enabled: false }, agentx: { ...settings.agentx, ...agentx } }));
	return dir;
}

// Runs `agentx <args>` in `cwd` to the end and throws when it fails. Only for commands that need no answer from the fake model, which this process gives.
function setUp(args, cwd, env) {
	const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`agentx ${args.join(" ")} failed: ${result.stderr}`);
}

/** Changes the project's agent-x/agentx.json: `change` gets it and returns the new one. */
export function editConfig(project, change) {
	const file = join(projectRoot(project), "agent-x", "agentx.json");
	writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, "utf8")))));
}

/** Changes the checked-in settings of the agent in `dir`: `change` gets them and returns the new ones. */
export function editSettings(dir, change) {
	const file = join(dir, ".pi", "settings.json");
	writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, "utf8")))));
}

/** Runs `agentx <args>` in the agent directory to the end; resolves to its exit status and output. Not spawnSync: the fake model answers from this process. */
export function agentx({ agent, env }, args) {
	const child = spawn(process.execPath, [cli, ...args], { cwd: agent, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	return new Promise((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr })));
}

/** Starts `agentx <args>` in the agent directory with its input open, as a session that stays. It is killed when the test `t` ends. */
export function open({ agent, env }, args, t) {
	const child = spawn(process.execPath, [cli, ...args], { cwd: agent, env, stdio: ["pipe", "pipe", "pipe"] });
	t.after(() => child.kill("SIGKILL"));
	return child;
}

/** The project as the agent's own processes, such as the model's bash, run agentx in it: `agentx event send` then sends from inside the agent. */
export const asAgent = (project) => ({ ...project, env: { ...project.env, AGENTX_AGENT: basename(project.agent) } });

/** Gives the agent an event as a person does, with `agentx event deliver` in the agent directory, and returns the event's id. */
export async function send(project, ...args) {
	const delivered = await agentx(project, ["event", "deliver", ...args]);
	assert.equal(delivered.status, 0, delivered.stderr);
	return /^Delivered event ([\w-]{12})/.exec(delivered.stdout)[1];
}

/** Sends an event as the agent does, with `agentx event send` from its own processes, into its outbox, and returns the event's id. */
export async function agentSend(project, ...args) {
	const sent = await agentx(asAgent(project), ["event", "send", ...args]);
	assert.equal(sent.status, 0, sent.stderr);
	return /^Sent event ([\w-]{12})/.exec(sent.stdout)[1];
}

/** Starts `agentx <args>` in `cwd`, in a process group of its own, so a test can signal it as a terminal does, the whole group at once. */
export function background(cwd, env, args) {
	const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (output += chunk));
	return { child, exited: new Promise((resolve) => child.on("exit", resolve)), output: () => output };
}

/**
 * Starts `agentx run` for the agent, with `agentx.runner` in its settings: `maxThreads` Pi threads at a time, and a stall time unless the default.
 * `end()` asks it to finish and resolves to its exit status; `stop()` kills it; `exited` resolves to its exit status.
 */
export function runner({ agent, env }, maxThreads = 4, stallSeconds) {
	editSettings(agent, (settings) => ({ ...settings, agentx: { ...settings.agentx, runner: { ...settings.agentx?.runner, maxThreads, ...(stallSeconds === undefined ? {} : { stallSeconds }) } } }));
	const started = background(agent, env, ["run"]);
	return {
		...started,
		end: () => {
			started.child.kill("SIGINT");
			return started.exited;
		},
		stop: () => {
			started.child.kill("SIGKILL");
			return started.exited;
		},
	};
}

/**
 * A fresh project for the test `t`: `event(id)` is the event on the agent's queue, `send(...args)` runs `agentx event send`, `start(...)` starts `agentx run`,
 * which is stopped when the test ends, and `reach(status, ...ids)` resolves when the events are all in that status.
 */
export function scratch(t, port) {
	const project = createAgent(port);
	const started = [];
	t.after(async () => {
		for (const server of started) await server.stop();
	});
	const event = (id) => events(project.agent).find((found) => found.id === id);
	return {
		project,
		event,
		send: (...args) => send(project, ...args),
		start: (...args) => started[started.push(runner(project, ...args)) - 1],
		reach: (status, ...ids) => until(() => ids.every((id) => event(id)?.status === status)),
	};
}

/** A message entry's text, without images. */
export const text = (entry) => (typeof entry.message.content === "string" ? entry.message.content : entry.message.content.map((part) => part.text ?? "").join("\n"));

/** Whether a session entry is an episode's end message. */
export const isEnd = (entry) => entry.type === "custom_message" && entry.customType === "agentx-episode-end";

/** The id of the episode that session entry `entryId` is in, in any of the agent's sessions: the one the next end message ends. */
export function episodeOf(project, entryId) {
	for (const { entries } of sessions(project)) {
		const at = entries.findIndex((entry) => entry.id === entryId);
		if (at >= 0) return entries.slice(at).find(isEnd)?.details.id;
	}
}

/** The agent's sessions as { thread, entries, users: [{ entryId, text }], contents, roles }, read from storage/sessions/<thread>/. `contents` is what was
 * typed or queued: each user message without its metadata block. */
export function sessions({ agent }) {
	// One folder per thread, storage/sessions/<thread>/, with the thread's session files.
	const directory = join(agent, "storage", "sessions");
	return readdirSync(directory)
		.flatMap((thread) => readdirSync(join(directory, thread)).filter((file) => file.endsWith(".jsonl")).map((file) => ({ thread, file: join(directory, thread, file) })))
		.map(({ thread, file }) => {
			const entries = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
			const users = entries.filter((entry) => entry.type === "message" && entry.message.role === "user").map((entry) => ({ entryId: entry.id, text: text(entry) }));
			return {
				thread,
				entries,
				users,
				contents: users.map((user) => user.text.split("\n").at(-1)),
				roles: entries.filter((entry) => entry.type === "message").map((entry) => entry.message.role),
			};
		});
}

/** The agent's session, when it must have exactly one. */
export function onlySession(project) {
	const all = sessions(project);
	assert.equal(all.length, 1);
	return all[0];
}

/** Waits until `check()` returns or resolves to something truthy and returns it; fails after `ms`. */
export async function until(check, ms = 20_000) {
	const end = Date.now() + ms;
	for (;;) {
		const result = await check();
		if (result) return result;
		if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/** The events on the queue of the agent in `agentRoot`, oldest first, read straight from the file as an operator would. */
export function events(agentRoot) {
	// No queue yet: only the router adds events to it, and creates it.
	if (!existsSync(join(agentRoot, "storage", "event_queue.db"))) return [];
	const rows = onQueueFile(agentRoot, (db) => (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'events'").get() ? db.prepare("SELECT * FROM events ORDER BY seq").all() : []));
	return rows.map((row) => ({
		id: row.id,
		threadId: row.thread_id,
		content: row.content,
		metadata: JSON.parse(row.metadata),
		doNotSteer: row.do_not_steer === 1,
		isSilent: row.is_silent === 1,
		status: row.status,
		attempts: row.attempts,
		error: row.error,
		entryId: row.entry_id,
		key: row.key,
		updatedAt: row.updated_at,
	}));
}

/** The events that wait in the agent's inbox, oldest first, as their event.json holds them: { id, sentAt, event, facts, to, from }. */
export function inboxEvents(agentRoot, box = "inbox") {
	const dir = join(agentRoot, "storage", "workspace", box);
	return pending(dir).map((marker) => read(dir, markerId(marker)));
}

/** The id of the process that holds the thread's lease: the Pi process that runs the thread, or `agentx run` for a workflow's thread. */
export function holder(agentRoot, threadId) {
	const lease = onQueueFile(agentRoot, (db) => db.prepare("SELECT owner FROM threads WHERE thread_id = ?").get(threadId));
	return lease && Number(lease.owner.split(".")[0]);
}

/** Whether the process is running. */
export function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Works on the agent's queue file directly, as an operator would. With SQL text, runs it; with nothing, makes every thread lease look abandoned,
 * as after the time a lease lasts without a heartbeat. With a function, calls it with the open file and returns what it returns.
 */
export function onQueueFile(agentRoot, work = "UPDATE threads SET heartbeat_at = 0") {
	// Waits for agentx's writes, as its own connections do (src/agent-runtime/sqlite.ts), instead of failing at once.
	const db = new DatabaseSync(join(agentRoot, "storage", "event_queue.db"), { timeout: 5000 });
	try {
		return typeof work === "string" ? db.exec(work) : work(db);
	} finally {
		db.close();
	}
}
