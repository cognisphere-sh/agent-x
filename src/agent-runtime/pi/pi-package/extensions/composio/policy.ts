// The policy of an agent's Composio sessions, the same for its threads (index.ts) and its workflows (functions/composio-tool.ts).
// Pi loads this file from source and the workflow host from dist/, so it imports nothing.

// agentx's defaults for a session's policy: the agent may ask a person to connect accounts but may not delete one, and gets no remote sandbox,
// because it has its own shell and workspace. No `toolkits`: Composio then allows every toolkit, and a new agent's template names a few.
const defaults = {
	manage_connections: { enable: true, enable_connection_removal: false },
	workbench: { enable: false },
};

/** The session policy: agentx's defaults, with what the agent's settings give in their place, key by key also inside an object, so `{ "manage_connections": { "enable": false } }` keeps the rest of that default; `"*"` in `toolkits.enable` enables every toolkit. */
export function policy(session: Record<string, unknown> = {}): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...defaults, ...session };
	for (const [name, value] of Object.entries(defaults)) {
		const given = session[name];
		if (typeof given === "object" && given !== null && !Array.isArray(given)) merged[name] = { ...value, ...given };
	}
	// Composio knows no "*"; it allows every toolkit when the policy has no `enable` list. The rest of `toolkits`, such as `disable`, still goes.
	const toolkits = { ...(session.toolkits as Record<string, unknown> | undefined) };
	if (Array.isArray(toolkits.enable) && toolkits.enable.includes("*")) {
		delete toolkits.enable;
		if (Object.keys(toolkits).length > 0) merged.toolkits = toolkits;
		else delete merged.toolkits;
	}
	return merged;
}
