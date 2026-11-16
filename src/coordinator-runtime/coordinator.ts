// Coordinator: the one always-running process of a project, which `agentx serve` starts. It runs every agent with an AgentManager, and the services:
// the core ones, the relay that delivers between agents and the scheduler, the optional ones agentx.json turns on (services/), and the project's own
// in agent-x/services/, which agentx.json turns on too (project-services.ts). It owns the API server:
// its own routes, which control the agents, and each service's routes under /services/<name>/. With a person's `agentx event deliver`, it is the only
// way into an agent from outside it.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withEnvFile } from "../agent-runtime/agent-env.js";
import { agentIn, configFile, isAgentFolder, projectConfig } from "../agent-runtime/project-config.js";
import { centralStorage, ensureStorage, storageProblem } from "../agent-runtime/storage.js";
import { AgentManager } from "./agent-manager.js";
import { deliverTo } from "./deliver-event.js";
import { type ApiResponse, ApiServer, type Route } from "./api-server.js";
import { nameRule } from "../agent-runtime/events/queue.js";
import { loadProjectService, projectServices } from "./project-services.js";
import { ServiceRunner } from "./service-runner.js";
import { coreServices, optionalServices, type ServiceClass } from "./services/services.js";

/** Runs the agents and the services of the project's `agent-x/` directory, and serves on `host`:`port`. */
export class Coordinator {
	readonly agents: AgentManager[];
	// The services that start, chosen at start.
	private services: ServiceRunner[] = [];
	private readonly serviceConfig: Record<string, unknown>;
	private readonly publicUrl: string | undefined;
	private readonly api = new ApiServer();
	// Every route of the API, the coordinator's and the services', set at start.
	private routes: Route[] = [];
	private stopping: Promise<void> | undefined;

	/** `optional` is the optional services there are; a test gives its own. */
	constructor(
		private readonly agentX: string,
		private readonly optional: Record<string, ServiceClass> = optionalServices,
	) {
		const config = projectConfig(agentX);
		// The agents agentx.json lists, found once, so adding one means starting agentx serve again. A folder it does not list is not run.
		const listed = Object.keys(config.agents).sort();
		const agentsDir = join(agentX, "agents");
		const folders = existsSync(agentsDir) ? readdirSync(agentsDir).filter((name) => isAgentFolder(join(agentsDir, name))) : [];
		for (const name of listed) if (!folders.includes(name)) console.error(`${configFile(agentX)} lists agent "${name}", which has no folder in agents/; it is not run.`);
		for (const name of folders) if (!listed.includes(name)) console.error(`agents/${name} is not listed in ${configFile(agentX)}; it is not run.`);
		const roots = listed.flatMap((name) => agentIn(agentX, name) ?? []).filter((root) => usesCentralStorage(root));
		this.agents = roots.map((root) => new AgentManager(root, centralStorage(root)));

		const { services = {} } = config;
		this.serviceConfig = typeof services === "object" && services !== null && !Array.isArray(services) ? services : {};
		if (this.serviceConfig !== services) console.error(`${configFile(agentX)}: "services" must be an object; no optional service is on.`);
		this.publicUrl = typeof config.publicUrl === "string" ? config.publicUrl : undefined;
		if (config.publicUrl !== undefined && this.publicUrl === undefined) console.error(`${configFile(agentX)}: "publicUrl" must be a URL, as text; it is left out.`);
	}

	/** Starts the services, then the agents and the API server; resolves to the address it listens on. */
	async start(host: string, port: number): Promise<string> {
		this.services = await this.chooseServices();
		const available = withEnvFile(join(this.agentX, ".env.services"));
		const agents = this.agents.map(({ agent, root }) => ({ name: agent, root, storage: centralStorage(root) }));
		// One at a time, in order: the relay first, so that it stops last.
		for (const runner of this.services) {
			const secrets: Record<string, string> = {};
			const wanted = runner.service.secrets ?? [];
			for (const [key, value] of Object.entries(available)) if (value !== undefined && wanted.some((name) => isSecret(name, key))) secrets[key] = value;
			const config = this.serviceConfig[runner.name] ?? {};
			await runner.start({
				config,
				secrets,
				agents,
				publicUrl: this.publicUrl,
				stopping: () => this.stopping !== undefined,
				deliver: (agent, event, files = []) => deliverTo(this.agentX, agent, event, { facts: { "agentX-Service": runner.name }, files }),
			});
		}
		for (const agent of this.agents) agent.start();
		const serviceRoutes = this.services
			.filter((running) => running.on)
			.flatMap(({ name, service }) => (service.routes ?? []).map((route) => ({ ...route, path: `services/${name}/${route.path}` })));
		this.routes = [...this.ownRoutes(), ...serviceRoutes];
		const token = available.AGENTX_API_TOKEN || undefined;
		if (token === undefined) console.error("AGENTX_API_TOKEN is not set, in the environment or agent-x/.env.services: private routes answer 503.");
		return this.api.listen(host, port, this.routes, token);
	}

