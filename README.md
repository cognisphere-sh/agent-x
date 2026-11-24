# agentx

agentx is a harness around the [pi coding agent](https://github.com/earendil-works/pi). It creates projects that hold a Next.js app and Pi agents, and runs each agent with only its own config: its events, router, workflows, schedules and webhooks.

- **An agent is a folder.** Its prompt, skills, router, workflows, schedules and webhooks live in its `.pi/`, checked in. The agent and its developer both write them.
- **Everything reaches an agent as an event.** A router picks the thread. A workflow handles it with a script, or Pi does with the model.
- **The agents run on their own.** `agentx serve` runs every agent of a project, restarts one that stops, delivers between agents, fires schedules, and takes Telegram messages and webhooks.
- **Each agent comes with tools.** Gmail, Calendar, Drive and more through Composio, a browser that stays signed in, and a memory of its past work.
- **It runs anywhere.** `agentx dev` runs a project on a laptop, and `agentx server` runs it on an Ubuntu server with HTTPS.

## Quick start

You need Node 24.12 or later, pnpm and git.

```sh
pnpm add -g @cognisphere-sh/agentx      # once: the agentx command
agentx init-project my-project          # or, without installing: npx @cognisphere-sh/agentx init-project my-project
cd my-project
pnpm install                            # installs agent-x/ and web/
agentx init-agent main
pnpm dev                                # the agents, and the app on http://localhost:3000
```

In a second terminal, talk to the agent:

```sh
cd my-project/agent-x/agents/main
agentx chat
```

The first time, type `/login` in the session and pick a model provider. For Gmail, Calendar and other services, put a [Composio](https://composio.dev) key in the agent's `.env`: `COMPOSIO_API_KEY=...`.

Inside a project, `agentx` always runs the version the project pins. Without a global install, use `pnpm agentx <command>` in the project root.

Do not run `npx agentx`: `agentx` on npm is someone else's package.

## Commands

| Where | Command | What it does |
|---|---|---|
| Anywhere | `agentx init-project [name]` | Creates a project with `web/` (Next.js) and `agent-x/` |
| In a project | `agentx init-agent <name>` | Creates `agent-x/agents/<name>` |
| | `agentx remove-agent <name>` | Deletes an agent and its state |
| | `agentx serve` | Runs every agent until stopped |
| | `agentx dev` | Runs the agents and the web app on this machine, with an ngrok tunnel |
| | `agentx server setup\|start\|stop\|…` | Sets up an Ubuntu server and runs the project on it |
| | `agentx upgrade-project` | Moves the project to the latest agentx |
| In an agent | `agentx chat` | Talks to the agent, on the thread `main` unless given `--thread-id` |
| | `agentx run` | Runs the agent alone until stopped |
| | `agentx event deliver <content>` | Gives the agent an event |
| | `agentx webhook create\|list\|…` | Manages the agent's webhooks |

`agentx` with no command prints every option.

## A project

```
my-project/
  web/                     the Next.js app
  agent-x/                 the agents' package, which pins agentx
    agentx.json            the agents, and the config of each service
    agents/main/           one agent
      .pi/settings.json    its Pi packages, and agentx's settings for it
      .pi/knowledge/       its prompt, skills, router, workflows, schedules and webhooks
    storage/               every agent's runtime state (gitignored)
  deploy/                  the project's own steps for agentx dev and agentx server
```

The guides are in [docs/user_guides](docs/user_guides/), starting with the [quick start](docs/user_guides/quick_start.md). All docs: [docs/README.md](docs/README.md).

## Repository layout

```
CLAUDE.md                 Goals, mental model, and how docs are kept current.
docs/                     High-level design, one folder per module as in src/, user guides, tasks.
src/
  index.ts                The package's types, for the routers, workflows and services a project writes.
  cli/                    The agentx command: entry point, the hand-over to the pinned copy, one file per command, and what the upgrade adds from the templates.
    deploy/               agentx dev and agentx server: the logins and keys they ask for, the tunnel, the server's setup, units and Caddy config, the web app's builds.
  agent-runtime/          Everything that runs one agent.
    supervisor/           agentx run: three loops, their limits, stopping, and the agent's process the coordinator starts.
    events/               The queue (SQLite), the inbox and outbox, sending, and the router loop.
    workflows/            Events handled by a script.
    functions/            Calls a router or workflow in a child process; their types; a workflow's Composio tools.
    pi/                   Starting Pi, whether the agent's model can be reached, the Pi runner, and pi-package/, which Pi loads into every agent: extensions, and skills such as how to write a workflow.
    browser/              The agent's browser: agentx-browser, agent-browser on its profiles.
  coordinator-runtime/    agentx serve: every agent of a project, the API server, and the services, agentx's and the project's own.
    services/             One folder per service: relay/ (delivery between agents), scheduler/ (schedules), composio/ (Composio's webhook), telegram/ (Telegram bots), webhooks/ (each agent's webhooks).
test/                     The queue, and end to end agentx run, agentx serve, agentx dev, Composio and the upgrade, against a fake model and a fake Composio; what agentx server writes and builds.
templates/                project/ for init-project, agent/ for init-agent.
```

To work on agentx, see [develop agentx](docs/user_guides/develop_agentx.md).

## License

[MIT](LICENSE)
