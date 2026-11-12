# Agent runtime

The agent runtime is the code that runs one agent. It lives in `src/agent-runtime/`, beside `src/cli/`; the planned coordinator gets its own folder, `src/coordinator-runtime/`. `agentx run` uses the agent runtime to start Pi for a person at a terminal. The `AgentRunner` uses it to work an agent's queue with no person present.

```
src/agent-runtime/
  pi-launch.ts           how Pi is started, for `agentx run` and for the runner
  agent-runner.ts        class AgentRunner: works one agent's queue
  pi-package/            what Pi loads into every agent
    extensions/system-prompt/    builds the system prompt
    extensions/message-queue/    the message queue and the extension that delivers its messages
  agent-manager.ts       class AgentManager (planned)
```

| Module | Covers |
|---|---|
| [agent](agent/README.md) | The agent directory, and how Pi is started in it (`pi-launch.ts`) |
| [agent-runner](agent-runner/README.md) | `AgentRunner`: one Pi process per thread with messages, and what happens to the messages when a process ends |
| [pi-package](pi-package/README.md) | The Pi package agentx adds to every agent: how it loads, and the system prompt extension |
| [pi-package/message-queue](pi-package/message-queue/README.md) | The message queue and the extension that delivers its messages |
| [pi](pi/README.md) | The Pi behavior all of this relies on |

## Planned

- **AgentManager.** Creates, starts, stops and cleans up each agent's sandbox.

## Open questions

- What a sandbox is (process, container or VM), and how `storage/` maps into it.
- How the app sends messages and gets answers. The app can write to the queue file, but there is no API for it and no way to answer back.
