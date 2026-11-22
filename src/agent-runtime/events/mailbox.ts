// An agent's inbox and outbox: a folder per event, kept, and an empty marker per event that waits. Every event reaches an agent through its inbox,
// and every event it sends leaves through its outbox, which the coordinator takes. Plain files, each written once, so any number of processes
// can write one mailbox without a lock, across a sandbox's boundary too.

import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { checkEvent, isEventId, type NewEvent, newId } from "./queue.js";

/** An event in a mailbox, as its `event.json` holds it. */
export interface Mail {
	id: string;
	/** When the sender sent it, in milliseconds since 1970. */
	sentAt: number;
	/** The event, always with a key: the sender's, or a random one. */
	event: NewEvent & { key: string };
	/** The harness's `agentX-` lines. */
	facts: Record<string, string>;
	/** In an outbox: the agent it is for. */
	to?: string;
	/** In an outbox: the thread that sent it, with the workflow when one did. The agent that sent it is the outbox's own, which it does not name. */
	from?: { thread: string; workflow?: string };
}

/** The agent's inbox folder, from its storage folder: `storageOf` inside the agent, `centralStorage` in the coordinator. */
export const inbox = (storage: string) => join(storage, "workspace", "inbox");

/** The agent's outbox folder, from its storage folder. */
export const outbox = (storage: string) => join(storage, "workspace", "outbox");

/**
 * The mailbox `box` (`inbox` or `outbox`) of the agent's central storage folder `storage`, as the host reaches it. Throws when a folder on the way is a
 * link: the agent owns its storage, and could point its mailbox at another folder of the host, such as another agent's inbox.
 */
export function hostBox(box: (storage: string) => string, storage: string): string {
	let path = storage;
	for (const name of ["", ...relative(storage, box(storage)).split(sep)]) {
		path = join(path, name);
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${path} is a link, which the host does not follow in an agent's storage.`);
	}
	return path;
}

/** A file that goes with an event: a path, whose file is copied into the event's folder by its name, or a name and its content, written there. */
export type EventFile = string | { name: string; content: string | Uint8Array };

// The file's name in the event's folder.
const fileName = (file: EventFile) => (typeof file === "string" ? basename(file) : file.name);

// The harness's file in an event's folder; every other file there is the event's, by its name.
const eventFile = "event.json";

// What a file of an event may be called: a plain name, with no folder in it, nothing hidden, and not the harness's file.
const isFileName = (name: string) => name !== "" && name === basename(name) && !name.startsWith(".") && name !== eventFile;

/** The id of the event with `key` for the agent `receiver`: sending again gets the same id, and the same key sent to two agents gets two. */
export const mailId = (receiver: string, key: string) => createHash("sha256").update(`${receiver}\0${key}`).digest("base64url").slice(0, 12).replace(/^-/, "_");

/**
 * A new event for the agent `receiver`, checked, with `files`, sent at `sentAt`. Its id is made from the receiver and its key, a random one when it has none.
 * A file given by its path is any the caller can read, so a sandbox decides what an agent can send.
 */
export function newMail(event: NewEvent, receiver: string, files: EventFile[] = [], facts: Record<string, string> = {}, sentAt = Date.now()): Mail {
	for (const file of files) if (typeof file === "string" && !statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`${file} is not a file.`);
	checkEvent(event);
	const names = files.map(fileName);
	for (const name of names) if (!isFileName(name)) throw new Error(`A file of an event cannot be called "${name}".`);
	if (new Set(names).size < names.length) throw new Error("Two files of an event have the same name.");
	const key = event.key ?? newId();
	return { id: mailId(receiver, key), sentAt, event: { ...event, key }, facts };
}

