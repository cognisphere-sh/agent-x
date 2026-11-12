// The message queue of one agent: a SQLite file in the agent's storage/, opened by every process that sends to or runs the agent.
// Loaded twice: compiled, by the CLI and the runner, and from source, by the message queue extension next to it. The two copies share only the file.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** What a sender puts on the queue. */
export interface NewMessage {
	/** The conversation the message belongs to. It is the id of the Pi session that receives it. */
	threadId: string;
	content: string;
	/** Facts for the model about the message, shown to it one per line. */
	metadata?: Record<string, unknown>;
	/** Never enters a run that is in progress; waits for the next one. */
	doNotSteer?: boolean;
	/** Never starts a run; goes along with the next message that does. */
	isSilent?: boolean;
}

/** `queued`: waiting. `in_flight`: taken by the session that runs the thread. The others are final. */
export type Status = "queued" | "in_flight" | "done" | "failed" | "cancelled";

/** A message on the queue. */
export interface Message extends Required<NewMessage> {
	id: number;
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

// Deliveries a message gets before it is `failed`.
const maxAttempts = 3;

// Pi's rule for session ids, which thread ids are, capped at 200 characters because Pi puts the id in a file name.
const threadIdRule = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
// How long a thread stays with a process that stopped renewing its lease. Long, so that only a holder paused or blocked for minutes loses it:
// the runner takes a thread from its own dead Pi process without waiting (abandon), so the wait falls only on threads whose holder died unseen.
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
// Limits a statement on `messages` to threads this process holds; takes `owner` as a parameter.
const held = "EXISTS (SELECT 1 FROM threads WHERE threads.thread_id = messages.thread_id AND owner = ?)";
// A message that can start a run.
const startsRun = "status = 'queued' AND is_silent = 0";
// Messages that need a Pi session: one that can start a run, or one that a session has taken and not finished.
const work = `((${startsRun}) OR status = 'in_flight')`;

const schema = `
CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	thread_id TEXT NOT NULL,
	content TEXT NOT NULL,
	metadata TEXT NOT NULL,
	do_not_steer INTEGER NOT NULL,
	is_silent INTEGER NOT NULL,
	status TEXT NOT NULL,
	attempts INTEGER NOT NULL,
	error TEXT,
	entry_id TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_status ON messages (status, thread_id);
CREATE TABLE IF NOT EXISTS threads (
	thread_id TEXT PRIMARY KEY,
	owner TEXT NOT NULL,
	heartbeat_at INTEGER NOT NULL
);`;

interface Row {
	id: number;
	thread_id: string;
	content: string;
	metadata: string;
	do_not_steer: number;
	is_silent: number;
	status: Status;
	attempts: number;
	error: string | null;
	entry_id: string | null;
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

/** The queue of the agent in `agentRoot`. Every method is one atomic step, safe against other processes using the same file. */
export class Queue {
	private readonly db: DatabaseSync;

