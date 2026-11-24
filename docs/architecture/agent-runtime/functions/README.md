# Functions

The agent's router and workflows are functions, written by the agent and its developer. This module calls them, and defines their contract.

```
src/agent-runtime/functions/
  function-call.ts   callFunction: calls a function in a child process, with a time limit
  function-host.ts   the child process: imports the module, calls its default export
  composio-tool.ts   a workflow's ctx.composio: runs one Composio tool as the agent
  contracts.ts       the types of routers and workflows, which the @cognisphere-sh/agentx package exports
```

## Calling a function

- Each call is a child `node` process in the agent directory, with the agent's environment (`agent-env.ts`, the one Pi gets), in a process group of its own.
- The job goes to the child over the IPC channel, and the result, or the error the function threw, comes back the same way. What the code prints goes to the caller: a workflow's into its log, a router's into a log only when the router fails.
- After the call, or past its time limit, the caller kills the child's process group, so nothing the code started is left behind. A child whose IPC channel closes, because `agentx run` ended, exits.

## The contracts

`contracts.ts` holds the types: `Router`, `Workflow`, their contexts, and `Event`. The package's `types`, `src/index.ts`, exports them with the services' ([coordinator](../../coordinator-runtime/README.md#the-projects-own-services)), so the code gets them with `import type { Router } from "@cognisphere-sh/agentx"`. The package exports no values: a workflow sends with `ctx.send` and runs Composio tools with `ctx.composio`.

Routers and workflows are `.ts` files ([D74](#d74)), which Node imports by stripping their types. The project's `agent-x/package.json` has `"type": "module"`, so Node reads them as ES modules without first trying CommonJS, and warning that it did. It makes every `.js` file under `agent-x/` an ES module too: a script with `require` there must be a `.cjs` file. Node does not check the types, and refuses TypeScript that needs compiling: `enum`, `namespace`, and constructor parameter properties. A relative import names the `.ts` file.

## Composio in a workflow

`ctx.composio(tool, args)` runs one [Composio](../pi/pi-package/composio/README.md) tool as the agent and resolves to the tool's `data` ([D82](#d82)):

```ts
await ctx.composio("TELEGRAM_SEND_MESSAGE", { chat_id: event.metadata.chat, text: "Your invoice is filed." });
```

- The run's first call makes a Composio session with Composio's REST API: for the agent's `agentx.composio.userId`, with the policy its threads get (`policy.ts` of the Composio extension), read from the agent's `.pi/settings.json`. The run's other calls use it too, also calls made at once. Making it gives up after 10 seconds.
- Each call is `POST /api/v3.1/tool_router/session/<id>/execute` with `tool_slug` and `arguments`, with `COMPOSIO_API_KEY` from the agent's environment; `COMPOSIO_BASE_URL` points it elsewhere, as the tests do. The workflow's own time limit bounds a call.
- Only `result_type: "completed"` is success. Otherwise it throws, with Composio's reason and its log id: a tool that failed, a call a session hook blocked, or one that needs a person, such as an account to connect or an approval. A missing key or user id, or an answer that is not 2xx, throws too. The run then fails, and its babysitter thread hears why ([Workflows](../workflows/README.md#failure-reports)).

Routers get no `ctx.composio`: they only pick a thread.

## Known limits

- **A Composio session per run.** A run that calls `ctx.composio` makes one more call to Composio, for its session.
- An import is resolved from the file's real path. The agent's `storage/` links into `agent-x/storage/<agent>/`, so its router and workflows find the project's packages. A `storage` mounted outside `agent-x/` would not.

## Decisions

<a id="d74"></a>
### D74. Routers, workflows and the project's services are TypeScript, which Node runs by stripping the types

- **Problem.** The code a developer and an agent write for agentx needs one language. Pi extensions are already `.ts`, which Pi loads with no build step.
- **Decision.** The router is `event_router.ts`, and a workflow's script must be a `.ts` file. Node, which agentx needs at 24.12 or later, imports them as they are, by stripping their types. The project's `agent-x/package.json` has `"type": "module"`.
- **Why.** One language for everything written for an agent, extensions included, with the contracts as plain types. Nothing is compiled, so the agent can write its router and workflows and use them at once.
- **Rejected.** Both `.ts` and `.mjs`: two kinds of file to look for, document and test, for the same thing.
- **Consequence.** Types are never checked when the code runs, and TypeScript that needs compiling, such as `enum`, is refused. Every `.js` file under `agent-x/` is an ES module too, so a CommonJS script, with `require`, must be named `.cjs`.

<a id="d82"></a>
### D82. A workflow runs Composio tools with `ctx.composio`, in a session of its run with the agent's policy

- **Problem.** Work that needs no judgement belongs in a workflow, but much of it acts in an outside service, such as sending a Telegram message. The agent's Composio tools are only in its Pi sessions, and the prompt forbids calling Composio's API with the key.
- **Decision.** `WorkflowContext` has `composio(tool, args)`. At its first call, a run makes a Composio session for the agent's user id with the policy from the agent's `.pi/settings.json`, through the same `policy()` as the Composio extension, and runs each tool with Composio's execute route, with `fetch`. The prompt allows Composio through the tools and `ctx.composio` only.
- **Why.** A workflow acts with the same accounts and limits as the agent's threads, and a developer's `toolkits` still hold. A run is one process with no Pi session to keep a session in, so a session per run needs no state. Two REST calls need no SDK ([D40](../pi/pi-package/composio/README.md#d40)).
- **Rejected.** Scripts that call Composio's API themselves: each would copy the policy, or skip it. A Composio session kept across runs: state on disk, and a way to tell when the settings change, to save one call per run.
