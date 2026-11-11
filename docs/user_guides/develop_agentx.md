# Develop agentx

## Build and check

```sh
pnpm install
pnpm run check    # type check
pnpm run build    # writes dist/, which the agentx command runs
```

## Run the local build

Link the checkout once; `agentx` and `npx agent-x` then run the local build from any directory:

```sh
npm link                               # in the agentx checkout, after pnpm run build
npx agent-x init-project my-project    # anywhere
```

`npm unlink -g agent-x` removes the link.

## Use a local build in a project

agentx is not published yet, so the version that `init-project` pins cannot be installed from the registry. Replace it with the local build:

```sh
cd my-project/agent-x
npm install <path-to-agentx>      # with pnpm: pnpm link <path-to-agentx>
```

Then install the project from its root with the same package manager. npm and pnpm record a local path differently (`file:` and `link:`), so do not mix them in one project.

Rebuild agentx after changes (`pnpm run build`); the project uses `dist/` through the link. Changes to `src/agent-runtime/pi-package/` need no rebuild: agents load it from the link on the next prompt.

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first and update the docs in the same change.
