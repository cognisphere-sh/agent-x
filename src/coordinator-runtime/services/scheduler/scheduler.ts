// The scheduler, a core service: events an agent gets at the times a cron pattern names. They are listed in the developer's .pi/schedules.json and in the agent's own
// storage/knowledge/schedules.json; on a name in both, the agent's wins, so the agent can change or stop one of its developer's. The coordinator looks at them
// each second and reads a file again only when it changed, so an edit applies within a second. Polled, not watched: file watching misses changes on mounted and linked folders.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Cron } from "croner";
import { checkEvent, nameRule, type NewEvent, withoutBlockTag, workflowPrefix } from "../../../agent-runtime/events/queue.js";
import { deliverEvent } from "../../deliver-event.js";
import { forEachAgent, Service, type ServiceContext } from "../../service.js";

// A fire due longer ago than this was missed, as while agentx serve was down. Fires are looked for each second, so one on time is well within it.
const lateMs = 60_000;

// When a file last changed; 0 when it is missing.
const changedAt = (file: string) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;

// One schedule, checked.
interface Schedule {
	// The file that lists it, for a report.
	file: string;
	cron: Cron;
	event: NewEvent;
	isActive: boolean;
	fireOnce: boolean;
	catchUp: boolean;
	// The entry as written: a changed entry is a new schedule.
	entry: string;
}

// What the coordinator keeps of a schedule, in storage/schedule-state.json, so that starting again neither repeats a fire nor forgets one.
interface State {
	entry: string;
	// The time up to which fires have been dealt with.
	until: number;
	// A fireOnce schedule that fired, or whose one fire was missed.
	done?: boolean;
}

/** The scheduler: fires every agent's schedules that are due, each second. Not while the coordinator stops: a fire due then is dealt with at the next start, as one due while it was down. */
export class SchedulerService extends Service {
	override onStart(context: ServiceContext): void {
		const agents = context.agents.map((agent) => ({ name: agent.name, scheduler: new Scheduler(agent.root, agent.storage) }));
		context.every(1000, () => {
			if (!context.stopping()) forEachAgent(agents, "its schedules could not be fired, and are tried again", ({ scheduler }) => scheduler.tick());
		});
	}
}

/** The schedules of the agent in `agentRoot`, fired into its inbox. */
export class Scheduler {
	readonly agent: string;
	// The agent's own list of schedules, then the developer's.
	private readonly lists: string[];
	// The agent's settings, which hold the time zone the patterns are in.
	private readonly settings: string;
	private readonly stateFile: string;
	// When each file was last changed, as last read; a missing file is 0.
	private readonly seen = new Map<string, number>();
	private schedules = new Map<string, Schedule>();
	private state: Record<string, State> | undefined;

	constructor(
		private readonly agentRoot: string,
		/** The agent's storage folder: its own schedules, and what was fired. */
		storage: string,
	) {
		this.agent = basename(agentRoot);
		this.lists = [join(storage, "knowledge", "schedules.json"), join(agentRoot, ".pi", "schedules.json")];
		this.settings = join(agentRoot, ".pi", "settings.json");
		this.stateFile = join(storage, "schedule-state.json");
	}

