# Quick start

Requires Node 22+ and git.

```sh
npx agentx init-project my-project     # or: pnpm dlx agentx init-project my-project
cd my-project
npx agentx init-agent main
npm install
npm run dev                            # app on http://localhost:3000
```

In a second terminal:

```sh
cd my-project/harness/main
npm run pi                             # agent; run /login in the first session
```

You now have:

- `app/`: a Next.js app with `GET /api/health`.
- `harness/main/`: an agent. Its login is its own, stored in `storage/pi/auth.json` (gitignored).

Next: [run an agent](run_an_agent.md), [customize an agent](customize_an_agent.md).

Until agentx is published, use a local build: [develop_agentx.md](develop_agentx.md#use-a-local-build-in-a-project).
