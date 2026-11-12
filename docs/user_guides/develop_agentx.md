# Develop agentx

## Build and check

```sh
pnpm install
pnpm run check    # type check
pnpm run build    # writes dist/, which the agentx command runs
pnpm test         # builds, then runs test/*.test.mjs
```

The tests need no login and no network. They take about a minute and a half.

- `test/queue.test.mjs` tests the queue, with several processes sharing one file.
- `test/runner.test.mjs` creates scratch projects in the temp directory, with this checkout linked in as their agentx. It runs the built CLI, the runner and real Pi processes against `test/fake-model.mjs`, a fake model server on localhost.

## Run the local build

Register the checkout's commands once. `agentx` then works in any directory:

```sh
pnpm add -g .                          # in the agentx checkout, after pnpm run build
agentx init-project my-project         # anywhere
```

`pnpm remove -g agent-x` removes them.

## Use a local build in a project

agentx is not on npm yet, so the version `init-project` pins cannot be installed, and commands in the project stop. Link the local build instead:

```sh
cd my-project/agent-x
pnpm link <path-to-agentx>        # with npm: npm install <path-to-agentx>
```

Then install the project from its root with the same package manager. pnpm writes the path as `link:` and npm as `file:`, so do not mix them in one project.

After a change to agentx:

| Changed | Do |
|---|---|
| Most code | `pnpm run build`. The project uses `dist/` through the link. |
| `src/agent-runtime/pi-package/` | Nothing. Pi loads it from the link when a session starts. |
| The queue code in `pi-package/extensions/message-queue/` | `pnpm run build`. The CLI and the runner use it from `dist/`. |

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first, and update the docs in the same change.
