# Agent runtime

Everything that runs one agent, by function. `agent-env.ts` is the environment all of the agent's processes get.

- `supervisor/`: `agentx run` itself, the `AgentSupervisor` that runs three loops, and their limits.
- `events/`: an event before anyone handles it: the queue, `sendEvent`, and the `EventRouter` loop.
- `workflows/`: events handled by a script: the `WorkflowRunner` and the lists of workflows.
- `functions/`: calling the router or a workflow in a child process, and their types, which the package exports.
- `pi/`: events handled by Pi: how Pi is started, the `PiRunner`, and `pi-package/`, what Pi loads into every agent.

`AgentManager` (`agent-manager.ts`) is not built yet.

See [docs/architecture/agent-runtime/](../../docs/architecture/agent-runtime/README.md).
