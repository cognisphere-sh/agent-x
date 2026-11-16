// The project's own services, which its developer writes in agent-x/services/<name>/index.ts, on the contract of agentx's (service.ts). The
// coordinator imports each one agentx.json lists into its own process; Node strips the file's types. A service is checked by its shape, not its class.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Route } from "./api-server.js";
import type { ServiceDefinition } from "./service.js";

/** The project's services: the folders of `agent-x/services/` that hold an `index.ts`, by name. */
export function projectServices(agentX: string): string[] {
	const dir = join(agentX, "services");
	return existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "index.ts"))).sort() : [];
}

/** Imports the project's service `name` and makes one with its default export, a class; throws why it cannot. */
export async function loadProjectService(agentX: string, name: string): Promise<ServiceDefinition> {
	const file = `services/${name}/index.ts`;
	const { default: Class } = await import(pathToFileURL(join(agentX, file)).href);
	if (typeof Class !== "function") throw new Error(`${file} has no default export class.`);
	const service = new Class() as ServiceDefinition;
	const problem = shapeProblem(service);
	if (problem !== undefined) throw new Error(`${file}: ${problem}`);
	return service;
}

// What is wrong with the service's shape, if anything. TypeScript is not checked when Node runs it.
function shapeProblem({ secrets, routes, onStart, onStop }: ServiceDefinition): string | undefined {
	if (secrets !== undefined && !(Array.isArray(secrets) && secrets.every((name) => typeof name === "string"))) return "secrets must be a list of variable names.";
	if (routes !== undefined && !(Array.isArray(routes) && routes.every(isRoute))) return 'each route needs a method, "GET" or "POST", a path, a summary and handle.';
	if (![onStart, onStop].every((hook) => hook === undefined || typeof hook === "function")) return "onStart and onStop must be methods.";
	return undefined;
}

const isRoute = (route: Route) =>
	(route?.method === "GET" || route?.method === "POST") && typeof route.path === "string" && typeof route.summary === "string" && typeof route.handle === "function";
