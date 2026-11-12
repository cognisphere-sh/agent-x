# Pi integration

Facts about `@earendil-works/pi-coding-agent` (pinned at 1.5.2) that the design depends on. Paths are in the Pi repo, `packages/coding-agent/`. Re-check them when upgrading Pi.

## Config locations

- Pi reads config from two places only: the agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) and `<cwd>/.pi/`. It does not search parent directories for `.pi/` (`src/core/settings-manager.ts`).
- In a trusted project Pi loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` without any settings (`docs/configuration.md`). Its own project prompt is the single file `.pi/SYSTEM.md`; it knows no prompt folder.
- The agent directory holds config and state together: `settings.json`, `auth.json`, `trust.json`, `models.json`, `bin/`.
- In `.pi/settings.json`, resource paths resolve from `.pi/`; `sessionDir` resolves from `cwd` and is read before trust is checked. `extensions` and `skills` list more folders to load; one that does not exist is skipped without a warning.
- Pi accepts settings keys it does not know: it gives no warning, keeps them when it rewrites a settings file, and returns them from `pi.getSettings()`, which gives an extension the user and project settings merged (`persistScopedSettings` in `src/core/settings-manager.ts`, `docs/extensions.md`).

## Project trust

- Resources from `.pi/` load only when the project is trusted. Interactive mode asks; print mode (`-p`) skips untrusted `.pi/` silently.
- `--approve` trusts the project for one run. Saved decisions live in `<agentDir>/trust.json`.
- `pi mcp ...` checks only saved trust and ignores `--approve` (`src/extensions/mcp/cli.ts`).

## Skills discovery

- `~/.agents/skills` loads for every project. Only user-level settings can exclude it. Skills carry `filePath`, and a `before_agent_start` handler can replace `event.systemPromptOptions.skills`, the list Pi appends to the prompt.
- `.agents/skills` in `cwd` and its ancestors loads when the project is trusted, walking up to the git root (`src/core/package-manager.ts`).
- `-ns` drops all skills, including the agent's own.

## CLI

- Subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`, `auth`) are recognized only as the first argument. `auth login <provider>` and `auth logout <provider>` write the agent directory's `auth.json` without starting a session.
- `-nc` skips `AGENTS.md` / `CLAUDE.md`. `-c` continues the latest session, `-r` opens a picker, `--session <id>` accepts a partial ID.
- With `-p`, Pi reads stdin until it closes.
- The CLI entry is `dist/bundle/cli.js` in the package.

## Sessions

- `--session-id <id>` opens the session with exactly that id among those stored for the working directory, or creates it. It cannot be combined with `--session`, `-c` or `-r`; given twice, the last one counts (`createSessionManager` in `src/main.ts`).
- A session id must match `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` (`assertValidSessionId` in `src/core/session-manager.ts`). The id is part of the file name, `<time>_<id>.jsonl`, which limits its length.
- Pi finds a session by its id among those stored for the working directory, which it compares as text (`SessionManager.findById` in `src/core/session-manager.ts`). A path through a symlink does not match the resolved path. The CLI's working directory is always the resolved path, so `agentx run` and the runner, which both start the CLI, find the same session file.
- The session file is written when the first message is appended. A session that never got one leaves no file.
- Nothing locks a session file. Two processes that open the same session each append from their own last entry, which forks the conversation; a reader takes the last line as the current end.
- Replacing the session in a running Pi (`/new`, `/resume`, `/fork`, `/clone`, `/import`) sends `session_shutdown` with a reason to the extensions, runs every extension's factory again and sends `session_start` to the new instances. `/reload` does the same and also loads the extension's module again. `/tree` keeps the session.
- After a session is replaced or closed, the old `ctx` and `pi` objects throw when used. A timer an extension started keeps the process alive and, uncaught, such a throw ends the process, so an extension must stop its timers on `session_shutdown`.

## Delivering messages

