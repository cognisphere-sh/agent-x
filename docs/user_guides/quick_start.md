# Quick start

Requires Node 22+ and git.

```sh
npx agent-x init-project my-project     # or, inside an empty folder: npx agent-x init-project
cd my-project
npm install                             # installs agent-x/ and web/
npx agent-x init-agent main
npm run dev                             # app on http://localhost:3000
```

In a second terminal:

```sh
cd my-project/agent-x/agents/main
npm run pi                             # agent; run /login in the first session
```

`web/` and `agent-x/` are two independent packages, each with its own install, so they can be deployed apart (for example the app on Vercel, the agents on a server). `npm install` in the root installs both; `npm install` inside one installs only that one. pnpm works the same way; use one package manager per project.

`agentx` commands work in the project root, in `agent-x/` and in an agent, and always run the agentx version the project pins.

You now have:

- `web/`: a Next.js app with `GET /api/health`.
- `agent-x/agents/main/`: an agent. Log in once in any agent; the login is stored in `agent-x/.pi/auth.json` (gitignored) and used by all agents of the project.

Next: [run an agent](run_an_agent.md), [customize an agent](customize_an_agent.md).

Until agentx is published, use a local build: [develop_agentx.md](develop_agentx.md#use-a-local-build-in-a-project).
