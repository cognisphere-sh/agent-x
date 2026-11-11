# Project

What `agentx init-project [name]` creates, from `templates/project/`.

```
my-project/
  .gitignore            node_modules/, web/.next/, web/next-env.d.ts, agent-x/.pi/; per agent: storage/, .pi/npm/, .pi/git/
  package.json          scripts only: install (both packages), dev, build (the app's), agentx (the pinned CLI)
  web/                  Next.js (App Router); its own package
    app/layout.tsx, app/page.tsx
    app/api/health/route.ts   GET -> { ok: true }
  agent-x/              everything of agentx in the project; its own package
    package.json        dependency agent-x (exact version); npm workspaces ["agents/*"]
    pnpm-workspace.yaml the same workspaces for pnpm
    .pi/                Pi's agent directory, shared by all agents; gitignored, created by Pi
    agents/             one directory per agent, created by init-agent
```

## Packages

`web/` and `agent-x/` are independent packages: each has its own `package.json`, lockfile and `node_modules`, can be installed with its own `npm install`, and can be deployed without the other ([D14](#d14)). They run as separate processes: the app is the Next.js server; agents run under `agentx run` and later the [runtime](../runtime/README.md).

`agent-x/` depends on the `agent-x` npm package at an exact version, as a dependency so that a production install keeps it. Its agents are its workspaces, which is how `npm run pi` in an agent finds the `agentx` bin in `agent-x/node_modules/.bin` under npm and pnpm. Workspace names must be unique, so agents are `agent-<name>`.

The root has no dependencies, only scripts. `install` makes `npm install` or `pnpm install` in the root install `agent-x/` and then `web/` with the same package manager: both run a package's `install` script as part of installing, and the script reads the package manager's name from `npm_config_user_agent`. `npm run dev` and `npm run build` run the app's scripts; `agent-x/` has nothing to build or start until `agentx serve` exists. `npm run agentx -- <command>` runs the pinned CLI without npx ([CLI](../cli/README.md#where-the-command-comes-from)).

## Git

`init-project` runs `git init`. Besides being expected, this bounds Pi's search for `.agents/skills` at the project root ([D7](#d7)).

## Not decided yet

- How the app talks to agents (through the runtime's queue is the expected path; see [Runtime](../runtime/README.md)).

## Decisions

<a id="d7"></a>
### D7. Accept `~/.agents/skills`; bound ancestor skills with `git init`

- **Problem.** Pi loads `~/.agents/skills` for every project, and `.agents/skills` from ancestors up to the git root.
- **Decision.** `init-project` runs `git init`, so the ancestor search stops at the project root. `~/.agents/skills` is accepted.
- **Rejected.** Excluding `~/.agents/skills` through generated user-level settings in `storage/pi`: violates [D4](../agent/README.md#d4) and adds code to make the CLI and SDK skill sets identical, which is not a goal.
- **Superseded in part.** `~/.agents/skills` is hidden from the model by the system prompt extension ([D18](../pi-package/README.md#d18)).

<a id="d9"></a>
### D9. npm workspaces plus `pnpm-workspace.yaml`; template ships `gitignore`

- **Decision.** The project root declares `web` and `agent-x/*` as workspaces for npm and pnpm. The template's `.gitignore` is stored as `gitignore` and renamed by `init-project`.
- **Why.** One install for app and agents; agents find the `agentx` bin in root `node_modules/.bin`. npm strips `.gitignore` from published packages.
- **Superseded in part.** Agents are at `agent-x/agents/*` ([D13](#d13)). The root has no workspaces; agents are workspaces of `agent-x/` ([D14](#d14)).

<a id="d13"></a>
### D13. Agents live in `agent-x/agents/`

- **Problem.** With agents directly in `agent-x/`, anything else agentx keeps in a project would sit among the agent directories and match the `agent-x/*` workspace glob.
- **Decision.** Agents are at `agent-x/agents/<name>/`. The storage ignore rule uses `agent-x/agents/*`.
- **Why.** `agent-x/` is the home of everything agentx in the project; agents are one kind of thing in it.

<a id="d14"></a>
### D14. `web/` and `agent-x/` are independent packages

- **Problem.** The app and the agents are deployed to different places (for example the app on Vercel, the agents on a VPS) and run as separate processes. With one root workspace, neither installs without the other, and the app's install pulls in Pi.
- **Decision.** No workspaces in the project root. `web/` and `agent-x/` each have their own `package.json`, lockfile and `node_modules`. `agent-x/package.json` holds the `agent-x` dependency and lists `agents/*` as workspaces (also in `agent-x/pnpm-workspace.yaml`). The root `package.json` has only scripts: `install` installs both packages, and `agentx` runs the pinned CLI from `agent-x/node_modules`. `init-agent` accepts the root or `agent-x/` as the current directory.
- **Why.** Each side installs and deploys alone. agentx's Pi package is in `agent-x/node_modules/agent-x` under npm and pnpm alike. Agents as workspaces of `agent-x/` is what lets pnpm find the `agentx` bin from an agent.
- **Rejected.** `agent-x/` as a workspace of the root: npm hoists its dependency to the root and pnpm does not, so one settings path cannot fit both. `npm exec agentx` in the root script: when `agent-x/` is not installed, npm would offer to download `agentx`, an unrelated package ([D12](../cli/README.md#d12)).
- **Consequence.** Two installs and two lockfiles, run together by the root's `install` script. The root has no `agentx` bin of its own; the CLI hands over to the pinned copy ([D15](../cli/README.md#d15)).
