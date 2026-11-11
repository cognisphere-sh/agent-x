# Pi package

The agentx Pi package: what agentx adds to every agent to run it under the harness. Today that is the system prompt extension and the harness prompt; shared skills, prompt templates and MCP servers go here too. It ships in the `agent-x` package as `src/agent-runtime/pi-package/` and is passed to Pi by `agentx run`, so it is kept apart from what the agent's own directory defines and is the same for every agent ([D11](#d11)).

```
agent-x/src/agent-runtime/pi-package/
  package.json                marks the Pi package: Pi as a peer dependency, no `pi` manifest
  extensions/system-prompt/
    index.ts                  the system prompt extension
    harness.md                the harness prompt
```

Pi discovers a package's resources by folder name, so adding to it means adding a file:

```
  extensions/<name>.ts or <name>/index.ts   hooks, tools, commands; MCP servers through pi.registerMcpServer
  skills/<skill>/SKILL.md                   skills for every agent
  prompts/<name>.md                         prompt templates
```

## Loading

`agentx run` passes the package's folder to Pi with `-e` when it starts a session ([D16](#d16)). Pi loads a package folder given this way in place, with all its resources: extensions, skills and prompt templates ([Pi](../pi/README.md#packages)). Nothing in the agent's directory refers to it, so the agent's `.pi/settings.json` holds only what the agent's author wrote, and upgrading agentx upgrades the package for every agent.

The folder is found relative to the running CLI, which is the copy the project pins ([D15](../cli/README.md#d15)). With agentx linked from a checkout (`npm install <path-to-agentx>` in `agent-x/`), edits to it apply on the next prompt, with no rebuild.

It has its own `package.json` because Pi requires a package to list Pi under `peerDependencies`, and warns when it is under `dependencies`, where agentx's own `package.json` has it. It is named `agentx-pi`, is private and never published on its own; it travels inside `agent-x`.

Pi loads the TypeScript source, so the package publishes this folder as source. It sits in `src/` to be type-checked with the rest and beside the runtime code that runs agents; the copy `tsc` emits to `dist/` is unused.

## The system prompt extension

`extensions/system-prompt/index.ts` handles `before_agent_start` and sets `event.systemPromptOptions.customPrompt` to `harness.md` followed by the agent's `system_prompt/*.md` files (found under `systemPromptOptions.cwd`, the agent directory) sorted by filename, each trimmed, joined with blank lines. Files are read on every prompt, so edits apply without `/reload`. Why an extension: [D5](../agent/README.md#d5).

The prompt has two parts:

- **Harness prompt** (`harness.md`): the same in every agent. What agentx is, tool-use rules, which of the agent's files it may read or write (it writes in `storage/workspace`), and where the project's app and other agents are.
- **Agent prompt** (`system_prompt/*.md` in the agent): who the agent is and how it works ([Agent](../agent/README.md#system-prompt)).

`customPrompt` replaces Pi's whole default prompt, including its tool list, rules and Pi docs pointers, so the harness prompt carries the tool rules. Pi still appends the skills list and the working directory ([Pi](../pi/README.md#extensions)).

The same handler removes skills under `~/.agents/skills` from `event.systemPromptOptions.skills`, the list Pi appends, so the model is told only about the agent's skills, its packages' skills and agentx's ([D18](#d18)).

## Known limits

- Skills in `~/.agents/skills` are hidden from the model, not unloaded: Pi still lists them at startup, and a user can run one by typing `/skill:<name>` ([D18](#d18)).
- The package loads only through `agentx run`. Pi started any other way in an agent directory does not get it. The runtime must pass the same folder to the SDK (`additionalExtensionPaths`).

## Decisions

<a id="d11"></a>
### D11. agentx's Pi package ships in the agentx package and loads as a local Pi package

- **Problem.** What agentx adds to every agent (the harness prompt, the extension that builds the system prompt, shared skills) must stay apart from what users write in the agent, must not be overridable from the agent's files, and should upgrade with agentx.
- **Decision.** `src/agent-runtime/pi-package/` in the agentx package, listed in the agent template's `.pi/settings.json` `packages` as a local path into `node_modules/agent-x` of the project's `agent-x/` package. The agent directory holds only user-defined files. Design goal 2 becomes: the agent directory plus the agentx version the project pins define the agent.
- **Why.** One copy, versioned and pinned with agentx like Pi itself ([D1](../agent/README.md#d1)). Declared in checked-in settings, so the Pi SDK's `SettingsManager` loads it the same way as the CLI.
- **Superseded in part.** The package is no longer listed in the agent's settings; `agentx run` passes it to Pi ([D16](#d16)).
- **Rejected.** `system_prompt/00-harness.md` or `extensions/` in the agent: copied per agent, editable, stale after upgrades, mixed with user files. `.agentx/` in the agent: the same copy, only hidden. `.pi/extensions` and `.pi/skills`: Pi loads these as the agent's own, so user files would land there too. `agentx run -e <path>`: invisible in the agent's config, and the SDK runtime would need its own injection. Pi's `systemPromptOptions.sections` for the harness prompt: rendered after the skills list and working directory, not first.

<a id="d16"></a>
### D16. `agentx run` passes agentx's part of the config; the agent's settings are the author's alone

- **Problem.** The agent's `.pi/settings.json` held agentx's lines (the Pi package path, `sessionDir`) next to the author's. An agentx release that changed its lines could not reach existing agents, a wrong package path was skipped by Pi without a warning, and the path depended on the folder depth and on where the package manager installs.
- **Decision.** `run` adds `-e <agentx>/src/agent-runtime/pi-package` and `--session-dir <agent>/storage/sessions` to session runs. The template's `.pi/settings.json` has no agentx entries.
- **Why.** One owner per file: agentx's part lives in agentx and upgrades with it; the author's file is never edited or migrated. Pi reports a missing `-e` path as an error.
- **Consequence.** The package is not visible in the agent's config, and Pi marks its resources as temporary scope. The runtime must pass the same two settings to the SDK; this is what [D11](#d11) wanted to avoid.
- **Rejected.** agentx's lines in `storage/pi/settings.json`, Pi's second settings file: it is gitignored state that Pi also writes to, so agentx would generate and merge it on every start ([D4](../agent/README.md#d4)). `agentx upgrade` rewriting agentx's lines in every agent: needed for each change, and agents stay broken until it runs.

<a id="d18"></a>
### D18. The system prompt extension hides `~/.agents/skills` from the model

- **Problem.** Pi loads `~/.agents/skills` for every project, so an agent's prompt listed skills from the home of whoever runs it, which are not part of the agent and differ per machine ([D7](../project/README.md#d7) accepted this).
- **Decision.** In `before_agent_start`, the extension drops skills whose file is under `~/.agents/skills` from `systemPromptOptions.skills`.
- **Why.** No generated file and no flag: it applies wherever the Pi package is loaded, under the CLI and the SDK alike. Matching the path keeps skills from the shared `agent-x/.pi` and from packages, which Pi also marks as user scope.
- **Rejected.** `--no-skills`: also drops the skills of the agent's settings and packages. An exclusion in Pi's user-level settings: a generated file ([D4](../agent/README.md#d4)). Setting `HOME` for Pi: breaks git, ssh and everything else the agent runs.
- **Consequence.** The skills stay loaded in Pi: its startup listing shows them and `/skill:<name>` typed by a user still works.
