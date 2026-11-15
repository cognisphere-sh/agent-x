# Project

What `agentx init-project [name]` creates from `templates/project/`.

```
my-project/
  .gitignore            node_modules/, web/.next/, web/next-env.d.ts, agent-x/.pi/, agent-x/.env, agent-x/storage/, and per agent its storage link, .pi/npm/, .pi/git/
  package.json          scripts only: install, dev, build, agentx
  web/                  Next.js (App Router); its own package
    app/api/health/route.ts   GET -> { ok: true }
  agent-x/              agentx's part of the project; its own package
    package.json        depends on agent-x, at an exact version
    agentx.json         the project's agents: description and canSendTo (coordinator D63)
    .pi/                Pi's agent directory, shared by all agents; gitignored
    .env                keys for all agents, such as COMPOSIO_API_KEY; gitignored
    agents/<name>/      one folder per agent
    storage/<name>/     each agent's runtime state; gitignored
```

The template ships `gitignore`, which `init-project` renames, because npm drops `.gitignore` from published packages.

## Packages

`web/` and `agent-x/` are separate packages ([D14](#d14)): each installs and deploys alone. The app is the Next.js server; the agents run under `agentx serve` or `agentx run`.

`agent-x/` depends on `agent-x` as a normal dependency, so a production install keeps it. Agents are plain folders, not packages.

The root has scripts only: `install` installs both packages, `dev` and `build` run the app's, and `agentx` runs the pinned CLI ([CLI](../README.md#where-the-command-comes-from)).

## Not decided yet

How the app talks to agents. A person gives an agent an event with `agentx event deliver`, and [webhooks](../../../tasks/backlog/coordinator-webhooks.md) are planned. What the app calls, and how answers get back, is open.

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
