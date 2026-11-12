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
    package.json        dependency agent-x (exact version)
    .pi/                Pi's agent directory, shared by all agents; gitignored, created by Pi
    agents/             one directory per agent, created by init-agent
```

## Packages

`web/` and `agent-x/` are independent packages: each has its own `package.json`, lockfile and `node_modules`, can be installed with its own `pnpm install`, and can be deployed without the other ([D14](#d14)). They run as separate processes: the app is the Next.js server; agents run under `agentx run` and later under the [agent runner](../../agent-runtime/agent-runner/README.md).

`agent-x/` depends on the `agent-x` npm package at an exact version, as a dependency so that a production install keeps it. It is the only package there: an agent is a plain folder. The `agentx` bin is in `agent-x/node_modules/.bin`, where `pnpm exec agentx` finds it from `agent-x/` and from every agent.

The root has no dependencies, only scripts. `install` makes `pnpm install` in the root install `agent-x/` and then `web/` with the same package manager, and npm does the same: both run a package's `install` script as part of installing, and the script reads the package manager's name from `npm_config_user_agent`. `pnpm dev` and `pnpm build` run the app's scripts. `agent-x/` has nothing to build or start. `pnpm agentx <command>` runs the pinned CLI from the root ([CLI](../README.md#where-the-command-comes-from)).

## Git

`init-project` runs `git init`. Besides being expected, this bounds Pi's search for `.agents/skills` at the project root ([D7](#d7)).

## Not decided yet

- How the app talks to agents. Each agent has a [queue](../../agent-runtime/pi-package/message-queue/README.md) that any process on the machine can put messages on, and `agentx send` does that from a shell. What the app calls, and how an answer gets back to it, is open ([Agent runtime](../../agent-runtime/README.md#open-questions)).

## Decisions

<a id="d7"></a>
### D7. `init-project` runs `git init`, which bounds Pi's search for skills

- **Problem.** Pi loads `.agents/skills` from the working directory and its ancestors, up to the git root. Without a repository, folders above the project would add skills to its agents.
- **Decision.** `init-project` runs `git init`, so the search stops at the project root.
- **Consequence.** `~/.agents/skills` loads regardless; it is hidden from the model ([D18](../../agent-runtime/pi-package/README.md#d18)).

<a id="d9"></a>
### D9. The template ships `gitignore`; `init-project` renames it

- **Problem.** npm strips `.gitignore` from published packages, so a template cannot carry one.
- **Decision.** The template's file is named `gitignore`, and `init-project` renames it to `.gitignore`.

<a id="d13"></a>
### D13. Agents live in `agent-x/agents/`

- **Problem.** `agent-x/` holds more than agents: its package files and Pi's shared directory. Agents need a folder of their own, which one ignore rule can name.
- **Decision.** Agents are at `agent-x/agents/<name>/`.
- **Why.** `agent-x/` is the home of everything agentx in the project; agents are one kind of thing in it.

<a id="d14"></a>
### D14. `web/` and `agent-x/` are independent packages

- **Problem.** The app and the agents are deployed to different places (for example the app on Vercel, the agents on a server) and run as separate processes. Each must install without the other, and the app's install must not pull in Pi.
- **Decision.** No workspaces in the project root. `web/` and `agent-x/` each have their own `package.json`, lockfile and `node_modules`. `agent-x/package.json` holds the `agent-x` dependency, and an agent is a folder in it, not a package. The root `package.json` has only scripts.
- **Why.** Each side installs and deploys alone. agentx is in `agent-x/node_modules/agent-x` under pnpm and npm alike, and its `agentx` bin is found there from `agent-x/` and from every agent.
- **Rejected.** `npm exec agentx` in the root script: when `agent-x/` is not installed, npm would offer to download `agentx`, an unrelated package ([D12](../README.md#d12)).
- **Consequence.** Two installs and two lockfiles, run together by the root's `install` script. The root has no `agentx` bin of its own; the CLI hands over to the pinned copy ([D15](../README.md#d15)).
