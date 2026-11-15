// Coordinator: the one always-running process of a project, which `agentx serve` starts. It runs every agent with an AgentManager, delivers events
// between agents from their outboxes, fires the agents' schedules, and answers the host's health checks over HTTP. With a person's `agentx event deliver`, which delivers as it does, it is the only way into an agent from outside it.

import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { agentIn, configFile, isAgentFolder, projectConfig } from "../agent-runtime/project-config.js";
import { centralStorage, ensureStorage, storageProblem } from "../agent-runtime/storage.js";
import { AgentManager } from "./agent-manager.js";
import { deliverOutbox } from "./delivery.js";
import { Scheduler } from "./scheduler.js";

// How often the agents' outboxes are taken and their schedules looked at.
const roundMs = 1000;

/** Runs the agents of the project's `agent-x/` directory and serves their health on `host`:`port`. */
export class Coordinator {
	readonly agents: AgentManager[];
	private readonly schedulers: Scheduler[];
	private readonly server: Server;
	private timer: NodeJS.Timeout | undefined;
	private stopping: Promise<void> | undefined;

	constructor(agentX: string) {
		// The agents agentx.json lists, found once, so adding one means starting agentx serve again. A folder it does not list is not run.
		const listed = Object.keys(projectConfig(agentX).agents).sort();
		const agentsDir = join(agentX, "agents");
		const folders = existsSync(agentsDir) ? readdirSync(agentsDir).filter((name) => isAgentFolder(join(agentsDir, name))) : [];
		for (const name of listed) if (!folders.includes(name)) console.error(`${configFile(agentX)} lists agent "${name}", which has no folder in agents/; it is not run.`);
		for (const name of folders) if (!listed.includes(name)) console.error(`agents/${name} is not listed in ${configFile(agentX)}; it is not run.`);
		const roots = listed.flatMap((name) => agentIn(agentX, name) ?? []).filter((root) => usesCentralStorage(root));
		this.agents = roots.map((root) => new AgentManager(root, centralStorage(root)));
		this.schedulers = roots.map((root) => new Scheduler(root, centralStorage(root)));
		this.server = createServer((request, response) => {
			const [status, body] = this.answer(request.method, request.url);
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		});
	}

	/** Starts the agents, delivery and the server; resolves to the address the server listens on. */
	async start(host: string, port: number): Promise<string> {
		for (const agent of this.agents) agent.start();
		this.timer = setInterval(() => {
			this.fireSchedules();
			this.deliver();
		}, roundMs);
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(port, host, resolve);
		});
		const address = this.server.address();
		return typeof address === "object" && address !== null ? `http://${host}:${address.port}` : String(address);
	}

	/**
	 * First call: every agent finishes its running work and stops. With `force`: they stop running work now. Resolves when all have stopped,
	 * their last events are delivered, and the server is closed; events that arrive meanwhile wait in the agents' inboxes.
	 */
	stop(force = false): Promise<void> {
		if (this.stopping !== undefined) {
			if (force) for (const agent of this.agents) void agent.stop(true);
			return this.stopping;
		}
		this.stopping = (async () => {
			await Promise.all(this.agents.map((agent) => agent.stop(force)));
			clearInterval(this.timer);
			this.deliver();
			await new Promise((resolve) => this.server.close(resolve));
		})();
		return this.stopping;
	}

	// Puts the events of the schedules that are due into their agents' inboxes. Not while the agents stop: they would wait for the next start.
	private fireSchedules(): void {
		for (const scheduler of this.schedulers) attempt(scheduler.agent, "its schedules could not be fired, and are tried again", () => scheduler.tick());
	}

	// One round of delivery. Delivery goes on while the agents drain, so what they send on the way out still arrives.
	private deliver(): void {
		for (const agent of this.agents) attempt(agent.agent, "its outbox could not be delivered, and is tried again", () => deliverOutbox(agent.root));
	}

	// `/health` says the coordinator runs; `/agents` says how each agent is, and is 503 unless every one runs, for a monitor that alerts a person.
	private answer(method: string | undefined, url: string | undefined): [number, unknown] {
		if (method !== "GET") return [405, { error: "Only GET." }];
		if (url === "/health") return [200, { ok: true }];
		if (url === "/agents") {
			const agents = this.agents.map((agent) => agent.status());
			return [agents.every((agent) => agent.state === "running") ? 200 : 503, { agents }];
		}
		return [404, { error: "Not found." }];
	}
}

// Makes the agent's storage when it is missing, and whether its storage/ is the central folder the coordinator reads. One that is a folder of its own
// is not run: the coordinator would never see its heartbeat or its outbox.
function usesCentralStorage(root: string): boolean {
	ensureStorage(root);
	const problem = storageProblem(root);
	if (problem !== undefined) console.error(`${problem} The agent is not run.`);
	return problem === undefined;
}

// One agent's part of a round. A failure is said, and the next round, a second later, tries again.
function attempt(agent: string, failed: string, work: () => void): void {
	try {
		work();
	} catch (error) {
		console.error(`${agent}: ${failed}: ${(error as Error).message}`);
	}
}
