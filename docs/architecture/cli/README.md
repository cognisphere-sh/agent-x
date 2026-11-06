# CLI

The `agentx` command. Built from `src/cli/` into `dist/cli/`; `package.json` `bin` points at `dist/cli/agentx.js`.

## Files

| File | Role |
|---|---|
| `src/cli/agentx.ts` | Entry point. Reads `argv`, dispatches to a command, prints usage or the error message and exits 1 on failure. |
| `src/cli/copy-template.ts` | `copyTemplate(template, target, packageFields)`: copies `templates/<template>` to a new directory and merges fields into its `package.json`. Exports `harnessPackage` (agentx's own name and version). |
| `src/cli/commands/<name>.ts` | One file per command. Exports one function. |

## Commands

| Command | Function | Does |
|---|---|---|
| `agentx init-project <name>` | `initProject(name, cwd)` | Creates `<cwd>/<name>` from `templates/project`, pins agentx as a dev dependency, renames `gitignore` to `.gitignore` ([D9](../project/README.md#d9)), runs `git init` ([D7](../project/README.md#d7)). See [project.md](../project/README.md). |
| `agentx init-agent <name>` | `initAgent(name, projectRoot)` | Requires `harness/` in the current directory. Creates `harness/<name>` from `templates/agent`, names the package `agent-<name>`, creates `storage/workspace`. See [Agent](../agent/README.md). |
| `agentx run [pi args]` | `runAgent(agentRoot, piArgs)` | Starts the pinned Pi CLI in the current directory, which must be an agent. See [Agent](../agent/README.md#how-agentx-run-starts-pi). |

Planned: `upgrade`, `serve` (starts the [runtime](../runtime/README.md)).

## Conventions

- Commands throw `Error` with a user-facing message; only `agentx.ts` prints and exits.
- Commands take the directory they act on as a parameter instead of reading `process.cwd()`, so the runtime can call them later.
- `run` is called through npm scripts in the agent's `package.json`. npm and pnpm run scripts with the package directory as `cwd`, which is why `process.cwd()` is the agent directory.

## Adding a command

1. Add `src/cli/commands/<name>.ts` exporting one function.
2. Add a branch and a usage line in `src/cli/agentx.ts`.
3. Add a row above and, if it involved a choice, an entry under "Decisions" in the README of the component it affects.

