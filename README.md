# agentx

Creates projects that hold a Next.js full-stack app and [pi coding agent](https://github.com/earendil-works/pi) agents, and runs each agent with only its own config.

```sh
npx agentx init-project my-project
cd my-project
npx agentx init-agent main
npm install
cd harness/main && npm run pi
```

Start with the [quick start](docs/user_guides/quick_start.md). All docs: [docs/README.md](docs/README.md).

## Repository layout

```
CLAUDE.md                 Goals, mental model, and how docs are kept current.
docs/                     High-level design, one folder per component, user guides.
src/
  cli/
    agentx.ts             Entry point: dispatches to a command.
    copy-template.ts      Copies templates/<name> into a new directory.
    commands/             One file per command: init-project, init-agent, run.
  runtime/                Always-running side, started by `agentx serve`. Planned.
    coordinator/          The long-running process and the message queue.
    agents/               AgentManager and AgentRunner.
templates/
  project/                Copied by init-project.
  agent/                  Copied by init-agent into harness/<name>.
```
