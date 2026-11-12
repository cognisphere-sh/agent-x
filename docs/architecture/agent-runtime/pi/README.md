# Pi integration

What agentx relies on in `@earendil-works/pi-coding-agent`, pinned at 1.5.2. Paths are in the Pi repo, under `packages/coding-agent/`. Check them again when upgrading Pi.

## Config locations

- Pi reads config from two places only: its agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) and `<cwd>/.pi/`. It does not look for `.pi/` in parent directories (`src/core/settings-manager.ts`).
- In a trusted project, Pi loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` with no settings (`docs/configuration.md`). Its own project prompt is one file, `.pi/SYSTEM.md`. It has no prompt folder.
- The agent directory holds config and state together: `settings.json`, `auth.json`, `trust.json`, `models.json`, `bin/`.
- In `.pi/settings.json`, resource paths resolve from `.pi/`. `sessionDir` resolves from `cwd` and is read before trust is checked. `extensions` and `skills` list more folders to load. A folder that does not exist is skipped with no warning.
- Pi accepts settings keys it does not know. It gives no warning, keeps them when it rewrites a settings file, and returns them from `pi.getSettings()`. That call gives an extension the user and project settings merged (`persistScopedSettings` in `src/core/settings-manager.ts`, `docs/extensions.md`).

## Project trust

- Resources in `.pi/` load only when the project is trusted. Interactive mode asks. Print mode (`-p`) skips an untrusted `.pi/` without a word.
- `--approve` trusts the project for one run. Saved choices are in `<agentDir>/trust.json`.
- `pi mcp ...` checks only saved trust and ignores `--approve` (`src/extensions/mcp/cli.ts`).

## Skills discovery

- `~/.agents/skills` loads for every project. Only user-level settings can exclude it.
- Each skill has a `filePath`. A `before_agent_start` handler can replace `event.systemPromptOptions.skills`, the list Pi adds to the prompt.
- `.agents/skills` in `cwd` and its parents, up to the git root, loads when the project is trusted (`src/core/package-manager.ts`).
- `-ns` drops all skills, the agent's own too.

## CLI

- Subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`, `auth`) count only as the first argument. `uninstall` is another name for `remove` (`src/package-manager-cli.ts`).
- `auth login <provider>` and `auth logout <provider>` write `auth.json` in the agent directory without starting a session.
- `-nc` skips `AGENTS.md` and `CLAUDE.md`. `-c` continues the latest session. `-r` opens a picker. `--session <id>` accepts part of an id.
- With `-p`, Pi reads stdin until it closes.
- The CLI entry is `dist/bundle/cli.js` in the package.

## Sessions

- `--session-id <id>` opens the session with exactly that id among those stored for the working directory, or creates it. It cannot be combined with `--session`, `-c` or `-r`. Given twice, the last one counts (`createSessionManager` in `src/main.ts`).
- A session id must match `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` (`assertValidSessionId` in `src/core/session-manager.ts`). The id is part of the file name, `<time>_<id>.jsonl`, which limits its length.
- Pi finds a session by its id among those stored for the working directory, and compares the directory as text (`SessionManager.findById` in `src/core/session-manager.ts`). A path through a symlink does not match the resolved path. The CLI always uses the resolved path as its working directory, so `agentx run` and the runner, which both start the CLI, find the same session file.
- Pi writes the session file when the first message is added. A session that never got a message leaves no file.
- Nothing locks a session file. Two processes that open the same session each append from their own last entry, which forks the conversation. A reader takes the last line as the current end.
- Replacing the session in a running Pi (`/new`, `/resume`, `/fork`, `/clone`, `/import`) sends `session_shutdown`, with a reason, to the extensions. Pi then runs every extension's factory again and sends `session_start` to the new instances. `/reload` does the same and also loads the extension's module again. `/tree` keeps the session.
- After a session is replaced or closed, the old `ctx` and `pi` objects throw when used. A timer an extension started keeps the process alive, and an uncaught throw from it ends the process. So an extension must stop its timers on `session_shutdown`.

## Delivering messages

