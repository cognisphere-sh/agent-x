# CLI

The `agentx` command, from the npm package `agent-x` ([D12](#d12)). It is a developer's local tool: create projects and agents, try an agent, run it. The code is in `src/cli/` and builds to `dist/cli/agentx.js`, which `package.json` `bin` names as `agentx` and `agent-x`. What `init-project` creates: [project](project/README.md).

| File | Role |
|---|---|
| `agentx.ts` | Entry point. Hands over to the pinned copy, then runs the command. On failure, prints the error or the usage and exits 1. |
| `copy-template.ts` | Copies `templates/<name>` into a missing or empty directory. |
| `pinned-cli.ts` | Finds the CLI the project pins ([D15](#d15)). |
| `agent-root.ts` | Finds the agent directory, or the project's `agent-x/`, a command runs in. |
| `commands/<name>.ts` | One file per command. |

## Commands

| Command | Does |
|---|---|
| `agentx init-project [name]` | Creates `<name>/`, or fills the current directory, which must be empty. Pins `agent-x` at its own version ([D14](project/README.md#d14)) and runs `git init` ([D7](project/README.md#d7)). |
| `agentx init-agent <name>` | In the project root, `agent-x/` or `agent-x/agents/`. Creates `agent-x/agents/<name>` from the template, its [storage](../agent-runtime/agent/README.md#storage) and the link to it, writes its Composio user id `<name>@<project>` ([D38](../agent-runtime/pi/pi-package/composio/README.md#d38)), and lists it in `agentx.json` ([D63](../coordinator-runtime/README.md#d63)). Names use letters, digits and dashes. |
| `agentx remove-agent <name> [--yes]` | In the project root, `agent-x/` or `agent-x/agents/`. Deletes the agent's folder, its state and its entry in `agentx.json`, and takes it off the other agents' `canSendTo`. Lists them and asks first; only `y` or `yes` deletes, and input that ends unanswered, as with Ctrl-C, keeps them. `--yes` skips the question. Refuses while the agent runs. |
| `agentx serve [--host <host>] [--port <port>]` | In the project root, `agent-x/` or `agent-x/agents/`. Runs every agent and the services of the [coordinator](../coordinator-runtime/README.md), and serves its API on `127.0.0.1:3100` unless told otherwise. |
| `agentx run` | Runs the agent until it is stopped ([supervisor](../agent-runtime/supervisor/README.md)). |
| `agentx chat [--thread-id <id>] [pi args]` | Opens the pinned Pi on a thread, `main` by default. Other arguments go to Pi ([Pi](../agent-runtime/pi/README.md#how-agentx-chat-starts-pi)). |
| `agentx event deliver [options] [--] <content>` | A person gives an agent an event, straight into its inbox, with no `agentx serve`. Refuses to run in the agent's processes. |
| `agentx event send [options] [--] <content>` | The agent sends an event, from its own processes, such as the model's bash, into its outbox. Refuses to run elsewhere. |

Both `event` commands take `--agent <name>` (another agent of the project), `--thread-id <id>` (without it, the routers pick), `--key`, `--do-not-steer`, `--silent`, `--meta <name>=<value>` ([D30](#d30)) and `--file <path>`. Both add `source: cli` unless `--meta source=…` says otherwise, and print the event's id ([Events](../agent-runtime/events/README.md#sending-and-delivering)).

`run`, `chat` and `event` run in an agent directory, and make its storage when it is missing, as after a fresh clone. Flags are lower case with dashes, like Pi's; `--thread-id` names the folder of the thread's Pi sessions ([D21](../agent-runtime/pi/README.md#d21)).

Planned: `upgrade`.

## Where the command comes from

The pinned agentx is in `agent-x/node_modules`. Start it with `pnpm exec agentx` in `agent-x/`, `agent-x/agents/` or an agent, `pnpm agentx` in the project root, or a global `agentx`.

Whichever copy starts, the pinned copy does the work ([D15](#d15)). `pinnedCli` looks in the current directory and each parent for the package that pins `agent-x`.

- Not installed: the command stops and says to run `pnpm install`.
- Another copy: agentx runs the pinned one with the same arguments and exits with its status. While it runs, the outer copy ignores `SIGINT`, so the pinned copy decides what Ctrl-C means, and passes `SIGTERM` on.
- Outside a project, and for `init-project`, the running copy does the work.

## Conventions

- `run`, `serve` and `event` only read their arguments and call the agent runtime or the coordinator runtime. `init-project`, `init-agent`, `remove-agent` and `chat` are the developer's tools, and keep their logic in the CLI. The runtimes never import the CLI.
- Commands throw an `Error` with a message for the user; only `agentx.ts` prints it and exits.
- `event` reads its options with Node's `parseArgs` in strict mode, so an unknown option is an error. `chat` reads its own flags by hand and passes the rest to Pi.

## Decisions

<a id="d12"></a>
### D12. npm package `agent-x`; the command is `agentx`

- **Decision.** The package is `agent-x`. Its command is `agentx`, with `agent-x` as a second name, so `pnpm dlx agent-x` works.
- **Why.** `agentx` on npm is someone else's package, so `npx agentx` would run their code.

<a id="d15"></a>
### D15. Any `agentx` hands over to the copy the project pins

- **Decision.** Every command but `init-project` runs the agentx installed in the project, and stops with "run pnpm install" if it is not installed.
- **Why.** A global `agentx` may be another version, with another Pi and other templates.
- **Consequence.** In a fresh clone, nothing but `init-project` works until `pnpm install`.

<a id="d30"></a>
### D30. `agentx event` takes metadata as repeated `--meta name=value`

- **Decision.** Each fact is one `--meta <name>=<value>`; the value may contain `=`.
- **Why.** No JSON to quote in the shell, and a misspelt option is an error instead of a stray fact.

<a id="d45"></a>
### D45. `run` runs the agent, `chat` opens a thread, `event` sends and delivers

- **Decision.** `run` runs the agent until it is stopped. `chat` opens Pi on one thread for a person. `event send` is the agent's way to send, `event deliver` a person's way to give an agent an event.
- **Why.** Each name says what the command does. The agent sends and a person delivers, which go different ways ([D48](../agent-runtime/events/README.md#d48)).
- **Rejected.** `agentx serve` in an agent directory, which would give `serve` two meanings.
