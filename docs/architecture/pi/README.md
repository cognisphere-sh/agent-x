# Pi integration

Facts about `@earendil-works/pi-coding-agent` (pinned at 1.5.0) that the design depends on. Paths are in the Pi repo, `packages/coding-agent/`. Re-check them when upgrading Pi.

## Config locations

- Pi reads config from two places only: the agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) and `<cwd>/.pi/`. It does not search parent directories for `.pi/` (`src/core/settings-manager.ts`).
- The agent directory holds config and state together: `settings.json`, `auth.json`, `trust.json`, `models.json`, `bin/`.
- In `.pi/settings.json`, resource paths resolve from `.pi/`; `sessionDir` resolves from `cwd` and is read before trust is checked.

## Project trust

- Resources from `.pi/` load only when the project is trusted. Interactive mode asks; print mode (`-p`) skips untrusted `.pi/` silently.
- `--approve` trusts the project for one run. Saved decisions live in `<agentDir>/trust.json`.
- `pi mcp ...` checks only saved trust and ignores `--approve` (`src/extensions/mcp/cli.ts`).

## Skills discovery

- `~/.agents/skills` loads for every project. Only user-level settings can exclude it.
- `.agents/skills` in `cwd` and its ancestors loads when the project is trusted, walking up to the git root (`src/core/package-manager.ts`).
- `-ns` drops all skills, including the agent's own.

## CLI

- Subcommands (`install`, `remove`, `update`, `list`, `config`, `mcp`) are recognized only as the first argument.
- `-nc` skips `AGENTS.md` / `CLAUDE.md`. `-c` continues the latest session, `-r` opens a picker, `--session <id>` accepts a partial ID.
- With `-p`, Pi reads stdin until it closes.
- The CLI entry is `bundle/cli.js` in the package.

## Extensions

- `before_agent_start` can set `event.systemPromptOptions.customPrompt`, which replaces the default preamble; tools, skills and `cwd` sections are still appended.
- The `input` event can `continue`, `transform` or `handled` (skip the model).
- Extensions load in the CLI and the SDK alike.

## SDK

What the runtime must account for when it uses the SDK:

- `DefaultResourceLoader` and `SettingsManager` take `cwd` and `agentDir` explicitly.
- The built-in MCP extension reads the agent directory from the global `getAgentDir()` (env var), not from options.
- `SessionManager.findById` matches exact IDs only; the CLI matches prefixes.
