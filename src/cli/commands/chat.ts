// `agentx chat [--thread-id <id>] [pi args]`: opens Pi on one thread of an agent, for a person, without changing anything the agent's author checked in.

import { spawnSync } from "node:child_process";
import { agentEnv } from "../../agent-runtime/agent-env.js";
import { piCli, sessionFlags } from "../../agent-runtime/pi/pi-launch.js";
import { isThreadId, withQueue, workflowPrefix } from "../../agent-runtime/events/queue.js";

// Pi reads its subcommands only as the first argument, so no flags may come before them.
const piSubcommands = ["install", "remove", "uninstall", "update", "list", "config", "mcp", "auth"];
// Pi's own ways of choosing a session, and the flags that open none. With one of them, Pi picks the session among the thread's, or opens none.
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
	// A thread is a folder of Pi sessions, `main` unless given. It is written `--thread-id main` or `--thread-id=main`.
	const at = options.findIndex((arg) => arg === "--thread-id" || arg.startsWith("--thread-id="));
	let threadId = "main";
	let rest = args;
	if (at >= 0) {
		const inline = args[at] !== "--thread-id";
		threadId = inline ? args[at].slice("--thread-id=".length) : args[at + 1];
		if (!threadId) throw new Error("--thread-id takes a thread id, such as --thread-id main");
		rest = args.toSpliced(at, inline ? 1 : 2);
	}
	if (!isThreadId(threadId)) throw new Error(`Invalid thread id "${threadId}": use letters, digits, ".", "_" and "-", starting and ending with a letter or digit.`);
	if (threadId.startsWith(workflowPrefix)) throw new Error(`Thread "${threadId}" is a workflow's: its events run a script, not Pi. Use --thread-id <other>.`);
	// Without a choice of the caller's, the thread's latest session goes on. Two processes writing one session split the conversation in two,
	// so a thread another process runs is refused here; when the caller picks the session (-c, -r, ...), the event queue extension checks instead.
	const continueLatest = !options.some((arg) => sessionChoices.includes(arg.split("=")[0]));
	if (continueLatest && withQueue(agentRoot, (queue) => queue.heldElsewhere(threadId))) {
		throw new Error(`Thread "${threadId}" is running in another process. Use --thread-id <other>, or try again when that run is over.`);
	}
	return [...sessionFlags(agentRoot, threadId, continueLatest), ...rest];
}
