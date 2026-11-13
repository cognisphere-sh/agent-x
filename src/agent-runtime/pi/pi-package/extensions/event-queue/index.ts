// The event queue extension, loaded by Pi into every agent session: everything that happens to a queued event inside a session.
// It takes the thread's events off the queue, sends them into the session, records the session entry each one became, and settles them when the run ends.
// A session is a thread: its id is the thread id, and while it is open it holds the thread's lease, so no other process runs the same conversation.
// While the session is idle, queued events start a run. During a run, events that arrive are steered in at the end of a turn.
// It is the same under `agentx chat` and under `agentx run`, whose Pi runner only starts the Pi process of a thread that has events.
// The Pi runner's sessions are workers (--agentx-worker): nobody watches them, so a worker leaves when its thread has no work, and a run of its that is cut off gets another attempt.
// A one-shot run (`-p`, `--mode json`) holds its thread but takes nothing from the queue: it answers its own prompt.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Queue, workflowPrefix } from "../../../../events/queue.js";
import { eventIds, render } from "./render.js";

// How often an idle session looks for events, and every session checks that it still holds its thread. Pi has no event for "a queued event arrived"; a timer is how an extension waits.
const tickMs = 1000;
// How long after a send Pi may still be starting on it. Before the run starts Pi looks idle, and it can be waiting on another extension or a login refresh.
const graceMs = 60_000;

