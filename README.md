# agentx

Creates projects that hold a Next.js full-stack app and [pi coding agent](https://github.com/earendil-works/pi) agents, and runs each agent with only its own config: its events, its routers, workflows and schedules.

```sh
pnpm add -g agent-x
agentx init-project my-project
cd my-project
pnpm install
agentx init-agent main
cd agent-x/agents/main && agentx chat    # talk to it; agentx run runs it on its own
```

Start with the [quick start](docs/user_guides/quick_start.md). All docs: [docs/README.md](docs/README.md).

## Repository layout

```
CLAUDE.md                 Goals, mental model, and how docs are kept current.
docs/                     High-level design, one folder per module as in src/, user guides, tasks.
src/
  cli/                    The agentx command: entry point, the hand-over to the pinned copy, one file per command.
  agent-runtime/          Everything that runs one agent.
    supervisor/           agentx run: three loops, their limits, stopping, and the agent's process the coordinator starts.
    events/               The queue (SQLite), the inbox and outbox, sending, and the router loop.
    workflows/            Events handled by a script.
    functions/            Calls a router or workflow in a child process; their types.
    pi/                   Starting Pi, the Pi runner, and pi-package/, which Pi loads into every agent.
  coordinator-runtime/    agentx serve: every agent of a project, delivery, schedules, /health and /agents.
test/                     The queue, and end to end agentx run, agentx serve and Composio, against a fake model and a fake Composio.
templates/                project/ for init-project, agent/ for init-agent.
```
