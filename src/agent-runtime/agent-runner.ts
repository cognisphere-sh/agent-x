// AgentRunner: serves one agent's message queue by running a Pi process for each thread that has messages.
// It only starts the processes: the Pi CLI in RPC mode, with what `agentx run` gives it, as a worker. The message queue extension in the session
// takes the thread's messages, delivers and settles them, and ends the session when the thread has no more.
// The runner changes a message's status only when a thread's process ends with a failure.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
// Types only, which the build removes: the runner does not load Pi.
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { piCli, piEnv, sessionFlags } from "./pi-launch.js";
import { Queue } from "./pi-package/extensions/message-queue/queue.js";

// How often the queue is checked for threads with work.
const pollMs = 1000;

// The records in Pi's RPC output that the runner acts on. All others report the session's activity. Pi exports no type for an extension's error.
type PiRecord = RpcExtensionUIRequest | { type: "extension_error"; event: string; extensionPath: string; error: string };

/**
 * Runs the threads of the agent in `agentRoot`: one Pi process per thread, `maxWorkers` at a time, the thread of the oldest waiting message first.
 * A Pi process that writes nothing for `stallMs` is stopped; set it above the longest a tool of the agent may run without output.
 */
export class AgentRunner {
	private readonly queue: Queue;
	// The Pi process of each running thread.
	private readonly workers = new Map<string, ChildProcessWithoutNullStreams>();
	// When each Pi process last wrote to its output. Pi writes while a run makes progress: the model's text, tool calls, tool output.
	private readonly heardAt = new Map<ChildProcessWithoutNullStreams, number>();
	private stopping = false;

	constructor(
		private readonly agentRoot: string,
		private readonly maxWorkers: number,
		private readonly stallMs = 10 * 60_000,
	) {
		this.queue = new Queue(agentRoot);
	}

	/** Serves the queue until `stop` is called and the running threads have finished. */
	async run(): Promise<void> {
		while (!this.stopping || this.workers.size > 0) {
			// The runner starts no second process for a thread it is running, so a worker that is stuck would keep its thread and its place forever.
			for (const [threadId, child] of this.workers) {
				// Its lease ran out: its main thread is blocked, and only SIGKILL ends it. Its exit is handled as any death.
				if (this.queue.expired(threadId, child.pid)) {
					console.error(`${threadId}: Pi stopped renewing its lease, so the runner ends it`);
					child.kill("SIGKILL");
				} else if (!child.killed && Date.now() - (this.heardAt.get(child) ?? 0) >= this.stallMs) {
					// It writes nothing, as when a tool waits forever. Told to stop, Pi closes its session, which aborts the run and gives its messages another attempt.
					console.error(`${threadId}: Pi wrote nothing for ${this.stallMs / 1000} s, so the runner stops it`);
					child.kill("SIGTERM");
				}
			}
			while (!this.stopping && this.workers.size < this.maxWorkers) {
				// Not a thread that a live process holds, and not one whose own process is still closing: that one has given up its lease already.
				const threadId = this.queue.nextThread([...this.workers.keys()]);
				if (threadId === undefined) break;
				this.work(threadId);
			}
			await sleep(pollMs);
		}
		this.queue.close();
	}

	/**
	 * Starts no more threads; `run` returns when the running ones are done. With `force`, tells them to stop now: Pi closes each session,
	 * which aborts its run, and its messages wait for the next runner, with the attempt counted.
	 */
	stop(force = false): void {
		this.stopping = true;
		if (force) for (const child of this.workers.values()) child.kill("SIGTERM");
	}

	// One worker: the thread's Pi session in a process of its own, started the way `agentx run --thread-id <thread> --mode rpc` starts it.
	// In RPC mode Pi stays open until its input closes, so a session ends when it decides to, and at the latest with the runner.
	private work(threadId: string): void {
		const child = spawn(process.execPath, [piCli, ...sessionFlags(this.agentRoot, threadId), "--mode", "rpc", "--agentx-worker"], {
			cwd: this.agentRoot,
			env: piEnv(this.agentRoot),
		});
		this.workers.set(threadId, child);
		this.heardAt.set(child, Date.now());
		console.log(`${threadId}: session opened`);

		// Pi writes one JSON record per line, ended by a line feed, and waits when nobody reads. A record can be megabytes long,
		// such as the one that ends a run, so the text is split only when a line is complete.
		let unread = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			this.heardAt.set(child, Date.now());
			unread += chunk;
			if (!chunk.includes("\n")) return;
			const lines = unread.split("\n");
			unread = lines.pop() ?? "";
			for (const line of lines) this.heard(threadId, child, line);
		});
		// Pi's last words say why it stopped.
		let said = "";
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			said = (said + chunk).slice(-4000);
		});
		// An answer written to a process that has just gone fails. Its exit is handled below.
		child.stdin.on("error", () => {});

		// The process could not be started.
		child.once("error", (error) => this.ended(threadId, child, error.message, true));
		child.once("exit", async (code, signal) => {
			// What Pi wrote last can still be in the pipe. A process that Pi started can hold the pipe open, so the wait has an end.
			if (!child.stderr.readableEnded) await Promise.race([new Promise((resolve) => child.stderr.once("end", resolve)), sleep(pollMs, undefined, { ref: false })]);
			if (code === 0) return this.ended(threadId, child);
			const reason = said.split("\n").findLast((line) => /^\w*Error: /.test(line)) ?? (signal ? `Pi was stopped by ${signal}.` : `Pi stopped with exit code ${code}.`);
			// Told to stop, Pi closes its session and exits with 143 (SIGTERM) or 129 (SIGHUP). Before it listens for them, and on a terminal's Ctrl-C, the signal itself ends it.
			const told = code === 143 || code === 129 || signal === "SIGTERM" || signal === "SIGHUP" || signal === "SIGINT";
			this.ended(threadId, child, reason, !told);
		});
	}

	// What a session tells its host. Nobody is there to answer an extension's dialog, and an unanswered one holds its run forever,
	// so every request of an extension is answered as cancelled. Pi ignores an answer to a request that waits for none.
	private heard(threadId: string, child: ChildProcessWithoutNullStreams, line: string): void {
		try {
			const record: PiRecord = JSON.parse(line);
			if (record.type === "extension_error") console.error(`${threadId}: ${record.event} in ${record.extensionPath}: ${record.error}`);
			if (record.type !== "extension_ui_request") return;
			if (record.method === "notify") console.error(`${threadId}: ${record.message}`);
			const answer: RpcExtensionUIResponse = { type: "extension_ui_response", id: record.id, cancelled: true };
			child.stdin.write(`${JSON.stringify(answer)}\n`);
		} catch {
			// Not a record.
		}
	}

	// The thread's process is gone. If it ended in order, the message queue extension has settled everything.
	// `failure` says why it did not, and `own` that nobody told it to stop: then the runner does what the session no longer can.
	private ended(threadId: string, child: ChildProcessWithoutNullStreams, failure?: string, own = false): void {
		// A process that could not be started reports an error, and sometimes an exit too.
		if (this.workers.get(threadId) !== child) return;
		this.workers.delete(threadId);
		this.heardAt.delete(child);
		console.log(`${threadId}: session closed`);
		if (failure === undefined) return;
		console.error(`${threadId}: ${failure}`);
		// What it left in flight goes back to the queue now, not when its lease runs out. A process that failed by itself,
		// for example because an extension does not load, costs the waiting messages an attempt.
		this.queue.abandon(threadId, child.pid, own ? failure : undefined);
	}
}
