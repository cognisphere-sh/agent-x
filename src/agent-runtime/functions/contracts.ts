// The contracts of the code an agent and its developer write for agentx, all .ts files that Node runs by stripping their types: event routers
// and workflows. The code gets them with `import type { Router, Workflow } from "agent-x"` (src/index.ts).

/** An event as the router and workflows get it. */
export interface Event {
	id: string;
	/** Markdown. When files came with it, its last line names them, and each is in its folder of the agent's inbox, `storage/workspace/inbox/<id>/`. */
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

/** The router's answer: a thread of the agent, such as `main`, `workflow.<name>` to run a workflow, or `pass` to drop the event. A router that returns nothing leaves the event to `main`. */
export interface RouteResult {
	thread: string;
}

/** The default export of the agent's event router, `.pi/knowledge/router/event_router.ts`, which agentx asks about every event without a thread. */
export type Router = (event: Event, ctx: RouterContext) => RouteResult | void | Promise<RouteResult | void>;

/** Where `ctx.send` sends an event. Without `threadId`, the receiving agent's router picks the thread. */
export interface SendOptions {
	/** Another agent of the project; this agent when left out. */
	agent?: string;
	threadId?: string;
	/** Sending again with the same key adds nothing. */
	key?: string;
	metadata?: Record<string, unknown>;
	/** Files that go with the event, by their paths from the agent directory. The content gets a line that names them, and the receiver finds them in the event's folder of its inbox. */
	files?: string[];
}

/** What a workflow knows besides its event. */
export interface WorkflowContext {
	/** The workflow's name. */
	workflow: string;
	/**
	 * Sends an event, with `source: workflow.<name>` in its metadata, through the agent's outbox; resolves to its id. The coordinator delivers it, also to this agent,
	 * and reports one it cannot deliver on the workflow's babysitter thread, which gets the answers too.
	 */
	send(content: string, options?: SendOptions): Promise<string>;
	/**
	 * Runs one Composio tool, such as `GMAIL_SEND_EMAIL`, with its arguments, as the agent: its connected accounts and the policy its threads get. Resolves to the tool's data;
	 * throws when Composio is not set up, or the tool fails or needs a person, such as an account to connect or an approval.
	 */
	composio(tool: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The default export of a workflow's script. Returning means success, throwing means failure. The event's content and metadata are its parameters. */
export type Workflow = (event: Event, ctx: WorkflowContext) => void | Promise<void>;
