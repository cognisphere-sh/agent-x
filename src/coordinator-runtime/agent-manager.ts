// AgentManager: runs one agent's process for the coordinator, which runs the agent as `agentx run` does, in its directory, and keeps it running.
// It starts the process again after it exits, with a backoff, gives up after repeated restarts, and kills a process whose heartbeat stops.
// The process is where the agent's sandbox will be: the sandbox step changes how it is started, not the coordinator.

import { type ChildProcess, spawn } from "node:child_process";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { lastBeat } from "../agent-runtime/storage.js";

/** Where the agent is: `starting` until its first heartbeat, `failed` after it was started again too often. */
export type AgentState = "starting" | "running" | "restarting" | "failed" | "stopping" | "stopped";

/** What `/agents` says about an agent. */
export interface AgentStatus {
	agent: string;
	state: AgentState;
	/** When it got into this state, in milliseconds since 1970. */
	since: number;
	/** How many times its process was started again since its last run of `goodRunMs`. */
	restarts: number;
	/** How its last process ended, or null when none has. */
	lastExit: string | null;
	pid: number | null;
}

/** The manager's times and limits. */
export interface ManagerLimits {
	/** The first wait before a start again, doubled after each, up to `lastDelayMs`. */
	firstDelayMs: number;
	lastDelayMs: number;
	/** A run this long sets the count of restarts and the wait back. */
	goodRunMs: number;
	/** A process with no heartbeat for this long is hung, and killed. */
	hungMs: number;
	/** Restarts with no good run between them, after which the agent is failed. */
	maxRestarts: number;
	/** How often the heartbeat is checked. */
	checkMs: number;
}

// The limits the coordinator uses.
const managerLimits: ManagerLimits = { firstDelayMs: 1000, lastDelayMs: 60_000, goodRunMs: 600_000, hungMs: 60_000, maxRestarts: 5, checkMs: 5000 };

// The agent runtime's own entry, run with this Node, so the agent runs the same agentx as the coordinator, without the CLI.
const agentProcess = fileURLToPath(new URL("../agent-runtime/supervisor/agent-process.js", import.meta.url));

/** Runs and watches the agent in `root`. */
export class AgentManager {
	readonly agent: string;
	private child: ChildProcess | undefined;
	private state: AgentState = "stopped";
	private since = Date.now();
	private restarts = 0;
	private lastExit: string | null = null;
	private startedAt = 0;
	// Whether to start the agent once it has stopped, for a restart; a stop in between clears it.
	private startWhenStopped = false;
	// Why the manager killed the process itself, when it did.
	private killedFor: string | undefined;
	private timer: NodeJS.Timeout | undefined;
	private watch: NodeJS.Timeout | undefined;
	private stopped: Promise<void> = Promise.resolve();
	private resolveStopped: () => void = () => {};

	constructor(
		/** The agent's directory. */
		readonly root: string,
		/** The agent's storage folder, where it writes its heartbeat. */
		private readonly storage: string,
		private readonly args: string[] = [agentProcess],
		private readonly limits: ManagerLimits = managerLimits,
	) {
		this.agent = basename(root);
	}

	/** Starts the agent's process and keeps it running. Starts a stopped or failed agent again, with its count of restarts at 0; does nothing otherwise. */
	start(): void {
		if (this.state !== "stopped" && this.state !== "failed") return;
		this.restarts = 0;
		this.stopped = new Promise((resolve) => (this.resolveStopped = resolve));
		clearInterval(this.watch);
		this.watch = setInterval(() => this.checkHeartbeat(), this.limits.checkMs);
		this.launch();
	}

	// Starts the process, the first time or again after it exited.
	private launch(): void {
		this.startedAt = Date.now();
		this.killedFor = undefined;
		// A process group of its own, so a terminal's Ctrl-C reaches only the coordinator, which decides what it means.
		// The IPC channel is the agent's lifeline: `agentx run` ends at once when it closes, as when the coordinator is killed.
		const child = spawn(process.execPath, this.args, { cwd: this.root, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
		this.child = child;
		this.set("starting");
		createInterface({ input: child.stdout! }).on("line", (line) => console.log(`${this.agent}: ${line}`));
		createInterface({ input: child.stderr! }).on("line", (line) => console.error(`${this.agent}: ${line}`));
		child.once("error", (error) => console.error(`${this.agent}: could not start: ${error.message}`));
		child.once("exit", (code, signal) => this.exited(code, signal));
	}

	/** First call: the agent finishes its running work and stops. With `force`: it stops running work now. Resolves when its process has exited. */
	stop(force = false): Promise<void> {
		this.startWhenStopped = false;
		if (this.state === "stopped") return this.stopped;
		clearTimeout(this.timer);
		if (this.child === undefined) {
			this.finish();
			return this.stopped;
		}
		// `agentx run` takes a first SIGTERM as a drain and a second as a stop.
		if (this.state !== "stopping") this.child.kill("SIGTERM");
		if (force) this.child.kill("SIGTERM");
		this.set("stopping");
		return this.stopped;
	}

	/** Stops the agent once its running work is done, then starts it. A stop meanwhile, as when agentx serve stops, cancels the start. */
	restart(): void {
		const stopped = this.stop();
		this.startWhenStopped = true;
		void stopped.then(() => {
			if (this.startWhenStopped) this.start();
		});
	}

	/** The agent's state, for `/agents`. */
	status(): AgentStatus {
		return { agent: this.agent, state: this.state, since: this.since, restarts: this.restarts, lastExit: this.lastExit, pid: this.child?.pid ?? null };
	}

	private set(state: AgentState): void {
		if (state !== this.state) this.since = Date.now();
		this.state = state;
	}

	private exited(code: number | null, signal: NodeJS.Signals | null): void {
		this.child = undefined;
		this.lastExit = this.killedFor ?? (signal === null ? `exited with code ${code}` : `stopped by ${signal}`);
		if (this.state === "stopping") return this.finish();
		if (Date.now() - this.startedAt >= this.limits.goodRunMs) this.restarts = 0;
		if (this.restarts >= this.limits.maxRestarts) {
			this.set("failed");
			console.error(`${this.agent}: failed after ${this.restarts} restarts; its last process ${this.lastExit}. Start it again with POST /agents/${this.agent}/start, or by starting agentx serve again.`);
			return;
		}
		this.restarts += 1;
		this.set("restarting");
		const delay = Math.min(this.limits.firstDelayMs * 2 ** (this.restarts - 1), this.limits.lastDelayMs);
		console.error(`${this.agent}: its process ${this.lastExit}; starting it again in ${delay / 1000} s`);
		this.timer = setTimeout(() => this.launch(), delay);
	}

	private finish(): void {
		this.set("stopped");
		clearInterval(this.watch);
		this.resolveStopped();
	}

	// Only a heartbeat written since this process started counts, so a file an earlier process left says nothing about this one.
	private checkHeartbeat(): void {
		if ((this.state !== "starting" && this.state !== "running") || this.child?.pid === undefined) return;
		const beat = lastBeat(this.storage);
		if (beat >= this.startedAt && this.state === "starting") this.set("running");
		if (Date.now() - Math.max(beat, this.startedAt) <= this.limits.hungMs) return;
		this.killedFor = `was hung: no heartbeat for ${this.limits.hungMs / 1000} s, and was killed`;
		try {
			// The whole group, so what it started goes too.
			process.kill(-this.child.pid, "SIGKILL");
		} catch {
			// It has just ended.
		}
	}
}
