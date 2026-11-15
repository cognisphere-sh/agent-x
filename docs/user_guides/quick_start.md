# Quick start

You need Node 22.19 or later, pnpm and git.

```sh
pnpm add -g agent-x                     # once: the agentx command
agentx init-project my-project          # or, in an empty folder: agentx init-project
cd my-project
pnpm install                            # installs agent-x/ and web/
agentx init-agent main
pnpm dev                                # app on http://localhost:3000
```

In a second terminal:

```sh
cd my-project/agent-x/agents/main
agentx chat                             # talk to the agent
```

The first time, type `/login` in the session and pick a provider. The login is saved in `agent-x/.pi/auth.json` (gitignored), and all agents of the project share it.

For Gmail, Calendar, Drive and other services, put a Composio key in `agent-x/.env` (gitignored): `COMPOSIO_API_KEY=...`. See [External services](customize_an_agent.md#external-services-composio).

What you get:

- `web/`: a Next.js app with `GET /api/health`.
- `agent-x/agents/main/`: an agent.

`web/` and `agent-x/` are separate packages, so you can deploy them apart. `pnpm install` in the root installs both; inside one, only that one. npm works too, but use one package manager per project.

`agentx` works in the project root, in `agent-x/` and in an agent, and always runs the version the project pins. Before `pnpm install`, it stops and asks you to run it. Without a global `agentx`, use `pnpm exec agentx <command>` in `agent-x/` or an agent, and `pnpm agentx <command>` in the root.

Next: [chat with an agent](chat_with_an_agent.md), [run it and send it events](send_events.md), [customize an agent](customize_an_agent.md).
