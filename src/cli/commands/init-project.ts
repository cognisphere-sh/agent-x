// `agentx init-project <name>`: creates a project with a Next.js app in web/ and agents in agent-x/agents/.

import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { copyTemplate, harnessPackage, setPackageFields } from "../copy-template.js";

/** Creates `<cwd>/<name>` (`.` for `cwd` itself) from templates/project, pins this harness as a dependency of its agent-x/ and makes it a git repo. */
export function initProject(name: string, cwd: string): void {
	const root = resolve(cwd, name);
	const projectName = basename(root);
	copyTemplate("project", root, { name: projectName });
	// A dependency, not a dev dependency: a production install of agent-x/ must keep it.
	setPackageFields(join(root, "agent-x"), {
		name: `${projectName}-agent-x`,
		dependencies: { [harnessPackage.name]: harnessPackage.version },
	});
	// npm drops .gitignore files from published packages, so the template ships it as `gitignore`.
	renameSync(join(root, "gitignore"), join(root, ".gitignore"));
	// Pi loads `.agents/skills` from an agent and its parent directories up to the git root.
	// The project's own git root keeps skills of directories above the project out.
	spawnSync("git", ["init", "-q"], { cwd: root, stdio: "inherit" });
	console.log(`Created ${root}

Next:${name === "." ? "" : `
  cd ${name}`}
  npm install                              # installs agent-x/ and web/
  npx ${harnessPackage.name} init-agent main
  npm run dev                              # the app
  cd agent-x/agents/main && npm run pi     # the agent`);
}
