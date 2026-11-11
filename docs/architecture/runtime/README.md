# Runtime

Status: planned. Only the directories exist. Started later by `agentx serve`.

```
src/runtime/
  coordinator/   the always-running process
  agents/
    agent-manager.ts   class AgentManager
    agent-runner.ts    class AgentRunner
```

## Components

**Coordinator.** The always-running process. Starts the `AgentManager` and the `AgentRunner`s, and owns the message queue.

**AgentManager.** Creates, starts, stops and cleans up each agent's sandbox.

**AgentRunner.** Takes messages for an agent from the queue and invokes the Pi SDK in that agent's sandbox.

`AgentManager` and `AgentRunner` are two classes in one directory because they share the notion of an agent and its sandbox ([D10](#d10)).

## Constraints from the rest of the design

- An SDK session must behave like `agentx run` for the same agent directory: `cwd` = agent directory, Pi agent directory = `agent-x/.pi`, no context files, `.pi/` trusted, sessions in `storage/sessions`, and agentx's Pi package loaded ([D16](../pi-package/README.md#d16)).
- Pi's MCP extension reads the agent directory from the `PI_CODING_AGENT_DIR` env var, not from SDK options, so per-agent isolation in one process needs care (see [Pi integration](../pi/README.md#sdk)).
- Nothing in the agent directory changes when an agent starts ([D4](../agent/README.md#d4)).

## Open questions

- Queue technology and message format.
- What a sandbox is (process, container, VM) and how `storage/` maps into it.
- One process per agent or many agents per process (the env var above favors one per agent).

## Decisions

<a id="d8"></a>
### D8. No SDK integration and no `models.json` yet

- **Decision.** No SDK integration and no per-agent `models.json` until they are needed. The SDK comes with this runtime.
- **Why.** Prototypes of both were built and removed: they added code before anything used it. What the SDK prototype taught is in [Pi integration](../pi/README.md#sdk).

<a id="d10"></a>
### D10. Runtime layout: `coordinator/` and `agents/`

- **Decision.** `src/runtime/coordinator/` for the always-running process; `src/runtime/agents/` for two classes, `AgentManager` and `AgentRunner`.
- **Why.** Both classes act on an agent and its sandbox; one directory keeps them together. Nothing is built until the runtime is designed ([open questions](#open-questions)).
