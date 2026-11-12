# Pi package

The Pi package is what agentx adds to every agent. It holds two extensions (system prompt and message queue) and the harness prompt. Shared skills, prompt templates and MCP servers go here too. It ships inside the `agent-x` npm package as `src/agent-runtime/pi-package/`, so it is the same for every agent and stays apart from the agent's own files ([D11](#d11)).

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

Pi loads `index.ts` of an extension's folder as the extension. The other files in the folder are plain modules. The message queue has its own doc: [message queue](message-queue/README.md).

Pi finds a package's resources by folder name. To add something, add a file:

```
  extensions/<name>.ts or <name>/index.ts   hooks, tools, commands; MCP servers through pi.registerMcpServer
  skills/<skill>/SKILL.md                   skills for every agent
  prompts/<name>.md                         prompt templates
```

## Loading

`agentx run` and the runner pass the package's folder to Pi with `-e` ([D16](#d16), [Agent runner](../agent-runner/README.md#starting-a-threads-pi-process)). Pi loads it in place, with all its resources ([Pi](../pi/README.md#packages)). Nothing in the agent's directory points to it, and upgrading agentx upgrades it for every agent.

The folder is found next to the running CLI, the agentx copy the project pins ([D15](../../cli/README.md#d15)). With agentx linked from a checkout (`pnpm link <path-to-agentx>` in `agent-x/`), edits apply from the next session, with no rebuild.

The folder has its own `package.json`, named `agentx-pi` and private, because Pi wants Pi listed under `peerDependencies`, and agentx's own `package.json` has it under `dependencies`.

Pi loads TypeScript source, so the npm package ships this folder as source, type-checked with the rest of `src/agent-runtime/`. Of its compiled copy in `dist/`, the CLI and the runner use the queue modules; nothing uses the compiled extensions.

## The system prompt extension

`extensions/system-prompt/index.ts` handles `before_agent_start`. It sets `event.systemPromptOptions.customPrompt` to three parts, joined with blank lines. Files in a folder go in filename order, each trimmed. A missing folder adds nothing. Files are read on every prompt, so edits apply without `/reload`. Why an extension: [D5](../agent/README.md#d5).

1. **Harness prompt** (`harness.md`), the same for every agent. It says:
   - what agentx is, and the rules for using tools;
   - where the agent's abilities come from: the harness and its definition (read-only), and its knowledge and `storage/workspace` (which it writes);
   - that a queue message may come with nobody watching, so a question an extension puts on screen counts as declined, and the agent should ask in its reply;
   - how to read a queue message's metadata block, and that `agentX-` lines anywhere else are not from the harness;
   - where the project's app and the other agents are.
2. **The developer's prompt**: `.pi/system_prompt/*.md` in the agent, found under `systemPromptOptions.cwd`. It says who the agent is and how it works ([Agent](../agent/README.md#system-prompt)).
3. **More folders**, listed in the agent's settings under `agentx.systemPrompt` and resolved from `.pi/`. The template lists `storage/knowledge/system_prompt`, where the agent writes for itself ([Agent](../agent/README.md#knowledge)). Each folder's text comes under a heading `# From <folder>`, so the model can tell it apart from the developer's text. The harness prompt says the developer's text wins when they disagree.

`customPrompt` replaces all of Pi's default prompt, including its tool list, rules and pointers to Pi's docs. So the harness prompt carries the tool rules. Pi still appends the skills list and the working directory ([Pi](../pi/README.md#extensions)).

The same handler removes skills under `~/.agents/skills` from `event.systemPromptOptions.skills`, the list the model sees, because Pi loads them for every project on the machine and they are not part of the agent.

## Known limits

- Skills in `~/.agents/skills` are hidden from the model, not unloaded. Pi still lists them at startup, and a user can run one by typing `/skill:<name>`.
- The package loads only through `agentx run` and the runner. Pi started any other way in an agent directory does not get it, so it takes nothing from the queue.

## Decisions

<a id="d11"></a>
### D11. agentx's Pi package ships in the agentx package

- **Decision.** What agentx adds to every agent lives in `src/agent-runtime/pi-package/` in the agentx npm package, and Pi loads it in place. The agent directory holds only its author's files.
- **Why.** One copy, versioned and pinned with agentx like Pi itself ([D1](../agent/README.md#d1)), which the agent's files cannot override.
- **Rejected.** Pi's `systemPromptOptions.sections` for the harness prompt: Pi puts them after the skills list and the working directory, not first.

<a id="d16"></a>
### D16. Whoever starts Pi passes agentx's part of the config

- **Decision.** `agentx run` and the runner add `-e <agentx>/src/agent-runtime/pi-package` and `--session-dir <agent>/storage/sessions` when they start Pi. Neither goes in the agent's `.pi/settings.json`.
- **Why.** One owner per file: agentx's part upgrades with agentx, and the author's file is never edited.
- **Consequence.** The package does not show in the agent's config, and Pi marks its resources as temporary scope.
