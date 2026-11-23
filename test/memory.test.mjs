// End-to-end tests of the memory extension: real Pi sessions under `agentx run`, on two threads, and the fake model, which can call any tool.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { Queue } from "../dist/agent-runtime/events/queue.js";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, alive, asAgent, editSettings, episodeOf, holder, scratch, send, sessions, text, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

// The entries of a thread's one session.
const entriesOf = (project, thread) => sessions(project).find((session) => session.thread === thread)?.entries ?? [];
const lastResult = (project, thread) => text(entriesOf(project, thread).findLast((entry) => entry.type === "message" && entry.message.role === "toolResult"));
const custom = (project, thread, customType) => entriesOf(project, thread).filter((entry) => entry.type === "custom_message" && entry.customType === customType);
// Waits until no Pi process holds the thread: what it wrote is in its session file only.
const ended = (project, thread) => until(() => !alive(holder(project.agent, thread)));
// The agent's memory index, read as it is on disk; closed when the test ends.
function indexOf(t, project) {
	const db = new DatabaseSync(join(project.agent, "storage", "memory", "index.db"), { readOnly: true });
	t.after(() => db.close());
	return db;
}

/** A fresh project (see `scratch`) with `agentx run` started as `server`, and `run(thread, content)`, which queues an event and resolves to the id of its
 * episode, once that episode's end message is written. */
function setup(t, settings = {}) {
	const base = scratch(t, model.port);
	editSettings(base.project.agent, (current) => ({ ...current, ...settings, agentx: { ...current.agentx, ...settings.agentx } }));
	const queue = new Queue(base.project.agent);
	t.after(() => queue.close());
	const server = base.start();
	const run = async (thread, content) => {
		const id = queue.enqueue({ threadId: thread, content });
		await base.reach("done", id);
		let episode;
		await until(() => (episode = episodeOf(base.project, base.event(id).entryId)));
		return episode;
	};
	return { ...base, server, run };
}

