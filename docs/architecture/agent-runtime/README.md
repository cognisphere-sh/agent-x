# Agent runtime

Everything that runs one agent, in `src/agent-runtime/` ([D34](#d34)). `agentx run` uses it to start Pi for a person at a terminal, and the `AgentRunner` uses it to work an agent's queue without one.

```
src/agent-runtime/
  pi-launch.ts           how Pi is started for an agent, by `agentx run` and by the runner
  agent-runner.ts        class AgentRunner: serves one agent's queue
  pi-package/            what Pi loads into every agent
    extensions/system-prompt/    builds the system prompt
    extensions/message-queue/    the agent's message queue and the extension that works it
  agent-manager.ts       class AgentManager (planned)
```

| Module | Covers |
|---|---|
| [agent](agent/README.md) | An agent directory, and how Pi is started in it (`pi-launch.ts`) |
| [agent-runner](agent-runner/README.md) | `AgentRunner`: a Pi process for each thread with messages, and what becomes of the messages when one ends |
| [pi-package](pi-package/README.md) | The Pi package agentx adds to every agent: how it loads, the system prompt extension |
| [pi-package/message-queue](pi-package/message-queue/README.md) | The agent's message queue and the extension that delivers its messages |
| [pi](pi/README.md) | The Pi behavior all of this relies on |

## Planned

- **AgentManager.** Creates, starts, stops and cleans up each agent's sandbox.

## Open questions

- What a sandbox is (process, container, VM) and how `storage/` maps into it.
- How the app sends messages and gets answers: it can put messages on the queue file today, but there is no API for it and no path back.

## Decisions

<a id="d34"></a>
### D34. `src/agent-runtime/` and `src/coordinator-runtime/`, beside `src/cli/`

- **Problem.** The runner, the way Pi is started and the Pi package with the queue are used together, by `agentx run` and by the runner. The coordinator is another program with another job.
- **Decision.** `src/agent-runtime/` holds everything that runs one agent: `agent-runner.ts`, `pi-launch.ts`, `pi-package/`, and later `agent-manager.ts`. `src/coordinator-runtime/` is for the process that runs all agents of a project. Both sit in `src/` beside `cli/`, and `docs/architecture/` has the same folders.
- **Why.** What is used together for one thing shares a folder, and each runtime has a folder with its name, with no level between it and `src/`.
