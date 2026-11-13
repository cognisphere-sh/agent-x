# Functions

The agent's router and its workflows are functions, written by the agent or its developer. This module calls them, and defines their contract.

```
src/agent-runtime/functions/
  function-call.ts   callFunction: calls a function in a child process, with a time limit
  function-host.ts   the child process: imports the module, calls its default export
  contracts.ts       the types of the router and workflows, which the agent-x package exports
```

## Calling a function

- A child process of `node`, in the agent directory, with the agent's environment, `agent-env.ts`, the one Pi gets ([Agent](../pi/README.md#how-agentx-chat-starts-pi)), in a process group of its own.
- The job, the module's path and the event, goes to the child over the IPC channel, and the outcome comes back the same way: the function's result, or the error it threw. The code may print anything; its output goes to the caller, which keeps it in a log.
- The child imports the module and calls its default export. After the call, the caller kills the child's process group, so nothing the code started is left behind.
- A call past its time limit has its process group killed. A child whose IPC channel closes, because `agentx run` ended, exits.

## The contracts

`contracts.ts` holds the types: `Router`, with `RouterContext` and `RouteResult`; `Workflow`, with `WorkflowContext` and `SendOptions`; and `Event`, what both get. `package.json` names its declarations as the package's `types`, so the agent's code gets them with `import type { Router } from "agent-x"`, or in a `.mjs` file with `/** @type {import("agent-x").Router} */`. The package exports no values: a function that sends uses `ctx.send`, or the `agentx` command on its `PATH`.

## Known limits

- Routers and workflows are JavaScript or TypeScript modules. Code in another language is called from the function.
- An import is resolved from the file's real path. When `storage/` is linked in from elsewhere, the router and workflows will no longer find the project's packages from their own folder. Node's `--preserve-symlinks` would fix that, but it breaks packages that pnpm installs with dependencies of their own.
- Starting Node costs about 50 ms per call.
