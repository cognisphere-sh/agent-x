// Your event router. agentx asks it about every event that names no thread, after the agent's own router, storage/knowledge/event_router.mjs, when that one picks none.
// It gets the event, { id, content, metadata, createdAt }, and ctx, { workflows: [{ name, description }] }, and returns { thread }: a thread of the agent,
// such as "main", or "workflow.<name>" to run that workflow. Nothing passes the event on to main. Each call is a new process, so an edit applies to the next event.

/** @type {import("agent-x").Router} */
export default async function route(event, ctx) {
	return { thread: "main" };
}
