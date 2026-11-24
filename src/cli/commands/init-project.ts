// `agentx init-project <name>`: creates a project with a Next.js app in web/ and agents in agent-x/agents/.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { copyTemplate, harnessRoot, setPackageFields } from "../copy-template.js";

/** Creates `<cwd>/<name>` (`.` for `cwd` itself) from templates/project, pins this harness as a dependency of its agent-x/ and makes it a git repo. */
export function initProject(name: string, cwd: string): void {
	const root = resolve(cwd, name);
	const projectName = basename(root);
	copyTemplate("project", root);
	setPackageFields(root, { name: projectName });
	// The version of this harness, pinned exactly. A dependency, not a dev dependency: a production install of agent-x/ must keep it.
	const { version } = JSON.parse(readFileSync(join(harnessRoot, "package.json"), "utf8"));
	setPackageFields(join(root, "agent-x"), {
		name: `${projectName}-agent-x`,
		dependencies: { "agent-x": version },
	});
	// Pi loads `.agents/skills` from an agent and its parent directories up to the git root.
	// The project's own git root keeps skills of directories above the project out.
	const git = spawnSync("git", ["init", "-q"], { cwd: root, stdio: "inherit" });
	if (git.status !== 0) throw new Error(`Created ${root}, but git init failed${git.error ? ` (${git.error.message})` : ""}. Run git init in it: without a repository, Pi loads skills from the folders above the project.`);
	console.log(`Created ${root}

Next:${name === "." ? "" : `
  cd ${name}`}
  pnpm install                             # installs agent-x/ and web/
  agentx init-agent main
  pnpm dev                                 # the agents and the app, on this machine
  cd agent-x/agents/main && agentx chat    # talk to the agent; agentx run runs it on its own`);
}
