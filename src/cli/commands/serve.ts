// `agentx serve`: runs every agent of the project and the coordinator's services until it is stopped, and serves their health and the services over HTTP.

import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { Coordinator } from "../../coordinator-runtime/coordinator.js";
import { projectAgentX } from "../agent-root.js";
import { onStopSignals } from "../../agent-runtime/supervisor/stop-signals.js";

const usage = `usage: agentx serve [--host <host>] [--port <port>]
  --host <host>  where the server listens (default: 127.0.0.1)
  --port <port>  its port (default: 3100; 0 for any free one)`;

/** Runs the coordinator of the project whose root, agent-x/ or agent-x/agents/ is `cwd`. The first SIGINT or SIGTERM lets running work finish; the second stops it. */
export async function serve(cwd: string, args: string[]): Promise<void> {
	const { values } = parseArgs({ args, options: { host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "3100" } } });
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port takes a port number.\n${usage}`);
	const agentX = projectAgentX(cwd);
	const coordinator = new Coordinator(agentX);
	const done = new Promise<void>((resolve) => onStopSignals((force) => coordinator.stop(force).then(resolve)));
	const address = await coordinator.start(values.host, port);
	const names = coordinator.agents.map((agent) => agent.agent);
	console.log(
		`Serving ${names.length === 0 ? "no agents" : `agents ${names.join(", ")}`} of ${basename(join(agentX, ".."))} on ${address} (GET /routes lists the API), with services ${coordinator.servicesOn().join(", ")}. Ctrl-C lets running work finish; a second Ctrl-C stops it.`,
	);
	await done;
}
