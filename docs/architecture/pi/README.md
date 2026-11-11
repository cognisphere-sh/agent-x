# Pi integration

Facts about `@earendil-works/pi-coding-agent` (pinned at 1.5.2) that the design depends on. Paths are in the Pi repo, `packages/coding-agent/`. Re-check them when upgrading Pi.

## Config locations

- Pi reads config from two places only: the agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) and `<cwd>/.pi/`. It does not search parent directories for `.pi/` (`src/core/settings-manager.ts`).
- The agent directory holds config and state together: `settings.json`, `auth.json`, `trust.json`, `models.json`, `bin/`.
- In `.pi/settings.json`, resource paths resolve from `.pi/`; `sessionDir` resolves from `cwd` and is read before trust is checked.

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

## Packages

- `packages` in `.pi/settings.json` accepts a local path, resolved from `<cwd>/.pi/` (`getBaseDirForScope` in `src/core/package-manager.ts`). Pi loads it in place, without copying or installing it.
- A missing local path is skipped without a warning (`resolveLocalExtensionSource`).
- `-e <folder>` (SDK: `additionalExtensionPaths`) loads a package folder with all its resources, in temporary scope, and reports a missing path as an error (`resolveExtensionSources` in `src/core/package-manager.ts`, `src/core/resource-loader.ts`).
- `--session-dir <dir>` sets where sessions are stored and looked up, as `sessionDir` in settings does.
- A directory without a `package.json` `pi` manifest is discovered by convention: `extensions/`, `skills/`, `prompts/` (prompt templates), `themes/`.
- A package carries extensions, skills, prompt templates and themes. MCP servers are not a package resource; an extension adds them with `pi.registerMcpServer` (`docs/mcp.md`).
- Project-scope npm and git packages are installed into `<cwd>/.pi/npm` and `<cwd>/.pi/git` (`getNpmInstallRoot`, `getGitInstallRoot` in `src/core/package-manager.ts`).
- Pi warns when a package's `package.json` lists a host package such as `@earendil-works/pi-coding-agent` in `dependencies` (`src/core/resource-loader.ts`).

## Extensions

- `before_agent_start` can set `event.systemPromptOptions.customPrompt`, which replaces the default preamble and drops the default tool list, rules and Pi docs sections; the skills list and `cwd` are still appended (`src/core/system-prompt.ts`). Tool schemas still reach the model.
- Extension directories load `*.ts` files and `<subdir>/index.ts` one level deep; other files in them are ignored (`src/core/package-manager.ts`).
- The `input` event can `continue`, `transform` or `handled` (skip the model).
- Extensions load in the CLI and the SDK alike.

## SDK

What the runtime must account for when it uses the SDK:

- `DefaultResourceLoader` and `SettingsManager` take `cwd` and `agentDir` explicitly.
- The built-in MCP extension reads the agent directory from the global `getAgentDir()` (env var), not from options.
- `SessionManager.findById` matches exact IDs only; the CLI matches prefixes.
