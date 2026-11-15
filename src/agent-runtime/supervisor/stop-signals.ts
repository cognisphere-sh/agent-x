// How `agentx run` and `agentx serve` are stopped: the first SIGINT or SIGTERM lets running work finish, the second stops it.

/** Calls `stop` on each SIGINT or SIGTERM, with `force` from the second on. */
export function onStopSignals(stop: (force: boolean) => void): void {
	let stops = 0;
	let interruptedAt = 0;
	const signalled = () => stop(++stops > 1);
	process.on("SIGINT", () => {
		interruptedAt = Date.now();
		signalled();
	});
	// `pnpm exec` sends a SIGTERM right after the terminal's Ctrl-C (pnpm 11.21); that is the same stop.
	process.on("SIGTERM", () => {
		if (Date.now() - interruptedAt > 1000) signalled();
	});
}
