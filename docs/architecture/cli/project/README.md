# Project

What `agentx init-project [name]` creates from `templates/project/`.

```
my-project/
  .gitignore            node_modules/, web/.next/, the server's web/.next-a/, web/.next-b/ and web/.agentx-web.env, web/next-env.d.ts, agent-x/.pi/, agent-x/.env,
                        agent-x/storage/, and per agent its .env, its storage link, .pi/npm/, .pi/git/
  package.json          scripts only: install, dev (agentx dev), build, agentx
  deploy/               the project's own check.sh and setup.sh, which agentx dev and agentx server run; stubs, a comment each (cli/deploy D105)
  web/                  Next.js (App Router); its own package
    app/api/health/route.ts   GET -> { ok: true }
    next.config.ts      distDir from AGENTX_WEB_DIST_DIR, else .next, so a server builds beside the running app (cli/deploy D107)
    tsconfig.json       lists the types folders of .next, .next-a and .next-b, so no build changes it
  agent-x/              agentx's part of the project; its own package
    package.json        depends on @cognisphere-sh/agentx, at an exact version; `"type": "module"`, for the routers, workflows and services, which are `.ts` (D74)
    pnpm-workspace.yaml pnpm's settings for this package: the dependencies whose install scripts it does not run (allowBuilds), which pnpm 11 otherwise refuses
    agentx.json         the project's agents: description and canSendTo (coordinator D63); the coordinator's services' config under `services`, and `publicUrl` (D68)
    .pi/                Pi's agent directory, shared by all agents; gitignored
    .env                the coordinator's API token and its services' secrets, which no agent reads; gitignored; starts with each secret the services use, commented out
    agents/<name>/      one folder per agent, with its keys in its own .env (agent D43)
    services/           the project's own coordinator services, a folder each (coordinator D75); empty
    storage/<name>/     each agent's runtime state; gitignored
```

The templates ship `gitignore`, `agent-x/env` and the agent's `env`, which `init-project` and `init-agent` copy with a dot before their names, because npm drops `.gitignore`, and may drop `.env` files, from published packages. `agentx upgrade-project` adds to `agentx.json`, `agent-x/.env` and `.gitignore` what a later version's templates add ([CLI](../README.md#d100)).

## Packages

`web/` and `agent-x/` are separate packages ([D14](#d14)): each installs and deploys alone. The app is the Next.js server; the agents run under `agentx serve` or `agentx run`.

`agent-x/` depends on `@cognisphere-sh/agentx` as a normal dependency, so a production install keeps it. Agents are plain folders, not packages.

The root has scripts only: `install` installs both packages, `dev` runs [`agentx dev`](../deploy/README.md#agentx-dev), the agents and the app, `build` runs the app's, and `agentx` runs the pinned CLI ([CLI](../README.md#where-the-command-comes-from)).

## Not decided yet

How the app talks to agents. The coordinator's [API](../../coordinator-runtime/README.md#the-api-server) reports and controls them with a token the web app's server holds; sending them events from the app, and how answers get back, are [planned](../../../tasks/backlog/web-app-api.md).

## Decisions

<a id="d7"></a>
### D7. `init-project` runs `git init`, which bounds Pi's search for skills

- **Decision.** `init-project` runs `git init`, and stops with an error if it fails.
- **Why.** Pi searches for `.agents/skills` in the working directory and each parent up to the git root. Without a repository, folders above the project would add skills to its agents.
- **Consequence.** `~/.agents/skills` still loads, but the system prompt extension hides it from the model.

<a id="d14"></a>
### D14. `web/` and `agent-x/` are independent packages

- **Decision.** No workspaces: `web/` and `agent-x/` each have their own `package.json`, lockfile and `node_modules`; the root has only scripts.
- **Why.** The app and the agents deploy apart, and the app must not pull in Pi.
