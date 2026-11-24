# CLI

The `agentx` command, from the npm package `agent-x` ([D12](#d12)). It is a developer's tool: create projects and agents, try an agent, run it, and run a project on a laptop or a server. The code is in `src/cli/` and builds to `dist/cli/agentx.js`, which `package.json` `bin` names as `agentx` and `agent-x`. What `init-project` creates: [project](project/README.md). Running a project: [deploy](deploy/README.md).

| File | Role |
|---|---|
| `agentx.ts` | Entry point. Hands over to the pinned copy, then runs the command. On failure, prints the error or the usage and exits 1. |
| `copy-template.ts` | Copies `templates/<name>` into a missing or empty directory, naming each `env` and `gitignore` file with a dot. Writes the JSON files the CLI changes, indented with tabs. |
| `pinned-cli.ts` | Finds the CLI the project pins, and runs it ([D15](#d15)); `upgrade-project` runs the copy it installed the same way ([D99](#d99)). |
| `agent-root.ts` | Finds the agent directory, or the project's `agent-x/`, a command runs in. |
| `confirmed.ts` | Asks a person a question: to confirm what `remove-agent` and `remove-thread` delete, or for a login or a key. |
| `template-sync.ts` | Adds what a template has and a project's or agent's file lacks, for `upgrade-project` and `upgrade-agent` ([D100](#d100)). |
| `commands/<name>.ts` | One file per command. |
| `deploy/` | What `dev` and `server` share and do: the questions for logins and keys, the tunnel, the server's setup, files and web builds ([deploy](deploy/README.md)). |

## Commands

| Command | Does |
|---|---|
| `agentx init-project [name]` | Creates `<name>/`, or fills the current directory, which must be empty. Pins `agent-x` at its own version ([D14](project/README.md#d14)) and runs `git init` ([D7](project/README.md#d7)). |
| `agentx init-agent <name>` | In the project root, `agent-x/` or `agent-x/agents/`. Creates `agent-x/agents/<name>` from the template, with its `.env` for its keys ([D43](../agent-runtime/agent/README.md#d43)), its [storage](../agent-runtime/agent/README.md#storage) and the link to it, writes its Composio user id `<name>@<project>` ([D38](../agent-runtime/pi/pi-package/composio/README.md#d38)), and lists it in `agentx.json` ([D63](../coordinator-runtime/README.md#d63)). Names use letters, digits and dashes. |
| `agentx remove-agent <name> [--yes]` | In the project root, `agent-x/` or `agent-x/agents/`. Deletes the agent's folder, its state and its entry in `agentx.json`, and takes it off the other agents' `canSendTo`. Lists them and asks first; only `y` or `yes` deletes, and input that ends unanswered, as with Ctrl-C, keeps them. `--yes` skips the question. Refuses while the agent runs. |
| `agentx upgrade-project` | In the project root, `agent-x/` or `agent-x/agents/`. Moves `agent-x` to the latest version in the registry and installs it, with pnpm ([D99](#d99)). Then adds what the templates have and the project lacks: keys of `agentx.json`, keys of `agent-x/.env`, lines of `.gitignore`; and upgrades every agent, as `upgrade-agent` does ([D100](#d100)). Prints each change. |
| `agentx upgrade-agent <name>` | In the project root, `agent-x/` or `agent-x/agents/`. Adds to the agent's `.pi/settings.json` the `agentx` settings it lacks, with the template's values, and to its `.env` the keys it does not name; moves the Pi packages it lists to the versions the template pins ([D100](#d100)). Changes no other value. Prints each change. |
| `agentx serve [--host <host>] [--port <port>]` | In the project root, `agent-x/` or `agent-x/agents/`. Runs every agent and the services of the [coordinator](../coordinator-runtime/README.md), and serves its API on `127.0.0.1:3100` unless told otherwise. Logs each agent with no login for its model provider. |
| `agentx dev` | In the project root, `agent-x/` or `agent-x/agents/`, on a laptop: asks for the logins and keys the project lacks, runs `deploy/check.sh`, opens an ngrok tunnel to the agents, and runs them, as `serve` does, and the web app with `next dev` ([deploy](deploy/README.md#agentx-dev)). |
| `agentx server setup\|start\|restart\|stop\|status\|logs` | The same, on the project's Ubuntu server: sets it up, with Caddy for HTTPS, and runs the agents and the web app as systemd user services ([deploy](deploy/README.md#agentx-server)). |
| `agentx run` | Runs the agent until it is stopped ([supervisor](../agent-runtime/supervisor/README.md)). |
| `agentx chat [--thread-id <id>] [pi args]` | Opens the pinned Pi on a thread, `main` by default. Other arguments go to Pi ([Pi](../agent-runtime/pi/README.md#how-agentx-chat-starts-pi)). |
| `agentx remove-thread <thread-id> [--yes]` | Deletes a Pi thread of the agent: its sessions, `storage/sessions/<thread-id>/`, and its episodes in the agent's [memory](../agent-runtime/pi/pi-package/memory/README.md) ([D94](#d94)). Says what it deletes and asks first, as `remove-agent` does; `--yes` skips the question. Refuses in the agent's processes, while a process holds the thread, and while events wait for it, before the question and again after. |
| `agentx event deliver [options] [--] <content>` | A person gives an agent an event, straight into its inbox, with no `agentx serve`. Refuses to run in the agent's processes. |
| `agentx event send [options] [--] <content>` | The agent sends an event, from its own processes, such as the model's bash, into its outbox. Refuses to run elsewhere. |
| `agentx webhook create\|list\|rotate\|delete ...` | The agent's [webhooks](../coordinator-runtime/services/webhooks/README.md#an-agents-webhooks), URLs that outside services call to run one of its workflows: makes one with a random token and prints its URL, changes one and keeps its URL, lists them with each one's last request, gives one a new URL, or deletes one. `create` and `rotate` refuse until `agentx.json` has `publicUrl` and turns on the webhooks service. |

Both `event` commands take `--agent <name>` (another agent of the project), `--thread-id <id>` (without it, the router picks), `--key`, `--do-not-steer`, `--silent`, `--meta <name>=<value>` ([D30](#d30)) and `--file <path>`. Both add `source: cli` unless `--meta source=…` says otherwise, and print the event's id ([Events](../agent-runtime/events/README.md#sending-and-delivering)).

`run`, `chat`, `remove-thread`, `event` and `webhook` run in an agent directory, and make its storage when it is missing, as after a fresh clone. Flags are lower case with dashes, like Pi's; `--thread-id` names the folder of the thread's Pi sessions ([D21](../agent-runtime/pi/README.md#d21)).

## Where the command comes from

The pinned agentx is in `agent-x/node_modules`. Start it with `pnpm exec agentx` in `agent-x/`, `agent-x/agents/` or an agent, `pnpm agentx` in the project root, or a global `agentx`.

Whichever copy starts, the pinned copy does the work ([D15](#d15)). `pinnedCli` looks in the current directory and each parent for the package that pins `agent-x`.

- Not installed: the command stops and says to run `pnpm install`.
- Another copy: agentx runs the pinned one with the same arguments and exits with its status. While it runs, the outer copy ignores `SIGINT`, so the pinned copy decides what Ctrl-C means, and passes `SIGTERM` on.
- Outside a project, and for `init-project`, the running copy does the work.

## Conventions

- `run`, `serve`, `event` and `webhook` only read their arguments and call the agent runtime or the coordinator runtime: `webhook` keeps the file through the webhooks service's `hooks.ts`. `init-project`, `init-agent`, `remove-agent`, `upgrade-project`, `upgrade-agent`, `remove-thread`, `chat`, `dev` and `server` are the developer's tools, and keep their logic in the CLI; `dev` runs the coordinator as `serve` does. The runtimes never import the CLI.
- Commands throw an `Error` with a message for the user; only `agentx.ts` prints it and exits.
- `event` and `webhook` read their options with Node's `parseArgs` in strict mode, so an unknown option is an error. `chat` reads its own flags by hand and passes the rest to Pi.

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

<a id="d94"></a>
### D94. A person removes a thread with `agentx remove-thread`, which takes its episodes out of the memory index too, and only while the thread is idle

- **Problem.** A person may want a thread gone, with what the agent remembers of it. Its sessions are Pi's files, its episodes are rows in the memory index, and `agentx run` can start the thread whenever an event comes.
- **Decision.** `agentx remove-thread` refuses in the agent's processes, while a process holds the thread and while events wait for it. It holds the thread's lease while it deletes the thread's folder, then the thread's rows in the index, in one transaction. It opens the index through `index-db.ts`, which loads nothing of Pi.
- **Why.** The lease keeps a session from starting on the thread meanwhile, and waiting events would start it again. Only the thread's own session indexes its files ([memory](../agent-runtime/pi/pi-package/memory/README.md#d91)), so nothing adds its episodes back. What the agent remembers is for a person to remove, not the agent. Loading Pi takes most of a second, which every command would pay, since the CLI imports its commands up front.
- **Consequence.** The thread's settled events stay on the queue. An event for the thread later starts it again, with new sessions.

<a id="d99"></a>
### D99. `agentx upgrade-project` installs the latest agentx, and the new copy brings the files up to its own templates

- **Problem.** A project pins one agentx, and every command runs that copy ([D15](#d15)), which has the old templates. A new version may add settings and keys that the project's files lack.
- **Decision.** `upgrade-project` asks pnpm for `agent-x@latest`. When the project pins another version, it installs the latest with `pnpm add --save-exact`, then runs the new copy's `upgrade-project`, which finds itself the latest and brings the files up to its own templates. A pin that is not a version, such as a `link:` to a checkout, is not looked up: the files are brought up to the agentx installed.
- **Why.** Only the new version knows its templates. The same command hands over with no hidden flag: the second run finds nothing to install.
- **Consequence.** A project that pins a version without `upgrade-project` upgrades once by hand: `pnpm add --save-exact agent-x@latest` in `agent-x/`, then `agentx upgrade-project`.

<a id="d100"></a>
### D100. An upgrade adds what the templates have and the files lack, and changes no value

- **Problem.** A new version adds settings and keys. The project's and the agents' files are the developer's: checked in, or holding secrets.
- **Decision.** `upgrade-project` adds to `agentx.json` the keys of its template that it lacks, to `agent-x/.env` each paragraph of the template that names a variable the file does not, and to `.gitignore` the template's lines it lacks. For each agent it does what `upgrade-agent` does: it adds to `.pi/settings.json` each `agentx` setting the agent lacks, at any depth, with the template's value, and moves each Pi package the agent lists to the version the template pins for it; it adds to the agent's `.env` the template's keys it does not name. A missing `.env` is written from the template. Values, lists, Pi's other settings and packages the agent does not list stay as they are.
- **Why.** Running it again changes nothing, and what it changes shows in `git diff`. Pi's settings in the template are a start the developer changes, not defaults, so a package the developer removed stays removed. A setting the developer deleted comes back with the template's value, so a setting is turned off by its value, such as `"systemPrompt": []`.
- **Rejected.** Comparing the old version's templates with the new one's, to add only what is new: the old templates are gone once the new version is installed, and `upgrade-agent` alone has no old version. Copying every template file the agent lacks: a developer may have removed `system_prompt/1-role.md` or `event_router.ts` on purpose.
