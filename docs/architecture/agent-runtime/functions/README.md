# Functions

The agent's routers and workflows are functions, written by the agent or its developer. This module calls them, and defines their contract.

```
src/agent-runtime/functions/
  function-call.ts   callFunction: calls a function in a child process, with a time limit
  function-host.ts   the child process: imports the module, calls its default export
  contracts.ts       the types of routers and workflows, which the agent-x package exports
```

## Calling a function

- Each call is a child `node` process in the agent directory, with the agent's environment (`agent-env.ts`, the one Pi gets), in a process group of its own.
- The job goes to the child over the IPC channel, and the result, or the error the function threw, comes back the same way. What the code prints goes to the caller: a workflow's into its log, a router's into a log only when the router fails.
- After the call, or past its time limit, the caller kills the child's process group, so nothing the code started is left behind. A child whose IPC channel closes, because `agentx run` ended, exits.

## The contracts

`contracts.ts` holds the types: `Router`, `Workflow`, their contexts, and `Event`. The package names them as its `types`, so the agent's code gets them with `import type { Router } from "agent-x"`, or in a `.mjs` file with `/** @type {import("agent-x").Router} */`. The package exports no values: a workflow sends with `ctx.send`.

## Known limits

- Routers and workflows are JavaScript or TypeScript modules.
- An import is resolved from the file's real path. The agent's `storage/` links into `agent-x/storage/<agent>/`, so its router and workflows find the project's packages. A `storage` mounted outside `agent-x/` would not.
