// The agent's browser: the agent-browser agentx pins, run on one of the agent's profiles. A profile is a Chrome profile folder in the agent's storage, so
// what a site keeps, such as a sign-in, stays from run to run, and its agent-browser session of the same name is one browser, shared by the agent's threads.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentEnvFile, withEnvFile } from "../agent-env.js";
import { storageOf } from "../storage.js";

/** The agent-browser this harness pins, never one on the PATH, so every agent runs the same version. */
const agentBrowserCli = fileURLToPath(import.meta.resolve("agent-browser/bin/agent-browser.js"));

/** The profile the agent's browser uses unless it is given another. */
export const defaultProfile = "default";

// What a profile may be called. It is also the session's name, which goes into a socket path that must stay under 104 bytes.
const profileRule = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Installs the Chrome this agent-browser expects in the user's ~/.agent-browser/, for every agent the user runs, and on Linux the system libraries it
 * needs, through sudo; returns its exit status.
 */
export function installBrowser(): number {
	return spawnSync(process.execPath, [agentBrowserCli, "install", "--with-deps"], { stdio: "inherit" }).status ?? 1;
}

/** Runs agent-browser with `args` on the profile `profile` of the agent in `agentRoot`, in this terminal; returns its exit status. */
export function runBrowser(agentRoot: string, profile: string, args: string[]): number {
	if (!profileRule.test(profile)) throw new Error(`"${profile}" is not a profile name: lowercase letters, digits, - and _, up to 32, starting with a letter or digit.`);
	const storage = storageOf(agentRoot);
	const folder = join(storage, "workspace", "browser");
	const env = {
		// The agent's .env, which its processes have, also when only the agent's two variables are set, as in an image that installs Chrome.
		...withEnvFile(agentEnvFile(agentRoot)),
		// agent-browser keeps its sockets and its own state in ~/.agent-browser/namespaces/<namespace>/: a socket path in storage/ would be too long.
		// One per agent, so two agents, also of two projects, never share a session.
		AGENT_BROWSER_NAMESPACE: `agentx-${createHash("sha256").update(realpathSync(storage)).digest("hex").slice(0, 12)}`,
		AGENT_BROWSER_DOWNLOAD_PATH: join(folder, "downloads"),
		AGENT_BROWSER_SCREENSHOT_DIR: join(folder, "screenshots"),
	};
	const result = spawnSync(process.execPath, [agentBrowserCli, "--session", profile, "--profile", join(folder, "profiles", profile), ...args], { env, stdio: "inherit" });
	if (result.error) throw result.error;
	return result.status ?? 1;
}
