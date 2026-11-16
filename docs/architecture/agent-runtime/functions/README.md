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

`contracts.ts` holds the types: `Router`, `Workflow`, their contexts, and `Event`. The package's `types`, `src/index.ts`, exports them with the services' ([coordinator](../../coordinator-runtime/README.md#the-projects-own-services)), so the code gets them with `import type { Router } from "agent-x"`. The package exports no values: a workflow sends with `ctx.send`.

Routers and workflows are `.ts` files ([D74](#d74)), which Node imports by stripping their types. The project's `agent-x/package.json` has `"type": "module"`, so Node reads them as ES modules without first trying CommonJS, and warning that it did. It makes every `.js` file under `agent-x/` an ES module too: a script with `require` there must be a `.cjs` file. Node does not check the types, and refuses TypeScript that needs compiling: `enum`, `namespace`, and constructor parameter properties. A relative import names the `.ts` file.

## Known limits

- An import is resolved from the file's real path. The agent's `storage/` links into `agent-x/storage/<agent>/`, so its router and workflows find the project's packages. A `storage` mounted outside `agent-x/` would not.

## Decisions

<a id="d74"></a>
### D74. Routers, workflows and the project's services are TypeScript, which Node runs by stripping the types

- **Problem.** The code a developer and an agent write for agentx needs one language. Pi extensions are already `.ts`, which Pi loads with no build step.
- **Decision.** The routers are `event_router.ts`, and a workflow's script must be a `.ts` file. Node, which agentx needs at 24.12 or later, imports them as they are, by stripping their types. The project's `agent-x/package.json` has `"type": "module"`.
- **Why.** One language for everything written for an agent, extensions included, with the contracts as plain types. Nothing is compiled, so an agent can still write its own router and workflows and use them at once.
- **Rejected.** Both `.ts` and `.mjs`: two kinds of file to look for, document and test, for the same thing.
- **Consequence.** Types are never checked when the code runs, and TypeScript that needs compiling, such as `enum`, is refused. Every `.js` file under `agent-x/` is an ES module too, so a CommonJS script, with `require`, must be named `.cjs`.
