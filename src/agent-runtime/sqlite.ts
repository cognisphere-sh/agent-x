// Opens an agent's SQLite files, which several processes use at once: the event queue and the memory index. Loaded from source too, by the Pi package.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// How long a step waits for another process that is writing the file.
const waitMs = 5000;
// SQLite's result code for "another process has the file locked".
const sqliteBusy = 5;

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

/** Opens `file`, which several processes may use at once, and makes its folder, and `table` with `schema`, when they are not there yet. */
export function openDatabase(file: string, table: string, schema: string): DatabaseSync {
	mkdirSync(dirname(file), { recursive: true });
	// `timeout`: wait for another process's write instead of failing at once.
	const db = new (sqlite().DatabaseSync)(file, { timeout: waitMs });
	// WAL lets readers and one writer work at the same time, across processes. The switch to it on a new file is the one step that
	// does not wait: it fails at once while another process is making the same switch. So it is tried again for as long as a write would wait.
	for (const deadline = Date.now() + waitMs; ; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)) {
		try {
			db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
			break;
		} catch (error) {
			if ((error as { errcode?: number }).errcode !== sqliteBusy || Date.now() > deadline) throw error;
		}
	}
	// Read first, so that opening a file that has its tables takes no write lock. Several processes can open a new file at once, so the tables are made
	// in one transaction, under the write lock: one makes them, the others find them.
	if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table) === undefined) transaction(db, () => db.exec(schema));
	return db;
}

/** Does `work` in one transaction of `db`, which holds the write lock from its start. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
	// IMMEDIATE takes the write lock at the start. A transaction that reads first and locks later fails when another process writes in between.
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = work();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
