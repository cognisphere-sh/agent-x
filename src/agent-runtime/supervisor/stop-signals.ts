// How `agentx run` and `agentx serve` are stopped: the first SIGINT or SIGTERM lets running work finish, the second stops it.

type StopSignal = "SIGINT" | "SIGTERM";

/** Calls `stop` on each SIGINT or SIGTERM, with `force` from the second on. */
export function onStopSignals(stop: (force: boolean) => void): void {
	let stops = 0;
	// `pnpm exec` sends a SIGTERM right after the terminal's Ctrl-C (pnpm 11.21); that is the same stop. A busy process can take the two in either
	// order, so a SIGINT and a SIGTERM within a second of each other are one stop, whichever came first.
	const lastAt: Record<StopSignal, number> = { SIGINT: 0, SIGTERM: 0 };
	const on = (signal: StopSignal, other: StopSignal) =>
		process.on(signal, () => {
			lastAt[signal] = Date.now();
			if (lastAt[signal] - lastAt[other] > 1000) stop(++stops > 1);
		});
	on("SIGINT", "SIGTERM");
	on("SIGTERM", "SIGINT");
}