/** `event` as it goes into an inbox: with files, its content ends with a line that names them, and the receiver finds them in the event's folder. Check it after: a file's name is the sender's word too. */
export function withFilesLine(event: NewEvent, files: EventFile[]): NewEvent {
	if (files.length === 0) return event;
	return { ...event, content: `${event.content}\n\nFiles: ${files.map((file) => `\`${fileName(file)}\``).join(", ")}` };
}

// The time in the name of the last marker this process made. Each marker gets a later one, so one sender's events keep their order
// within a millisecond too, where markers would otherwise sort by their ids.
let lastAt = 0;

/**
 * Puts `mail` into the mailbox `box`, with `files`, each by its name, and marks it waiting. The folder is written under a hidden name and then renamed,
 * so a reader never sees half of it; a folder of that id already there, from an earlier delivery of the same event, is kept.
 */
export function put(box: string, mail: Mail, files: EventFile[]): void {
	const folder = join(box, mail.id);
	// The folder is there when the event was put before, as one sent again with its key. While it waits, it needs no second marker. Otherwise it gets
	// one: the earlier put may have died between the folder and its marker. If it was taken already, the queue ignores it the second time.
	if (existsSync(folder)) {
		if (pending(box).some((marker) => markerId(marker) === mail.id)) return;
	} else {
		const temporary = join(box, `.${mail.id}.${process.pid}`);
		rmSync(temporary, { recursive: true, force: true });
		mkdirSync(temporary, { recursive: true });
		for (const file of files) {
			const to = join(temporary, fileName(file));
			// A clone where the file system can make one, so a large file costs no copying; still a file of its own, which the sender cannot change.
			if (typeof file === "string") copyFileSync(file, to, constants.COPYFILE_FICLONE);
			// Content, as a service's download, goes straight into the event's folder, with no file of its own to copy.
			else writeFileSync(to, file.content);
		}
		writeFileSync(join(temporary, eventFile), JSON.stringify(mail));
		try {
			renameSync(temporary, folder);
		} catch (error) {
			// Another writer put the same event at the same moment.
			rmSync(temporary, { recursive: true, force: true });
			if (!existsSync(folder)) throw error;
		}
	}
	// Created after the folder, so a marker always finds its event. Its name starts with the time, so markers sort oldest first.
	lastAt = Math.max(Date.now(), lastAt + 1);
	mkdirSync(join(box, ".pending"), { recursive: true });
	writeFileSync(join(box, ".pending", `${String(lastAt).padStart(15, "0")}-${mail.id}`), "");
}

/** The markers of the events that wait in `box`, oldest first. */
export function pending(box: string): string[] {
	const dir = join(box, ".pending");
	return existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith(".")).sort() : [];
}

/** The id of the event a marker stands for, or undefined when the marker is not one. */
export function markerId(marker: string): string | undefined {
	const id = marker.split("-").slice(1).join("-");
	return isEventId(id) ? id : undefined;
}

/**
 * The events that wait in `box`, oldest first, each read as it is reached. One that cannot be read is set aside in `.rejected/`, and `onRejected` hears why.
 * The markers are listed once, so a backlog costs one listing.
 */
export function* waiting(box: string, onRejected: (marker: string, why: string) => void): Generator<{ marker: string; mail: Mail }> {
	for (const marker of pending(box)) {
		const id = markerId(marker);
		let mail: Mail | undefined;
		try {
			mail = id === undefined ? undefined : read(box, id);
			if (mail === undefined) throw new Error("it has no event.json");
		} catch (error) {
			reject(box, marker);
			onRejected(marker, (error as Error).message);
			continue;
		}
		yield { marker, mail };
	}
}

/** The event `id` in `box`, as its event.json holds it; undefined when there is no such event. Throws when its event.json is not a file or not JSON. */
export function read(box: string, id: string): Mail | undefined {
	const folder = join(box, id);
	const file = join(folder, eventFile);
	if (!existsSync(file)) return undefined;
	// A folder that is a link, as a writer could make, would lead out of the mailbox.
	if (!lstatSync(folder).isDirectory()) throw new Error(`${folder} is not a folder.`);
	if (!lstatSync(file).isFile()) throw new Error(`${file} is not a plain file.`);
	const mail: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (typeof mail !== "object" || mail === null || Array.isArray(mail) || (mail as Mail).id !== id) throw new Error(`${file} is not this event.`);
	return mail as Mail;
}

/** The paths of the event's own files in its folder `id` of `box`, whatever its event.json says; throws on one that is not a plain file, such as a link. */
export function filesIn(box: string, id: string): string[] {
	const folder = join(box, id);
	// By name, so the line that names them reads the same each time.
	return readdirSync(folder)
		.sort()
		.filter((name) => name !== eventFile)
		.map((name) => {
			if (!lstatSync(join(folder, name)).isFile()) throw new Error(`\`${name}\` in its folder is not a plain file.`);
			return join(folder, name);
		});
}

/** Ends the wait of an event: deletes its marker. */
export function done(box: string, marker: string): void {
	rmSync(join(box, ".pending", marker), { force: true });
}

/** Moves the marker of an event that cannot be taken to `.rejected/`, where it stays for a person to look at. */
export function reject(box: string, marker: string): void {
	mkdirSync(join(box, ".rejected"), { recursive: true });
	renameSync(join(box, ".pending", marker), join(box, ".rejected", marker));
}
