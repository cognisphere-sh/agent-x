// An agent's Composio user id as the coordinator's services read it: from the agent's checked-in settings, never from what the agent writes.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The Composio user id of the agent in `agentRoot`, `agentx.composio.userId`; undefined when it has none or its settings cannot be read. */
export function composioUserId(agentRoot: string): string | undefined {
	try {
		const settings = JSON.parse(readFileSync(join(agentRoot, ".pi", "settings.json"), "utf8")) as { agentx?: { composio?: { userId?: unknown } } };
		const userId = settings.agentx?.composio?.userId;
		return typeof userId === "string" ? userId : undefined;
	} catch {
		return undefined;
	}
}
