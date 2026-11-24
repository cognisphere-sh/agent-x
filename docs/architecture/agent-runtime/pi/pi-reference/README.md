# Pi reference

What agentx relies on in `@earendil-works/pi-coding-agent`, pinned at 1.5.2. Paths are in the Pi repo, under `packages/coding-agent/`. Check them again when upgrading Pi.

## Config locations

- Pi reads config from two places only: its agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) and `<cwd>/.pi/`. It does not look for `.pi/` in parent directories (`src/core/settings-manager.ts`).
- In a trusted project, Pi loads `.pi/extensions/`, `.pi/skills/` and `.pi/prompts/` with no settings (`docs/configuration.md`). Its own project prompt is one file, `.pi/SYSTEM.md`. It has no prompt folder.
- The agent directory holds config and state together: `settings.json`, `auth.json`, `trust.json`, `models.json`, `bin/`.
- In `.pi/settings.json`, resource paths resolve from `.pi/`. `extensions` and `skills` list more folders to load, each read as Pi reads `.pi/extensions/` and `.pi/skills/`: an extension is a `.ts` or `.js` file, or a folder with an `index.ts` or a `package.json` manifest, one level deep (`collectFilesFromPaths` in `src/core/package-manager.ts`). A folder that does not exist is skipped with no warning.
- Pi accepts settings keys it does not know. It gives no warning, keeps them when it rewrites a settings file, and returns them from `pi.getSettings()`. That call gives an extension the user and project settings merged (`persistScopedSettings` in `src/core/settings-manager.ts`, `docs/extensions.md`).

## Project trust

- Resources in `.pi/` load only when the project is trusted. Interactive mode asks. Print mode (`-p`) skips an untrusted `.pi/` without a word.
- `--approve` trusts the project for one run. Saved choices are in `<agentDir>/trust.json`.
- `pi mcp ...` checks only saved trust and ignores `--approve` (`src/extensions/mcp/cli.ts`).

## Skills discovery

- `~/.agents/skills` loads for every project. Only user-level settings can exclude it.
- Each skill has a `filePath`. A `before_agent_start` handler can replace `event.systemPromptOptions.skills`, the list Pi adds to the prompt. With an empty list Pi writes no `skills` section (`buildSystemPrompt` in `src/core/system-prompt.ts`).
- Pi reads the skills once, when the session starts, and again only on `/reload`. `/skill:<name>` looks the skill up in that list, not in the prompt's, and puts the file's text in the message as a `<skill>` block (`_expandSkillCommand` in `src/core/agent-session.ts`).
- `--no-skills` drops the skills of the settings and of the packages they list; `--skill` paths stay (`src/core/resource-loader.ts`).
- Pi exports its loader, `loadSkillsFromDir({ dir, source })`, and `parseFrontmatter`. The loader skips a `SKILL.md` without a description, with a diagnostic naming its path, and only warns about a bad name.
- `.agents/skills` in `cwd` and its parents, up to the git root, loads when the project is trusted (`src/core/package-manager.ts`).

## CLI

- Subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`, `auth`) count only as the first argument. `uninstall` is another name for `remove` (`src/package-manager-cli.ts`).
- `auth login <provider>` and `auth logout <provider>` write `auth.json` in the agent directory without starting a session. `auth login` needs a terminal; `--no-browser` signs in another way, such as over SSH.
- `auth check --provider <provider>` exits 0 when the provider has credentials (a login, an environment key, or a key in `models.json`), 1 when it has none and 2 when they are invalid; it refreshes an expired login unless given `--no-refresh` (`docs/cli.md`).
- `-nc` skips `AGENTS.md` and `CLAUDE.md`. `-c` continues the latest session. `-r` opens a picker. `--session <id>` accepts part of an id.
- With `-p`, Pi reads stdin until it closes.
- The CLI entry is `dist/bundle/cli.js` in the package.

## Sessions

- `--session-id <id>` opens the session with exactly that id among those stored for the working directory, or creates it. It cannot be combined with `--session`, `-c` or `-r`. Given twice, the last one counts (`createSessionManager` in `src/main.ts`).
- A session id must match `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` (`assertValidSessionId` in `src/core/session-manager.ts`). The id is part of the file name, `<time>_<id>.jsonl`, which limits its length.
- Pi finds a session by its id, or the latest one, among those stored for the working directory, and compares the directory as text (`findById`, `continueRecent` in `src/core/session-manager.ts`). A path through a symlink does not match the resolved path. The CLI always uses the resolved path as its working directory, so `agentx chat` and the Pi runner, which both start the CLI, find the same session file.
- Pi writes the session file when the first message is added. A session that never got a message leaves no file.
- The file is JSON lines: the header, then one entry per line. Pi writes each new entry whole, as one line, when it adds it (`_persist` in `src/core/session-manager.ts`), and skips a line it cannot parse. `ctx.sessionManager.getEntries()` gives the session's entries, without the header, in the order they were written, as the file holds them; the [memory index](../pi-package/memory/README.md#the-index) takes them from there.
- Nothing locks a session file. Two processes that open the same session each append from their own last entry, which forks the conversation. A reader takes the last line as the current end.
- Replacing the session in a running Pi (`/new`, `/resume`, `/fork`, `/clone`, `/import`) sends `session_shutdown`, with a reason, to the extensions. Pi then runs every extension's factory again and sends `session_start` to the new instances. `/reload` does the same and also loads the extension's module again. `/tree` keeps the session.
- After a session is replaced or closed, the old `ctx` and `pi` objects throw when used. A timer an extension started keeps the process alive, and an uncaught throw from it ends the process. So an extension must stop its timers on `session_shutdown`.

## Tools

- The `bash` tool runs a command with `PI_SESSION_FILE`, the file of the session that runs it, and `PI_SESSION_ID` in its environment, removing ones it inherited. A command a person types with `!` gets none (`resolveSpawnContext` in `src/core/tools/bash.ts`). So `agentx event send`, run by the model, knows its thread, the file's folder ([sending](../../events/README.md#sending-and-delivering)). The rest of the command's environment is Pi's own (`getShellEnv` in `src/utils/shell.ts`), so `AGENTX_AGENT`, which agentx gives Pi, reaches every command, a person's `!` command too.
- Pi saves the model's answer to the session before it runs the answer's tool calls: the agent awaits each listener, and the session appends the message at `message_end` (`processEvents` in pi-agent-core's `src/agent.ts`, `runLoop` in its `src/agent-loop.ts`). So while a tool runs, the branch's last assistant message is the answer that called it, with all its tool calls.

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
- `agent_before_settle` carries `outcome` (`completed` or `error`, after Pi's own retries). It is not sent for an aborted run. `agent_settled` carries `aborted` and comes last: after the run's last turn and the entries `agent_before_settle` handlers returned are written, with Pi awaiting each handler in turn (`_emitAgentSettled` in `src/core/agent-session.ts`).
- `pi.sendUserMessage()` does not run extension commands, and does not expand templates and skills unless told to. What it sends goes through `input` handlers, and a handler that returns `handled` drops the input with no run.
- With no usable model set, `ctx.model` is not empty. It is a placeholder for a model of a provider Pi does not know, so `ctx.modelRegistry.getProvider(ctx.model.provider)` is undefined. `ctx.modelRegistry.getApiKeyAndHeaders(model)` tells whether Pi can log in for a model, and why not when it cannot. Before a run, Pi itself refuses a prompt when there is no model, or no login for its provider (`_preparePrompt` in `src/core/agent-session.ts`).
- `ctx.mode` is `tui`, `rpc`, `json` or `print`: the mode the host bound the extensions with, and `print` if the host does not say. `ctx.hasUI` is true when the host bound a UI, as the terminal UI and RPC mode do (`setUIContext` in `src/core/extensions/runner.ts`).
- Print mode writes the run's last message to stdout when it is an assistant message, and nothing when an extension added one after it. It binds no shutdown handler, so `ctx.shutdown()` does nothing. Pi sets the exit code only when the run failed, and keeps a code an extension has set (`src/modes/print-mode.ts`, `src/main.ts`).

## Packages

- `packages` in `.pi/settings.json` accepts a local path, resolved from `<cwd>/.pi/` (`getBaseDirForScope` in `src/core/package-manager.ts`). Pi loads it where it is, with no copy or install.
- `-e <folder>` loads a package folder with all its resources, in temporary scope. A missing path is an error (`resolveExtensionSources` in `src/core/package-manager.ts`, `src/core/resource-loader.ts`).
- `--session-dir <dir>` sets where sessions are stored and looked up. Pi looks only in that folder, not in folders below it: `-c`, `-r` and `--session-id` find the sessions in it alone (`findById`, `continueRecent` and `list` in `src/core/session-manager.ts`). `--continue` in an empty folder starts a new session there.
- A folder with no `pi` manifest in a `package.json` is read by convention: `extensions/`, `skills/`, `prompts/` (prompt templates), `themes/`. Pi takes the folder's entries in the order the file system lists them, unsorted (`collectAutoExtensionEntries` in `src/core/package-manager.ts`).
- A `pi` manifest with resource fields (`extensions`, `skills`, `prompts`, `themes`) replaces that: Pi loads only what it lists, in the listed order, and no other type (`collectPackageResources`).
- A package carries extensions, skills, prompt templates and themes. MCP servers are not a package resource; an extension adds them with `pi.registerMcpServer` (`docs/mcp.md`).
- Project-scope npm and git packages are installed into `<cwd>/.pi/npm` and `<cwd>/.pi/git` (`getNpmInstallRoot`, `getGitInstallRoot` in `src/core/package-manager.ts`).
- On start, Pi installs an npm package that is missing, or whose installed version differs from an exact version in the settings. A package it cannot install is skipped, and the session starts without it. With `PI_OFFLINE` set, nothing is installed (`resolvePackageSources`, `installedNpmMatchesConfiguredVersion`). An exact version is never updated (`docs/packages.md`).
- A package's source ends with its version or ref after its last `@`: `npm:@scope/name@1.2.3`, `git:github.com/user/repo@v1` (`docs/packages.md`). `agentx upgrade-agent` finds the template's version of an agent's package by the source without it.
- Pi warns when a package's `package.json` lists a host package, such as `@earendil-works/pi-coding-agent`, in `dependencies` (`src/core/resource-loader.ts`).

## Extensions

- `before_agent_start` can set `event.systemPromptOptions.customPrompt`. It replaces the default preamble and drops the default tool list, rules and Pi docs sections. Pi still adds the skills list and `cwd` (`src/core/system-prompt.ts`). Tool schemas still reach the model.
- `before_agent_start` runs once per run, when a prompt starts one (`_prepareRun` in `src/core/agent-session.ts`). A message steered into a running run does not run it.
- A `before_agent_start` handler that throws does not stop the run. Pi reports the error and goes on with the options as the handler left them: without a `customPrompt` it set, Pi's default prompt (`emitBeforeAgentStart` in `src/core/extensions/runner.ts`).
- `event.systemPromptOptions.sections` holds custom sections, each wrapped in `<name>` tags. They stay when `customPrompt` is set. A name must match `^[a-z][a-z0-9_-]*$` and not be `preamble`, or building the prompt throws. They come after Pi's own sections, `cwd` last of those, in the order they were set, and an empty one is left out. Each run's handlers get the options fresh, without the last run's sections, so a section no handler sets again is removed (`normalizeBuildSystemPromptOptions` in `src/core/system-prompt.ts`). A session replays its sections in the order they first came: a changed one keeps its place, a new one goes last (`getCurrentSystemMessage` in pi-ai's `src/utils/transcript.ts`). When a section changes, Pi sends the model that section's whole new text, and nothing for the sections that did not change (`diffSystemPromptSections` in `src/core/system-prompt.ts`).
- An extension folder loads its `*.ts` files and `<subdir>/index.ts` one level down. Other files in it are ignored (`src/core/package-manager.ts`).
- The `input` event can return `continue`, `transform` or `handled` (skip the model).
- `pi.registerFlag(name, { type: "boolean" })` adds a command-line flag, listed in `--help`. `pi.getFlag(name)` reads it in a handler. While the extension is loading, it returns the default (`docs/extensions.md`).
- Pi calls an event's handlers one after another and awaits each, extension by extension (`emit` in `src/core/extensions/runner.ts`). So a `session_start` handler that awaits holds back the handlers after it. Pi loads the `-e` package first, then the agent's extensions, from `.pi/extensions/` and the folders its settings list, then its built-in ones such as MCP support (`mergePaths` in `src/core/resource-loader.ts`).
- Pi's MCP support waits for servers with direct tools once, in its `before_agent_start` of the first run, and only for servers registered by then (`dist/extensions/mcp/index.js`).
- Every session start (start-up, `/new`, `/resume`, `/fork`, `/reload`) emits `session_start`, then, once all its handlers have finished, `resources_discover`, if any extension handles it. Nothing follows at start-up: the mode then waits for input (RPC, terminal) or sends its prompt (print) (`bindExtensions` in `src/core/agent-session.ts`). `session_start` fires whether or not a message comes.
- `pi.appendEntry(customType, data)` adds a custom entry to the session, which the model does not see. `ctx.sessionManager.getEntries()` returns it with `type: "custom"`.
- `pi.registerTool` takes `parameters` as any JSON Schema; a TypeBox schema is one. Its `execute(id, params, signal, onUpdate, ctx)` gets the extension context. A thrown error reaches the model as an error result.

## Context and compaction

Sources: `docs/extensions.md`, `docs/compaction.md`, `docs/session-format.md`, `src/core/agent-session.ts`, `src/core/compaction/compaction.ts`.

- A `turn_end` handler sees the entries proposed so far in `event.entries` and returns the whole list: `custom`, `custom_message`, `context_edit` and `compaction` drafts. Pi checks them together after every handler has run and appends them in order; one bad draft drops them all. `event.toolResults` holds the turn's tool results, with their `details`.
- A `context_edit` entry with `replacement: null` omits its target, and one with `replacement: { content }` replaces the target's content, a user, assistant, tool result or custom message entry, from the model's context from then on. The session file keeps the target. `ctx.sessionManager.buildSessionProjection()` gives the entries as the model sees them: each with its source entry and its messages, none for an omitted one. `sessionEntryToContextMessages(entry)`, exported from Pi's index, gives an entry's messages as they were written. A replacement with string content on an assistant or tool result message becomes one text part. Pi checks each edit's target against the whole branch, so applying edits costs their number times the branch's length.
- A `custom_message` draft becomes a user-role message for the model. It runs no input handlers.
- `pi.appendEntry` in `before_agent_start` lands before the run's first message, the prompt that started it. A `message` that the handler returns lands after it, and after any messages queued for the next turn (`_prepareRun` in `src/core/agent-session.ts`).
- `input` comes for a prompt, typed or from RPC, and for `pi.sendUserMessage`, before Pi makes it a message; `streamingBehavior` is undefined, and `ctx.isIdle()` true, only when it will start a run. A run that `pi.sendMessage(..., { triggerTurn: true })` starts has no `input`.
- Pi writes a run's system message, when the prompt is new or changed, before the run's first message, and a message written into the session earlier comes before it. Providers take only a system message at the very start of the context as the system prompt; a later one is sent as an update of its sections (`openai-responses-shared.ts` in `@earendil-works/pi-ai`).
- `agent_before_settle` comes once a run is over, after Pi's retries, and takes the same drafts as `turn_end`. Each handler gets in `event.entries` the drafts of the handlers before it, in the order the extensions loaded, and returns the whole list (`emitBoundary` in `src/core/extensions/runner.ts`). Drafts alone start no model call; only `continue: true` does, when the context then does not end with an assistant message. The continuation is another low-level run without `before_agent_start`, and `agent_before_settle` comes again after it.
- `ctx.getContextUsage()` is the last model response's token count plus Pi's estimate of the messages after it, a quarter of their length. After a compaction it is `null` until the next response. With `context_edit` entries in the context, Pi's own threshold check uses its estimate of the whole context instead.
- Pi compacts by itself when the context passes the window less `compaction.reserveTokens` (default 16384): before a prompt, ahead of `before_agent_start`, and between turns, also after the model refused a context as too long, and for `/compact`. Its cut keeps `compaction.keepRecentTokens` (default 20000), never splits a tool call from its result, and can fall inside a run.
- Each assistant message keeps the provider's `usage`: `input`, `output`, `cacheRead` and `cacheWrite` tokens, each counted once; a failed answer's are zero (`calculateContextTokens` in `src/core/compaction/compaction.ts`, `parseChunkUsage` in pi-ai's `openai-completions.ts`).

## MCP servers

Sources: `docs/mcp.md`, `docs/extensions.md`, `dist/extensions/mcp/` and pi-mcp's `output-limit.js`.

- `pi.registerMcpServer(name, config)` takes the shape of an `mcpServers` entry in `mcp.json`. Registered during `session_start`, a server connects at once. A registration is not saved, so an extension registers again on every load. A server of the same name in `mcp.json` takes precedence.
- `env` and `headers` values can name environment variables as `${NAME}`. Pi fills them in when it connects, also for a registered server.
- `exposure` decides how tools reach the model. `codemode`, the default: not declared; scripts in the `codemode` tool call them. `deferred`: found and loaded with `tool_search`. `direct`: declared like a built-in tool. Pi lists a server's instructions and `description` in the system prompt only for servers whose tools are not declared.
- The first prompt waits up to 10 seconds for servers with `direct` tools, so their tools are in its request.
- An MCP tool is an extension tool, named `mcp__<server>__<tool>` (`pi.registerTool` in `index.js`), so `tool_result` handlers get its result and can replace it; the session file keeps the result as they leave it. Its `content` is the server's content blocks, and text over 20 KB is already cut in the middle, with the whole text in a temp file named by `details.fullOutputPath` (`convertMcpResult` in `tools.js`). Replacing `content` drops `structuredContent`, the whole `CallToolResult`, which codemode scripts get.
- Pi takes an HTTP server without an `Authorization` header for one that may sign in with OAuth, so a server that refuses its key shows in `/mcp` as needing sign-in.

## RPC mode

What the Pi runner relies on when it starts Pi for a thread ([Pi runner](../README.md#starting-a-threads-pi-process)). Sources: `docs/rpc.md`, `docs/rpc-extension-ui.md`, `src/modes/rpc/rpc-mode.ts`.

- `--mode rpc` keeps Pi running with no terminal. It takes the other flags as usual. It reads commands from its input and writes records to its output: one JSON object per line, each ended by a line feed only. Pi waits when nobody reads its output. Diagnostics go to its error output.
- A session works with no command sent: its extensions start and their timers run. The Pi runner needs nothing more, because the event queue extension delivers the events.
- Pi closes the session and exits when its input closes (exit code 0), and on `SIGTERM` (143) or `SIGHUP` (129). It does not handle `SIGINT`, which ends it at once. Closing the session first aborts a run in progress ([delivering messages](#delivering-messages)).
- `ctx.shutdown()` ends Pi at once when the session is idle and no command is being handled, also when called during `session_start`. During a run it takes effect when the run has settled. The exit code is 0.
- An extension's dialog (`ctx.ui.select`, `confirm`, `input`, `editor`) is written to the output as an `extension_ui_request`. It waits for an `extension_ui_response` with the same id on the input, with no time limit unless the extension set one. If the answer has `cancelled: true`, `confirm` returns false and the others return nothing. Pi ignores an answer whose id it is not waiting for (`handleInputLine` in `src/modes/rpc/rpc-mode.ts`).
- `ctx.ui.notify` is written the same way and expects no answer. An error in an extension's handler is written as an `extension_error` record.
- When Pi cannot start a session without a terminal, for example because an extension does not load, it writes a line starting with `Error:` to its error output and exits with code 1 (`src/main.ts`). A missing model does not stop it: the session starts with the placeholder model.
- `RpcClient`, Pi's own client for this mode, cannot answer a dialog, starts `node` from `PATH`, and kills the process one second after asking it to stop (`src/modes/rpc/rpc-client.ts`).
- Measured with the bundled CLI (`dist/bundle/cli.js`, which uses Node's compile cache): ready in 0.15 to 0.2 seconds, and about 130 MB while idle.
