# CLI

The `agentx` command, from the npm package `agent-x` ([D12](#d12)). The code is in `src/cli/` and builds to `dist/cli/`. `package.json` `bin` points `agentx` and `agent-x` at `dist/cli/agentx.js`. The build marks that file executable, because a linked checkout runs it directly.

What `init-project` creates: [project](project/README.md).

## Files

| File | Role |
|---|---|
| `src/cli/agentx.ts` | Entry point. Hands over to the pinned copy, then runs the command. On failure, prints the error or usage and exits 1. |
| `src/cli/copy-template.ts` | `copyTemplate(template, target)` copies `templates/<template>` into a missing or empty directory. Also exports `setPackageFields` (sets fields in a `package.json`) and `harnessRoot` (agentx's package root, where `init-project` reads the version it pins). |
| `src/cli/pinned-cli.ts` | `pinnedCli(cwd)` finds the CLI the project pins ([D15](#d15)). `pinsAgentx(dir)` says whether `dir/package.json` lists `agent-x` in its dependencies. It is the one rule for "the project's agent-x package", used by `pinnedCli`, `agentRoot` and `initAgent`. |
| `src/cli/agent-root.ts` | `agentRoot(dir)` returns `dir` if it is an agent directory, and throws otherwise. |
| `src/cli/commands/<name>.ts` | One file per command, exporting one function. |

## Commands

| Command | Does |
|---|---|
| `agentx init-project [name]` | Creates `<name>/`, or fills the current directory if no name is given. The target must be missing or empty. Names `agent-x/package.json` `<project>-agent-x` and pins `agent-x` at its own version ([D14](project/README.md#d14)). Renames `gitignore` to `.gitignore`. Runs `git init`, and stops with an error if it fails ([D7](project/README.md#d7)). |
| `agentx init-agent <name>` | Run in the project root or `agent-x/`. The name may use only letters, digits and dashes. Creates `agent-x/agents/<name>` from `templates/agent`, with `storage/workspace` and the `storage/knowledge` folders, and writes the agent's Composio user id, `<name>@<project>`, into its settings ([D38](../agent-runtime/pi/pi-package/composio/README.md#d38)). See [Agent](../agent-runtime/agent/README.md). |
| `agentx run` | Runs the agent until it is stopped: routes its events, runs its Pi threads and its workflows. The first Ctrl-C lets running work finish; the second stops it. See [Agent supervisor](../agent-runtime/supervisor/README.md). |
| `agentx chat [--thread-id <id>] [pi args]` | Opens the pinned Pi on the thread given, or `main`, for a person. Other arguments go to Pi. Refuses a thread another process is running, and a workflow's thread. See [Agent](../agent-runtime/pi/README.md#how-agentx-chat-starts-pi). |
| `agentx event send [--agent <name>] [--thread-id <id>] [--key <key>] [--do-not-steer] [--silent] [--meta <name>=<value> ...] [--] <content>` | Sends an event to this agent, or to another agent of the project with `--agent` ([D30](#d30)). Without `--thread-id`, the agent's router picks the thread; with `workflow.<name>`, that workflow runs with it, and a workflow that does not exist is refused. Adds `source: cli` to the metadata unless `--meta source=…` says otherwise. Prints the event's id, a random 12-character string. See [Event queue](../agent-runtime/events/README.md#events). |
| `agentx event list [--agent <name>] [--limit <n>]` | The newest events, 20 unless told otherwise: time, id, status, thread (or `(router)` while it has none), source. |
| `agentx event show [--agent <name>] <id>` | One event whole: content, metadata, thread and whether the router failed, status, attempts, error, key, the session entry that got it, and for a workflow's event, its run: the log, the events it sent, and its failure report with that report's status and session entry ([Workflows](../agent-runtime/workflows/README.md#failure-reports)). |

`run`, `chat` and `event` must run in an agent directory: a folder in `agents/` of a package that pins agentx. `agentRoot` checks this, so a command run elsewhere stops before it creates `storage/`.

Flags are lower case with dashes, like Pi's. `--thread-id` is agentx's word for Pi's `--session-id` ([D21](../agent-runtime/pi/README.md#d21)). The commands' names follow what each does for a person ([D45](#d45)).

Planned: `serve`, to start the [coordinator](../coordinator-runtime/README.md), and `upgrade`.

## Where the command comes from

The pinned agentx is in the project's `agent-x/node_modules`. Ways to start a copy:

| Where | Command |
|---|---|
| `agent-x/` or an agent | `pnpm exec agentx <command>` |
| Project root | `pnpm agentx <command>` (a root script) |
| Anywhere | a global `agentx` (`pnpm add -g agent-x`), or `pnpm dlx agent-x` |

Whichever copy starts, the pinned copy does the work ([D15](#d15)). `pinnedCli(cwd)` checks `cwd` and each parent directory, first for `agent-x/` and then for the directory itself, until `pinsAgentx` matches. The pinned CLI is `node_modules/agent-x/dist/cli/agentx.js` in that package.

- File missing: the command stops and says to run `pnpm install`.
- Another copy: agentx runs it with the same arguments and exits with its status. Copies are compared by real path, so a linked checkout counts as the same copy.
- While the pinned copy runs, the outer `agentx` ignores `SIGINT`. A terminal's Ctrl-C reaches both, and the pinned copy decides what it means, as `agentx run` lets running work finish; the outer one waits for it, so the prompt does not come back early. A `SIGTERM` to the outer one alone, as from `kill` or a process manager, is passed on to the pinned copy, so it never runs on by itself.
- Outside a project: the running copy does the work.
- `init-project` is never handed over, because it creates a new project.

## Conventions

- Commands throw an `Error` with a message for the user. Only `agentx.ts` prints it and exits.
- Commands take their directory as a parameter instead of reading `process.cwd()`, so the runtime can call them.
- `chat` reads its own flags by hand, because it passes the rest to Pi. `event` uses Node's `parseArgs` in strict mode, so an unknown option is an error.

## Adding a command

1. Add `src/cli/commands/<name>.ts` that exports one function.
2. Add a branch and a usage line in `src/cli/agentx.ts`.
3. Add a row above. If it involved a choice, add a decision to the README of the module it affects.

## Decisions

<a id="d12"></a>
### D12. npm package `agent-x`; the command is `agentx`

- **Decision.** The package is `agent-x`. Its command is `agentx`, with `agent-x` as a second name, so `pnpm dlx agent-x` works.
- **Why.** `agentx` on npm is someone else's package, so `npx agentx` would run their code.

<a id="d15"></a>
### D15. Any `agentx` hands over to the copy the project pins

- **Decision.** Every command but `init-project` runs the agentx installed in the project, and stops with "run pnpm install" if it is not installed. While it waits for the pinned copy, the outer process ignores `SIGINT` and passes on `SIGTERM`.
- **Why.** A global `agentx` or `pnpm dlx agent-x` may be another version, with another Pi and other templates.
- **Consequence.** In a fresh clone, nothing but `init-project` works until `pnpm install`.

<a id="d30"></a>
### D30. `agentx event send` takes metadata as repeated `--meta name=value`

- **Decision.** Each fact is one `--meta <name>=<value>`, and the value may contain `=`. Node's `parseArgs` reads the options in strict mode.
- **Why.** No JSON to quote in the shell, and a misspelt option is an error instead of a stray fact.

<a id="d45"></a>
### D45. `agentx run` runs the agent; `agentx chat` opens a thread for a person; `agentx event` sends and shows events

- **Decision.** `run` runs the agent until it is stopped. `chat` opens Pi on one thread at a terminal. `event send`, `event list` and `event show` send an event and show what became of an agent's events.
- **Why.** Each name says what the command does: running the agent is `run`, and talking to it on one thread is a chat. What reaches an agent is an event, so one command group sends and audits them.
- **Rejected.** `agentx work` for running the agent, which leaves `run` naming the terminal session; `agentx serve` in an agent directory, which would give `serve`, the coordinator's command in a project, two meanings.
