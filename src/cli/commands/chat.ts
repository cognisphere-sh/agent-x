// `agentx chat [--thread-id <id>] [pi args]`: opens Pi on one thread of an agent, for a person, without changing anything the agent's author checked in.

import { spawnSync } from "node:child_process";
import { agentEnv } from "../../agent-runtime/agent-env.js";
import { piCli, sessionFlags } from "../../agent-runtime/pi/pi-launch.js";
import { isThreadId, withQueue, workflowPrefix } from "../../agent-runtime/events/queue.js";

// Pi reads its subcommands only as the first argument, so no flags may come before them.
const piSubcommands = ["install", "remove", "uninstall", "update", "list", "config", "mcp", "auth"];
// Pi's own ways of choosing a session, and the flags that open none. With one of them, Pi decides which thread the session is.
const sessionChoices = ["--session-id", "--session", "-c", "--continue", "-r", "--resume", "--fork", "--no-session", "--export", "--list-models", "-h", "--help", "-v", "--version"];

/** Runs the Pi CLI pinned by this harness in `agentRoot` with the project's `agent-x/.pi` as its agent directory; returns its exit status. */
export function chatAgent(agentRoot: string, args: string[]): number {
	const piArgs = piSubcommands.includes(args[0] ?? "") ? args : sessionArgs(agentRoot, args);
	const result = spawnSync(process.execPath, [piCli, ...piArgs], { cwd: agentRoot, stdio: "inherit", env: agentEnv(agentRoot) });
	return result.status ?? 1;
}

// Pi's arguments for a session: agentx's flags, the thread, and what the caller passed.
function sessionArgs(agentRoot: string, args: string[]): string[] {
	// What follows `--` is the prompt, not options.
	const options = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
	// A thread is a Pi session, and its id is the session's id. --thread-id is agentx's name for Pi's --session-id; it is written `--thread-id main` or `--thread-id=main`.
	const at = options.findIndex((arg) => arg === "--thread-id" || arg.startsWith("--thread-id="));
	let threadId: string | undefined;
	let rest = args;
	if (at >= 0) {
		const inline = args[at] !== "--thread-id";
		threadId = inline ? args[at].slice("--thread-id=".length) : args[at + 1];
		if (!threadId) throw new Error("--thread-id takes a thread id, such as --thread-id main");
		rest = args.toSpliced(at, inline ? 1 : 2);
	} else if (!options.some((arg) => sessionChoices.includes(arg))) {
		threadId = "main";
	}
	// The thread whose folder holds the session: the one given, or the session Pi is told to open, or main, where Pi also picks among sessions (-c, -r).
	const sessionId = options.find((arg, index) => options[index - 1] === "--session-id") ?? options.find((arg) => arg.startsWith("--session-id="))?.slice("--session-id=".length);
	const folder = threadId ?? sessionId ?? "main";
	if (!isThreadId(folder)) throw new Error(`Invalid thread id "${folder}": use letters, digits, ".", "_" and "-", starting and ending with a letter or digit.`);
	if (folder.startsWith(workflowPrefix)) throw new Error(`Thread "${folder}" is a workflow's: its events run a script, not Pi. Use --thread-id <other>.`);
	// Two processes writing one session split the conversation in two. When Pi picks the session itself, the event queue extension checks instead.
	const thread = threadId;
	if (thread !== undefined && withQueue(agentRoot, (queue) => queue.heldElsewhere(thread))) {
		throw new Error(`Thread "${thread}" is running in another process. Use --thread-id <other>, or try again when that run is over.`);
	}
	return [...sessionFlags(agentRoot, folder, threadId !== undefined), ...rest];
}
