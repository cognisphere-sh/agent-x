// The contracts of the code an agent writes for agentx: its event router and its workflows. The agent's code gets them with
// `import type { Router, Workflow } from "agent-x"`, or in a .mjs file with a JSDoc comment: `/** @type {import("agent-x").Router} */`.

/** An event as the router and workflows get it. */
export interface Event {
	id: string;
	/** Markdown. Files it names, under storage/attachments/, hold the rest. */
	content: string;
	/** Facts about the event, such as `source`. */
	metadata: Record<string, unknown>;
	/** When it was sent, in milliseconds since 1970. */
	createdAt: number;
}

/** What the router knows besides the event: the agent's workflows. */
export interface RouterContext {
	workflows: { name: string; description: string }[];
}

/** The router's answer: a thread of the agent, such as `main`, or `workflow.<name>` to run a workflow. */
export interface RouteResult {
	thread: string;
}

/** The default export of `storage/knowledge/event_router.mjs`. agentx calls it for every event without a thread. */
export type Router = (event: Event, ctx: RouterContext) => RouteResult | Promise<RouteResult>;

/** Where `ctx.send` sends an event. Without `threadId`, the receiving agent's router picks the thread. */
export interface SendOptions {
	/** Another agent of the project; this agent when left out. */
	agent?: string;
	threadId?: string;
	/** Sending again with the same key adds nothing. */
	key?: string;
	metadata?: Record<string, unknown>;
}

/** What a workflow knows besides its event. */
export interface WorkflowContext {
	/** The workflow's name. */
	workflow: string;
	/** Sends an event, with `source: workflow.<name>` and `agentX-WorkflowRun: <this event's id>` in its metadata; resolves to its id. */
	send(content: string, options?: SendOptions): Promise<string>;
}

/** The default export of a workflow's script. Returning means success, throwing means failure. The event's content is its parameters. */
export type Workflow = (event: Event, ctx: WorkflowContext) => void | Promise<void>;
