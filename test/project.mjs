// Test helpers: a scratch agentx project whose agent talks to the fake model, and the built CLI run in it with a clean environment.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/** The CLI under test. Tests run after `tsc`, so dist/ is current. */
export const cli = fileURLToPath(new URL("../dist/cli/agentx.js", import.meta.url));

/** Creates a project with one agent, `main`, set up to use the fake model on `port`. Returns the agent directory. */
export function createAgent(port) {
	// On macOS the temp directory is reached through a symlink, which is the case Pi's session lookup is sensitive to.
	const root = mkdtempSync(join(tmpdir(), "agentx-test-"));
	const home = join(root, "home");
	mkdirSync(home);
	const env = { PATH: process.env.PATH, HOME: home, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
	const run = (args, cwd) => {
		const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });
		if (result.status !== 0) throw new Error(`agentx ${args.join(" ")} failed: ${result.stderr}`);
	};
	run(["init-project", "project"], root);
	run(["init-agent", "main"], join(root, "project"));
	const agent = join(root, "project", "agent-x", "agents", "main");
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
	const settingsPath = join(agent, ".pi", "settings.json");
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	// No retries inside Pi, so a failing model call fails the run at once.
	writeFileSync(settingsPath, JSON.stringify({ ...settings, defaultProvider: "fake", defaultModel: "fake-model", retry: { enabled: false } }));
	return { agent, env };
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

/** Starts the AgentRunner for the agent, `maxWorkers` threads at a time. `end()` asks it to finish and resolves to its exit status; `stop()` kills it. */
export function runner({ agent, env }, maxWorkers = 4) {
	const script = fileURLToPath(new URL("runner-process.mjs", import.meta.url));
	const child = spawn(process.execPath, [script, String(maxWorkers)], { cwd: agent, env, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	child.stdout.on("data", (chunk) => (output += chunk));
	child.stderr.on("data", (chunk) => (output += chunk));
	const exited = new Promise((resolve) => child.on("exit", resolve));
	return {
		child,
		output: () => output,
		end: () => {
			child.kill("SIGINT");
			return exited;
		},
		stop: () => {
			child.kill("SIGKILL");
			return exited;
		},
	};
}

/** The agent's sessions as { id, users: [{ entryId, text }], contents, roles }, read from storage/sessions. `contents` is what was typed or queued: each user message without its metadata block. */
export function sessions({ agent }) {
	const directory = join(agent, "storage", "sessions");
	return readdirSync(directory)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => {
			const entries = readFileSync(join(directory, file), "utf8").trim().split("\n").map((line) => JSON.parse(line));
			const text = (content) => (typeof content === "string" ? content : content.map((part) => part.text ?? "").join("\n"));
			const users = entries.filter((entry) => entry.type === "message" && entry.message.role === "user").map((entry) => ({ entryId: entry.id, text: text(entry.message.content) }));
			return {
				id: entries[0].id,
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

/** The messages on the queue of the agent in `agentRoot`, oldest first, read straight from the file as an operator would. */
export function messages(agentRoot) {
	return onQueueFile(agentRoot, (db) => db.prepare("SELECT * FROM messages ORDER BY id").all()).map((row) => ({
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
		updatedAt: row.updated_at,
	}));
}

/** The id of the process that holds the thread's lease: the Pi process that runs the thread. */
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
	const db = new DatabaseSync(join(agentRoot, "storage", "message_queue.db"));
	try {
		return typeof work === "string" ? db.exec(work) : work(db);
	} finally {
		db.close();
	}
}
