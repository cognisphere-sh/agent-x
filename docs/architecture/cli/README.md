# CLI

The `agentx` command, published in the npm package `agent-x` ([D12](#d12)). Built from `src/cli/` into `dist/cli/`; `package.json` `bin` points `agentx` and `agent-x` at `dist/cli/agentx.js`. The build marks that file executable, which `tsc` does not do and a linked checkout needs: its `agentx` command is a link to the file itself.

What `init-project` creates has its own doc: [project](project/README.md).

## Files

| File | Role |
|---|---|
| `src/cli/agentx.ts` | Entry point. Reads `argv`, dispatches to a command, prints usage or the error message and exits 1 on failure. |
| `src/cli/copy-template.ts` | `copyTemplate(template, target)`: copies `templates/<template>` to a missing or empty directory. Exports `setPackageFields(dir, fields)`, which sets fields in a `package.json`, and `harnessRoot` (agentx's package root, where `init-project` reads the version it pins). |
| `src/cli/pinned-cli.ts` | `pinnedCli(cwd)`: the CLI entry file of the agentx the project around `cwd` pins; undefined outside a project or when it is the running copy, and an error when the project has not installed it ([D15](#d15)). Exports `pinsAgentx(dir)`, whether a package lists `agent-x` in its dependencies, which `agentRoot` and `initAgent` use too. |
| `src/cli/agent-root.ts` | `agentRoot(dir)`: returns `dir` if it is an agent directory, and throws otherwise. |
| `src/cli/commands/<name>.ts` | One file per command. Exports one function. |

## Commands

| Command | Function | Does |
|---|---|---|
| `agentx init-project [name]` | `initProject(name, cwd)` | Creates `<cwd>/<name>` from `templates/project`, or fills the current directory when no name is given and names the project after it. The target must be missing or empty. Names `agent-x/package.json` `<project>-agent-x` and pins `agent-x` as its dependency ([D14](project/README.md#d14)), renames `gitignore` to `.gitignore` ([D9](project/README.md#d9)), runs `git init` and stops with an error if it fails ([D7](project/README.md#d7)). See [project.md](project/README.md). |
| `agentx init-agent <name>` | `initAgent(name, cwd)` | Run in the project root or in `agent-x/`: the package that pins agentx is `agent-x/` of the current directory, or the directory itself. The name is letters, digits and dashes, so it stays a folder in `agents/`. Creates `agent-x/agents/<name>` from `templates/agent`, with `storage/workspace` and the folders of `storage/knowledge`. See [Agent](../agent-runtime/agent/README.md). |
| `agentx run [--thread-id <id>] [pi args]` | `runAgent(agentRoot, args)` | Starts the pinned Pi CLI with agentx's Pi package and the agent's session folder, on the thread named, or `main`. Every other argument goes to Pi. Refuses a thread another process is running. See [Agent](../agent-runtime/agent/README.md#how-agentx-run-starts-pi). |
| `agentx send [--thread-id <id>] [--do-not-steer] [--silent] [--meta <name>=<value> ...] [--] <content>` | `sendMessage(agentRoot, args)` | Puts a message on the agent's queue, for the thread `main` unless told otherwise, and says what it queued. Each `--meta` adds one metadata entry ([D30](#d30)). See [Message queue](../agent-runtime/pi-package/message-queue/README.md#messages). |

`run` and `send` act on the agent directory they are run in. `agentRoot` checks that the current directory is one: a folder in `agents/` of a package that lists `agent-x` in its dependencies. That is the layout the rest of agentx relies on, for Pi's shared directory and for finding the pinned CLI. A command run anywhere else stops before it creates a `storage/` there.

agentx's own flags are spelled like Pi's, in lower case with dashes. Where agentx and Pi have different words for one thing, the flag uses agentx's: `--thread-id`, which `run` hands to Pi as `--session-id` ([D21](../agent-runtime/pi-package/message-queue/README.md#d21)).

Planned: `serve`, which will start the [coordinator](../coordinator-runtime/README.md), and `upgrade`.

## Where the command comes from

The pinned agentx is installed in the project's `agent-x/node_modules`. `pnpm exec agentx` finds its command there from `agent-x/` and from an agent, and the root script `agentx` (`node agent-x/node_modules/agent-x/dist/cli/agentx.js`, run as `pnpm agentx <command>`) starts it from the project root. A global `agentx` (`pnpm add -g agent-x`) and `pnpm dlx agent-x` are other copies.

Whichever copy starts, the pinned one does the work ([D15](#d15)). Before dispatching, `agentx.ts` calls `pinnedCli(cwd)`, which looks in `cwd` and each parent directory for the package that pins agentx: `agent-x/` there, or the directory itself, with a `package.json` that lists `agent-x` in its dependencies. The first one found is the project's, and its `node_modules/agent-x/dist/cli/agentx.js` is the pinned CLI. If that file is missing, the command stops and asks for `pnpm install`. If it is not the running copy (compared by real path, so a linked checkout counts as the same), the CLI runs it with the same arguments and `cwd` and exits with its status. Outside a project, the running copy does the work. `init-project` is never handed over: it creates a new project.

## Conventions

- Commands throw `Error` with a user-facing message; only `agentx.ts` prints and exits.
- Commands take the directory they act on as a parameter instead of reading `process.cwd()`, so the runtime can call them later.
- `run` and `send` are started in the agent directory, so `process.cwd()` is the agent.
- `run` reads its own flags by hand, because it passes what it does not know to Pi. `send` uses Node's `parseArgs`, strict, so an unknown option is an error.

## Adding a command

1. Add `src/cli/commands/<name>.ts` exporting one function.
2. Add a branch and a usage line in `src/cli/agentx.ts`.
3. Add a row above and, if it involved a choice, an entry under "Decisions" in the README of the module it affects.

## Decisions

<a id="d12"></a>
### D12. npm package `agent-x`; the command is `agentx`

- **Problem.** `agentx` on npm is an unrelated package, so `pnpm dlx agentx` or `npx agentx` outside a project would run someone else's code.
- **Decision.** The package is `agent-x`. Its command is `agentx`, with `agent-x` as a second name, so `pnpm dlx agent-x <command>` and `npx agent-x <command>` work from the registry: both look for a bin named like the package.
- **Why.** `agent-x` matches the repository name and is free on npm; `agentx` is the short name to type.
- **Rejected.** `agentx-pi`: the package is a harness that uses Pi, not a Pi package. A scope such as `@cognisphere/agentx`: needs an npm org and a longer first command.

<a id="d15"></a>
### D15. Any `agentx` hands over to the copy the project pins

- **Problem.** The pinned agentx is in `agent-x/node_modules` ([D14](project/README.md#d14)), so a global `agentx`, or `pnpm dlx agent-x`, started in the project is another copy: a global install, or the latest registry version. `run` would start that copy's Pi, and `init-agent` would copy another version's template.
- **Decision.** The CLI looks from the current directory upward for the package that pins agentx, and runs the copy installed in it with the same arguments, unless that is the running copy. When the project has not installed agentx, the command stops and asks for `pnpm install`. `init-project` is excluded.
- **Why.** Commands behave the same from the root, `agent-x/` and an agent, without the user knowing where the install is. A command that stops is better than one that runs another version's Pi without a word.
- **Rejected.** Only the root script `pnpm agentx <command>`: correct, but a global `agentx` stays silently unpinned. A root dev dependency on `agent-x`: a second pin that can drift from the one in `agent-x/package.json`.
- **Consequence.** In a fresh clone, every command but `init-project` waits for `pnpm install`.

<a id="d30"></a>
### D30. `agentx send` takes metadata as repeated `--meta name=value`

- **Problem.** A sender attaches facts to a message, such as who it is from. Their names are the sender's, so the command cannot list them as options.
- **Decision.** One option, `--meta <name>=<value>`, repeated for each fact; the value is text and may contain `=`. The options are parsed by Node's `parseArgs` in strict mode. `--` ends the options, and what is left is the content.
- **Why.** No JSON to quote in the shell, and a fixed set of options lets a standard parser read them and reject a misspelt one, instead of queuing it as a stray fact.
- **Rejected.** `--metadata '<json>'`: JSON quoted inside a shell argument, for values that are almost always plain text.
