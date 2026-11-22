// The agent's time zone, and times as the agent reads them. Every time the agent sees is in its time zone, `agentx.timezone` in its settings, or the
// machine's when that names none: its processes run in it, and the harness writes the times it shows the agent in it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `zone`, the agent's `agentx.timezone`, when Node knows it; otherwise undefined, for the machine's. */
export function knownTimeZone(zone: string | null | undefined): string | undefined {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone ?? undefined });
		return zone ?? undefined;
	} catch {
		return undefined;
	}
}

/** The time zone of the agent in `agentRoot`, read by code outside Pi from its checked-in `.pi/settings.json`; undefined for the machine's, also when the
 * settings cannot be read. */
export function agentTimeZone(agentRoot: string): string | undefined {
	try {
		const zone = (JSON.parse(readFileSync(join(agentRoot, ".pi", "settings.json"), "utf8")) as { agentx?: { timezone?: unknown } }).agentx?.timezone;
		return typeof zone === "string" ? knownTimeZone(zone) : undefined;
	} catch {
		return undefined;
	}
}

/** A time as the agent reads it, in `timeZone` or the machine's: "Wednesday 2026-11-11 21:59:54 GMT+5:30". */
export function dayDateTime(time: number, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "shortOffset",
		timeZone,
	}).formatToParts(time);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((found) => found.type === type)?.value;
	return `${part("weekday")} ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} ${part("timeZoneName")}`;
}
