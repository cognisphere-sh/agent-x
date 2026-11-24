// Tests of what agentx server writes and builds, which run on any machine: the domain it takes from publicUrl, Caddy's config, the systemd units, and
// the web app's builds beside the running one, with a stand-in `next`. The commands that change the server itself run only on an Ubuntu server.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentsUnit, caddyfile, serverDomain, unitNames, webUnit } from "../dist/cli/deploy/server-files.js";
import { buildWeb } from "../dist/cli/deploy/web-build.js";
import { cli, createAgent, projectRoot, stub } from "./project.mjs";

test("a server's domain is publicUrl's host, when publicUrl is https with no port, path or query", () => {
	assert.equal(serverDomain("https://agents.example.com"), "agents.example.com");
	assert.equal(serverDomain("https://agents.example.com/"), "agents.example.com");
	for (const url of ["http://agents.example.com", "https://agents.example.com:8443", "https://agents.example.com/x", "https://agents.example.com/?a=1", "not a url", undefined, 3]) {
		assert.equal(serverDomain(url), undefined, String(url));
	}
});

test("Caddy sends /services/* to agentx serve and the rest to the web app; the units run the pinned agentx serve, draining on a stop, and next start on the named build", () => {
	const root = "/home/deploy/my project";
	assert.deepEqual(unitNames(root), { agents: "my-project-agents", web: "my-project-web" });
	const caddy = caddyfile(root, "agents.example.com");
	assert.match(caddy, /\nagents\.example\.com \{\n\t# .*\n\thandle \/services\/\* \{\n\t\treverse_proxy 127\.0\.0\.1:3100\n\t\}\n\t# The web app\.\n\thandle \{\n\t\treverse_proxy 127\.0\.0\.1:3000\n/);
	assert.match(caddy, /acme_ca https:\/\/acme-v02\.api\.letsencrypt\.org\/directory/);

	const agents = agentsUnit(root, "/usr/bin/node");
	assert.match(agents, /^WorkingDirectory=\/home\/deploy\/my project$/m);
	assert.match(agents, /^ExecStart="\/usr\/bin\/node" "\/home\/deploy\/my project\/agent-x\/node_modules\/agent-x\/dist\/cli\/agentx\.js" serve$/m);
	assert.match(agents, /^KillMode=mixed$/m);
	assert.match(agents, /^TimeoutStopSec=600$/m);
	assert.match(agents, /^Restart=on-failure$/m);
	assert.match(agents, /^Environment="PATH=\/usr\/bin:/m);
	assert.match(agents, /^WantedBy=default\.target$/m);

	const web = webUnit(root, "/usr/bin/node");
	assert.match(web, /^WorkingDirectory=\/home\/deploy\/my project\/web$/m);
	assert.match(web, /^ExecStart="\/home\/deploy\/my project\/web\/node_modules\/\.bin\/next" start --port 3000 --hostname 127\.0\.0\.1$/m);
	assert.match(web, /^EnvironmentFile=\/home\/deploy\/my project\/web\/\.agentx-web\.env$/m);
	assert.doesNotMatch(web, /KillMode/);
});

test("the web app builds into .next-a and .next-b in turn, beside the build it serves, and a build that is not where it was asked fails", (t) => {
	t.mock.method(console, "log", () => {});
	const root = mkdtempSync(join(tmpdir(), "agentx-web-"));
	const bin = join(root, "web", "node_modules", ".bin");
	mkdirSync(bin, { recursive: true });
	// A stand-in for next build, which writes into the folder next.config.ts takes from AGENTX_WEB_DIST_DIR.
	const next = (body) => stub(join(bin, "next"), body);
	next('mkdir -p "$AGENTX_WEB_DIST_DIR" && echo built > "$AGENTX_WEB_DIST_DIR/BUILD_ID"');
	const serving = () => readFileSync(join(root, "web", ".agentx-web.env"), "utf8");
	assert.equal(buildWeb(root), ".next-a");
	assert.equal(serving(), "AGENTX_WEB_DIST_DIR=.next-a\n");
	assert.equal(buildWeb(root), ".next-b");
	assert.equal(buildWeb(root), ".next-a");
	assert.ok(existsSync(join(root, "web", ".next-b", "BUILD_ID")));

	// A next.config.ts that ignores the variable builds into .next, so the build the app serves stays named, though .next-b holds an earlier build.
	const earlier = new Date(Date.now() - 60_000);
	utimesSync(join(root, "web", ".next-b", "BUILD_ID"), earlier, earlier);
	next("mkdir -p .next && echo built > .next/BUILD_ID");
	assert.throws(() => buildWeb(root), /web\/next\.config\.ts must set distDir: process\.env\.AGENTX_WEB_DIST_DIR \?\? "\.next"/);
	next("exit 1");
	assert.throws(() => buildWeb(root), /The web app's build failed: the running app keeps its build/);
	assert.equal(serving(), "AGENTX_WEB_DIST_DIR=.next-a\n");
});

test("a new project has the deploy scripts' stubs, runs agentx dev with pnpm dev, and its web app builds where agentx server says", () => {
	const root = projectRoot(createAgent(9));
	for (const script of ["check.sh", "setup.sh"]) assert.match(readFileSync(join(root, "deploy", script), "utf8"), /^#!\/usr\/bin\/env bash\n(#.*\n)+$/);
	assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.dev, "node agent-x/node_modules/agent-x/dist/cli/agentx.js dev");
	assert.match(readFileSync(join(root, "web", "next.config.ts"), "utf8"), /distDir: process\.env\.AGENTX_WEB_DIST_DIR \?\? "\.next"/);
	assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^web\/\.next-a\/\nweb\/\.next-b\/\nweb\/\.agentx-web\.env$/m);
});

test("agentx server runs only on Linux, and not as root", { skip: process.platform === "linux" }, () => {
	const root = projectRoot(createAgent(9));
	const result = spawnSync(process.execPath, [cli, "server", "start"], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /agentx server runs on the project's Ubuntu server\. On this machine, run the project with agentx dev\./);
	assert.match(spawnSync(process.execPath, [cli, "server", "go"], { cwd: root, encoding: "utf8" }).stderr, /^usage, on the server/);
});
