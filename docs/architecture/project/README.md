# Project

What `agentx init-project <name>` creates, from `templates/project/`.

```
my-project/
  .gitignore            node_modules/, app/.next/, app/next-env.d.ts, harness/*/storage/
  package.json          npm workspaces ["app", "harness/*"]; devDependency agentx (exact version)
  pnpm-workspace.yaml   the same workspaces for pnpm
  app/                  Next.js (App Router)
    app/layout.tsx, app/page.tsx
    app/api/health/route.ts   GET -> { ok: true }
  harness/              one directory per agent, created by init-agent
```

## Workspaces

The project root, `app/` and every `harness/<agent>/` are workspace packages. One `npm install` at the root installs everything, and agentx's bin lands in the root `node_modules/.bin`, which npm scripts in any workspace find. Package names must be unique, so the app is `app` and agents are `agent-<name>`.

Root scripts: `npm run dev` and `npm run build` run the app's scripts.

## Git

`init-project` runs `git init`. Besides being expected, this bounds Pi's search for `.agents/skills` at the project root ([D7](#d7)).

## Not decided yet

- How the app talks to agents (through the runtime's queue is the expected path; see [Runtime](../runtime/README.md)).
- pnpm is configured but untested.

## Decisions

<a id="d7"></a>
### D7. Accept `~/.agents/skills`; bound ancestor skills with `git init`

- **Problem.** Pi loads `~/.agents/skills` for every project, and `.agents/skills` from ancestors up to the git root.
- **Decision.** `init-project` runs `git init`, so the ancestor search stops at the project root. `~/.agents/skills` is accepted.
- **Rejected.** Excluding `~/.agents/skills` through generated user-level settings in `storage/pi`: violates [D4](../agent/README.md#d4) and adds code to make the CLI and SDK skill sets identical, which is not a goal.

<a id="d9"></a>
### D9. npm workspaces plus `pnpm-workspace.yaml`; template ships `gitignore`

- **Decision.** The project root declares `app` and `harness/*` as workspaces for npm and pnpm. The template's `.gitignore` is stored as `gitignore` and renamed by `init-project`.
- **Why.** One install for app and agents; agents find the `agentx` bin in root `node_modules/.bin`. npm strips `.gitignore` from published packages.