	// The core services, then the optional ones agentx.json lists, then the project's own it lists, each with its config there. A project's service
	// that cannot be loaded is off, alone.
	private async chooseServices(): Promise<ServiceRunner[]> {
		const builtIn = (name: string) => Object.hasOwn(coreServices, name) || Object.hasOwn(this.optional, name);
		const listed = (name: string) => Object.hasOwn(this.serviceConfig, name);
		const runners = [...Object.entries(coreServices), ...Object.entries(this.optional).filter(([name]) => listed(name))].map(([name, Class]) => new ServiceRunner(name, new Class()));
		const own = projectServices(this.agentX);
		for (const name of own) {
			if (builtIn(name)) console.error(`agent-x/services/${name} has the name of one of agentx's services; it is not run.`);
			else if (!nameRule.test(name)) console.error(`agent-x/services/${name}: a service's name has only letters, digits and dashes; it is not run.`);
			else if (!listed(name)) console.error(`agent-x/services/${name} is not listed under "services" in ${configFile(this.agentX)}; it is not run.`);
			else {
				try {
					runners.push(new ServiceRunner(name, await loadProjectService(this.agentX, name)));
				} catch (error) {
					console.error(`Service "${name}" is off: ${(error as Error).message}`);
				}
			}
		}
		for (const name of Object.keys(this.serviceConfig)) {
			if (!builtIn(name) && !own.includes(name)) console.error(`${configFile(this.agentX)} names service "${name}", which neither agentx nor agent-x/services/ has; it is skipped.`);
		}
		return runners;
	}

	/** The names of the services that started. */
	servicesOn(): string[] {
		return this.services.filter((running) => running.on).map((running) => running.name);
	}

	/**
	 * First call: every agent finishes its running work and stops, while the services go on. With `force`: they stop running work now. Then the
	 * services stop, the last started first, so the relay delivers what the agents sent on their way out; then the API server closes. Events that
	 * arrive meanwhile wait in the agents' inboxes.
	 */
	stop(force = false): Promise<void> {
		if (this.stopping !== undefined) {
			if (force) for (const agent of this.agents) void agent.stop(true);
			return this.stopping;
		}
		this.stopping = (async () => {
			await Promise.all(this.agents.map((agent) => agent.stop(force)));
			for (const runner of [...this.services].reverse()) await runner.stop();
			await this.api.close();
		})();
		return this.stopping;
	}

	// The coordinator's own routes: its health, open to the host's health check; the agents, which a person controls through the web app; and the list of every route.
	private ownRoutes(): Route[] {
		return [
			{ method: "GET", path: "health", access: "public", summary: "200 while agentx serve runs.", handle: () => ({ status: 200, body: { ok: true } }) },
			{ method: "GET", path: "agents", summary: "Each agent's state; 503 unless every agent is running or stopped.", handle: () => this.agentStates() },
			{ method: "POST", path: "agents/:agent/start", summary: "Starts a stopped or failed agent.", handle: ({ params }) => this.control(params.agent, (agent) => agent.start()) },
			{ method: "POST", path: "agents/:agent/stop", summary: "Stops an agent once its running work is done.", handle: ({ params }) => this.control(params.agent, (agent) => void agent.stop()) },
			{ method: "POST", path: "agents/:agent/restart", summary: "Stops an agent once its running work is done, then starts it.", handle: ({ params }) => this.control(params.agent, (agent) => agent.restart()) },
			{ method: "GET", path: "routes", summary: "Every route of the API.", handle: () => ({ status: 200, body: { routes: this.routes.map(describe) } }) },
		];
	}

	// For a monitor that alerts a person: an agent stopped on purpose is not a fault.
	private agentStates(): ApiResponse {
		const agents = this.agents.map((agent) => agent.status());
		return { status: agents.every((agent) => agent.state === "running" || agent.state === "stopped") ? 200 : 503, body: { agents } };
	}

	// Acts on the agent `name`, and answers with its state, at once: a stop goes on in the background, as the agent drains.
	private control(name: string, act: (agent: AgentManager) => void): ApiResponse {
		const agent = this.agents.find((manager) => manager.agent === name);
		if (agent === undefined) return { status: 404, body: { error: `This project runs no agent "${name}".` } };
		if (this.stopping !== undefined) return { status: 409, body: { error: "agentx serve is stopping." } };
		act(agent);
		return { status: 202, body: agent.status() };
	}
}

// Whether the variable `key` is the secret `name`, or starts with it when `name` ends with `*`.
const isSecret = (name: string, key: string) => (name.endsWith("*") ? key.startsWith(name.slice(0, -1)) : key === name);

// A route as `GET /routes` lists it.
const describe = ({ method, path, access = "private", summary }: Route) => ({ method, path: `/${path}`, access, summary });

// Makes the agent's storage when it is missing, and whether its storage/ is the central folder the coordinator reads. One that is a folder of its own
// is not run: the coordinator would never see its heartbeat or its outbox.
function usesCentralStorage(root: string): boolean {
	ensureStorage(root);
	const problem = storageProblem(root);
	if (problem !== undefined) console.error(`${problem} The agent is not run.`);
	return problem === undefined;
}
