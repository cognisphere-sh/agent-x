// `agentx upgrade-project`: moves the project to the latest agentx, then brings the project and every agent up to that version's templates.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { agentFolders, configFile, projectConfig, saveProjectConfig } from "../../agent-runtime/project-config.js";
import { projectAgentX } from "../agent-root.js";
import { agentxDependency, agentxPackage, installedCli, runCli } from "../pinned-cli.js";
import { added, addMissingEnv, addMissingKeys, addMissingLines, type Change, printChanges, templateText } from "../template-sync.js";
import { upgradeAgentFiles } from "./upgrade-agent.js";

/**
 * Upgrades the project whose root, `agent-x/` or `agent-x/agents/` is `cwd`. When agent-x pins a version other than the registry's latest, it installs
 * the latest and runs it to bring the files up to its own templates; otherwise it brings them up to this agentx's. Resolves to the exit status.
 */
export async function upgradeProject(cwd: string): Promise<number> {
	const agentX = projectAgentX(cwd);
	const pinned = String(agentxDependency(agentX));
	// A version from the registry, as init-project pins it, not a link to a checkout.
	const fromRegistry = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pinned);
	const latest = fromRegistry ? pnpm(agentX, ["view", `${agentxPackage}@latest`, "version"]).trim() : pinned;
	if (latest !== pinned) {
		console.log(`Upgrading agentx ${pinned} to ${latest}.`);
		pnpm(agentX, ["add", "--save-exact", `${agentxPackage}@${latest}`], "inherit");
		// This copy has the old templates. The new one, now the latest, brings the files up to its own.
		return runCli(installedCli(agentX), ["upgrade-project"]);
	}
	console.log(fromRegistry ? `agentx ${pinned} is the latest.` : `agentx is pinned as ${pinned}, not a version from the registry: the files are brought up to the agentx installed.`);

	const config = projectConfig(agentX);
	const keys = addMissingKeys(config, JSON.parse(templateText("project/agent-x/agentx.json")));
	if (keys.length > 0) saveProjectConfig(agentX, config);
	const env = join(agentX, ".env");
	const gitignore = join(dirname(agentX), ".gitignore");
	const changes: Change[] = [
		...added(configFile(agentX), keys),
		...added(env, addMissingEnv(env, templateText("project/agent-x/env"))),
		...added(gitignore, addMissingLines(gitignore, templateText("project/gitignore"))),
		...agentFolders(agentX).flatMap((name) => upgradeAgentFiles(join(agentX, "agents", name))),
	];
	printChanges(cwd, changes);
	return 0;
}

// Runs pnpm with `args` in `dir`, and returns what it printed; with `inherit`, it prints to this terminal. Throws why it failed.
function pnpm(dir: string, args: string[], output: "pipe" | "inherit" = "pipe"): string {
	const result = spawnSync("pnpm", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", output, output] });
	if (result.error !== undefined || result.status !== 0) {
		throw new Error(`pnpm ${args.join(" ")} failed in ${dir}${result.error ? `: ${result.error.message}` : result.stderr ? `:\n${result.stderr.trim()}` : "."}`);
	}
	return result.stdout ?? "";
}