- `pi.sendUserMessage(text, { deliverAs: "steer" })` queues the text as a steer while a run is in progress and starts a run when Pi is idle. At runtime it returns nothing: a failure (no model, no login, compaction in progress) goes to the host's extension-error listener, not to the caller (`sendUserMessage` in the extension actions of `src/core/agent-session.ts`).
- A steer is put in before the next model call: after the tool calls of the current turn, and also after a final turn without tool calls, which then is not the last. One sent from a `turn_end` handler is delivered in the same run.
- Each steer becomes its own user message, by default one per turn (`steeringMode`).
- After a provider error, Pi still delivers pending steers, in a retry or in a new run. After an abort, pending steers stay with Pi and are delivered with the next prompt. `session.clearQueue()` drops them; extensions can only ask `ctx.hasPendingMessages()`.
- When a run is aborted during a tool call, the turn still ends with `turn_end` and outcome `completed`, because the outcome comes from the assistant message, which asked for the tool. `ctx.signal.aborted` is true by then. A steer sent at that point is saved to the session, and the model call that would read it is aborted.
- Before a run starts, Pi prepares the prompt: `input` handlers, template expansion, the model and login check. During that time `ctx.isIdle()` is still true and nothing is pending (`_preparePrompt` in `src/core/agent-session.ts`).
- Closing or replacing a session aborts a run in progress first, so the extensions see `agent_settled` with `aborted: true` before `session_shutdown` (`src/core/agent-session-runtime.ts`).
- An extension can abort the run in progress from any handler or timer with `ctx.abort()` (`ExtensionContext` in `src/core/extensions/types.ts`). A tool call in progress is stopped and no further model call is made.
- Pi appends a user message to the session after the message's `message_end` event. By the next `context` event, which precedes every model call, the entry exists. No event carries a user message's entry id.
- `agent_before_settle` carries `outcome` (`completed` or `error`, after Pi's own retries) and is not sent for an aborted run. `agent_settled` carries `aborted` and is final.
- `pi.sendUserMessage()` neither runs extension commands nor expands templates and skills unless told to. What it sends passes through `input` handlers, where returning `handled` drops the input without a run.
- With no usable model configured, `ctx.model` is not empty: it is a placeholder for a model of a provider Pi does not know, so `ctx.modelRegistry.getProvider(ctx.model.provider)` is undefined. `ctx.modelRegistry.getApiKeyAndHeaders(model)` answers whether Pi can authenticate a request for a model, with the reason when it cannot. Before a run, Pi itself refuses a prompt when there is no model or no login for its provider (`_preparePrompt` in `src/core/agent-session.ts`).
- `ctx.mode` is `tui`, `rpc`, `json` or `print`: the mode the host bound the extensions with, `print` unless it says otherwise. `ctx.hasUI` is true when the host bound a UI, as the terminal UI and RPC mode do (`setUIContext` in `src/core/extensions/runner.ts`). Print mode writes the last assistant message of the run to stdout. It binds no shutdown handler, so `ctx.shutdown()` does nothing, and Pi sets the process exit code only when the run failed, leaving a code an extension has set (`src/modes/print-mode.ts`, `src/main.ts`).

## Packages

- `packages` in `.pi/settings.json` accepts a local path, resolved from `<cwd>/.pi/` (`getBaseDirForScope` in `src/core/package-manager.ts`). Pi loads it in place, without copying or installing it.
- A missing local path is skipped without a warning (`resolveLocalExtensionSource`).
- `-e <folder>` loads a package folder with all its resources, in temporary scope, and reports a missing path as an error (`resolveExtensionSources` in `src/core/package-manager.ts`, `src/core/resource-loader.ts`).
- `--session-dir <dir>` sets where sessions are stored and looked up, as `sessionDir` in settings does.
- A directory without a `package.json` `pi` manifest is discovered by convention: `extensions/`, `skills/`, `prompts/` (prompt templates), `themes/`.
- A package carries extensions, skills, prompt templates and themes. MCP servers are not a package resource; an extension adds them with `pi.registerMcpServer` (`docs/mcp.md`).
- Project-scope npm and git packages are installed into `<cwd>/.pi/npm` and `<cwd>/.pi/git` (`getNpmInstallRoot`, `getGitInstallRoot` in `src/core/package-manager.ts`).
- Pi warns when a package's `package.json` lists a host package such as `@earendil-works/pi-coding-agent` in `dependencies` (`src/core/resource-loader.ts`).

## Extensions

- `before_agent_start` can set `event.systemPromptOptions.customPrompt`, which replaces the default preamble and drops the default tool list, rules and Pi docs sections; the skills list and `cwd` are still appended (`src/core/system-prompt.ts`). Tool schemas still reach the model.
- Extension directories load `*.ts` files and `<subdir>/index.ts` one level deep; other files in them are ignored (`src/core/package-manager.ts`).
- The `input` event can `continue`, `transform` or `handled` (skip the model).
- `pi.registerFlag(name, { type: "boolean" })` adds a command-line flag, listed in `--help`. `pi.getFlag(name)` reads it in a handler; while the extension is being loaded it returns the default (`docs/extensions.md`).

## RPC mode

What the runner relies on when it starts Pi for a thread ([Agent runner](../agent-runner/README.md#starting-a-threads-pi-process)). Sources: `docs/rpc.md`, `docs/rpc-extension-ui.md`, `src/modes/rpc/rpc-mode.ts`.

- `--mode rpc` keeps Pi running without a terminal. It takes the other flags as usual, reads commands from its input and writes records to its output: one JSON object per line, ended by a line feed only. Pi waits when its output is not read. Diagnostics go to its error output.
- A session works without any command being sent: its extensions start and their timers run. That is all the runner needs, because the message queue extension delivers the messages.
- Pi closes the session and exits when its input closes (exit code 0), and when it gets `SIGTERM` (143) or `SIGHUP` (129). It does not handle `SIGINT`, which ends it at once. Closing the session aborts a run in progress first ([delivering messages](#delivering-messages)).
- `ctx.shutdown()` ends Pi right away when the session is idle and no command is being handled, also when it is called during `session_start`. During a run it takes effect when the run has settled. The exit code is 0.
- An extension's dialog (`ctx.ui.select`, `confirm`, `input`, `editor`) is written to the output as an `extension_ui_request` and waits for an `extension_ui_response` with the same id on the input, without a limit unless the extension set one. Answered with `cancelled: true`, `confirm` returns false and the others return nothing. An answer whose id Pi is not waiting for is ignored (`handleInputLine` in `src/modes/rpc/rpc-mode.ts`). `ctx.ui.notify` is written the same way and expects no answer. An error in an extension's handler is written as an `extension_error` record.
- When Pi cannot start a session without a terminal, for example because an extension does not load, it writes a line starting with `Error:` to its error output and exits with code 1 (`src/main.ts`). A missing model does not stop it: the session starts with the placeholder model.
- Opening a session id that does not exist yet writes a warning to the error output, so not every line there is a failure.
- `RpcClient`, Pi's own client for this mode, has no way to answer a dialog, starts `node` from `PATH`, and kills the process one second after asking it to stop (`src/modes/rpc/rpc-client.ts`).
- Measured with the bundled CLI (`dist/bundle/cli.js`, which uses Node's compile cache): ready in 0.15 to 0.2 seconds, about 130 MB while idle.
