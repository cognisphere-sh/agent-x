# agentx

Creates projects that hold a Next.js full-stack app and [pi coding agent](https://github.com/earendil-works/pi) agents, and runs each agent with only its own config: its events, a router it keeps, and its workflows.

```sh
pnpm add -g agent-x
agentx init-project my-project
cd my-project
pnpm install
agentx init-agent main
cd agent-x/agents/main && agentx chat    # or agentx run, to run it in the background
```

Start with the [quick start](docs/user_guides/quick_start.md). All docs: [docs/README.md](docs/README.md).

## Repository layout

```
CLAUDE.md                 Goals, mental model, and how docs are kept current.
docs/                     High-level design, one folder per module in the same hierarchy as src/, user guides.
src/
  cli/
    agentx.ts             Entry point: dispatches to a command.
    copy-template.ts      Copies templates/<name> into a new directory.
    pinned-cli.ts         Finds the agentx a project pins, for the hand-over to it.
    agent-root.ts         Recognizes an agent directory.
    commands/             One file per command: init-project, init-agent, run, chat, event.
  agent-runtime/          Everything that runs one agent.
    agent-env.ts          The environment of an agent's processes: Pi, its router, its workflows.
    supervisor/           `agentx run` itself: the AgentSupervisor, which runs three loops, and their limits.
    events/               An event before anyone handles it: the queue (SQLite), how every sender adds an event, and the router loop.
    workflows/            Events handled by a script: the workflow runner and the lists of workflows.
    functions/            Calls the router or a workflow in a child process; their types, which the package exports.
    pi/                   Events handled by Pi: how Pi is started (for `agentx chat` and the Pi runner), the Pi runner, and
                          pi-package/, loaded by Pi into every agent: the system prompt extension with the harness prompt, the event
                          queue extension, which delivers events to Pi, and the Composio extension, which gives each thread Composio's tools.
  coordinator-runtime/    The process that runs all agents of a project. Planned.
test/                     Tests of the queue and, end to end, of `agentx run`, its router and workflows, and Composio, against a fake model and a fake Composio.
templates/
  project/                Copied by init-project.
  agent/                  Copied by init-agent into agent-x/agents/<name>.
```
