// The web app's builds on a server, beside the running one. Builds take turns between two folders, web/.next-a/ and web/.next-b/: next builds into the
// one the app is not serving, then the app starts again on it. The template's web/next.config.ts takes the folder from AGENTX_WEB_DIST_DIR, which the
// web unit reads from web/.agentx-web.env.

import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEnvFile } from "../../agent-runtime/agent-env.js";

// The variable that names the web app's build folder, which web/next.config.ts reads; `.next` when it is unset, as under next dev.
const distDirVariable = "AGENTX_WEB_DIST_DIR";

/** The env file that names the build the web app serves, which its unit reads. */
export const webBuildFile = (root: string) => join(root, "web", ".agentx-web.env");

/** The `next` command of the web app of the project in `root`. */
export const nextCli = (root: string) => join(root, "web", "node_modules", ".bin", "next");

/**
 * Builds the web app of the project in `root` into the folder it is not serving, and names that folder in the env file, so the app's next start serves
 * the new build; returns the folder. Throws when the build fails, and the running app keeps its build.
 */
export function buildWeb(root: string): string {
	const web = join(root, "web");
	const next = nextCli(root);
	if (!existsSync(next)) throw new Error("web/ is not installed: run pnpm install in the project's root.");
	const file = webBuildFile(root);
	const folder = readEnvFile(file)[distDirVariable] === ".next-a" ? ".next-b" : ".next-a";
	console.log(`Building the web app into web/${folder}/, while the running one serves its build.`);
	const started = Date.now();
	const build = spawnSync(next, ["build"], { cwd: web, stdio: "inherit", env: { ...process.env, [distDirVariable]: folder } });
	if (build.status !== 0) throw new Error("The web app's build failed: the running app keeps its build, and nothing was restarted.");
	// The folder may hold an earlier build, which next build replaces, keeping its cache: only a BUILD_ID from this build shows it went there.
	const buildId = join(web, folder, "BUILD_ID");
	if (!existsSync(buildId) || statSync(buildId).mtimeMs < started - 1000) {
		throw new Error(`next build did not write web/${folder}/: web/next.config.ts must set distDir: process.env.${distDirVariable} ?? ".next", as agentx's template does.`);
	}
	writeFileSync(file, `${distDirVariable}=${folder}\n`);
	return folder;
}
