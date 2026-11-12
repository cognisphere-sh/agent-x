// `agentx run [--thread-id <id>] [pi args]`: starts Pi in an agent directory without changing anything the agent's author checked in.

import { spawnSync } from "node:child_process";
import { piCli, piEnv, sessionFlags } from "../../agent-runtime/pi-launch.js";
import { Queue } from "../../agent-runtime/pi-package/extensions/message-queue/queue.js";

// Pi reads its subcommands only as the first argument, so no flags may come before them.
const piSubcommands = ["install", "remove", "uninstall", "update", "list", "config", "mcp", "auth"];
// Pi's own ways of choosing a session, and the flags that open none. With one of them, Pi decides which thread the session is.
const sessionChoices = ["--session-id", "--session", "-c", "--continue", "-r", "--resume", "--fork", "--no-session", "--export", "--list-models", "-h", "--help", "-v", "--version"];

/** Runs the Pi CLI pinned by this harness in `agentRoot` with the project's `agent-x/.pi` as its agent directory; returns its exit status. */
export function runAgent(agentRoot: string, args: string[]): number {
	const piArgs = piSubcommands.includes(args[0] ?? "") ? args : sessionArgs(agentRoot, args);
	const result = spawnSync(process.execPath, [piCli, ...piArgs], { cwd: agentRoot, stdio: "inherit", env: piEnv(agentRoot) });
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
	// Two processes writing one session split the conversation in two. When Pi picks the session itself, the message queue extension checks instead.
	if (threadId !== undefined) {
		const queue = new Queue(agentRoot);
		const busy = queue.heldElsewhere(threadId);
		queue.close();
		if (busy) throw new Error(`Thread "${threadId}" is running in another process. Use --thread-id <other>, or try again when that run is over.`);
	}
	return [...sessionFlags(agentRoot, threadId), ...rest];
}
