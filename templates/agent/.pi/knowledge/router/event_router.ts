// The agent's event router, which its developer and the agent both edit. agentx asks it about every event that names no thread.
// It gets the event, { id, content, metadata, createdAt }, and ctx, { workflows: [{ name, description }] }, and returns { thread }: a thread of the agent,
// such as "main", "workflow.<name>" to run that workflow, or "pass" to drop the event. Nothing leaves the event to main. Each call is a new process, so an edit applies to the next event.

import type { Router } from "@cognisphere-sh/agentx";

const route: Router = async (event, ctx) => {
	return { thread: "main" };
};

export default route;
