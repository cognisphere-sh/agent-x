# Develop agentx

## Build and check

```sh
npm install
npm run check    # type check
npm run build    # writes dist/, which the agentx command runs
```

## Run the local build

```sh
node <path-to-agentx>/dist/cli/agentx.js init-project /tmp/my-project
```

## Use a local build in a project

agentx is not published yet, so the version that `init-project` pins cannot be installed from the registry. Replace it with the local build:

```sh
cd my-project
npm install -D <path-to-agentx>
```

Rebuild agentx after changes (`npm run build`); the project uses `dist/` through the link.

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first and update the docs in the same change.
