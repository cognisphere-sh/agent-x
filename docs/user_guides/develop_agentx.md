# Develop agentx

## Build and check

```sh
pnpm install
pnpm run check    # type check
pnpm run build    # writes dist/, which the agentx command runs
pnpm test         # builds, then runs test/*.test.mjs
```

The tests need no login and no network.

- `test/queue.test.mjs` tests the queue, with several processes sharing one file.
- `test/runner.test.mjs` creates scratch projects in the temp directory, with this checkout linked in as their agentx. It runs the built CLI, `agentx run` and real Pi processes against `test/fake-model.mjs`, a fake model server on localhost.
- `test/agentx-run.test.mjs` does the same for the rest of `agentx run`: the routers, workflows and their failure reports, stopping, and a crashed loop.
- `test/coordinator.test.mjs` tests the `AgentManager` with stand-in processes, delivery and schedules, and `agentx serve` end to end: two agents, delivery between them, refusals, restarts and stopping.
- `test/composio.test.mjs` does the same for the Composio extension, also against `test/fake-composio.mjs`, a fake Composio with its session routes and an MCP endpoint.

## Run the local build

Register the checkout's commands once. `agentx` then works in any directory:

```sh
pnpm add -g .                          # in the agentx checkout, after pnpm run build
agentx init-project my-project         # anywhere
```

`pnpm remove -g agent-x` removes them.

## Use a local build in a project

To try a local build in a project, link it in place of the version it pins:

```sh
cd my-project/agent-x
pnpm link <path-to-agentx>        # with npm: npm install <path-to-agentx>
```

Then install the project from its root with the same package manager. pnpm writes the path as `link:` and npm as `file:`, so do not mix them in one project.

After a change to agentx:

| Changed | Do |
|---|---|
| Most code | `pnpm run build`. The project uses `dist/` through the link. |
| `src/agent-runtime/pi/pi-package/`, and `events/queue.ts`, `sqlite.ts` and `project-config.ts`, which its extensions import | Nothing for Pi, which loads them as source when a session starts. For `queue.ts`, `sqlite.ts` and `project-config.ts`, also `pnpm run build`: the rest of agentx uses them from `dist/`. |

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first, and update the docs in the same change.
