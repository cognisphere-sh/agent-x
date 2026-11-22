// Trims the answer of Composio's COMPOSIO_SEARCH_TOOLS before the model reads it: the guidance and details the harness's prompt makes needless,
// and the stubs of schemas the model loads with COMPOSIO_GET_TOOL_SCHEMAS when it needs them.
// It removes only fields it names, so a field Composio adds still reaches the model, and it leaves alone an answer that failed or does not parse.

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

// Each result's orders to follow Composio's plan step by step, and the ids of Composio's own cache of plans.
const resultNoise = ["execution_guidance", "plan_id", "cached_plan_usecase"];

/** The search answer `text` trimmed, or undefined when it is not a successful search answer, which then stays as it is. */
export function trimSearch(text: string): string | undefined {
	let answer: unknown;
	try {
		answer = JSON.parse(text);
	} catch {
		// Not JSON, such as an answer over Pi's output limit, which Pi cut in the middle.
		return undefined;
	}
	if (!isFields(answer) || answer.successful !== true || !isFields(answer.data)) return undefined;
	const data = { ...answer.data };

	const results = (Array.isArray(data.results) ? data.results : []).filter(isFields);
	const primary = new Set(results.flatMap((result) => (Array.isArray(result.primary_tool_slugs) ? result.primary_tool_slugs : [])));
	if (Array.isArray(data.results)) data.results = data.results.map((result) => (isFields(result) ? Object.fromEntries(Object.entries(result).filter(([field]) => !resultNoise.includes(field))) : result));
	// A stub names a tool without its input schema; the results still name the tool. A primary tool's stays: it is a tool the task needs.
	if (isFields(data.tool_schemas)) {
		data.tool_schemas = Object.fromEntries(Object.entries(data.tool_schemas).filter(([slug, schema]) => !(isFields(schema) && schema.hasFullSchema === false && !primary.has(slug))));
	}
	// The harness's prompt says a run needs no session id, so Composio's order to pass it in every call goes, and the id stays.
	if (isFields(data.session)) data.session = { id: data.session.id };
	// The time stays, since a message typed to the agent carries none; Composio's advice on using it goes.
	if (isFields(data.time_info)) data.time_info = { current_time_utc: data.time_info.current_time_utc };
	// With every service connected, that is all the model needs to know of the connections, and the next steps say only to go on. A service with
	// no account keeps both whole: they tell the model to connect it.
	const statuses = data.toolkit_connection_statuses;
	if (Array.isArray(statuses) && statuses.length > 0 && statuses.every((status) => isFields(status) && status.has_active_connection === true)) {
		data.toolkit_connection_statuses = statuses.map((status: Fields) => ({ toolkit: status.toolkit, has_active_connection: true }));
		delete data.next_steps_guidance;
	}
	return JSON.stringify({ ...answer, data });
}
