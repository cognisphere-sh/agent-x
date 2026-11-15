// The event queue of one agent: a SQLite file in the agent's storage/. Only its router loop adds events; the processes that run its threads take and settle them.
// Loaded twice: compiled, by the CLI and `agentx run`, and from source, by the event queue extension in pi/pi-package, which Pi loads as source. The two copies share only the file.

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** What a sender puts on the queue. */
export interface NewEvent {
	/** The thread the event belongs to: the id of the Pi session that receives it, or `workflow.<name>`. Without one, the agent's router picks it. */
	threadId?: string;
	content: string;
	/** Facts for the model about the event, shown to it one per line. */
	metadata?: Record<string, unknown>;
	/** Adding an event whose key is already on the queue adds nothing, so a sender can repeat itself safely. */
	key?: string;
	/** Never enters a run that is in progress; waits for the next one. */
	doNotSteer?: boolean;
	/** Never starts a run; goes along with the next event that does. */
	isSilent?: boolean;
}

/** `queued`: waiting. `in_flight`: taken by the session or the workflow that runs the thread. The others are final. */
export type Status = "queued" | "in_flight" | "done" | "failed" | "cancelled";

/** An event on the queue. */
export interface Event extends Required<Omit<NewEvent, "threadId" | "key">> {
	/** 12 letters, digits, `-` and `_`, not starting with `-`, made from the receiving agent and the event's key (a random key when none is given). */
	id: string;
	threadId: string;
	key: string | null;
	status: Status;
	/** How many times it was taken for delivery. */
	attempts: number;
	/** Why the last attempt did not finish. */
	error: string | null;
	/** The Pi session entry that holds the last delivery. */
	entryId: string | null;
	createdAt: number;
	updatedAt: number;
}

/** The start of a workflow's thread id: `workflow.<name>`. Pi never runs such a thread. */
export const workflowPrefix = "workflow.";

/** The workflow whose thread `threadId` is, or undefined for any other thread. */
export function workflowName(threadId: string | undefined): string | undefined {
	return threadId?.startsWith(workflowPrefix) ? threadId.slice(workflowPrefix.length) : undefined;
}

// Deliveries an event gets before it is `failed`.
const maxAttempts = 3;

// Pi's rule for session ids, which thread ids are, capped at 200 characters because Pi puts the id in a file name.
const threadIdRule = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
// How long a thread stays with a process that stopped renewing its lease. Long, so that only a holder paused or blocked for minutes loses it:
// `agentx run` takes a thread from its own dead Pi process without waiting (abandon), so the wait falls only on threads whose holder died unseen.
const leaseMs = 120_000;
// How old a lease gets before its holder writes it again. The holder checks it every second; writing it only now and then keeps the writes of
// a session that holds its thread to one every 10 s. A holder that stops thus keeps its thread for 110 to 120 s.
const renewMs = 10_000;
// How long a step waits for another process that is writing the file.
const waitMs = 5000;
// SQLite's result code for "another process has the file locked".
const sqliteBusy = 5;
// This process as a lease holder: its id and its start time, so a reused process id is a new holder.
const owner = `${process.pid}.${Math.trunc(performance.timeOrigin)}`;
// Limits a statement on `events` to threads this process holds; takes `owner` as a parameter.
const held = "EXISTS (SELECT 1 FROM threads WHERE threads.thread_id = events.thread_id AND owner = ?)";
// An event that can start a run.
const startsRun = "status = 'queued' AND is_silent = 0";
// Events that need a session or a workflow run: one that can start a run, or one that was taken and not finished.
const work = `((${startsRun}) OR status = 'in_flight')`;
// A workflow's thread, in SQL.
const workflowThread = `thread_id GLOB '${workflowPrefix}*'`;
// The tag of the harness's metadata block (render.ts). No sender's text may hold it, so no event can fake a block or end one early.
const blockTag = /<\/?agentx-metadata\b/i;

/** A new event's id: 72 random bits, so that ids are unique without a check and nobody can guess one. A leading "-" becomes "_",
 * so that a command line does not take the id for an option. */
export const newId = () => randomBytes(9).toString("base64url").replace(/^-/, "_");

/** Whether `id` has the shape of an event's id. */
export const isEventId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_][A-Za-z0-9_-]{11}$/.test(id);

