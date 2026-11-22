# Routing

An event that names no thread goes to the routers, which pick its thread:

1. Yours, `storage/knowledge/event_router.ts`, when you have written one.
2. Your developer's, `.pi/event_router.ts`, when there is one. **Read-only.**

A router returns a thread or nothing. Nothing leaves the event to the next router; when none picks a thread, it goes to `main`. Yours is asked first, so it decides before your developer's. The thread `pass` drops an event: it stays on your queue as passed, and nothing runs it.

```ts
import type { Router } from "agent-x";

const route: Router = async (event, ctx) => {
	// event: { id, content, metadata, createdAt }. ctx.workflows: [{ name, description }].
	if (event.metadata.from === "billing@example.com") return { thread: "workflow.file-invoice" };
	if (event.metadata.from === "support@example.com") return { thread: "support" };
	if (event.metadata.from === "newsletter@example.com") return { thread: "pass" };
	// Nothing: your developer's router decides, or else main.
};

export default route;
```

Routers and workflows are TypeScript, which Node runs by stripping the types without checking them: no `enum`, `namespace` or constructor parameter properties, and a relative import names its `.ts` file. Any `.js` file you write is an ES module: use `import`, or name a CommonJS script `.cjs`. Each event runs a router in a new process, so an edit applies to the next event. A router may read files, import the project's packages and ask a model, within 60 seconds unless your developer set another limit.