test("episode_search finds the episodes of every thread by keyword, best first, without the one in progress; episode_read gives one back with those around it, without its end message and fold nudges", async (t) => {
	const { project, run } = setup(t, { agentx: { memory: { compaction: { foldNudgeEvery: 1 } } } });
	const other = await run("other", "[bash echo zebra-crossing]");
	await ended(project, "other");
	const between = new Date().toISOString();
	const first = await run("main", "the first task, on giraffes");
	const search = await run("main", '[tool episode_search {"query":"zebra crossings giraffe"}]');
	const found = lastResult(project, "main");
	assert.match(found, /^2 episodes found, best first\./);
	assert.deepEqual(
		[...found.matchAll(/^## Episode (\S+)\n\nThread `(\S+)`, from .+ to .+\.$/gm)].map((match) => [match[1], match[2]]),
		[
			[other, "other"],
			[first, "main"],
		],
	);
	assert.match(found, /\*\*zebra\*\*-\*\*crossing\*\*/);

	// The episode's end brought a fold nudge, which the agent answered without folding.
	await until(() => custom(project, "main", "agentx-fold-nudge").length === 1 && entriesOf(project, "main").at(-1).type === "context_edit");
	await run("main", `[tool episode_read ${JSON.stringify({ episode: search, before: 1 })}]`);
	const read = lastResult(project, "main");
	assert.match(read, new RegExp(`^## Episode ${first}\\n\\nThread \`main\`, from .+\\.\\n\\n<agentX-metadata id="\\S+">\\n[^]*\\nthe first task, on giraffes\\n\\n### You\\n\\nreply \\d+\\n\\n## Episode ${search}\\n\\n`));
	assert.match(read, /\n### Tool call: episode_search\n\n```json\n\{\n {2}"query": "zebra crossings giraffe"\n\}\n```\n\n### Result\n\n````\n2 episodes found/);
	assert.match(read, /\n### You\n\nreply \d+$/);
	assert.ok(!/ended\.|Fold the earlier episodes/.test(read), read);

	// Only one thread's episodes, or only those started in a window of time.
	const only = async (filter) => {
		await run("main", `[tool episode_search ${JSON.stringify({ query: "zebra giraffes", ...filter })}]`);
		return [...lastResult(project, "main").matchAll(/^## Episode (\S+)$/gm)].map((match) => match[1]);
	};
	assert.deepEqual(await only({ thread: "other" }), [other]);
	assert.deepEqual(await only({ until: between }), [other]);
	assert.deepEqual(await only({ since: new Date(Date.now() + 60_000).toISOString() }), []);
	assert.equal(lastResult(project, "main"), "No episode found.");
});

test("the index is storage/memory/index.db; each session indexes its own file only, so a deleted index gets a thread's episodes back when a run of the thread settles", async (t) => {
	const { project, run } = setup(t);
	const other = await run("other", "[bash echo zebra-crossing]");
	const index = join(project.agent, "storage", "memory");
	assert.ok(existsSync(join(index, "index.db")));
	await ended(project, "other");
	rmSync(index, { recursive: true });
	await run("main", `[tool episode_read ${JSON.stringify({ episode: other })}]`);
	assert.equal(lastResult(project, "main"), `There is no episode ${other}.`);
	await run("other", "the giraffe task");
	await ended(project, "other");
	await run("main", `[tool episode_read ${JSON.stringify({ episode: other })}]`);
	assert.match(lastResult(project, "main"), new RegExp(`^## Episode ${other}\\n\\nThread \`other\`[^]*\\n### Tool call: bash\\n[^]*\\nzebra-crossing\\n`));
});

test("a run's episode is in the index once the run settles, with no search, in chunks of whole turns; a turn longer than a chunk is cut", async (t) => {
	const { project, run } = setup(t);
	// Three turns: a call with about 2,400 characters of result, one with 5,400, and the reply.
	model.answerWhen("giraffe giraffe", "[bash printf 'zebra%.0s ' $(seq 900)]");
	const episode = await run("other", "[bash printf 'giraffe%.0s ' $(seq 300)]");
	await ended(project, "other");
	const chunks = indexOf(t, project)
		.prepare("SELECT text FROM chunks WHERE episode = ? ORDER BY part")
		.all(episode)
		.map((row) => row.text);
	assert.equal(chunks.length, 4, chunks.join("\n----\n"));
	// The first turn alone, as the second does not fit with it, and the second cut where the chunk is full: it has no blank line in the chunk's second half.
	assert.ok(chunks[0].endsWith("giraffe \n```\n\n") && !chunks[0].includes("zebra"), chunks[0]);
	assert.ok(chunks[1].startsWith("### Tool call: bash\n") && chunks[1].length === 4000, chunks[1]);
	assert.ok(chunks[2].endsWith("zebra \n```\n\n"), chunks[2]);
	assert.match(chunks[3], /^### You\n\nreply \d+$/);
});

test("episode_read gives a long answer in pages and says which is the last, refuses a page past it, and takes a count below 0 for none", async (t) => {
	const { project, run } = setup(t, { agentx: { memory: { compaction: { enabled: false } } } });
	await run("other", "the giraffe task");
	// About 42,000 characters: two pages.
	const long = await run("other", "[bash printf 'zebra%.0s ' $(seq 7000)]");
	await ended(project, "other");
	const read = async (args) => {
		await run("main", `[tool episode_read ${JSON.stringify({ episode: long, ...args })}]`);
		return lastResult(project, "main");
	};
	// SQLite would take a LIMIT of -1 for none, and give every episode before it.
	const first = await read({ before: -1 });
	assert.match(first, /\n\n\[Page 1 of 2\. Call episode_read with page 2 for more\.\]$/);
	assert.ok(!first.includes("giraffe"));
	assert.match(await read({ page: 2 }), /\n\n\[Page 2 of 2, the last\.\]$/);
	assert.equal(await read({ page: 3 }), "There is no page 3: the answer has 2 pages.");
});

test("a time without an offset is in the agent's time zone, as its events show times", async (t) => {
	// UTC+14, far from the machine's own zone.
	const timeZone = "Pacific/Kiritimati";
	const { project, run } = setup(t, { agentx: { timezone: timeZone, memory: { compaction: { enabled: false } } } });
	const giraffe = await run("other", "the giraffe task");
	await ended(project, "other");
	const startedAt = Number(indexOf(t, project).prepare("SELECT started_at FROM episodes WHERE id = ?").get(giraffe).started_at);
	// The minute before the episode started, as a clock in that zone shows it: 2026-11-22T14:05.
	const minuteBefore = new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(startedAt - 60_000).replace(" ", "T");
	const search = async (window) => {
		await run("main", `[tool episode_search ${JSON.stringify({ query: "giraffe", thread: "other", ...window })}]`);
		return lastResult(project, "main");
	};
	assert.match(await search({ since: minuteBefore }), /^1 episode found/);
	assert.equal(await search({ until: minuteBefore }), "No episode found.");
});

test("an index that cannot be updated is reported, and the run goes on", async (t) => {
	const { project, server, run } = setup(t);
	// A folder where the index's file goes: SQLite cannot open it.
	mkdirSync(join(project.agent, "storage", "memory", "index.db"), { recursive: true });
	await run("main", "the giraffe task");
	await until(() => server.output().includes("main: The memory index could not be updated, and the thread's next run tries again: "));
});

test("agentx remove-thread deletes a thread's sessions and its episodes in the index; only a person runs it, and not while the thread runs", async (t) => {
	const { project, run } = setup(t);
	const other = await run("other", "[bash echo zebra-crossing]");
	const kept = await run("main", "the giraffe task");
	await ended(project, "other");
	assert.match((await agentx(asAgent(project), ["remove-thread", "other", "--yes"])).stderr, /^agentx remove-thread is for people/);
	assert.match((await agentx(project, ["remove-thread", "nowhere", "--yes"])).stderr, /^This agent has no thread "nowhere"\./);
	await send(project, "--thread-id", "busy", "[sleep 5]");
	await until(() => alive(holder(project.agent, "busy")));
	assert.match((await agentx(project, ["remove-thread", "busy", "--yes"])).stderr, /^Thread "busy" is running\./);

	const removed = await agentx(project, ["remove-thread", "other", "--yes"]);
	assert.equal(removed.status, 0, removed.stderr);
	assert.ok(!existsSync(join(project.agent, "storage", "sessions", "other")));
	// Only `other` left: `busy` may have indexed its own file meanwhile.
	const index = indexOf(t, project);
	assert.equal(index.prepare("SELECT count(*) AS n FROM episodes WHERE thread = 'other' OR id = ?").get(other).n, 0);
	assert.equal(index.prepare("SELECT count(*) AS n FROM chunks WHERE episode = ?").get(other).n, 0);
	assert.equal(index.prepare("SELECT count(*) AS n FROM sessions WHERE path LIKE 'other/%'").get().n, 0);
	assert.equal(index.prepare("SELECT thread FROM episodes WHERE id = ?").get(kept).thread, "main");
	assert.ok(index.prepare("SELECT count(*) AS n FROM chunks WHERE episode = ?").get(kept).n > 0);
	await run("main", `[tool episode_read ${JSON.stringify({ episode: other })}]`);
	assert.equal(lastResult(project, "main"), `There is no episode ${other}.`);
});
