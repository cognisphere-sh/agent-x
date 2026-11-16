// A coordinator service: a part of `agentx serve` besides running the agents, such as the relay between agents or the scheduler. Each one is set up in
// onStart, polls with `context.every`, declares its API in `routes`, served under /services/<name>/, and stops in onStop, after the agents have stopped.

import type { NewEvent } from "../agent-runtime/events/queue.js";
import type { Route } from "./api-server.js";

/** An agent the coordinator runs, as a service sees it. */
export interface ServiceAgent {
	name: string;
	/** Its directory. */
	root: string;
	/** Its storage folder, in the project's central storage. */
	storage: string;
}

/** What a service is given at start. */
export interface ServiceContext {
	/** Its config, `services.<name>` in agentx.json; `{}` when there is none. The service checks it. */
	config: unknown;
	/** The values of its own `secrets`, from the coordinator's environment or `agent-x/.env.services`; a missing one is left out. */
	secrets: Record<string, string>;
	/** The agents the coordinator runs. */
	agents: ServiceAgent[];
	/** The project's public address, `publicUrl` in agentx.json, for a service that tells an external service where to send. */
	publicUrl?: string;
	/** Whether the coordinator is stopping: the agents drain, and the services still run. */
	stopping(): boolean;
	/**
	 * Delivers `event` into the inbox of the agent `agent`, with `agentX-Service: <the service's name>`, so no sender can claim a service sent it, and
	 * returns its id. Its key is the service's own id for what it delivers, such as a webhook's delivery id, so the same one delivered again is one event.
	 * `files` are copied into the event's folder. Throws when the project has no such agent, or the event is refused.
	 */
	deliver(agent: string, event: NewEvent & { key: string }, files?: string[]): string;
	/** Runs `work` every `ms` until the service stops. Never two runs at once; a failure is logged, and the next run goes on. */
	every(ms: number, work: () => void | Promise<void>): void;
}

/**
 * The shape of every service: agentx's own and the project's, which its developer writes in `agent-x/services/<name>/index.ts` with
 * `export default class implements ServiceDefinition`. Each member may be left out.
 */
export interface ServiceDefinition {
	/** Environment variables it needs, from the coordinator's environment or `agent-x/.env.services`. A name that ends with `*` takes every variable that starts with it. */
	secrets?: string[];
	/** Its routes, below `/services/<name>/`, served while it is on. */
	routes?: Route[];
	/** Sets it up; a throw leaves it off. */
	onStart?(context: ServiceContext): void | Promise<void>;
	/** Runs after the agents have stopped and its polling has ended. */
	onStop?(): void | Promise<void>;
}

/** A part of the coordinator that ships with agentx, in a folder of its own under services/. Each hook may be left out. */
export abstract class Service implements ServiceDefinition {
	/** Environment variables it needs, such as a signing secret, from the coordinator's environment or `agent-x/.env.services`, which no agent reads. A name that ends with `*` takes every variable that starts with it. */
	readonly secrets: string[] = [];

	/** Its API contract: each route, with its path below `/services/<name>/`, who may call it, and its handler. Served only while the service is on. */
	readonly routes: Route[] = [];

	/** Sets the service up: checks its config and secrets, and starts its polling. A throw leaves it off; the coordinator goes on. */
	onStart(_context: ServiceContext): void | Promise<void> {}

	/** Runs after the agents have stopped and the service's polling has ended. */
	onStop(): void | Promise<void> {}
}

/** Runs `work` for each agent. A failure is logged for that agent, and the others go on. */
export function forEachAgent<Agent extends { name: string }>(agents: Agent[], failed: string, work: (agent: Agent) => void): void {
	for (const agent of agents) {
		try {
			work(agent);
		} catch (error) {
			console.error(`${agent.name}: ${failed}: ${(error as Error).message}`);
		}
	}
}