	constructor(agentRoot: string) {
		const storage = join(agentRoot, "storage");
		mkdirSync(storage, { recursive: true });
		// `timeout`: wait for another process's write instead of failing at once.
		this.db = new (sqlite().DatabaseSync)(join(storage, "message_queue.db"), { timeout: waitMs });
		// WAL lets readers and one writer work at the same time, across processes. The switch to it on a new file is the one step that
		// does not wait: it fails at once while another process is making the same switch. So it is tried again for as long as a write would wait.
		for (const deadline = Date.now() + waitMs; ; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)) {
			try {
				this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; ${schema}`);
				return;
			} catch (error) {
				if ((error as { errcode?: number }).errcode !== sqliteBusy || Date.now() > deadline) throw error;
			}
		}
	}

	/** Closes the file. The queue must not be used afterwards. */
	close(): void {
		this.db.close();
	}

	// For senders.

	/** Adds a message and returns its id. */
	enqueue(message: NewMessage): number {
		if (typeof message.threadId !== "string" || !threadIdRule.test(message.threadId)) {
			throw new Error(`Invalid thread id "${message.threadId}": use letters, digits, ".", "_" and "-", starting and ending with a letter or digit, 200 characters at most.`);
		}
		const metadata = message.metadata ?? {};
		// Names starting with agentX- are the harness's own lines, and a name with a colon or a line break could fake one.
		const badKey = Object.keys(metadata).find((key) => /^agentx-|[:\r\n\u2028\u2029]/i.test(key));
		if (badKey !== undefined) throw new Error(`Invalid metadata name "${badKey}": names must not start with "agentX-" or contain ":" or a line break.`);
		const now = Date.now();
		const { lastInsertRowid } = this.db
			.prepare(
				`INSERT INTO messages (thread_id, content, metadata, do_not_steer, is_silent, status, attempts, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
			)
			.run(message.threadId, message.content, JSON.stringify(metadata), Number(message.doNotSteer ?? false), Number(message.isSilent ?? false), now, now);
		return Number(lastInsertRowid);
	}

	// For the process that runs a thread. It holds the thread's lease, and only the holder can take and finish messages.

	/** Takes or renews this process's lease on a thread; false when another live process holds it. Taking a thread over ends the attempt of the messages its last holder left in flight. */
	acquire(threadId: string): boolean {
		return this.transaction(() => {
			const now = Date.now();
			const lease = this.db.prepare("SELECT owner, heartbeat_at FROM threads WHERE thread_id = ?").get(threadId);
			if (lease && lease.owner !== owner && Number(lease.heartbeat_at) > now - leaseMs) return false;
			this.db
				.prepare("INSERT INTO threads (thread_id, owner, heartbeat_at) VALUES (?, ?, ?) ON CONFLICT (thread_id) DO UPDATE SET owner = excluded.owner, heartbeat_at = excluded.heartbeat_at")
				.run(threadId, owner, now);
			if (lease?.owner !== owner) this.endAttempt(threadId, "The process running this thread stopped.");
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

	/** Gives up this process's lease on a thread. Messages still in flight are picked up by the next holder. */
	release(threadId: string): void {
		this.db.prepare("DELETE FROM threads WHERE thread_id = ? AND owner = ?").run(threadId, owner);
	}

	/**
	 * Frees a thread whose holder, the process `pid`, was seen to end, as the runner sees its own Pi processes end: without waiting for the lease to run out.
	 * The thread is taken over, which ends the attempt of what was left in flight, and given up. With `failure`, a holder that left nothing in flight
	 * could not run the thread, and the waiting messages lose an attempt for that reason, so an agent that cannot start is not started forever.
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
	 * The thread of the oldest message with work that no live process holds, leaving out the threads in `except`.
	 * Work is a queued message that can start a run, or a message left in flight by a process that stopped.
	 */
	nextThread(except: string[] = []): string | undefined {
		const row = this.db
			.prepare(
				`SELECT thread_id FROM messages WHERE ${work}
				   AND thread_id NOT IN (SELECT thread_id FROM threads WHERE heartbeat_at > ?)
				   AND thread_id NOT IN (SELECT value FROM json_each(?))
				 ORDER BY id LIMIT 1`,
			)
			.get(Date.now() - leaseMs, JSON.stringify(except));
		return row && String(row.thread_id);
	}

	/** Whether the thread has work: a queued message that can start a run, or a message in flight. */
	hasWork(threadId: string): boolean {
		return this.db.prepare(`SELECT 1 FROM messages WHERE ${work} AND thread_id = ? LIMIT 1`).get(threadId) !== undefined;
	}

	/** Whether a message of the thread is in flight: taken, and not settled yet. */
	inFlight(threadId: string): boolean {
		return this.db.prepare("SELECT 1 FROM messages WHERE thread_id = ? AND status = 'in_flight' LIMIT 1").get(threadId) !== undefined;
	}

	/**
	 * Takes the thread's queued messages for delivery, oldest first, and counts the attempt.
	 * With `steer`, takes those that may enter a run in progress. Otherwise takes all of them to start a run, and none when all are silent.
	 */
	claim(threadId: string, steer = false): Message[] {
		return this.transaction(() => {
			// Checked first, so that the claim of an idle session writes nothing.
			if (!steer && !this.db.prepare(`SELECT 1 FROM messages WHERE thread_id = ? AND ${startsRun} LIMIT 1`).get(threadId)) return [];
			// Only the holder takes messages. Renewing an old lease here keeps another process from taking the thread, and with it these messages, before the next renewal.
			if (!this.renew(threadId)) return [];
			const rows = this.db
				.prepare(
					`UPDATE messages SET status = 'in_flight', attempts = attempts + 1, error = NULL, entry_id = NULL, updated_at = ?
					 WHERE thread_id = ? AND status = 'queued' ${steer ? "AND do_not_steer = 0" : ""} RETURNING *`,
				)
				.all(Date.now(), threadId);
			return rows.map(toMessage).sort((a, b) => a.id - b.id);
		});
	}

	/** Records the Pi session entry that holds messages in flight on the thread. A message with an entry has reached the model. */
	delivered(threadId: string, ids: number[], entryId: string): void {
		this.db
			.prepare(`UPDATE messages SET entry_id = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND thread_id = ? AND status = 'in_flight' AND ${held}`)
			.run(entryId, Date.now(), JSON.stringify(ids), threadId, owner);
	}

	/**
	 * Settles the thread's messages when their run has ended. `done`: the run completed, for the messages Pi saved.
	 * An `error`: the run failed, and the messages Pi saved go back to the queue, or become `failed` after the last attempt.
	 * `cancelled`: the run was aborted, for every message in flight, also those Pi was still holding for that run.
	 */
	settle(threadId: string, result: "done" | "cancelled" | { error: string }): void {
		if (typeof result === "object") return this.endAttempt(threadId, result.error, "AND entry_id IS NOT NULL");
		this.db
			.prepare(`UPDATE messages SET status = ?, updated_at = ? WHERE thread_id = ? AND status = 'in_flight' AND ${held} ${result === "done" ? "AND entry_id IS NOT NULL" : ""}`)
			.run(result, Date.now(), threadId, owner);
	}

	/** Ends the attempt of the thread's messages in flight, saved by Pi or not: back to the queue, or `failed` after the last attempt. */
	fail(threadId: string, error: string): void {
		this.endAttempt(threadId, error);
	}

	// `which` narrows it to some of the thread's in-flight messages.
	private endAttempt(threadId: string, error: string, which = ""): void {
		this.db
			.prepare(
				`UPDATE messages SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END, error = ?, updated_at = ?
				 WHERE thread_id = ? AND status = 'in_flight' AND ${held} ${which}`,
			)
			.run(maxAttempts, error, Date.now(), threadId, owner);
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

function toMessage(record: Record<string, unknown>): Message {
	const row = record as unknown as Row;
	return {
		id: row.id,
		threadId: row.thread_id,
		content: row.content,
		metadata: JSON.parse(row.metadata),
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