	/** Fires the schedules that are due at `now`. Throws on a file that cannot be written; what was not done is done on the next call. */
	tick(now = Date.now()): void {
		this.state ??= existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as Record<string, State>) : {};
		if ([...this.lists, this.settings].some((file) => changedAt(file) !== this.seen.get(file))) this.load();
		let changed = false;
		for (const [name, schedule] of this.schedules) {
			let state = this.state[name];
			// A new or changed schedule counts from now: nothing before it was missed.
			if (state?.entry !== schedule.entry) {
				state = this.state[name] = { entry: schedule.entry, until: now };
				changed = true;
			}
			if (state.done || !schedule.isActive) continue;
			const due = schedule.cron.nextRun(new Date(state.until))?.getTime();
			if (due === undefined || due > now) continue;
			// Fires missed while the coordinator was down become one late fire with catchUp, and none without it.
			if (now - due <= lateMs || schedule.catchUp) this.fire(name, schedule, due);
			state.until = now;
			if (schedule.fireOnce) state.done = true;
			changed = true;
		}
		if (changed) writeFileSync(this.stateFile, JSON.stringify(this.state));
	}

	// Reads the schedule files again. A broken entry is left out and reported on the agent's main thread.
	private load(): void {
		for (const file of [...this.lists, this.settings]) this.seen.set(file, changedAt(file));
		const timeZone = this.timeZone();
		const schedules = new Map<string, Schedule>();
		for (const file of this.lists) {
			if (!existsSync(file)) continue;
			let entries: unknown;
			try {
				entries = JSON.parse(readFileSync(file, "utf8"));
			} catch (error) {
				this.report(file, "", `${(error as Error).message}. Its schedules are skipped.`);
				continue;
			}
			for (const [name, entry] of Object.entries(entries ?? {})) {
				const checked = check(file, name, entry, timeZone);
				if (typeof checked === "string") this.report(file, name, `schedule "${name}" is skipped: ${checked}`);
				else if (schedules.has(name)) console.error(`${this.agent}: ${file}: schedule "${name}" is skipped: storage/knowledge/schedules.json has one of that name, which is used.`);
				else schedules.set(name, checked);
			}
		}
		this.schedules = schedules;
	}

	// The agent's time zone, `agentx.timezone` in its settings; the machine's when it names none or one that does not exist.
	private timeZone(): string | undefined {
		try {
			const timeZone = (JSON.parse(readFileSync(this.settings, "utf8")) as { agentx?: { timezone?: unknown } }).agentx?.timezone;
			if (typeof timeZone !== "string") return undefined;
			new Intl.DateTimeFormat("en", { timeZone });
			return timeZone;
		} catch {
			return undefined;
		}
	}

	// The event of the fire due at `due`. Its key holds the time, so a fire put twice, as after a crash, is one event; it is sent at the time it was due.
	// A fire the agent refuses, such as one for a workflow it does not have, is reported instead, so that it holds up no other schedule.
	private fire(name: string, schedule: Schedule, due: number): void {
		try {
			deliverEvent(this.agentRoot, { ...schedule.event, key: `schedule:${name}:${due}` }, { facts: { "agentX-Schedule": name }, sentAt: due });
		} catch (error) {
			this.report(schedule.file, name, `schedule "${name}" did not fire: ${(error as Error).message}`);
		}
	}

	// Tells the agent's main thread, once for each problem: its key names the problem.
	private report(file: string, name: string, why: string): void {
		const content = withoutBlockTag(`${file}: ${why}`);
		console.error(`${this.agent}: ${content}`);
		deliverEvent(this.agentRoot, { threadId: "main", content, key: `schedule-error:${name}:${why}`.slice(0, 200), metadata: { source: "schedule" } });
	}
}

// The entry of `file` as a schedule, or what is wrong with it.
function check(file: string, name: string, entry: unknown, timeZone: string | undefined): Schedule | string {
	if (!nameRule.test(name)) return "a name has only letters, digits and dashes.";
	const { cron, content, threadId, metadata, isSilent = false, isActive = true, fireOnce = false, catchUp = false } = (entry ?? {}) as Record<string, unknown>;
	if (typeof cron !== "string") return "it needs a cron pattern, such as \"0 9 * * 1-5\".";
	// A workflow can take its parameters from metadata alone, so its schedule needs no content.
	const text = content ?? (typeof threadId === "string" && threadId.startsWith(workflowPrefix) ? "" : undefined);
	if (typeof text !== "string") return "it needs content, the text of its event, unless it runs a workflow.";
	for (const [key, value] of Object.entries({ isSilent, isActive, fireOnce, catchUp })) if (typeof value !== "boolean") return `${key} must be true or false.`;
	if (metadata !== undefined && (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))) return "metadata must be an object.";
	const event: NewEvent = { threadId: threadId as string | undefined, content: text, metadata: { ...(metadata as Record<string, unknown>), source: "schedule" }, isSilent: isSilent as boolean };
	try {
		checkEvent(event);
		return { file, cron: new Cron(cron, { timezone: timeZone, paused: true }), event, isActive: isActive as boolean, fireOnce: fireOnce as boolean, catchUp: catchUp as boolean, entry: JSON.stringify(entry) };
	} catch (error) {
		return (error as Error).message;
	}
}
