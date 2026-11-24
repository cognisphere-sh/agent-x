// `agentx server setup|start|restart|stop|status|logs`: runs a project on an Ubuntu server. Its two processes, the agents (agentx serve) and the web app
// (next start), run as systemd user services, so they start at boot, restart after a crash and log to the journal; Caddy brings HTTPS to them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { projectConfig, publicUrl } from "../../agent-runtime/project-config.js";
import { Coordinator } from "../../coordinator-runtime/coordinator.js";
import { projectAgentX } from "../agent-root.js";
import { askSetup } from "../deploy/ask-setup.js";
import { runProjectScript } from "../deploy/project-scripts.js";
import { agentsUnit, serverDomain, servesDomain, unitNames, webUnit } from "../deploy/server-files.js";
import { caddyConfig, setUpServer } from "../deploy/server-setup.js";
import { run } from "../deploy/system.js";
import { buildWeb } from "../deploy/web-build.js";

const usage = `usage, on the server, in the project's root, agent-x/ or agent-x/agents/:
  agentx server setup      set this Ubuntu server up: DNS, Caddy with HTTPS for publicUrl, Chrome, the logins and keys, then deploy/setup.sh
  agentx server start      build the web app, then run it and the agents, and at every boot from now on
  agentx server restart    after a change: build the web app beside the running one, then start both again
  agentx server stop       stop both, the agents once their running work is done, and keep them stopped
  agentx server status     whether each runs, with its latest log lines
  agentx server logs [journalctl options]
                           follow both logs, such as with --since today`;

/** Runs `agentx server <action> ...` for the project whose root, agent-x/ or agent-x/agents/ is `cwd`. */
export async function server(cwd: string, args: string[]): Promise<void> {
	const [action, ...rest] = args;
	if (!["setup", "start", "restart", "stop", "status", "logs"].includes(action ?? "") || (action !== "logs" && rest.length > 0)) throw new Error(usage);
	if (process.platform !== "linux") throw new Error("agentx server runs on the project's Ubuntu server. On this machine, run the project with agentx dev.");
	if (process.getuid?.() === 0) throw new Error("Run agentx server as the user who runs the project, without sudo: it asks for the sudo password when it needs it.");
	const agentX = projectAgentX(cwd);
	const root = dirname(agentX);
	const { agents, web } = unitNames(root);
	if (action === "setup") await setUpServer(agentX);
	else if (action === "start" || action === "restart") await start(agentX, agents, web, action === "restart");
	else if (action === "stop") {
		console.log("Stopping the web app, and the agents once their running work is done (up to 10 minutes).");
		systemctl("disable", "--now", web, agents);
	} else if (action === "status") systemctl("status", "--no-pager", "--lines=20", web, agents);
	else run("journalctl", ["--user", `--unit=${web}`, `--unit=${agents}`, "--follow", "--lines=100", ...rest]);
}

// Builds the web app beside the running one, writes the units `agents` and `web` when they changed, and starts both, the agents again after a restart.
async function start(agentX: string, agents: string, web: string, restart: boolean): Promise<void> {
	const root = dirname(agentX);
	const domain = serverDomain(publicUrl(projectConfig(agentX)));
	if (domain === undefined || !(existsSync(caddyConfig) && servesDomain(readFileSync(caddyConfig, "utf8"), domain))) {
		throw new Error("Caddy does not serve publicUrl in agent-x/agentx.json: set it to https://<domain>, then run agentx server setup.");
	}
	await askSetup(agentX, new Coordinator(agentX));
	runProjectScript(root, "check");
	buildWeb(root);
	const folder = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user");
	mkdirSync(folder, { recursive: true });
	let changed = false;
	for (const [name, text] of [
		[agents, agentsUnit(root, process.execPath)],
		[web, webUnit(root, process.execPath)],
	]) {
		const file = join(folder, `${name}.service`);
		if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
		writeFileSync(file, text);
		changed = true;
	}
	if (changed) systemctl("daemon-reload");
	systemctl("enable", "--quiet", web, agents);
	// The web app starts again on its new build. Its downtime is next start's own start, not the build.
	systemctl("restart", web);
	if (restart) console.log("Restarting the agents once their running work is done (up to 10 minutes).");
	systemctl(restart ? "restart" : "start", agents);
	systemctl("status", "--no-pager", "--lines=5", web, agents);
}

// Runs `systemctl --user` with `args`. `status` fails when a unit is not running, which it shows itself.
function systemctl(...args: string[]): void {
	run("systemctl", ["--user", ...args], args[0] === "status");
}
