# Agent runtime

Everything that runs one agent. `AgentRunner` (`agent-runner.ts`) serves the agent's queue by starting a Pi process for each thread with messages. `pi-launch.ts` says how Pi is started, for `agentx run` and for the runner. `pi-package/` is what Pi loads into every agent, with the queue's code. `AgentManager` (`agent-manager.ts`) is not built yet.

See [docs/architecture/agent-runtime/](../../docs/architecture/agent-runtime/README.md).
