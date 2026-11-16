// Tests of agentx-browser, the agent's browser command: it runs only in the agent's processes, on a profile by name, with the agent-browser agentx pins.
// None of them starts Chrome.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeModel } from "./fake-model.mjs";
import { agentx, createAgent, projectRoot } from "./project.mjs";

const command = fileURLToPath(new URL("../dist/agent-runtime/browser/browser-command.js", import.meta.url));

let model;
before(async () => {
	model = await startFakeModel();
});
after(() => model.close());

test("agentx-browser runs agentx's agent-browser in the agent's processes only, on a profile with a plain name", () => {
	const project = createAgent(model.port);
	// What the agent's processes have: its name, and the project's Pi agent directory.
	const env = { ...project.env, AGENTX_AGENT: "main", PI_CODING_AGENT_DIR: join(projectRoot(project), "agent-x", ".pi") };
	const run = (args, as = env) => spawnSync(process.execPath, [command, ...args], { cwd: project.agent, env: as, encoding: "utf8" });
	assert.match(run(["get", "url"], project.env).stderr, /^agentx-browser is the agent's own, run in its processes/);
	assert.match(run(["get", "url"], { ...env, AGENTX_AGENT: "nobody" }).stderr, /agents\/nobody is not an agent directory/);
	assert.match(run([]).stderr, /^usage:/);
	assert.match(run(["--profile", "Work Account", "open", "https://example.com"]).stderr, /^"Work Account" is not a profile name/);

	// The pinned agent-browser, which serves the guide that matches it.
	const guide = run(["skills", "get", "core"]);
	assert.equal(guide.status, 0, guide.stderr);
	assert.match(guide.stdout, /^---\nname: core\n/);
});

test("the model's bash runs agentx-browser as the agent", async () => {
	const project = createAgent(model.port);
	const guide = join(project.agent, "storage", "workspace", "guide.md");
	const chat = await agentx(project, ["chat", "-p", `[bash ${process.execPath} ${command} skills get core > ${guide}]`]);
	assert.equal(chat.status, 0, chat.stderr);
	assert.match(readFileSync(guide, "utf8"), /^---\nname: core\n/);
});
