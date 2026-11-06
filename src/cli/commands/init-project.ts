// `agentx init-project <name>`: creates a project with a Next.js app in app/ and agents in harness/.

import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { copyTemplate, harnessPackage } from "../copy-template.js";

/** Creates `<cwd>/<name>` from templates/project, pins this harness as a dev dependency and makes it a git repo. */
export function initProject(name: string, cwd: string): void {
	const root = resolve(cwd, name);
	copyTemplate("project", root, {
		name: basename(root),
		devDependencies: { [harnessPackage.name]: harnessPackage.version },
	});
	// npm drops .gitignore files from published packages, so the template ships it as `gitignore`.
	renameSync(join(root, "gitignore"), join(root, ".gitignore"));
	// Pi loads `.agents/skills` from an agent and its parent directories up to the git root.
	// The project's own git root keeps skills of directories above the project out.
	spawnSync("git", ["init", "-q"], { cwd: root, stdio: "inherit" });
	console.log(`Created ${root}

Next:
  cd ${name}
  npx ${harnessPackage.name} init-agent main
  npm install
  npm run dev                    # the app
  cd harness/main && npm run pi  # the agent`);
}
