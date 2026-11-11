# CLI

The `agentx` command, published in the npm package `agent-x` ([D12](#d12)). Built from `src/cli/` into `dist/cli/`; `package.json` `bin` points `agentx` and `agent-x` at `dist/cli/agentx.js`.

## Files

| File | Role |
|---|---|
| `src/cli/agentx.ts` | Entry point. Reads `argv`, dispatches to a command, prints usage or the error message and exits 1 on failure. |
| `src/cli/copy-template.ts` | `copyTemplate(template, target, packageFields)`: copies `templates/<template>` to a missing or empty directory and merges fields into its `package.json`. Exports `setPackageFields(dir, fields)` and `harnessPackage` (agentx's own name and version). |
| `src/cli/pinned-cli.ts` | `pinnedCli(cwd)`: the CLI entry file of the agentx the project around `cwd` pins, or undefined ([D15](#d15)). |
| `src/cli/commands/<name>.ts` | One file per command. Exports one function. |

## Commands

| Command | Function | Does |
|---|---|---|
| `agentx init-project [name]` | `initProject(name, cwd)` | Creates `<cwd>/<name>` from `templates/project`, or fills the current directory when no name is given and names the project after it. The target must be missing or empty. Names `agent-x/package.json` `<project>-agent-x` and pins `agent-x` as its dependency ([D14](../project/README.md#d14)), renames `gitignore` to `.gitignore` ([D9](../project/README.md#d9)), runs `git init` ([D7](../project/README.md#d7)). See [project.md](../project/README.md). |
| `agentx init-agent <name>` | `initAgent(name, cwd)` | Run in the project root or in `agent-x/`: uses `agent-x/agents/` or `agents/` of the current directory, whichever exists. Creates `agent-x/agents/<name>` from `templates/agent`, names the package `agent-<name>`, creates `storage/workspace`. See [Agent](../agent/README.md). |
| `agentx run [pi args]` | `runAgent(agentRoot, piArgs)` | Starts the pinned Pi CLI in the current directory, which must be an agent, with agentx's Pi package and the agent's session folder. See [Agent](../agent/README.md#how-agentx-run-starts-pi). |

Planned: `upgrade`, `serve` (starts the [runtime](../runtime/README.md)).

## Where the command comes from

The pinned agentx is installed in the project's `agent-x/node_modules`. Inside `agent-x/` and its agents, npm and pnpm find the `agentx` bin there. In the project root, `npx agent-x` finds a global link or the registry copy, and the root script `agentx` (`node agent-x/node_modules/agent-x/dist/cli/agentx.js`) runs the pinned copy directly.

Whichever copy starts, the pinned one does the work ([D15](#d15)). Before dispatching, `agentx.ts` calls `pinnedCli(cwd)`, which looks for `agent-x/node_modules/agent-x/dist/cli/agentx.js` and `node_modules/agent-x/dist/cli/agentx.js` in `cwd` and each parent directory. If it finds a copy that is not the running one (compared by real path, so a linked checkout counts as the same), the CLI runs that copy with the same arguments and `cwd` and exits with its status. `init-project` is never handed over: it creates a new project.

## Conventions

- Commands throw `Error` with a user-facing message; only `agentx.ts` prints and exits.
- Commands take the directory they act on as a parameter instead of reading `process.cwd()`, so the runtime can call them later.
- `run` is called through npm scripts in the agent's `package.json`. npm and pnpm run scripts with the package directory as `cwd`, which is why `process.cwd()` is the agent directory.

## Adding a command

1. Add `src/cli/commands/<name>.ts` exporting one function.
2. Add a branch and a usage line in `src/cli/agentx.ts`.
3. Add a row above and, if it involved a choice, an entry under "Decisions" in the README of the component it affects.


## Decisions

<a id="d12"></a>
### D12. npm package `agent-x`; the command stays `agentx`

- **Problem.** `agentx` on npm is an unrelated package, so `npx agentx` outside a project would run someone else's code.
- **Decision.** The package is `agent-x`. Its command is `agentx`, with `agent-x` as a second name for it, so `npx agent-x <command>` works from the registry and from a global link (`npm link`), where npx looks for a bin named like the package. Projects depend on `agent-x`; agents run `agentx run`.
- **Why.** It matches the repository name and is free on npm. Keeping the command avoids renaming every script and doc.
- **Rejected.** `agentx-pi`: the package is a harness that uses Pi, not a Pi package; only its `src/agent-runtime/pi-package` is one. A scope such as `@cognisphere/agentx`: needs an npm org and a longer first command.

<a id="d15"></a>
### D15. Any `agentx` hands over to the copy the project pins

- **Problem.** The pinned agentx is in `agent-x/node_modules` ([D14](../project/README.md#d14)), so `npx agent-x` in the project root runs a global link or the latest registry version. `run` would then start that copy's Pi, breaking "one pinned Pi", and `init-agent` would copy another version's template.
- **Decision.** The CLI looks for the project's pinned copy from the current directory upward and, if it is a different copy, runs it with the same arguments. `init-project` is excluded.
- **Why.** Commands behave the same from the root, `agent-x/` and an agent, without the user knowing where the install is.
- **Rejected.** Only the root script `npm run agentx -- <command>`: correct, but a bare `npx agent-x` stays silently unpinned. A root dev dependency on `agent-x`: a second pin that can drift from the one in `agent-x/package.json`.
