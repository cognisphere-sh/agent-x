// `agentx dev`: runs a project on a laptop. It asks for what the project lacks, runs its deploy/check.sh, opens an ngrok tunnel so outside services
// reach the agents, and runs the agents, as agentx serve does, and the web app, with next dev. The first Ctrl-C lets running work finish.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { publicUrlVariable } from "../../agent-runtime/project-config.js";
import { onStopSignals } from "../../agent-runtime/supervisor/stop-signals.js";
import { Coordinator } from "../../coordinator-runtime/coordinator.js";
import { projectAgentX } from "../agent-root.js";
import { askSetup } from "../deploy/ask-setup.js";
import { agentsPort } from "../deploy/ports.js";
import { runProjectScript } from "../deploy/project-scripts.js";
import { openTunnel } from "../deploy/tunnel.js";
import { nextCli } from "../deploy/web-build.js";

/** Runs the project whose root, agent-x/ or agent-x/agents/ is `cwd` until it is stopped. */
export async function dev(cwd: string): Promise<void> {
	const agentX = projectAgentX(cwd);
	const root = dirname(agentX);
	const children: ChildProcess[] = [];
	// However this process ends, the tunnel and the web app end with it.
	process.on("exit", () => {
		for (const child of children) child.kill();
	});

	const tunnel = await openTunnel(agentsPort);
	if (typeof tunnel === "string") console.error(`No tunnel, so outside services cannot reach the agents, and the services that need an address are off. ${tunnel}`);
	else children.push(tunnel.ngrok);
	// The tunnel's address is the project's for this run, in the agents' processes too; publicUrl in agentx.json is the server's.
	process.env[publicUrlVariable] = typeof tunnel === "string" ? "" : tunnel.url;

	const coordinator = new Coordinator(agentX);
	await askSetup(agentX, coordinator);
	runProjectScript(root, "check");

	const done = new Promise<void>((resolve) => onStopSignals((force) => coordinator.stop(force).then(resolve)));
	const address = await coordinator.start("127.0.0.1", agentsPort);
	const names = coordinator.agents.map((agent) => agent.agent);
	console.log(`Agents ${names.length === 0 ? "none" : names.join(", ")} on ${address}, with services ${coordinator.servicesOn().join(", ")}.`);
	if (typeof tunnel !== "string") console.log(`Tunnel: ${tunnel.url} -> ${address}. Telegram's bots, if any, now send here: use bots of their own on this machine, never the server's.`);

	const next = nextCli(root);
	if (existsSync(next)) children.push(spawn(next, ["dev"], { cwd: join(root, "web"), stdio: "inherit" }));
	else console.error("web/ is not installed, so the web app does not run: run pnpm install in the project's root.");
	console.log("Ctrl-C lets running work finish; a second Ctrl-C stops it.");
	await done;
	for (const child of children) child.kill();
}