// The tables. Several processes can open a new file at once, so they are made in one transaction, under the write lock: one makes them, the others find them.
const schema = `
	CREATE TABLE IF NOT EXISTS events (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL,
		thread_id TEXT,
		content TEXT NOT NULL,
		metadata TEXT NOT NULL,
		do_not_steer INTEGER NOT NULL,
		is_silent INTEGER NOT NULL,
		status TEXT NOT NULL,
		attempts INTEGER NOT NULL,
		error TEXT,
		entry_id TEXT,
		key TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS events_by_id ON events (id);
	CREATE UNIQUE INDEX IF NOT EXISTS events_by_key ON events (key);
	CREATE INDEX IF NOT EXISTS events_by_status ON events (status, thread_id);
	CREATE TABLE IF NOT EXISTS threads (
		thread_id TEXT PRIMARY KEY,
		owner TEXT NOT NULL,
		heartbeat_at INTEGER NOT NULL
	);`;

interface Row {
	seq: number;
	id: string;
	thread_id: string;
	content: string;
	metadata: string;
	do_not_steer: number;
	is_silent: number;
	status: Status;
	attempts: number;
	error: string | null;
	entry_id: string | null;
	key: string | null;
	created_at: number;
	updated_at: number;
}

// node:sqlite prints an "experimental" warning when it loads on Node before 24.15 and 26. Loading it here, with warnings off for that moment, keeps the line out of every agentx command.
function sqlite(): { DatabaseSync: typeof DatabaseSync } {
	const { emitWarning } = process;
	process.emitWarning = () => {};
	try {
		return process.getBuiltinModule("node:sqlite");
	} finally {
		process.emitWarning = emitWarning;
	}
}

/** `text` with the tag of the harness's metadata block broken, for text from code the agent wrote, such as an error message, that goes into an event. */
export function withoutBlockTag(text: string): string {
	return text.replace(/<(\/?agentx-metadata)/gi, "\u2039$1");
}

/** Opens the queue of the agent in `agentRoot`, does `work` with it, and closes it. */
export function withQueue<T>(agentRoot: string, work: (queue: Queue) => T): T {
	const queue = new Queue(agentRoot);
	try {
		return work(queue);
	} finally {
		queue.close();
	}
}

/** Agent names and workflow names: letters, digits and dashes. A name is a folder name or part of a thread id, so it cannot point anywhere else. */
export const nameRule = /^[a-zA-Z0-9-]+$/;

/** Throws when the queue would refuse `event`: a bad thread id, a field of the wrong type, a metadata name that is the harness's or could fake a line, or the tag of the harness's block in its text. */
export function checkEvent(event: NewEvent): void {
	if (event.threadId !== undefined && !isThreadId(event.threadId)) {
		throw new Error(`Invalid thread id "${event.threadId}": use letters, digits, ".", "_" and "-", starting and ending with a letter or digit, 200 characters at most.`);
	}
	// Not left to TypeScript: a workflow's script or a file in the inbox can hold anything, and a value the queue file cannot store would stop the router at that event each time it starts.
	if (typeof event.content !== "string") throw new Error("Invalid event: its content must be text.");
	if (typeof (event.key ?? "") !== "string") throw new Error("Invalid event: its key must be text.");
	if (typeof (event.doNotSteer ?? false) !== "boolean" || typeof (event.isSilent ?? false) !== "boolean") throw new Error("Invalid event: doNotSteer and isSilent must be true or false.");
	const metadata = event.metadata ?? {};
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) throw new Error("Invalid event: its metadata must be an object.");
	// Names starting with agentX- are the harness's own lines, and a name with a colon or a line break could fake one.
	const badKey = Object.keys(metadata).find((key) => /^agentx-|[:\r\n\u2028\u2029]/i.test(key));
	if (badKey !== undefined) throw new Error(`Invalid metadata name "${badKey}": names must not start with "agentX-" or contain ":" or a line break.`);
	if ([event.content, ...Object.entries(metadata).map(([name, value]) => `${name} ${JSON.stringify(value)}`)].some((text) => blockTag.test(text))) {
		throw new Error('Invalid event: its content or metadata contains "<agentx-metadata", the tag of the harness\'s own block.');
	}
}

