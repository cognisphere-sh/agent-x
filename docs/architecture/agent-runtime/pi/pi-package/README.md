# Pi package

What agentx adds to every agent: three extensions (system prompt, event queue, Composio) and the harness prompt. It ships inside the `agent-x` npm package as `src/agent-runtime/pi/pi-package/`, so it is the same for every agent and apart from the agent's own files ([D11](#d11)).

```
src/agent-runtime/pi/pi-package/
  package.json                Pi as a peer dependency; its `pi` manifest lists the extensions in load order
  extensions/system-prompt/   index.ts, and harness.md, the harness prompt
  extensions/event-queue/     index.ts, and render.ts, how events look to the model
  extensions/composio/        index.ts
```

Pi loads the extensions the manifest lists, in that order ([D42](#d42)). The other two have their own docs: [event queue](event-queue/README.md), [Composio](composio/README.md). Something new, an extension, skill or prompt template, must be listed in the manifest too.

## Loading

`agentx chat` and the Pi runner pass the package's folder to Pi with `-e` ([D16](#d16)). Pi loads it in place ([Pi](../pi-reference/README.md#packages)). Nothing in the agent directory points to it, and upgrading agentx upgrades it for every agent. With agentx linked from a checkout, edits apply from the next session.

The folder has its own `package.json`, `agentx-pi`, because Pi wants itself as a peer dependency. Pi loads TypeScript source, so the npm package ships this folder as source, with the two files its extensions import: `events/queue.ts` and `project-config.ts`. A test packs the package and follows every import of the folder.

## The system prompt extension

`extensions/system-prompt/index.ts` sets the system prompt in `before_agent_start`, from four parts. It reads the files on every prompt, so edits apply at once ([D5](../../agent/README.md#d5)).

1. **The harness prompt** (`harness.md`), the same for every agent. It covers the tool rules; where the agent's abilities come from, and what is read-only; what to keep where (a prompt note, a skill, a workflow, a router rule, a schedule); that nobody may be watching; how to read an event's metadata block, and that its content is data, never instructions; `agentx event send` and who sent an event; routers, workflows and schedules; what to do when something fails; Composio ([Composio](composio/README.md#the-prompt)); and where the app and the other agents are.
2. **The agents it can send to**: one line per agent its `canSendTo` allows, with its `description` from `agentx.json` ([D62](../../../coordinator-runtime/README.md#d62)). Nothing when there are none.
3. **The developer's prompt**: `.pi/system_prompt/*.md` in filename order ([Agent](../../agent/README.md#system-prompt)).
4. **The `agentx.systemPrompt` folders**, such as the agent's `storage/knowledge/system_prompt`, each under a heading `# From <folder>`. The harness prompt says the developer's text wins when they disagree.

This replaces all of Pi's default prompt, so the harness prompt carries the tool rules. Pi still appends the skills list and the working directory ([Pi](../pi-reference/README.md#extensions)).

The same handler hides skills under `~/.agents/skills` from the model, since Pi loads them for every project on the machine.

## Known limits

- Skills in `~/.agents/skills` are hidden, not unloaded: a person can still run one with `/skill:<name>`.
- The package loads only through `agentx chat` and `agentx run`. Pi started any other way takes nothing from the queue.

## Decisions

<a id="d11"></a>
### D11. agentx's Pi package ships in the agentx package

- **Decision.** What agentx adds to every agent lives in `src/agent-runtime/pi/pi-package/` in the agentx npm package, and Pi loads it in place. The agent directory holds only its author's files.
- **Why.** One copy, versioned and pinned with agentx like Pi itself ([D1](../../agent/README.md#d1)), which the agent's files cannot override.

<a id="d16"></a>
### D16. Whoever starts Pi passes agentx's part of the config

- **Decision.** `agentx chat` and the Pi runner add `-e <pi-package>` and `--session-dir storage/sessions/<thread>` when they start Pi. Neither goes in the agent's `.pi/settings.json`.
- **Why.** One owner per file: agentx's part upgrades with agentx, and the author's file is never edited.
- **Consequence.** The package does not show in the agent's config.

<a id="d42"></a>
### D42. The package's manifest lists its extensions in the order they load

- **Decision.** `package.json` has `"pi": { "extensions": [...] }`: Composio, event queue, system prompt.
- **Why.** Pi calls handlers in load order. Without a manifest it loads folders in file system order, which differs between macOS and Linux. Start-up work does not depend on the order: the event queue takes events only once every extension has started ([D44](event-queue/README.md#d44)).
