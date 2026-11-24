// Tests of `agentx dev`, which runs a project on a laptop, and of what it asks for: the services' secrets, the agents' keys and model logins. A fake
// ngrok on the PATH and a stand-in `next` in the project's web/ take the places of the real ones. `agentx dev` listens on agentx serve's port, 3100.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { modelProvider } from "../dist/agent-runtime/pi/model-login.js";
import { Coordinator } from "../dist/coordinator-runtime/coordinator.js";
import { Service } from "../dist/coordinator-runtime/service.js";
import { addAgent, alive, background, createAgent, editSettings, projectRoot, stub, until } from "./project.mjs";

test("the secrets a project lacks are those the services that start need and do not mark optional, one per agent the service lists", async (t) => {
	t.mock.method(console, "error", () => {});
	const agentX = mkdtempSync(join(tmpdir(), "agentx-secrets-"));
	writeFileSync(join(agentX, "agentx.json"), JSON.stringify({ agents: {}, services: { probe: { agents: { "my-agent": {}, b: {} } }, other: {} } }));
	class Probe extends Service {
		secrets = ["PROBE_KEY", "PROBE_URL?", "PROBE_TOKEN_*"];
	}
	class Other extends Service {
		secrets = ["OTHER_KEY"];
	}
	// `unlisted` is not in agentx.json, so it does not start, and needs nothing.
	const needed = await new Coordinator(agentX, { probe: Probe, other: Other, unlisted: Other }).secretsNeeded();
	assert.deepEqual(
		needed.map(({ service, variable }) => `${service}: ${variable}`),
		["probe: PROBE_KEY", "probe: PROBE_TOKEN_MY_AGENT", "probe: PROBE_TOKEN_B", "other: OTHER_KEY"],
	);
});

test("an agent's model provider is its defaultProvider, else the project's; a settings file that is not JSON names none", () => {
	const agentX = mkdtempSync(join(tmpdir(), "agentx-provider-"));
	const agent = join(agentX, "agents", "main");
	mkdirSync(join(agent, ".pi"), { recursive: true });
	mkdirSync(join(agentX, ".pi"));
	writeFileSync(join(agentX, ".pi", "settings.json"), JSON.stringify({ defaultProvider: "anthropic" }));
	assert.equal(modelProvider(agent), "anthropic");
	writeFileSync(join(agent, ".pi", "settings.json"), JSON.stringify({ defaultProvider: "openai" }));
	assert.equal(modelProvider(agent), "openai");
	writeFileSync(join(agent, ".pi", "settings.json"), "{ not json");
	assert.equal(modelProvider(agent), "anthropic");
});

// Whether agentx serve's port, which agentx dev listens on, is free on this machine: not while another agentx serve runs.
const portFree = () =>
	new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(3100, "127.0.0.1", () => server.close(() => resolve(true)));
	});

// The body of a stand-in that writes its pid to `pidFile`, prints `lines`, and stays until it is stopped.
const staying = (pidFile, lines) => `echo $$ > "${pidFile}"\n${lines.map((line) => `echo '${line}'`).join("\n")}\ntrap 'exit 0' INT TERM\nwhile :; do sleep 1; done`;

// A folder on the PATH with a stand-in `ngrok`, which writes its pid to ngrok.pid and logs `log` as the real one does with --log=stdout, then stays.
function fakeNgrok(log) {
	const bin = mkdtempSync(join(tmpdir(), "agentx-bin-"));
	stub(join(bin, "ngrok"), staying(join(bin, "ngrok.pid"), log));
	return bin;
}

// The project's web/ with a stand-in `next`, which says it ran as next dev and writes its pid to next.pid, then stays.
function fakeNext(root) {
	const bin = join(root, "web", "node_modules", ".bin");
	mkdirSync(bin, { recursive: true });
	stub(join(bin, "next"), staying(join(root, "next.pid"), ["next dev"]));
}

test("agentx dev opens a tunnel, lists what is missing without a terminal, makes the API token, runs the project's check, the agents and next dev, and Ctrl-C stops them all", async (t) => {
	if (!(await portFree())) return t.skip("port 3100 is in use, as by another agentx serve");
	const project = createAgent(9);
	const root = projectRoot(project);
	// An agent whose provider has no login.
	editSettings(addAgent(project, "b"), (settings) => ({ ...settings, defaultProvider: "openai" }));
	mkdirSync(join(root, "deploy"), { recursive: true });
	writeFileSync(join(root, "deploy", "check.sh"), 'echo "check ran in $PWD"');
	fakeNext(root);
	const bin = fakeNgrok(['t=now lvl=info msg="started tunnel" obj=tunnels name=command_line addr=http://localhost:3100 url=https://dev-tunnel.ngrok.app']);

	const dev = background(root, { ...project.env, PATH: `${bin}${delimiter}${project.env.PATH}` }, ["dev"]);
	t.after(() => alive(dev.child.pid) && process.kill(-dev.child.pid, "SIGKILL"));
	await until(() => dev.output().includes("next dev"), 30_000);
	const output = dev.output();
	assert.match(output, /Tunnel: https:\/\/dev-tunnel\.ngrok\.app -> http:\/\/127\.0\.0\.1:3100\./);
	assert.match(output, /Made AGENTX_API_TOKEN/);
	assert.match(readFileSync(join(root, "agent-x", ".env"), "utf8"), /^AGENTX_API_TOKEN=[0-9a-f]{64}$/m);
	assert.match(output, /COMPOSIO_API_KEY is not set in agent-x\/agents\/main\/\.env: Composio's scoped key/);
	assert.match(output, /Agent "b" has no openai login, so it cannot think\. Log in with: cd agent-x\/agents\/b && agentx chat auth login openai/);
	assert.doesNotMatch(output, /Agent "main" has no/);
	assert.match(output, new RegExp(`check ran in .*${root.split("/").pop()}$`, "m"));
	assert.match(output, /Agents b, main on http:\/\/127\.0\.0\.1:3100, with services relay, scheduler\./);
	assert.equal((await fetch("http://127.0.0.1:3100/health")).status, 200);

	// As a terminal's Ctrl-C does: the whole group.
	process.kill(-dev.child.pid, "SIGINT");
	assert.equal(await dev.exited, 0);
	await until(() => !alive(Number(readFileSync(join(bin, "ngrok.pid"), "utf8"))) && !alive(Number(readFileSync(join(root, "next.pid"), "utf8"))));
});

test("agentx dev goes on without a tunnel when ngrok stops, and a failing deploy/check.sh stops it before anything starts", async (t) => {
	const project = createAgent(9);
	const root = projectRoot(project);
	mkdirSync(join(root, "deploy"), { recursive: true });
	writeFileSync(join(root, "deploy", "check.sh"), 'echo "MY_KEY is missing" >&2; exit 3');
	const bin = mkdtempSync(join(tmpdir(), "agentx-bin-"));
	stub(join(bin, "ngrok"), `echo 't=now lvl=eror msg="failed to start tunnel" err="authentication failed"'\nexit 1`);

	const dev = background(root, { ...project.env, PATH: `${bin}${delimiter}${project.env.PATH}` }, ["dev"]);
	t.after(() => alive(dev.child.pid) && process.kill(-dev.child.pid, "SIGKILL"));
	assert.equal(await dev.exited, 1);
	assert.match(dev.output(), /No tunnel, so outside services cannot reach the agents.*ngrok stopped:\n.*authentication failed/s);
	assert.match(dev.output(), /MY_KEY is missing\ndeploy\/check\.sh failed with status 3\./);
	assert.doesNotMatch(dev.output(), /Agents main on/);
});
