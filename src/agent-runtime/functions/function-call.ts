// Calls code the agent wrote, its router or a workflow, in a child process of its own (function-host.ts), so the code cannot stall or crash `agentx run`.
// The job goes to the child and the outcome comes back over the IPC channel, because the code may print anything. The child has its own process group,
// so a terminal's Ctrl-C reaches only `agentx run`, and a kill ends whatever the code started too.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Event as QueuedEvent } from "../events/queue.js";
import type { Event, RouterContext } from "./contracts.js";
import { agentEnv } from "../agent-env.js";

const host = fileURLToPath(new URL("function-host.js", import.meta.url));

/** Which function is called: the router, with the agent's workflows, or a workflow, with its name. */
export type Callee = { kind: "router"; workflows: RouterContext["workflows"] } | { kind: "workflow"; workflow: string };

/** What the child is asked to do. */
export type Job = Callee & { file: string; event: Event };

/** How a call ended: the function's result, or why there is none. */
export type Outcome = { result: unknown } | { error: string; kind: "threw" | "timeout" | "stopped" | "exit" };

/** A call in progress. */
export interface Call {
	done: Promise<Outcome>;
	/** Ends the call now, with the reason as its outcome. */
	stop(): void;
}

/** Calls the default export of `file` with the event, as the contracts give it, in the agent's directory, with the agent's environment (agent-env.ts). Its output goes to `output`. */
export function callFunction(agentRoot: string, file: string, event: QueuedEvent, callee: Callee, timeoutMs: number, output: (chunk: Buffer) => void): Call {
	const job: Job = { ...callee, file, event: { id: event.id, content: event.content, metadata: event.metadata, createdAt: event.createdAt } };
	const child = spawn(process.execPath, [host], { cwd: agentRoot, env: agentEnv(agentRoot), detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
	child.stdout?.on("data", output);
	child.stderr?.on("data", output);
	let answer: Outcome | undefined;
	let ended: Outcome | undefined;
	child.on("message", (message) => (answer = message as Outcome));
	// The whole process group, also what the code started.
	const killGroup = () => {
		try {
			if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
		} catch {
			// The group is gone already.
		}
	};
	const end = (outcome: Outcome) => {
		ended ??= outcome;
		killGroup();
	};
	const timer = setTimeout(() => end({ error: `timeout: it took longer than ${timeoutMs / 1000} s`, kind: "timeout" }), timeoutMs);
	const done = new Promise<Outcome>((resolve) => {
		child.once("error", (error) => end({ error: `exit: ${error.message}`, kind: "exit" }));
		// Leftovers of the code, such as a process it started in the background, would hold the output open.
		child.once("exit", killGroup);
		// After the IPC channel has closed too, so the answer, if any, has arrived. An answer wins over a timeout or a stop that came after it.
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve(answer ?? ended ??{ error: signal ? `exit: it was stopped by ${signal}` : `exit: it exited with code ${code} without an answer`, kind: "exit" });
		});
	});
	child.send(job, () => {});
	return { done, stop: () => end({ error: "stopped: agentx run was stopped", kind: "stopped" }) };
}
