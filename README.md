# agentx

Creates projects that hold a Next.js full-stack app and [pi coding agent](https://github.com/earendil-works/pi) agents, and runs each agent with only its own config.

```sh
pnpm add -g agent-x
agentx init-project my-project
cd my-project
pnpm install
agentx init-agent main
cd agent-x/agents/main && agentx run
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
    commands/             One file per command: init-project, init-agent, run, send.
  agent-runtime/          Everything that runs one agent.
    agent-runner.ts       AgentRunner: starts a Pi process for each thread with messages. No command starts it yet.
    pi-launch.ts          How Pi is started for an agent, by `agentx run` and by the runner.
    pi-package/           Loaded by Pi into every agent as a package: the system prompt extension with the harness prompt, and the
                          message queue extension with the agent's message queue (SQLite), which the CLI and the runner use too.
  coordinator-runtime/    The process that runs all agents of a project. Planned.
test/                     Tests of the queue and, end to end, of the runner against a fake model.
templates/
  project/                Copied by init-project.
  agent/                  Copied by init-agent into agent-x/agents/<name>.
```
