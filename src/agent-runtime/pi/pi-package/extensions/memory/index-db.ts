// The memory index's file, storage/memory/index.db: its tables, and taking a thread's episodes out of it. The episode index (episode-index.ts)
// fills it from the session files. Nothing here loads Pi, so `agentx remove-thread` opens it at no cost.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, transaction } from "../../../../sqlite.js";

// `sessions`: for each session file, by its path relative to storage/sessions/, the id of the last end message indexed: what follows is indexed next. An
// episode's text is in `chunks`, in order, and `chunks_text` is FTS5's index of them, which the triggers keep in step.
const schema = `
	CREATE TABLE IF NOT EXISTS sessions (
		path TEXT PRIMARY KEY,
		last_end TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS episodes (
		id TEXT PRIMARY KEY,
		thread TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		ended_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS episodes_by_thread ON episodes (thread, started_at);
	CREATE TABLE IF NOT EXISTS chunks (
		id INTEGER PRIMARY KEY,
		episode TEXT NOT NULL,
		part INTEGER NOT NULL,
		text TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS chunks_by_episode ON chunks (episode, part);
	CREATE VIRTUAL TABLE IF NOT EXISTS chunks_text USING fts5 (text, content = 'chunks', content_rowid = 'id', tokenize = 'porter unicode61');
	CREATE TRIGGER IF NOT EXISTS chunk_added AFTER INSERT ON chunks BEGIN
		INSERT INTO chunks_text (rowid, text) VALUES (new.id, new.text);
	END;
	CREATE TRIGGER IF NOT EXISTS chunk_removed AFTER DELETE ON chunks BEGIN
		INSERT INTO chunks_text (chunks_text, rowid, text) VALUES ('delete', old.id, old.text);
	END;`;

/** The memory index's file of the agent in `agentRoot`. */
export const indexPath = (agentRoot: string) => join(agentRoot, "storage", "memory", "index.db");

/** Opens the memory index of the agent in `agentRoot`, made when it is missing. */
export function openIndex(agentRoot: string): DatabaseSync {
	return openDatabase(indexPath(agentRoot), "sessions", schema);
}

/** Takes a thread's episodes out of the index of the agent in `agentRoot`, with what it knows of the thread's session files, in one transaction. */
export function forgetThread(agentRoot: string, thread: string): void {
	if (!existsSync(indexPath(agentRoot))) return;
	const db = openIndex(agentRoot);
	try {
		transaction(db, () => {
			db.prepare("DELETE FROM chunks WHERE episode IN (SELECT id FROM episodes WHERE thread = ?)").run(thread);
			db.prepare("DELETE FROM episodes WHERE thread = ?").run(thread);
			// A file's path starts with its thread's folder.
			db.prepare("DELETE FROM sessions WHERE substr(path, 1, ?) = ?").run(thread.length + 1, `${thread}/`);
		});
	} finally {
		db.close();
	}
}
