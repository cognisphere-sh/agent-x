---
name: developer-services
title: Let a project's developer write coordinator services in agent-x/services/
description: A project's own services, in agent-x/services/<name>/index.ts, run in agentx serve beside agentx's, on the same contract; routers and workflows move from .mjs to .ts with them.
type: feature
priority: none
status: done
modules: [coordinator-runtime, agent-runtime/functions, agent-runtime/events, agent-runtime/workflows, cli/project]
created: 2026-11-16
updated: 2026-11-16
---
# Let a project's developer write coordinator services in agent-x/services/

Built on 2026-11-16. The design: [the project's own services](../../architecture/coordinator-runtime/README.md#the-projects-own-services), and [write a service](../../user_guides/write_a_service.md).

## What was built

In the commit that moves this task to `done/`, in two steps.

1. **Everything a project writes for agentx is `.ts`.** The routers are `event_router.ts`, and a workflow's script must be a `.ts` file; Node runs them by stripping their types. The project's `agent-x/package.json` gets `"type": "module"`, without which Node warns on every file. The template router, the harness prompt's routing and workflow sections, the tests and the docs use `.ts`.
2. **The project's own services.**
   - `ServiceDefinition` (`service.ts`), the shape of every service, each member optional; agentx's `Service` class implements it, and `ServiceRunner` runs either.
   - `project-services.ts` finds `agent-x/services/<name>/index.ts`, imports one, makes it with its default export, and checks its shape.
   - The coordinator chooses its services in `start()`: core, optional, then the project's own that `agentx.json` lists. A clash with agentx's names, a bad name, or a folder that is not listed is logged and not run; one that cannot load is off, alone.
   - `src/index.ts` is the package's `types`: the routers' and workflows' contracts, and `ServiceDefinition`, `ServiceContext`, `Route`, `ApiRequest` and `ApiResponse`.
   - `init-project` makes an empty `agent-x/services/`.

## Decisions

- [D74](../../architecture/agent-runtime/functions/README.md#d74): routers, workflows and the project's services are TypeScript, which Node runs by stripping the types.
- [D75](../../architecture/coordinator-runtime/README.md#d75): a project's developer writes services of its own in `agent-x/services/`, on the same contract, in the coordinator's process.

## Changes from the plan

- **Node 24.12 or later**, up from 22.19, so the `.ts` files run on the Node line they were checked on.

- **`.ts`, not `.mjs`.** The plan picked `.mjs`, as routers and workflows were then. Pi extensions are already `.ts`, so routers, workflows and services all moved to `.ts`, and `.mjs` is no longer taken.
- **`index.ts` only**, and the types from `src/index.ts`, not from `contracts.ts`, which holds only the routers' and workflows' contracts.

## Migration

- An existing project adds `"type": "module"` to `agent-x/package.json`, renames `.pi/event_router.mjs` and `storage/knowledge/event_router.mjs` to `.ts`, and renames each workflow's script to `.ts` with its `script` in `workflows.json`. A router left as `.mjs` is no longer asked, and a workflow whose script is not `.ts` is skipped and reported. No project has been deployed, so there is no migration code.
- An agent that wrote its own router or workflows as `.mjs` learns from the harness prompt to write `.ts`.
- With `"type": "module"`, every `.js` file under `agent-x/` is an ES module, so a script there that uses `require`, such as one an agent wrote in its workspace, fails until it is renamed `.cjs`. Without it, Node would warn on every router and workflow call.

## Verification

- `pnpm test`: the routers and workflows of every test are `.ts`. A new test runs a TypeScript service of the project, with `implements`, `private`, `import type` and a relative `.ts` import: it gets its config and only its secrets, its public route delivers with `agentX-Service`, and `/routes` lists it. A file that throws on import, a default export that is not a class, a wrong shape, a folder named `relay` and one not listed are each off or not run, with a log line.
- Node 24.12 imports `.ts` with no warning. agentx now needs Node 24.12 or later (`engines`), the version checked, so Node 22, which was not checked, is no longer supported.

## Follow-ups

- Nothing catches an error a project's service throws in a timer of its own; it ends `agentx serve` ([known limits](../../architecture/coordinator-runtime/README.md#known-limits)).

## Original plan


Today every [service](../../architecture/coordinator-runtime/README.md#services) ships with agentx: core ones, always on, and optional ones such as Telegram, which `agentx.json` turns on. A developer who wants another webhook, such as Stripe's or GitHub's, or a poller of their own, must change agentx. This task lets them write the service in their project.

### What a developer writes

```
agent-x/
  services/
    github/
      index.mjs        the service: its default export
      README.md        optional; anything else the service needs, such as helpers
  agentx.json          "services": { "github": { ... } } turns it on, with its config
  .env.services        its secrets
  package.json         its npm dependencies, beside agentx
```

```js
// agent-x/services/github/index.mjs
/** @implements {import("agent-x").ServiceDefinition} */
export default class GitHub {
	secrets = ["GITHUB_WEBHOOK_SECRET"];
	routes = [{ method: "POST", path: "webhook", access: "public", summary: "GitHub's events.", handle: (request) => this.receive(request) }];
	/** @param {import("agent-x").ServiceContext} context */
	onStart(context) { this.context = context; }
	receive(request) { /* check the signature, then this.context.deliver("main", { key, content, metadata }) */ }
}
```

It gets what agentx's own services get: its config from `services.<name>`, only the secrets it names, the agents, `publicUrl`, `deliver` (with `agentX-Service: <name>`), `every`, and its routes under `/services/<name>/`, listed by `GET /routes`.

### Plan

1. **The contract, as types only.** `contracts.ts` exports `ServiceDefinition` (the shape of `Service`: `secrets`, `routes`, `onStart` and `onStop`, each optional), `ServiceContext`, `Route`, `ApiRequest` and `ApiResponse`, so a developer types a service the way routers and workflows are typed: `import type` in TypeScript, JSDoc in `.mjs`. agentx's own `Service` class implements `ServiceDefinition`. The package gets no runtime entry.
2. **Loading** (`src/coordinator-runtime/project-services.ts`). At `start()`, the coordinator imports `agent-x/services/<name>/index.mjs` for each name that `agentx.json` lists under `services` and that has such a folder. It checks that the default export is a class, makes one, and checks the shape: arrays where `secrets` and `routes` are given, functions where the hooks are. What is left out is filled in, as `Service` does. `ServiceRunner` then runs it as any service.
   - What moves: the constructor stays sync and finds the agents. Choosing the services, and the log line for a name agentx and the project lack, move into `start()`, after the folder is read.
   - **Off, alone,** with a log line: a file that fails to import, a default export that is not a class or has the wrong shape, a constructor that throws, and, as now, an `onStart` that throws.
3. **Names.** A folder's name is the service's name: letters, digits and dashes, as an agent's, since it is a path segment and the `agentX-Service` fact. A name that agentx's own services use is refused, with a log line, so no project can stand in for the relay or take Composio's route.
4. **Turned on when listed** in `agentx.json` `services`, as optional services are, with `{}` when it needs no config. A folder that is not listed is logged and not run. So a checked-in service can be off in one deployment.
5. **Order.** Developer services start after agentx's own, so they stop before them, and the relay still stops last.
6. **Template and CLI.** `init-project` makes `agent-x/services/` with a `.gitkeep`. No `init-service` command yet.
7. **Tests** (`test/coordinator.test.mjs`, the fixture project): a listed service's route is served and its `deliver` reaches the agent with `agentX-Service`; it gets only the secrets it names; a folder that is not listed does not run; a file that throws on import, and one with no class, are off while the others run; a folder named `relay` is refused.
8. **Docs.**
   - The coordinator's README: the Services section and table (a third kind, the project's own), and D66, whose "Why" says services ship with agentx; D68, which says what `services.<name>` turns on.
   - A user guide, `docs/user_guides/write_a_service.md`: layout, the contract, config and secrets, `deliver` and its key, checking a webhook's caller (public routes check their own callers), dependencies in `agent-x/package.json`, and that the agent's prompt or router must say what the service's events are, since the harness prompt knows only agentx's services.
   - The project template's doc, and the layouts in `CLAUDE.md`, `README.md` and `high_level_design.md`; the status table.

### To decide

- **How the developer gets the contract.**
  - Types only, checked by shape (pick): the way routers and workflows already work, no package entry to keep, and nothing breaks if a project has two copies of agentx's code.
  - A runtime export, so the service `extends Service`: needs `exports` in agentx's `package.json` and a class shared across copies, for defaults that are four lines.
- **One folder per service** (pick), `services/<name>/index.mjs`, room for helpers and a README, as agentx's own services have; or one file, `services/<name>.mjs`.
- **`.mjs` only** (pick), as routers and workflows are. `.ts` would rest on Node's type stripping, which prints a warning on Node 22 and refuses some TypeScript.
- **On when listed** (pick), as optional services are; or on whenever the folder exists, which leaves no way to turn one off in a deployment but deleting it.

### Trust

A developer service runs in the coordinator's process, so it is trusted as the coordinator is:

- `secrets` says what the context gives it, but it can read the coordinator's whole environment and files.
- An exception outside its hooks and routes, such as in a timer of its own, can end `agentx serve` and every agent with it. Its hooks, routes and `every` are already caught.
- Until sandboxes, an agent can write `agent-x/services/`, as it can write any file of its OS user, and its code would run in the coordinator at the next start.

Rejected: each developer service in a child process of its own. It would isolate crashes, but every `deliver`, route and `every` would cross a channel, and the trust problem stays: the developer wrote it, and it runs as the same OS user.

### Known limits

- A change to a service needs `agentx serve` started again; nothing reloads it.
- A dependency of a service goes in `agent-x/package.json`, shared with every other service, as agentx's are.

### Decisions to record when built

- A project's own services live in `agent-x/services/<name>/`, on the same contract as agentx's, given by types and checked by shape, and run in the coordinator's process.
- A developer service is on when `agentx.json` lists it, and cannot take the name of one of agentx's services.
