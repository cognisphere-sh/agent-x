// End-to-end tests of the skills and context extensions: real Pi sessions, under `agentx chat -p` and `agentx run`, and the fake model, which can call any tool.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Queue } from "../dist/agent-runtime/events/queue.js";
import { startedEpisode } from "../dist/agent-runtime/pi/pi-package/extensions/context/episodes.js";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, alive, editSettings, holder, onlySession, scratch, until } from "./project.mjs";

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

/** A fresh project (see `scratch`) with `agentx run` started, and `run(content)`, which queues an event on thread main and resolves to its id once it is done
 * and its episode's end message is written, which comes after. */
function setup(t, settings = {}) {
	const base = scratch(t, model.port);
	editSettings(base.project.agent, (current) => ({ ...current, ...settings, agentx: { ...current.agentx, ...settings.agentx } }));
	const queue = new Queue(base.project.agent);
	t.after(() => queue.close());
	base.start();
	const run = async (content) => {
		const id = queue.enqueue({ threadId: "main", content });
		await base.reach("done", id);
		await until(() => {
			const episode = episodeOf(base.project, base.event(id).entryId);
			return entriesOf(base.project, "custom_message", "agentx-episode-end").some((end) => end.content.startsWith(`Episode ${episode} ended.`));
		});
		return id;
	};
	return { ...base, queue, run };
}

function writeSkill(folder, name, frontmatter) {
	mkdirSync(join(folder, name), { recursive: true });
	writeFileSync(join(folder, name, "SKILL.md"), `---\n${frontmatter}\n---\n\nHow to do it.\n`);
}

// Runs `agentx chat -p <prompt>` in the agent's main thread and fails the test when it fails.
async function chat(project, prompt) {
	const run = await agentx(project, ["chat", "-p", prompt]);
	assert.equal(run.status, 0, run.stderr);
}

// Ends the thread's Pi process and sets Pi to compact before the next one's first prompt, keeping `keepRecentTokens`: its threshold, the window less the
// reserve, is below the context. Pi asks the extension only when its own cut leaves something to summarize.
async function compactNext(project, keepRecentTokens) {
	const pi = holder(project.agent, "main");
	await until(() => !alive(pi));
	editSettings(project.agent, (settings) => ({ ...settings, compaction: { reserveTokens: 127_990, keepRecentTokens } }));
}

const entriesOf = (project, type, customType) => onlySession(project).entries.filter((entry) => entry.type === type && (customType === undefined || entry.customType === customType));
const messages = (project, role) => onlySession(project).entries.filter((entry) => entry.type === "message" && entry.message.role === role);
const text = (entry) => (typeof entry.message.content === "string" ? entry.message.content : entry.message.content.map((part) => part.text ?? "").join("\n"));
// The episode a session entry starts, from the line its text starts with.
const started = (entry) => (entry.type === "message" && entry.message.role === "user" ? startedEpisode(text(entry)) : undefined);
// The id of the episode that session entry `entryId` is in: the one the last first message up to it starts.
const episodeOf = (project, entryId) => {
	const entries = onlySession(project).entries;
	return started(entries.slice(0, entries.findIndex((entry) => entry.id === entryId) + 1).findLast(started));
};
// What a fold may omit of an episode: its messages and custom messages, from its first message up to the next episode's.
const episodeEntries = (project, id) => {
	const entries = onlySession(project).entries;
	const start = entries.findIndex((entry) => started(entry) === id);
	const next = entries.findIndex((entry, index) => index > start && started(entry));
	const omissible = (entry) => entry.type === "custom_message" || (entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message.role));
	return entries.slice(start, next < 0 ? undefined : next).filter(omissible);
};
const omitted = (project) => entriesOf(project, "context_edit").flatMap((edit) => (edit.replacement === null ? [edit.targetId] : []));
const replaced = (project) => entriesOf(project, "context_edit").filter((edit) => edit.replacement !== null);
const foldNudges = (project) => entriesOf(project, "custom_message", "agentx-fold-nudge");
// Resolves once there are `count` fold nudges and the turn of the last is over: it has left the context.
const foldNudged = (project, count) => until(() => foldNudges(project).length === count && omitted(project).includes(foldNudges(project)[count - 1].id));
// The agent's answer to the next fold nudge: a fold of these ranges.
const foldAtNudge = (ranges) => model.answerWhen("Fold the earlier episodes", `[tool fold ${JSON.stringify({ ranges })}]`);

