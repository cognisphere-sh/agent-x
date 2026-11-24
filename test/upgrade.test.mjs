// Tests of agentx upgrade-project and agentx upgrade-agent: they add what the templates have and the project or agent lacks, move the agent's Pi packages
// to the template's versions, change nothing else, and do nothing the second time. The registry is never reached: no network in tests.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setPackageFields } from "../dist/cli/copy-template.js";
import { cli, createAgent, editSettings, projectRoot } from "./project.mjs";

const checkout = fileURLToPath(new URL("..", import.meta.url));
const template = (path) => readFileSync(join(checkout, "templates", path), "utf8");
const settingsOf = (dir) => JSON.parse(readFileSync(join(dir, ".pi", "settings.json"), "utf8"));
/** Runs `agentx <args>` in `cwd` to the end. */
const run = (cwd, env, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

test("upgrade-project adds what the templates have and the project and its agents lack, bumps the agents' Pi packages, keeps every value, and is done once", () => {
	// No model is asked.
	const project = createAgent(1);
	const root = projectRoot(project);
	const agentX = join(root, "agent-x");
	// A checkout linked in, as when developing agentx, is not looked up in the registry.
	setPackageFields(agentX, { dependencies: { "@cognisphere-sh/agentx": `link:${checkout}` } });
	// An agent made by an older agentx, and changed by its developer.
	const { agentx: defaults, packages } = JSON.parse(template("agent/.pi/settings.json"));
	editSettings(project.agent, ({ agentx: { memory, ...agentx }, ...settings }) => ({
		...settings,
		packages: ["npm:pi-web-access@0.1.0", "npm:@someone/pi-tools@1.0.0"],
		agentx: { ...agentx, systemPrompt: [], runner: { maxThreads: 8 } },
	}));
	rmSync(join(project.agent, ".env"));
	writeFileSync(join(agentX, ".env"), "AGENTX_API_TOKEN=the-token");
	const oldGitignore = template("project/gitignore").replace("agent-x/agents/*/.env\n", "");
	writeFileSync(join(root, ".gitignore"), oldGitignore);

	const first = run(root, project.env, "upgrade-project");
	assert.equal(first.status, 0, first.stderr);
	assert.match(first.stdout, /^agentx is pinned as link:/);
	assert.match(first.stdout, /^\.gitignore: added agent-x\/agents\/\*\/\.env$/m);
	assert.match(first.stdout, /^agent-x\/agents\/main\/\.pi\/settings\.json: npm:pi-web-access@0\.1\.0 -> npm:pi-web-access@/m);

	const settings = settingsOf(project.agent);
	assert.deepEqual(settings.agentx.memory, defaults.memory);
	assert.deepEqual(settings.agentx.runner, { ...defaults.runner, maxThreads: 8 });
	assert.deepEqual(settings.agentx.systemPrompt, []);
	assert.equal(settings.defaultModel, "fake-model");
	// Only the versions of the packages it uses: a package the template adds and the agent left out stays out.
	assert.deepEqual(settings.packages, [packages.find((source) => source.startsWith("npm:pi-web-access@")), "npm:@someone/pi-tools@1.0.0"]);
	assert.equal(readFileSync(join(project.agent, ".env"), "utf8"), template("agent/env"));
	const env = readFileSync(join(agentX, ".env"), "utf8");
	assert.match(env, /^AGENTX_API_TOKEN=the-token\n\n# Composio's webhook/);
	for (const name of ["COMPOSIO_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN_MAIN", "COMPOSIO_COORDINATOR_API_KEY"]) assert.equal(env.split(`# ${name}=`).length, 2, name);
	assert.ok(!env.includes("# AGENTX_API_TOKEN="));
	assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), `${oldGitignore}agent-x/agents/*/.env\n`);

	const files = () => [join(project.agent, ".pi", "settings.json"), join(project.agent, ".env"), join(agentX, ".env"), join(root, ".gitignore"), join(agentX, "agentx.json")].map((file) => readFileSync(file, "utf8"));
	const before = files();
	const second = run(root, project.env, "upgrade-project");
	assert.equal(second.status, 0, second.stderr);
	assert.match(second.stdout, /^Nothing to add: the files are up to date\.$/m);
	assert.deepEqual(files(), before);
});

test("upgrade-project looks a version up in the registry, and installs the latest, which brings the files up to its own templates", () => {
	const project = createAgent(1);
	const root = projectRoot(project);
	const offline = run(root, { ...project.env, PATH: "" }, "upgrade-project");
	assert.equal(offline.status, 1);
	assert.match(offline.stderr, /^pnpm view @cognisphere-sh\/agentx@latest version failed in .*agent-x: .*ENOENT/);

	// A stand-in pnpm: the registry's latest is 9.9.9, and adding it pins it, as pnpm add does. The project's agentx stays this checkout, linked in.
	const bin = mkdtempSync(join(tmpdir(), "agentx-pnpm-"));
	const log = join(bin, "calls");
	writeFileSync(
		join(bin, "pnpm"),
		`#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[0] === "view") console.log("9.9.9");
if (args[0] === "add") {
	const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	pkg.dependencies["@cognisphere-sh/agentx"] = "9.9.9";
	fs.writeFileSync("package.json", JSON.stringify(pkg));
}
`,
	);
	chmodSync(join(bin, "pnpm"), 0o755);
	rmSync(join(project.agent, ".env"));

	const result = run(root, { ...project.env, PATH: `${bin}${delimiter}${project.env.PATH}` }, "upgrade-project");
	assert.equal(result.status, 0, result.stderr);
	const { version } = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
	// Each copy prints its own lines.
	assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), [`Upgrading agentx ${version} to 9.9.9.`, "agentx 9.9.9 is the latest.", "agent-x/agents/main/.env: added COMPOSIO_API_KEY"].sort());
	// The second copy looked the latest up again, and installed nothing.
	assert.equal(readFileSync(log, "utf8"), "view @cognisphere-sh/agentx@latest version\nadd --save-exact @cognisphere-sh/agentx@9.9.9\nview @cognisphere-sh/agentx@latest version\n");
	assert.equal(JSON.parse(readFileSync(join(root, "agent-x", "package.json"), "utf8")).dependencies["@cognisphere-sh/agentx"], "9.9.9");
});

test("upgrade-agent upgrades one agent, named from the project's root, agent-x/ or agent-x/agents/", () => {
	const project = createAgent(1);
	const agents = join(projectRoot(project), "agent-x", "agents");
	editSettings(project.agent, ({ agentx: { timezone, ...agentx }, ...settings }) => ({ ...settings, agentx }));

	const result = run(agents, project.env, "upgrade-agent", "main");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "main/.pi/settings.json: added agentx.timezone\n");
	assert.equal(settingsOf(project.agent).agentx.timezone, null);

	const missing = run(agents, project.env, "upgrade-agent", "nobody");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /^The project has no agent "nobody"/);
});
