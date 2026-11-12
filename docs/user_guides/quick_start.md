# Quick start

Requires Node 22.19 or later, pnpm and git.

```sh
pnpm add -g agent-x                     # once: the agentx command
agentx init-project my-project          # or, inside an empty folder: agentx init-project
cd my-project
pnpm install                            # installs agent-x/ and web/
agentx init-agent main
pnpm dev                                # app on http://localhost:3000
```

In a second terminal:

```sh
cd my-project/agent-x/agents/main
agentx run                              # the agent
```

The first time, type `/login` in the session and choose a provider. Pi tells you so when you send a message without a login.

`web/` and `agent-x/` are two independent packages, each with its own install, so they can be deployed apart (for example the app on Vercel, the agents on a server). `pnpm install` in the root installs both; `pnpm install` inside one installs only that one. npm works the same way; use one package manager per project.

`agentx` commands work in the project root, in `agent-x/` and in an agent, and always run the agentx version the project pins. Without the global command, `pnpm exec agentx <command>` runs the pinned copy from `agent-x/` or an agent, and `pnpm agentx <command>` from the project root.

You now have:

- `web/`: a Next.js app with `GET /api/health`.
- `agent-x/agents/main/`: an agent. Log in once in any agent; the login is stored in `agent-x/.pi/auth.json` (gitignored) and used by all agents of the project.

Next: [run an agent](run_an_agent.md), [send it messages](send_messages.md), [customize an agent](customize_an_agent.md).

Until agentx is published, use a local build: [develop_agentx.md](develop_agentx.md#use-a-local-build-in-a-project).
