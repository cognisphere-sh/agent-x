# Develop agentx

## Build and check

```sh
pnpm install
pnpm run check    # type check
pnpm run build    # writes dist/, which the agentx command runs, and marks the CLI file executable
pnpm test         # builds, then runs test/*.test.mjs
```

The tests need no login and no network. `test/queue.test.mjs` exercises the queue, with several processes on one file. `test/runner.test.mjs` creates scratch projects in the temp directory, with this checkout linked in as their agentx, and runs the built CLI, the runner and real Pi processes in them against `test/fake-model.mjs`, a stand-in for a model endpoint on localhost. It takes about a minute and a half.

## Run the local build

Register the checkout's commands once; `agentx` is then available in any directory:

```sh
pnpm add -g .                          # in the agentx checkout, after pnpm run build
agentx init-project my-project         # anywhere
```

`pnpm remove -g agent-x` removes them.

## Use a local build in a project

agentx is not published yet, so the version that `init-project` pins cannot be installed from the registry. Until agentx is installed in the project, every command there but `init-project` stops. Replace the pinned version with the local build:

```sh
cd my-project/agent-x
pnpm link <path-to-agentx>        # with npm: npm install <path-to-agentx>
```

Then install the project from its root with the same package manager. pnpm and npm record a local path differently (`link:` and `file:`), so do not mix them in one project.

Rebuild agentx after changes (`pnpm run build`); the project uses `dist/` through the link. Changes to `src/agent-runtime/pi-package/` reach agents without a rebuild: Pi loads it from the link when a session starts. The exception is the queue code in `extensions/message-queue/`, which the CLI and the runner use from `dist/`: rebuild after changing it.

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first and update the docs in the same change.