test("each skill is a section of its own with its version, read again on every run; Pi's one list is gone, and so are the machine's skills", async (t) => {
	const { project } = scratch(t, model.port);
	const skills = join(project.agent, "storage", "knowledge", "skills");
	writeSkill(skills, "greet", "name: greet\ndescription: How to greet people.\nmetadata:\n  version: 1");
	writeSkill(skills, "broken", "name: broken");
	writeSkill(join(project.env.HOME, ".agents", "skills"), "machine-wide", "name: machine-wide\ndescription: A skill of every project on this machine.");
	await chat(project, "first");
	const prompt = model.systemPrompts.at(-1);
	assert.match(prompt, /<agentx-skill-greet>\nname: greet\nversion: 1\ndescription: How to greet people\.\nfile: \S+\/greet\/SKILL\.md\n<\/agentx-skill-greet>/);
	assert.match(prompt, /could not be loaded:\n\n- \S+\/broken\/SKILL\.md: it has no description/);
	// agentx's own skills are there too, from its Pi package.
	assert.match(prompt, /<agentx-skill-browser>/);
	assert.ok(!prompt.includes("<available_skills>"), "Pi's list is gone");
	assert.ok(!prompt.includes("machine-wide"));
	assert.match(prompt, /<agentx-model>\n# Your model\n\nYou run on `fake\/fake-model`, with a context window of 128K tokens and up to 4.1K tokens of output\.\n<\/agentx-model>/);

	// A new version and a new skill show from the next run, without /reload: only their sections are sent again.
	writeSkill(skills, "greet", "name: greet\ndescription: How to greet people.\nmetadata:\n  version: 2");
	writeSkill(skills, "farewell", "name: farewell\ndescription: How to say goodbye.");
	await chat(project, "second");
	const patch = messages(project, "system").at(-1).message.sections;
	assert.deepEqual(Object.keys(patch).sort(), ["agentx-skill-farewell", "agentx-skill-greet"]);
	assert.match(patch["agentx-skill-greet"], /\nversion: 2\n/);
	assert.match(patch["agentx-skill-farewell"], /\nversion: none\n/);
});

test("an episode has an id of its own, given by the line its first message starts with, after the system message, and an end message with its tokens; episode_read gives it back, and fold folds only when a fold nudge asks", async (t) => {
	const { project, event, run } = setup(t);
	const alpha = await run("the alpha task");
	const a = episodeOf(project, event(alpha).entryId);
	assert.ok(a && a !== alpha, "an episode's id is its own");
	const first = messages(project, "user").find((entry) => entry.id === event(alpha).entryId);
	assert.ok(text(first).startsWith(`Episode ${a} started.\n\n<agentx-metadata id="${alpha}">`), text(first));
	assert.equal(onlySession(project).entries.find((entry) => entry.type === "message" || entry.type === "custom_message").message?.role, "system");
	const [end] = entriesOf(project, "custom_message", "agentx-episode-end");
	assert.match(end.content, new RegExp(`^Episode ${a} ended\\. It used about \\d+ tokens of your context\\.$`));

	await run(`[tool episode_read ${JSON.stringify({ episode: a })}]`);
	assert.match(
		text(messages(project, "toolResult").at(-1)),
		new RegExp(`^## Episode ${a}\\n\\nEpisode ${a} started\\.\\n\\n<agentx-metadata id="${alpha}">[\\s\\S]*\\nthe alpha task\\n\\n### You\\n\\nreply \\d+\\n\\n> Episode ${a} ended\\.`),
	);
	const b = episodeOf(project, event(await run("the beta task")).entryId);
	await run(`[tool fold ${JSON.stringify({ ranges: [{ from: a, to: b, summary: "x" }] })}]`);
	assert.match(text(messages(project, "toolResult").at(-1)), /Fold only when a message asks you to/);
	assert.equal(entriesOf(project, "context_edit").length, 0);
});

test("each attempt at an event is an episode of its own", async (t) => {
	const { project, queue, reach } = setup(t);
	const id = queue.enqueue({ threadId: "main", content: "[fail] this" });
	await reach("failed", id);
	const ids = messages(project, "user").map(started);
	assert.equal(new Set(ids).size, 3, ids.join(", "));
});

test("once the episodes since the last fold nudge used more than foldNudgeEvery, an episode's end brings a fold nudge, which says how to fold, and a turn to fold; then the fold nudge and that turn leave the context", async (t) => {
	const { project, event, run } = setup(t, { agentx: { memory: { compaction: { foldNudgeEvery: 1 } } } });
	const alpha = await run("the alpha task");
	// With no episode besides the newest there is nothing to fold, so no fold nudge.
	assert.equal(foldNudges(project).length, 0);

	// The agent answers the fold nudge without folding: once its turn is over, the fold nudge and the answer leave the context.
	const beta = await run("the beta task");
	await foldNudged(project, 1);
	const [nudge] = foldNudges(project);
	assert.match(nudge.content, /^Your context holds about \S+ of 128K tokens\. Fold the earlier episodes /);
	assert.match(nudge.content, /\n- Do not name the episodes it covers: its tag lists them\.\n/);
	const entries = onlySession(project).entries;
	const answer = entries.slice(entries.findIndex((entry) => entry.id === nudge.id)).find((entry) => entry.type === "message" && entry.message.role === "assistant");
	assert.ok(omitted(project).includes(answer.id));

	// The next fold nudge folds. The summary takes the place of the episode's first message, the event's, and the rest of it, its end message too, the fold call
	// and the fold nudge leave the context.
	const [a, b] = [alpha, beta].map((id) => episodeOf(project, event(id).entryId));
	const folded = episodeEntries(project, a);
	foldAtNudge([{ from: a, to: b, summary: "Finished the first job." }]);
	const gamma = await run("the gamma task");
	await foldNudged(project, 2);
	const [summary] = replaced(project);
	assert.equal(summary.targetId, event(alpha).entryId);
	assert.match(summary.replacement.content, new RegExp(`^<agentx-folded episodes="${a}">\\nFolded: 1 episode \\(${a}\\), about \\d+ tokens\\. \`episode_read\` [^\\n]+\\n\\nFinished the first job\\.\\n</agentx-folded>$`));
	const turn = episodeEntries(project, episodeOf(project, event(gamma).entryId)).filter((entry) => entry.type === "message" && entry.message.role !== "user");
	assert.ok([...folded.slice(1), ...turn.slice(1)].every((entry) => omitted(project).includes(entry.id)), JSON.stringify(entriesOf(project, "context_edit")));

	// A turn to fold that fails leaves its event done. The next episode's first request has the summary, and neither the folded event nor a fold nudge.
	model.answerWhen("Fold the earlier episodes", "[fail]");
	const delta = await run("the delta task");
	await foldNudged(project, 3);
	assert.equal(event(delta).status, "done");
	const asked = model.requests.find((users) => users.some((user) => user.includes("the delta task")));
	assert.ok(asked.some((user) => user.startsWith(`<agentx-folded episodes="${a}">`)), asked.join("\n---\n"));
	assert.ok(!asked.some((user) => user.includes("the alpha task") || user.startsWith("Your context holds")), asked.join("\n---\n"));
});

test("a fold whose ranges overlap or name an event is refused, and an event that arrives during a turn to fold waits for it and starts an episode of its own", async (t) => {
	const { project, queue, event, reach, run } = setup(t, { agentx: { memory: { compaction: { foldNudgeEvery: 1 } } } });
	const alpha = await run("the alpha task");
	const beta = await run("the beta task");
	const [a, b] = [alpha, beta].map((id) => episodeOf(project, event(id).entryId));
	const c = episodeOf(project, event(await run("the gamma task")).entryId);
	await foldNudged(project, 2);
	foldAtNudge([
		{ from: a, to: c, summary: "x" },
		{ from: b, to: c, summary: "y" },
	]);
	await run("the delta task");
	await foldNudged(project, 3);
	assert.match(text(messages(project, "toolResult").at(-1)), /overlap/);
	foldAtNudge([{ from: alpha, to: beta, summary: "x" }]);
	await run("the epsilon task");
	await foldNudged(project, 4);
	assert.match(text(messages(project, "toolResult").at(-1)), new RegExp(`This thread has no episode ${alpha}\\.`));
	assert.equal(replaced(project).length, 0);

	model.answerWhen("Fold the earlier episodes", "[sleep 2]");
	const zeta = queue.enqueue({ threadId: "main", content: "the zeta task" });
	await until(() => foldNudges(project).length === 5);
	const late = queue.enqueue({ threadId: "main", content: "arrived during the turn to fold" });
	await reach("done", zeta, late);
	assert.notEqual(episodeOf(project, event(late).entryId), episodeOf(project, event(zeta).entryId));
	assert.ok(!omitted(project).includes(event(late).entryId));
});

test("a steered event joins its episode; one fold folds two ranges, and a range that takes in part of an earlier fold replaces all of it", async (t) => {
	const { project, queue, event, reach, run } = setup(t, { agentx: { memory: { compaction: { foldNudgeEvery: 1 } } } });
	const first = queue.enqueue({ threadId: "main", content: "[sleep 2] the first job" });
	await until(() => event(first).entryId);
	const steered = queue.enqueue({ threadId: "main", content: "and this too" });
	await reach("done", first, steered);
	const e1 = episodeOf(project, event(first).entryId);
	assert.equal(episodeOf(project, event(steered).entryId), e1);
	await until(() => entriesOf(project, "custom_message", "agentx-episode-end").length === 1);
	const e3 = episodeOf(project, event(await run("the third job")).entryId);
	const fourth = await run("the fourth job");
	const e4 = episodeOf(project, event(fourth).entryId);
	const e5 = episodeOf(project, event(await run("the fifth job")).entryId);
	await foldNudged(project, 3);

	// Two ranges: the first two episodes, and the fourth. The fifth stays.
	foldAtNudge([
		{ from: e1, to: e4, summary: "Did the first and third jobs." },
		{ from: e4, to: e5, summary: "Did the fourth job." },
	]);
	await run("the sixth job");
	await foldNudged(project, 4);
	assert.deepEqual(
		replaced(project).map((edit) => [edit.targetId, edit.replacement.content.split("\n")[0]]),
		[
			[event(first).entryId, `<agentx-folded episodes="${e1} ${e3}">`],
			[event(fourth).entryId, `<agentx-folded episodes="${e4}">`],
		],
	);
	// The third episode alone is part of the first fold, so the fold takes in all of it, and its summary is replaced.
	foldAtNudge([{ from: e3, to: e4, summary: "All of the first and third jobs." }]);
	await run("the seventh job");
	await foldNudged(project, 5);
	const last = replaced(project).at(-1);
	assert.equal(last.targetId, event(first).entryId);
	assert.match(last.replacement.content, new RegExp(`^<agentx-folded episodes="${e1} ${e3}">\\n[^\\n]+\\n\\nAll of the first and third jobs\\.\\n</agentx-folded>$`));
});

test("when Pi compacts, the last episodes stay and everything before them is summarized in the form of a fold, the agent's fold summaries too", async (t) => {
	const { project, event, run } = setup(t, { agentx: { memory: { compaction: { keepEpisodes: 1, foldNudgeEvery: 1 } } } });
	const alpha = await run("the alpha task");
	const beta = await run("the beta task");
	const [a, b] = [alpha, beta].map((id) => episodeOf(project, event(id).entryId));
	await foldNudged(project, 1);
	foldAtNudge([{ from: a, to: b, summary: "Finished the first job." }]);
	const gamma = await run("the gamma task");
	await foldNudged(project, 2);
	// Room for the newest episode, with its end message, but not for the one before it.
	const size = Number(/about (\d+) tokens/.exec(entriesOf(project, "custom_message", "agentx-episode-end").at(-1).content)[1]);
	await compactNext(project, size + 40);
	const before = model.requests.length;
	await run("the delta task");
	const [compaction] = entriesOf(project, "compaction");
	assert.deepEqual(compaction.details, { agentx: true });
	assert.equal(compaction.firstKeptEntryId, event(gamma).entryId);
	assert.match(compaction.summary, new RegExp(`^<agentx-folded episodes="${a} ${b}">\\nFolded: 2 episodes \\(${a}, ${b}\\), about \\d+ tokens\\. [^\\n]+\\n\\nreply \\d+\\n</agentx-folded>$`));
	// The summary was asked of everything before the kept episode: the fold's summary, and the episode after it.
	const asked = model.requests.slice(before).find((users) => users[0].startsWith("The conversation to add to it"))[0];
	assert.ok(asked.includes(`<agentx-folded episodes="${a}">`) && asked.includes("the beta task") && !asked.includes("[tool fold"), asked);
});

test("when not even the newest episode fits in keepRecentTokens, the compaction cuts inside it where Pi does; the episode keeps its id and can still be folded", async (t) => {
	const { project, event, run } = setup(t, { compaction: { keepRecentTokens: 30 }, agentx: { memory: { compaction: { foldNudgeEvery: 1 } } } });
	const [a, b] = [await run("the alpha task"), await run("the beta task")].map((id) => episodeOf(project, event(id).entryId));
	// The model refuses the context after the episode's tool call, as too long: Pi compacts once, and asks again. The call and its result are more than
	// keepRecentTokens, so Pi's cut keeps them and not the event before them.
	model.answerWhen("39\n40", "[overflow]");
	const gamma = await run("[bash seq 1 40]");
	const g = episodeOf(project, event(gamma).entryId);
	const [compaction] = entriesOf(project, "compaction");
	assert.deepEqual(compaction.details, { agentx: true });
	assert.match(compaction.summary, new RegExp(`^<agentx-folded episodes="${a} ${b} ${g}">\\nFolded: 2 episodes \\(${a}, ${b}\\), and the start of episode ${g}, whose latest messages follow, about \\d+ tokens\\.`));
	// Its first message is in the summarized part, yet its end message names it.
	assert.match(entriesOf(project, "custom_message", "agentx-episode-end").at(-1).content, new RegExp(`^Episode ${g} ended\\.`));

	// What is left of it folds, its summary in place of the first of its messages the model still sees.
	// Gamma's end brought no fold nudge: after the compaction it is the only episode the model sees. Delta's brings the second.
	const d = episodeOf(project, event(await run("the delta task")).entryId);
	await foldNudged(project, 2);
	foldAtNudge([{ from: g, to: d, summary: "Ran the command." }]);
	await run("the epsilon task");
	await until(() => replaced(project).length === 1);
	const [summary] = replaced(project);
	assert.notEqual(summary.targetId, event(gamma).entryId);
	assert.ok(episodeEntries(project, g).some((entry) => entry.id === summary.targetId));
	// On a model's message, Pi keeps the summary as a text part.
	const content = summary.replacement.content;
	assert.match(typeof content === "string" ? content : content.map((part) => part.text).join(""), new RegExp(`^<agentx-folded episodes="${g}">\\n`));
});

test("a summary cut off at the token limit is not kept: Pi compacts as it does by itself", async (t) => {
	const { project, run } = setup(t, { agentx: { memory: { compaction: { keepEpisodes: 1 } } } });
	await run("the alpha task");
	await run("the beta task");
	await compactNext(project, 1);
	// The next request is the extension's summary call, before the next Pi process's first prompt.
	model.cutNext();
	await run("the gamma task");
	// Later compactions, as the context passes the low threshold again, are the extension's.
	const [first] = entriesOf(project, "compaction");
	assert.equal(first.details?.agentx, undefined, JSON.stringify(first));
});

test("with compaction turned off in its settings, fold folds nothing", async (t) => {
	const { project } = scratch(t, model.port);
	editSettings(project.agent, (settings) => ({ ...settings, agentx: { ...settings.agentx, memory: { compaction: { enabled: false } } } }));
	await chat(project, `[tool fold ${JSON.stringify({ ranges: [{ from: "a", to: "b", summary: "x" }] })}]`);
	assert.equal(messages(project, "toolResult").at(-1).message.isError, true);
	assert.match(text(messages(project, "toolResult").at(-1)), /Folding is turned off/);
	assert.equal(entriesOf(project, "context_edit").length, 0);
});
