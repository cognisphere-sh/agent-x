# Project

What `agentx init-project [name]` creates from `templates/project/`.

```
my-project/
  .gitignore            node_modules/, web/.next/, web/next-env.d.ts, agent-x/.pi/, agent-x/.env; per agent: storage/, .pi/npm/, .pi/git/
  package.json          scripts only: install (both packages), dev, build (the app's), agentx (the pinned CLI)
  web/                  Next.js (App Router); its own package
    app/layout.tsx, app/page.tsx
    app/api/health/route.ts   GET -> { ok: true }
  agent-x/              everything of agentx in the project; its own package
    package.json        dependency agent-x (exact version)
    .pi/                Pi's agent directory, shared by all agents; gitignored, created by Pi
    .env                keys for all agents, such as COMPOSIO_API_KEY; gitignored, written by the developer
    agents/             one folder per agent, agents/<name>/, created by init-agent
```

npm drops `.gitignore` from published packages, so the template ships `gitignore` and `init-project` renames it.

## Packages

`web/` and `agent-x/` are separate packages ([D14](#d14)). Each has its own `package.json`, lockfile and `node_modules`, installs alone and deploys alone. They run as separate processes: the app is the Next.js server, and agents run under `agentx run` (later also the [agent runner](../../agent-runtime/agent-runner/README.md)).

`agent-x/` depends on the `agent-x` npm package at an exact version. It is a dependency, not a dev dependency, so a production install keeps it. Agents are plain folders, not packages. `pnpm exec agentx` finds the bin in `agent-x/node_modules/.bin` from `agent-x/` and from every agent.

The root has scripts only:

- `install` installs `agent-x/` and then `web/`. It uses the package manager that ran it, read from `npm_config_user_agent`, so it works with pnpm and npm.
- `dev` and `build` run the app's scripts. `agent-x/` has nothing to build or start.
- `agentx` runs the pinned CLI: `pnpm agentx <command>` ([CLI](../README.md#where-the-command-comes-from)).

## Git

`init-project` runs `git init` and stops with an error if it fails. The repository stops Pi's search for `.agents/skills` at the project root ([D7](#d7)).

## Not decided yet

- How the app talks to agents. Any process on the machine can put messages on an agent's [queue](../../agent-runtime/pi-package/message-queue/README.md), and `agentx send` does so from a shell. What the app calls, and how answers get back, is open ([Agent runtime](../../agent-runtime/README.md#open-questions)).

## Decisions

<a id="d7"></a>
### D7. `init-project` runs `git init`, which bounds Pi's search for skills

- **Decision.** `init-project` runs `git init`, so Pi's search for `.agents/skills` stops at the project root.
- **Why.** Pi searches the working directory and each parent up to the git root. Without a repository, folders above the project would add skills to its agents.
- **Consequence.** `~/.agents/skills` still loads, but agentx's system prompt extension hides it from the model.

<a id="d14"></a>
### D14. `web/` and `agent-x/` are independent packages

- **Decision.** No workspaces: `web/` and `agent-x/` each have their own `package.json`, lockfile and `node_modules`, and the root has only scripts.
- **Why.** The app and the agents deploy apart (say, the app on Vercel and the agents on a server), and the app must not pull in Pi.
- **Consequence.** The root has no `agentx` bin, so any `agentx` hands over to the pinned copy ([D15](../README.md#d15)).