- `pi.sendUserMessage(text, { deliverAs: "steer" })` queues the text as a steer while a run is in progress, and starts a run when Pi is idle. It returns nothing at runtime. A failure (no model, no login, compaction in progress) goes to the host's extension-error listener, not to the caller (`sendUserMessage` in the extension actions of `src/core/agent-session.ts`).
- A steer goes in before the next model call: after the tool calls of the current turn, and also after a final turn with no tool calls, which then is not the last. A steer sent from a `turn_end` handler is delivered in the same run.
- Each steer becomes its own user message, by default one per turn (`steeringMode`).
- After a provider error, Pi still delivers pending steers, in a retry or in a new run. After an abort, pending steers stay with Pi and go in with the next prompt. `session.clearQueue()` drops them. Extensions can only ask `ctx.hasPendingMessages()`.
- When a run is aborted during a tool call, the turn still ends with `turn_end` and outcome `completed`. The outcome comes from the assistant message, which asked for the tool. By then `ctx.signal.aborted` is true. A steer sent at that point is saved to the session, and the model call that would read it is aborted.
- Before a run starts, Pi prepares the prompt: `input` handlers, template expansion, the model and login check. During that time `ctx.isIdle()` is still true and nothing is pending (`_preparePrompt` in `src/core/agent-session.ts`).
- Closing or replacing a session first aborts a run in progress. So the extensions see `agent_settled` with `aborted: true` before `session_shutdown` (`src/core/agent-session-runtime.ts`).
- An extension can abort the run in progress with `ctx.abort()`, from any handler or timer (`ExtensionContext` in `src/core/extensions/types.ts`). A tool call in progress stops, and no further model call is made.
- Pi adds a user message to the session after the message's `message_end` event. By the next `context` event, which comes before every model call, the entry exists. No event carries a user message's entry id.
- `agent_before_settle` carries `outcome` (`completed` or `error`, after Pi's own retries). It is not sent for an aborted run. `agent_settled` carries `aborted` and comes last.
- `pi.sendUserMessage()` does not run extension commands, and does not expand templates and skills unless told to. What it sends goes through `input` handlers, and a handler that returns `handled` drops the input with no run.
- With no usable model set, `ctx.model` is not empty. It is a placeholder for a model of a provider Pi does not know, so `ctx.modelRegistry.getProvider(ctx.model.provider)` is undefined. `ctx.modelRegistry.getApiKeyAndHeaders(model)` tells whether Pi can log in for a model, and why not when it cannot. Before a run, Pi itself refuses a prompt when there is no model, or no login for its provider (`_preparePrompt` in `src/core/agent-session.ts`).
- `ctx.mode` is `tui`, `rpc`, `json` or `print`: the mode the host bound the extensions with, and `print` if the host does not say. `ctx.hasUI` is true when the host bound a UI, as the terminal UI and RPC mode do (`setUIContext` in `src/core/extensions/runner.ts`).
- Print mode writes the run's last assistant message to stdout. It binds no shutdown handler, so `ctx.shutdown()` does nothing. Pi sets the exit code only when the run failed, and keeps a code an extension has set (`src/modes/print-mode.ts`, `src/main.ts`).

## Packages

- `packages` in `.pi/settings.json` accepts a local path, resolved from `<cwd>/.pi/` (`getBaseDirForScope` in `src/core/package-manager.ts`). Pi loads it where it is, with no copy or install.
- A missing local path is skipped with no warning (`resolveLocalExtensionSource`).
- `-e <folder>` loads a package folder with all its resources, in temporary scope. A missing path is an error (`resolveExtensionSources` in `src/core/package-manager.ts`, `src/core/resource-loader.ts`).
- `--session-dir <dir>` sets where sessions are stored and looked up, like `sessionDir` in settings.
- A folder with no `pi` manifest in a `package.json` is read by convention: `extensions/`, `skills/`, `prompts/` (prompt templates), `themes/`.
- A package carries extensions, skills, prompt templates and themes. MCP servers are not a package resource; an extension adds them with `pi.registerMcpServer` (`docs/mcp.md`).
- Project-scope npm and git packages are installed into `<cwd>/.pi/npm` and `<cwd>/.pi/git` (`getNpmInstallRoot`, `getGitInstallRoot` in `src/core/package-manager.ts`).
- Pi warns when a package's `package.json` lists a host package, such as `@earendil-works/pi-coding-agent`, in `dependencies` (`src/core/resource-loader.ts`).

## Extensions

- `before_agent_start` can set `event.systemPromptOptions.customPrompt`. It replaces the default preamble and drops the default tool list, rules and Pi docs sections. Pi still adds the skills list and `cwd` (`src/core/system-prompt.ts`). Tool schemas still reach the model.
- An extension folder loads its `*.ts` files and `<subdir>/index.ts` one level down. Other files in it are ignored (`src/core/package-manager.ts`).
- The `input` event can return `continue`, `transform` or `handled` (skip the model).
- `pi.registerFlag(name, { type: "boolean" })` adds a command-line flag, listed in `--help`. `pi.getFlag(name)` reads it in a handler. While the extension is loading, it returns the default (`docs/extensions.md`).

## RPC mode

What the runner relies on when it starts Pi for a thread ([Agent runner](../agent-runner/README.md#starting-a-threads-pi-process)). Sources: `docs/rpc.md`, `docs/rpc-extension-ui.md`, `src/modes/rpc/rpc-mode.ts`.

- `--mode rpc` keeps Pi running with no terminal. It takes the other flags as usual. It reads commands from its input and writes records to its output: one JSON object per line, each ended by a line feed only. Pi waits when nobody reads its output. Diagnostics go to its error output.
- A session works with no command sent: its extensions start and their timers run. The runner needs nothing more, because the message queue extension delivers the messages.
- Pi closes the session and exits when its input closes (exit code 0), and on `SIGTERM` (143) or `SIGHUP` (129). It does not handle `SIGINT`, which ends it at once. Closing the session first aborts a run in progress ([delivering messages](#delivering-messages)).
- `ctx.shutdown()` ends Pi at once when the session is idle and no command is being handled, also when called during `session_start`. During a run it takes effect when the run has settled. The exit code is 0.
- An extension's dialog (`ctx.ui.select`, `confirm`, `input`, `editor`) is written to the output as an `extension_ui_request`. It waits for an `extension_ui_response` with the same id on the input, with no time limit unless the extension set one. If the answer has `cancelled: true`, `confirm` returns false and the others return nothing. Pi ignores an answer whose id it is not waiting for (`handleInputLine` in `src/modes/rpc/rpc-mode.ts`).
- `ctx.ui.notify` is written the same way and expects no answer. An error in an extension's handler is written as an `extension_error` record.
- When Pi cannot start a session without a terminal, for example because an extension does not load, it writes a line starting with `Error:` to its error output and exits with code 1 (`src/main.ts`). A missing model does not stop it: the session starts with the placeholder model.
- Opening a session id that does not exist yet writes a warning to the error output, so not every line there is a failure.
- `RpcClient`, Pi's own client for this mode, cannot answer a dialog, starts `node` from `PATH`, and kills the process one second after asking it to stop (`src/modes/rpc/rpc-client.ts`).
- Measured with the bundled CLI (`dist/bundle/cli.js`, which uses Node's compile cache): ready in 0.15 to 0.2 seconds, and about 130 MB while idle.