/** Connects a Pi session to the agent's event queue. */
export default function (pi: ExtensionAPI) {
	pi.registerFlag("agentx-worker", { description: "The session works its thread's queued events and ends when there are none left. Passed by agentx run.", type: "boolean", default: false });
	const isWorker = () => pi.getFlag("agentx-worker") === true;

	// Undefined while the session does not hold its thread, and after shutdown: then nothing is taken from the queue and no input is accepted.
	let queue: Queue | undefined;
	let threadId = "";
	let timer: NodeJS.Timeout | undefined;
	// When events were last taken for sending.
	let sentAt = 0;
	// How many of the session's entries were searched for delivered events. Entries from before this session started belong to earlier deliveries.
	let seen = 0;
	// Why the run failed, as Pi judged it; set at the end of each run.
	let failure: string | undefined;
	// The time zone for the time shown on events: `agentx.timezone` in the agent's .pi/settings.json, or the machine's when that is null or missing.
	let timeZone: string | undefined;

	// From then on the session takes nothing from the queue and no input.
	const letGo = () => {
		queue?.close();
		queue = undefined;
	};

	// Tells whoever runs the session: in its UI when it has one, on the error output otherwise.
	const say = (ctx: ExtensionContext, message: string) => (ctx.hasUI ? ctx.ui.notify(message, "error") : console.error(message));

	// A one-shot run (`-p`, `--mode json`) answers its own prompt and ends. Every other session stays open: a terminal, or RPC mode, in which agentx run starts Pi.
	const oneShot = (ctx: ExtensionContext) => ctx.mode === "print" || ctx.mode === "json";

	// A session that a person or a program keeps open takes the thread's events. A one-shot run ends with its prompt,
	// and a session that is not saved (--no-session) would leave no record of them.
	const takesEvents = (ctx: ExtensionContext) => queue !== undefined && !oneShot(ctx) && ctx.sessionManager.getSessionFile() !== undefined;

	// Pi starts no run without a model and a login. It would refuse the events and tell only its host, so ask Pi first: then the reason goes on the events.
	const cannotRun = async (ctx: ExtensionContext): Promise<string | undefined> => {
		// With no usable model set, Pi holds a placeholder for one from a provider it does not know.
		if (!ctx.model || !ctx.modelRegistry.getProvider(ctx.model.provider)) {
			return "No model selected. Set defaultProvider and defaultModel in the agent's .pi/settings.json, or choose a model in a terminal session.";
		}
		const login = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		return login.ok ? undefined : login.error;
	};

	// Takes events off the queue and sends them as one user message: to join the run in progress (`steer`), or to start one.
	// Pi does not tell an extension whether it accepted a send, so what happened shows later: the event gets a session entry, or it does not.
	const deliver = async (ctx: ExtensionContext, steer: boolean) => {
		const batch = queue?.claim(threadId, steer) ?? [];
		if (batch.length === 0) return;
		sentAt = Date.now();
		const refusal = steer ? undefined : await cannotRun(ctx);
		if (refusal !== undefined) queue?.fail(threadId, refusal);
		// "steer" joins a run in progress and starts one when Pi is idle.
		else pi.sendUserMessage(render(batch, timeZone), { deliverAs: "steer" });
	};

	// Two processes writing one session split the conversation in two, so a session that does not hold its thread takes no input.
	// Nor does a session on a workflow's thread, whose events run a script, never Pi.
	const refuse = (ctx: ExtensionContext) => {
		say(
			ctx,
			threadId.startsWith(workflowPrefix)
				? `Thread "${threadId}" is a workflow's: its events run a script, not Pi, so this session takes no input. Open another thread.`
				: `Thread "${threadId}" is running in another process, so this session takes no input. Open another thread, or try again when that run is over.`,
		);
		// A one-shot run that was refused ends as failed; Pi leaves an exit code that is already set.
		if (oneShot(ctx)) process.exitCode = 1;
		// A worker without its thread has nothing to do.
		if (isWorker()) ctx.shutdown();
	};

	// Whether the session still holds its thread, renewing the lease when it is due. A holder loses it only when it was paused or blocked for longer
	// than a lease lasts and another process took the thread. Then its run in progress stops at once, so two processes never write one conversation;
	// its events in flight are the new holder's to try again.
	const holds = (ctx: ExtensionContext): boolean => {
		if (!queue) return false;
		if (queue.renew(threadId)) return true;
		letGo();
		if (!ctx.isIdle()) ctx.abort();
		refuse(ctx);
		return false;
	};

	const tick = (ctx: ExtensionContext) => {
		let idle: boolean;
		try {
			idle = ctx.isIdle();
		} catch {
			// The session was closed without a shutdown event; its context throws from then on.
			clearInterval(timer);
			return;
		}
		try {
			if (!holds(ctx) || !queue || !idle || !takesEvents(ctx)) return;
			// Sent, not settled, and Pi is idle: the event is on its way in, or Pi did not take it, for example because another extension swallowed it.
			// After the grace it gets another attempt.
			if (queue.inFlight(threadId)) {
				if (Date.now() - sentAt < graceMs) return;
				queue.fail(threadId, "Pi did not take the event.");
			}
			// A worker leaves when its thread has no work; agentx run starts another when events arrive. From here on it takes nothing more.
			if (isWorker() && !queue.hasWork(threadId)) {
				clearInterval(timer);
				ctx.shutdown();
				return;
			}
			// Outside an event handler nothing reports a failure, such as a queue file that stayed locked; the next tick tries again.
			deliver(ctx, false).catch(() => {});
		} catch {
			// The same, for the steps above.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		threadId = ctx.sessionManager.getSessionId();
		seen = ctx.sessionManager.getEntries().length;
		timeZone = (pi.getSettings() as { agentx?: { timezone?: string | null } }).agentx?.timezone ?? undefined;
		try {
			new Intl.DateTimeFormat("en-US", { timeZone });
		} catch {
			// A zone that Node does not know would fail every delivery.
			say(ctx, `Unknown time zone "${timeZone}" in agentx.timezone of .pi/settings.json, so events show the machine's time. Use a name such as "Asia/Kolkata".`);
			timeZone = undefined;
		}
		// A workflow's events run a script, never Pi, also when Pi was given the thread's id itself.
		if (threadId.startsWith(workflowPrefix)) {
			if (!oneShot(ctx)) refuse(ctx);
			return;
		}
		queue = new Queue(ctx.cwd);
		if (!queue.acquire(threadId)) {
			letGo();
			// A session that stays open is told now, before any input. A one-shot run is told when its prompt is refused.
			if (!oneShot(ctx)) refuse(ctx);
			return;
		}
	});

	// The session takes events only once every extension has started: Pi sends this right after all `session_start` handlers have finished,
	// so one that awaits work there, such as registering an MCP server after a network call, is done before the first run. It adds no resources.
	pi.on("resources_discover", (_event, ctx) => {
		if (!queue || timer) return;
		timer = setInterval(tick, tickMs, ctx);
		// The timer must not keep a finished one-shot run alive.
		timer.unref();
	});

	pi.on("input", (_event, ctx) => {
		if (queue) return { action: "continue" };
		refuse(ctx);
		return { action: "handled" };
	});

	// Records which session entry each delivered event became. Pi saves a user message after its own events;
	// by the next model call, which this event precedes, it has its entry. The event's id is in its text.
	pi.on("context", (_event, ctx) => {
		// Before each model call: a session that resumed after losing its thread stops here, not at the next tick.
		if (!holds(ctx)) return;
		const entries = ctx.sessionManager.getEntries();
		for (const entry of entries.slice(seen)) {
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			const { content } = entry.message;
			const ids = eventIds(typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));
			if (ids.length > 0) queue?.delivered(threadId, ids, entry.id);
		}
		seen = entries.length;
	});

	// A steer sent here enters the run before the next model call, also after the last turn, which then is not the last.
	// Not when the run is being aborted: Pi would save the message and never show it to the model.
	pi.on("turn_end", async (event, ctx) => {
		if (!holds(ctx)) return;
		if (event.outcome === "completed" && !ctx.signal?.aborted && takesEvents(ctx)) await deliver(ctx, true);
	});

	// Not sent for an aborted run.
	pi.on("agent_before_settle", (event, ctx) => {
		const last = ctx.sessionManager.getLeafEntry();
		const reason = last?.type === "message" && last.message.role === "assistant" ? last.message.errorMessage : undefined;
		failure = event.outcome === "error" ? (reason ?? "The run failed.") : undefined;
	});

	// Settles the events of the run. One still on its way into Pi is settled by the run it starts or joins.
	pi.on("agent_settled", (event) => {
		// Nobody is there to abort a worker's run. What aborts it is Pi closing the session, when agentx run stops or dies or the process is told to end.
		if (event.aborted && isWorker()) queue?.fail(threadId, "The session was closed during the run.");
		else queue?.settle(threadId, event.aborted ? "cancelled" : failure === undefined ? "done" : { error: failure });
		failure = undefined;
	});

	pi.on("session_shutdown", () => {
		clearInterval(timer);
		queue?.release(threadId);
		letGo();
	});
}