/** Whether `threadId` can be a thread's id: Pi's rule for session ids. */
export function isThreadId(threadId: unknown): threadId is string {
	return typeof threadId === "string" && threadIdRule.test(threadId);
}

/** The queue of the agent in `agentRoot`. Every method is one atomic step, safe against other processes using the same file. */
export class Queue {
	private readonly db: DatabaseSync;

	constructor(agentRoot: string) {
		const storage = join(agentRoot, "storage");
		mkdirSync(storage, { recursive: true });
		const file = join(storage, "event_queue.db");
		// `timeout`: wait for another process's write instead of failing at once.
		this.db = new (sqlite().DatabaseSync)(file, { timeout: waitMs });
		// WAL lets readers and one writer work at the same time, across processes. The switch to it on a new file is the one step that
		// does not wait: it fails at once while another process is making the same switch. So it is tried again for as long as a write would wait.
		for (const deadline = Date.now() + waitMs; ; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)) {
			try {
				this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
				break;
			} catch (error) {
				if ((error as { errcode?: number }).errcode !== sqliteBusy || Date.now() > deadline) throw error;
			}
		}
		// Read first, so that opening a file that has its tables takes no write lock.
		if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'events'").get() === undefined) this.transaction(() => this.db.exec(schema));
	}

	/** Closes the file. The queue must not be used afterwards. */
	close(): void {
		this.db.close();
	}

	// For senders.

	/**
	 * Adds an event and returns its id. With a key or an id that is already on the queue, adds nothing and returns the id of the event that has it.
	 * Every event on the queue has its thread: the router gives one to an event without. `facts` are `agentX-` lines from the harness itself, such as
	 * agentX-Schedule, which no sender may name. `fromInbox` gives the event the id and the send time it got in the agent's inbox.
	 */
	enqueue(event: NewEvent & { threadId: string }, facts: Record<string, string> = {}, fromInbox?: { id: string; sentAt: number }): string {
		checkEvent(event);
		const id = fromInbox?.id ?? newId();
		const now = Date.now();
		const added = this.db
			.prepare(
				`INSERT INTO events (id, thread_id, content, metadata, do_not_steer, is_silent, status, attempts, key, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?) ON CONFLICT DO NOTHING`,
			)
			.run(id, event.threadId, event.content, JSON.stringify({ ...event.metadata, ...facts }), Number(event.doNotSteer ?? false), Number(event.isSilent ?? false), event.key ?? null, fromInbox?.sentAt ?? now, now);
		if (added.changes > 0) return id;
		return String(this.db.prepare("SELECT id FROM events WHERE key = ? OR id = ?").get(event.key ?? null, id)?.id);
	}

	// For the process that runs a thread. It holds the thread's lease, and only the holder can take and finish events.

	/**
	 * Takes or renews this process's lease on a thread; false when another live process holds it. Taking a thread over ends the attempt of the events
	 * its last holder left in flight. Without `retry` they fail at once, as a workflow's do, since its run may have done part of its work.
	 */
	acquire(threadId: string, retry = true): boolean {
		return this.transaction(() => {
			const now = Date.now();
			const lease = this.db.prepare("SELECT owner, heartbeat_at FROM threads WHERE thread_id = ?").get(threadId);
			if (lease && lease.owner !== owner && Number(lease.heartbeat_at) > now - leaseMs) return false;
			this.db
				.prepare("INSERT INTO threads (thread_id, owner, heartbeat_at) VALUES (?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET owner = excluded.owner, heartbeat_at = excluded.heartbeat_at")
				.run(threadId, owner, now);
			if (lease?.owner !== owner) this.endAttempt(threadId, "The process running this thread stopped.", "", retry);
			return true;
		});
	}

	/** Keeps this process's lease on a thread, writing it again once it is 10 s old; false when the lease is no longer this process's. Call it every few seconds. */
	renew(threadId: string): boolean {
		const now = Date.now();
		const lease = this.db.prepare("SELECT heartbeat_at FROM threads WHERE thread_id = ? AND owner = ?").get(threadId, owner);
		if (lease === undefined) return false;
		if (Number(lease.heartbeat_at) > now - renewMs) return true;
		// The update checks the owner again: another process may have taken the lease since it was read.
		return this.db.prepare("UPDATE threads SET heartbeat_at = ? WHERE thread_id = ? AND owner = ?").run(now, threadId, owner).changes > 0;
	}

	/** Gives up this process's lease on a thread. Events still in flight are picked up by the next holder. */
	release(threadId: string): void {
		this.db.prepare("DELETE FROM threads WHERE thread_id = ? AND owner = ?").run(threadId, owner);
	}

	/**
	 * Frees a thread whose holder, the process `pid`, was seen to end, as the Pi runner sees its own Pi processes end: without waiting for the lease to run out.
	 * The thread is taken over, which ends the attempt of what was left in flight, and given up. With `failure`, a holder that left nothing in flight
	 * could not run the thread, and the waiting events lose an attempt for that reason, so an agent that cannot start is not started forever.
	 */
	abandon(threadId: string, pid: number | undefined, failure?: string): void {
		// The lease owner is `<pid>.<start time>`.
		this.db.prepare("DELETE FROM threads WHERE thread_id = ? AND owner LIKE ?").run(threadId, `${pid}.%`);
		const left = this.inFlight(threadId);
		// Not getting the thread means another process has taken it since.
		if (!this.acquire(threadId)) return;
		if (failure !== undefined && !left) {
			this.claim(threadId);
			this.fail(threadId, failure);
		}
		this.release(threadId);
	}

	/** Whether the lease of the process `pid` on the thread has run out: the process stopped renewing it, as a blocked or hung one does. */
	expired(threadId: string, pid: number | undefined): boolean {
		return this.db.prepare("SELECT 1 FROM threads WHERE thread_id = ? AND owner LIKE ? AND heartbeat_at <= ?").get(threadId, `${pid}.%`, Date.now() - leaseMs) !== undefined;
	}

	/** Whether another live process holds the thread. */
	heldElsewhere(threadId: string): boolean {
		return this.db.prepare("SELECT 1 FROM threads WHERE thread_id = ? AND owner != ? AND heartbeat_at > ?").get(threadId, owner, Date.now() - leaseMs) !== undefined;
	}

	/**
	 * The thread of the oldest event with work that no live process holds, leaving out the threads in `except`: a Pi thread, or with `workflows`, a workflow's.
	 * Work is a queued event that can start a run, or an event left in flight by a process that stopped.
	 */
	nextThread(except: string[] = [], workflows = false): string | undefined {
		const row = this.db
			.prepare(
				`SELECT thread_id FROM events WHERE ${work} AND ${workflows ? "" : "NOT"} ${workflowThread}
				   AND thread_id NOT IN (SELECT thread_id FROM threads WHERE heartbeat_at > ?)
				   AND thread_id NOT IN (SELECT value FROM json_each(?))
				 ORDER BY seq LIMIT 1`,
			)
			.get(Date.now() - leaseMs, JSON.stringify(except));
		return row && String(row.thread_id);
	}

	/** Whether the thread has work: a queued event that can start a run, or an event in flight. */
	hasWork(threadId: string): boolean {
		return this.db.prepare(`SELECT 1 FROM events WHERE ${work} AND thread_id = ? LIMIT 1`).get(threadId) !== undefined;
	}

	/** Whether an event of the thread is in flight: taken, and not settled yet. */
	inFlight(threadId: string): boolean {
		return this.db.prepare("SELECT 1 FROM events WHERE thread_id = ? AND status = 'in_flight' LIMIT 1").get(threadId) !== undefined;
	}

	/** The ids of the thread's events in flight. */
	inFlightIds(threadId: string): string[] {
		return this.db
			.prepare("SELECT id FROM events WHERE thread_id = ? AND status = 'in_flight' ORDER BY seq")
			.all(threadId)
			.map((row) => String(row.id));
	}

	/**
	 * Takes the thread's queued events for delivery, oldest first, and counts the attempt.
	 * With `steer`, takes those that may enter a run in progress. Otherwise takes all of them to start a run, and none when all are silent.
	 */
	claim(threadId: string, steer = false): Event[] {
		return this.transaction(() => {
			// Checked first, so that the claim of an idle session writes nothing.
			if (!steer && !this.db.prepare(`SELECT 1 FROM events WHERE thread_id = ? AND ${startsRun} LIMIT 1`).get(threadId)) return [];
			// Only the holder takes events. Renewing an old lease here keeps another process from taking the thread, and with it these events, before the next renewal.
			if (!this.renew(threadId)) return [];
			const rows = this.db
				.prepare(
					`UPDATE events SET status = 'in_flight', attempts = attempts + 1, error = NULL, entry_id = NULL, updated_at = ?
					 WHERE thread_id = ? AND status = 'queued' ${steer ? "AND do_not_steer = 0" : ""} RETURNING *`,
				)
				.all(Date.now(), threadId);
			return rows.sort((a, b) => Number(a.seq) - Number(b.seq)).map(toEvent);
		});
	}

	/** Takes the thread's oldest queued event, for a workflow, which runs one event at a time. */
	claimOldest(threadId: string): Event | undefined {
		return this.transaction(() => {
			if (!this.renew(threadId)) return undefined;
			const row = this.db
				.prepare(
					`UPDATE events SET status = 'in_flight', attempts = attempts + 1, error = NULL, updated_at = ?
					 WHERE seq = (SELECT seq FROM events WHERE thread_id = ? AND status = 'queued' ORDER BY seq LIMIT 1) RETURNING *`,
				)
				.get(Date.now(), threadId);
			return row && toEvent(row);
		});
	}

	/** Records the Pi session entry that holds events in flight on the thread. An event with an entry has reached the model. */
	delivered(threadId: string, ids: string[], entryId: string): void {
		this.db
			.prepare(`UPDATE events SET entry_id = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND thread_id = ? AND status = 'in_flight' AND ${held}`)
			.run(entryId, Date.now(), JSON.stringify(ids), threadId, owner);
	}

	/**
	 * Settles the thread's events when their run has ended. `done`: the run completed, for the events Pi saved.
	 * An `error`: the run failed, and the events Pi saved go back to the queue, or become `failed` after the last attempt.
	 * `cancelled`: the run was aborted, for every event in flight, also those Pi was still holding for that run.
	 */
	settle(threadId: string, result: "done" | "cancelled" | { error: string }): void {
		if (typeof result === "object") return this.endAttempt(threadId, result.error, "AND entry_id IS NOT NULL");
		this.db
			.prepare(`UPDATE events SET status = ?, updated_at = ? WHERE thread_id = ? AND status = 'in_flight' AND ${held} ${result === "done" ? "AND entry_id IS NOT NULL" : ""}`)
			.run(result, Date.now(), threadId, owner);
	}

	/** Ends a workflow's run of one event: `done` without an error, `failed` with one. */
	finish(threadId: string, id: string, error?: string): void {
		this.db
			.prepare(`UPDATE events SET status = ?, error = ?, updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'in_flight' AND ${held}`)
			.run(error === undefined ? "done" : "failed", error ?? null, Date.now(), id, threadId, owner);
	}

	/** Ends the attempt of the thread's events in flight, saved by Pi or not: back to the queue, or `failed` after the last attempt. */
	fail(threadId: string, error: string): void {
		this.endAttempt(threadId, error);
	}

	// For the router.

	/** The event with this id. */
	get(id: string): Event | undefined {
		const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
		return row && toEvent(row);
	}

	// `which` narrows it to some of the thread's in-flight events. Without `retry`, they fail whatever their attempts.
	private endAttempt(threadId: string, error: string, which = "", retry = true): void {
		this.db
			.prepare(
				`UPDATE events SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END, error = ?, updated_at = ?
				 WHERE thread_id = ? AND status = 'in_flight' AND ${held} ${which}`,
			)
			.run(retry ? maxAttempts : 0, error, Date.now(), threadId, owner);
	}

	// IMMEDIATE takes the write lock at the start. A transaction that reads first and locks later fails when another process writes in between.
	private transaction<T>(work: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
}

function toEvent(record: Record<string, unknown>): Event {
	const row = record as unknown as Row;
	return {
		id: row.id,
		threadId: row.thread_id,
		content: row.content,
		metadata: JSON.parse(row.metadata),
		key: row.key,
		doNotSteer: row.do_not_steer === 1,
		isSilent: row.is_silent === 1,
		status: row.status,
		attempts: row.attempts,
		error: row.error,
		entryId: row.entry_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
