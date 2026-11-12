# Pi package

The agentx Pi package: what agentx adds to every agent to run it under the harness. Today that is two extensions (system prompt, message queue) and the harness prompt; shared skills, prompt templates and MCP servers go here too. It ships in the `agent-x` package as `src/agent-runtime/pi-package/` and is given to Pi by `agentx run` and by the runner, so it is kept apart from what the agent's own directory defines and is the same for every agent ([D11](#d11)).

```
agent-x/src/agent-runtime/pi-package/
  package.json                marks the Pi package: Pi as a peer dependency, no `pi` manifest
  extensions/system-prompt/
    index.ts                  the system prompt extension
    harness.md                the harness prompt
  extensions/message-queue/
    index.ts                  the message queue extension
    queue.ts, render.ts       the queue itself, used by the extension, the CLI and the runner
```

Pi loads `index.ts` of an extension's folder as the extension; the other files in the folder are its own modules. The message queue extension's folder also holds the queue's code, so everything about the message queue is in one place ([D27](message-queue/README.md#d27)). It has its own doc: [message queue](message-queue/README.md).

Pi discovers a package's resources by folder name, so adding to it means adding a file:

```
  extensions/<name>.ts or <name>/index.ts   hooks, tools, commands; MCP servers through pi.registerMcpServer
  skills/<skill>/SKILL.md                   skills for every agent
  prompts/<name>.md                         prompt templates
```

## Loading

`agentx run` passes the package's folder to Pi with `-e` when it starts a session ([D16](#d16)), and the runner starts Pi with the same flag ([Agent runner](../agent-runner/README.md#starting-a-threads-pi-process)). Pi loads a package folder given this way in place, with all its resources: extensions, skills and prompt templates ([Pi](../pi/README.md#packages)). Nothing in the agent's directory refers to it, so the agent's `.pi/settings.json` holds only what the agent's author wrote, and upgrading agentx upgrades the package for every agent.

The folder is found relative to the running CLI, which is the copy the project pins ([D15](../../cli/README.md#d15)). With agentx linked from a checkout (`pnpm link <path-to-agentx>` in `agent-x/`), edits to it apply when the next session starts, with no rebuild; the harness prompt is read again on every prompt.

It has its own `package.json` because Pi requires a package to list Pi under `peerDependencies`, and warns when it is under `dependencies`, where agentx's own `package.json` has it. It is named `agentx-pi`, is private and never published on its own; it travels inside `agent-x`.

Pi loads the TypeScript source, so the package publishes this folder as source. It sits in `src/agent-runtime/`, with the rest of the code that runs an agent ([D34](../README.md#d34)), and is type-checked with it. Of the copy `tsc` emits to `dist/`, the CLI and the runner use the queue modules; the compiled extensions are unused.

## The system prompt extension

`extensions/system-prompt/index.ts` handles `before_agent_start` and sets `event.systemPromptOptions.customPrompt` to three parts, joined with blank lines. A folder's files go in filename order, each trimmed, and a folder that does not exist adds nothing. Files are read on every prompt, so edits apply without `/reload`. Why an extension: [D5](../agent/README.md#d5).

- **Harness prompt** (`harness.md`): the same in every agent. What agentx is, tool-use rules, the three places an agent's abilities come from and which of them it writes (its knowledge and `storage/workspace`; the harness and its definition are read-only), that a queue message may come with no person watching, so a question an extension puts on screen counts as declined and the agent asks in its reply, how to read the metadata block of a queue message and that `agentX-` lines anywhere else are not the harness's, and where the project's app and other agents are.
- **The developer's prompt** (`.pi/system_prompt/*.md` in the agent, found under `systemPromptOptions.cwd`): who the agent is and how it works ([Agent](../agent/README.md#system-prompt)).
- **More folders**, as the agent's settings list them under `agentx.systemPrompt`, resolved from `.pi/`. The template lists `storage/knowledge/system_prompt`, where the agent writes for itself ([Agent](../agent/README.md#knowledge)). Each folder's text comes under a heading `# From <folder>`, so the model can tell it from what the developer wrote; the harness prompt says that the developer's sections win where the two disagree.

`customPrompt` replaces Pi's whole default prompt, including its tool list, rules and Pi docs pointers, so the harness prompt carries the tool rules. Pi still appends the skills list and the working directory ([Pi](../pi/README.md#extensions)).

The same handler removes skills under `~/.agents/skills` from `event.systemPromptOptions.skills`, the list Pi appends, so the model is told only about the agent's skills, its packages' skills and agentx's ([D18](#d18)).

## Known limits

- Skills in `~/.agents/skills` are hidden from the model, not unloaded: Pi still lists them at startup, and a user can run one by typing `/skill:<name>` ([D18](#d18)).
- The package loads only through `agentx run` and the runner. Pi started any other way in an agent directory does not get it, and so takes nothing from the queue.

## Decisions

<a id="d11"></a>
### D11. agentx's Pi package ships in the agentx package

- **Problem.** What agentx adds to every agent (the harness prompt, its extensions, shared skills) must stay apart from what the agent's author writes, must not be overridable from the agent's files, and should upgrade with agentx.
- **Decision.** `src/agent-runtime/pi-package/` in the agentx npm package, which Pi loads in place. The agent directory holds only the author's files.
- **Why.** One copy, versioned and pinned with agentx like Pi itself ([D1](../agent/README.md#d1)).
- **Rejected.** Pi's `systemPromptOptions.sections` for the harness prompt: rendered after the skills list and the working directory, not first.

<a id="d16"></a>
### D16. Whoever starts Pi passes agentx's part of the config; the agent's settings are the author's alone

- **Problem.** Pi has to be told about agentx's Pi package and where the agent's sessions go, and the agent's `.pi/settings.json` belongs to its author.
- **Decision.** `agentx run` and the runner add `-e <agentx>/src/agent-runtime/pi-package` and `--session-dir <agent>/storage/sessions` when they start a session, so neither is in the agent's `.pi/settings.json`.
- **Why.** One owner per file: agentx's part lives in agentx and upgrades with it, and the author's file is never edited or migrated. Pi reports a missing `-e` path as an error.
- **Consequence.** The package is not visible in the agent's config, and Pi marks its resources as temporary scope.

<a id="d18"></a>
### D18. The system prompt extension hides `~/.agents/skills` from the model

- **Problem.** Pi loads `~/.agents/skills` for every project, so an agent's prompt would list skills from the home of whoever runs it. They are not part of the agent and differ per machine.
- **Decision.** In `before_agent_start`, the extension drops skills whose file is under `~/.agents/skills` from `systemPromptOptions.skills`.
- **Why.** No generated file and no flag: it applies wherever the Pi package is loaded. Matching the path keeps skills from the shared `agent-x/.pi` and from packages, which Pi also marks as user scope.
- **Rejected.** `--no-skills`: also drops the skills of the agent's settings and packages. An exclusion in Pi's user-level settings: a generated file ([D4](../agent/README.md#d4)). Setting `HOME` for Pi: breaks git, ssh and everything else the agent runs.
- **Consequence.** The skills stay loaded in Pi: its startup listing shows them, and `/skill:<name>` typed by a user still works.
