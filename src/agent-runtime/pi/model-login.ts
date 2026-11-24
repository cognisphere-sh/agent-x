// Whether an agent's model can be reached: Pi's `auth check` for the agent's provider, run as the agent runs Pi, so a key in its .env counts too.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentEnv } from "../agent-env.js";
import { agentXOf } from "../project-config.js";
import { piCli } from "./pi-launch.js";

/**
 * The provider the agent's Pi starts with: `defaultProvider` in its .pi/settings.json, else in the project's agent-x/.pi/settings.json; undefined when
 * neither names one. A file that cannot be read names none: Pi says what is wrong with it when the agent runs.
 */
export function modelProvider(agentRoot: string): string | undefined {
	for (const file of [join(agentRoot, ".pi", "settings.json"), join(agentXOf(agentRoot), ".pi", "settings.json")]) {
		const provider = settingOf(file);
		if (typeof provider === "string" && provider !== "") return provider;
	}
	return undefined;
}

// `defaultProvider` in the Pi settings file `file`; undefined when it is missing or is not JSON.
function settingOf(file: string): unknown {
	try {
		return (JSON.parse(readFileSync(file, "utf8")) as { defaultProvider?: unknown } | null)?.defaultProvider;
	} catch {
		return undefined;
	}
}

/** Whether Pi has a login or a key for `provider` where the agent runs. Pi refreshes an expired login on the way. */
export function hasModelLogin(agentRoot: string, provider: string): Promise<boolean> {
	return new Promise((resolve) => {
		const check = spawn(process.execPath, [piCli, "auth", "check", "--provider", provider], { cwd: agentRoot, env: agentEnv(agentRoot), stdio: "ignore" });
		check.on("error", () => resolve(false));
		check.on("exit", (code) => resolve(code === 0));
	});
}
