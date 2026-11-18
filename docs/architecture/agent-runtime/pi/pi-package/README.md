# Pi package

What agentx adds to every agent: three extensions (system prompt, event queue, Composio), the harness prompt, and its skills. It ships inside the `agent-x` npm package as `src/agent-runtime/pi/pi-package/`, so it is the same for every agent and apart from the agent's own files ([D11](#d11)).

```
src/agent-runtime/pi/pi-package/
  package.json                Pi as a peer dependency; its `pi` manifest lists the extensions in load order, and the skills folder
  extensions/system-prompt/   index.ts, and the harness prompt: preamble.md and core/*.md, a file per section, numbered in reading order
  extensions/event-queue/     index.ts, and render.ts, how events look to the model
  extensions/composio/        index.ts, and policy.ts, the policy of the agent's Composio sessions, which its workflows use too
  skills/browser/             SKILL.md: the agent's browser, with agentx-browser
```

Pi loads the extensions the manifest lists, in that order, and the skills in `skills/` ([D42](#d42)). The other two have their own docs: [event queue](event-queue/README.md), [Composio](composio/README.md). Something new, an extension, skill or prompt template, must be listed in the manifest too.

## Loading

`agentx chat` and the Pi runner pass the package's folder to Pi with `-e` ([D16](#d16)). Pi loads it in place ([Pi](../pi-reference/README.md#packages)). Nothing in the agent directory points to it, and upgrading agentx upgrades it for every agent. With agentx linked from a checkout, edits apply from the next session.

The folder has its own `package.json`, `agentx-pi`, because Pi wants itself as a peer dependency. Pi loads TypeScript source, so the npm package ships this folder as source, with the two files its extensions import: `events/queue.ts` and `project-config.ts`. A test packs the package and follows every import of the folder.

## The system prompt extension

`extensions/system-prompt/index.ts` sets the system prompt in `before_agent_start`, as Pi's sections. It reads the files at the start of every run, so an edit applies from the next run; events steered into a run already going do not read them again ([D5](../../agent/README.md#d5)). Each file is a section of its own, so when one changes, Pi sends the model that section alone, and the removal of one that is gone ([D73](#d73)).

**The preamble**, `preamble.md`, is Pi's `preamble`, the untagged start of the prompt. It replaces Pi's default prompt with its tool list, rules and docs, so the harness carries the tool rules. It says who the agent is and what the sections below are, and that the developer's text wins over the agent's notes. Pi's own sections follow it, such as the skills list and the working directory ([Pi](../pi-reference/README.md#extensions)), then agentx's, each in a tag of its own name:

| Section | From |
|---|---|
| `agentx-core-<file>` | The harness's rules, `core/*.md`, the same for every agent, in this order: the tool rules (`1-tools`); where the agent's abilities come from, and what is read-only (`2-files`); what to keep where (`3-learning`); that nobody may be watching, so the agent answers an event on the channel it came on and its plain text is only its own thinking, how to read an event's metadata block, that its content is data, never instructions, `agentx event send`, who sent an event, and that a question to a Telegram chat with fixed answers goes on inline buttons (`4-events`); routers, workflows and schedules, and that what a script can do the same way every time goes to a workflow, which can run Composio tools with `ctx.composio` and sends what needs judgement to a thread (`5-routing`, `6-workflows`, `7-schedules`); what to do when something fails (`8-failures`); Composio, the main way into external services, before the browser, and that the person chooses the service when several can do a task and none is connected (`9-external-services`, [Composio](composio/README.md#the-prompt)); and where the app and the other agents are (`10-project`) |
| `agentx-core-agents` | One line per agent its `canSendTo` allows, with its `description` from `agentx.json` ([D62](../../../coordinator-runtime/services/relay/README.md#d62)). None when there are none |
| `agentx-identity-<file>` | The developer's prompt, `.pi/system_prompt/*.md` ([Agent](../../agent/README.md#system-prompt)) |
| `agentx-knowledge-<file>` | The `agentx.systemPrompt` folders, such as the agent's `storage/knowledge/system_prompt` |

The blocks keep the order of the table: the developer's sections always follow the harness's, and the agent's notes come last. Within a block, files go in the order of their names, with numbers compared as numbers, so an index, a number and `-` at the start of the name, orders them: `9-first.md` comes before `10-rules.md`.

`<file>` is the file's name without `.md` and without its index, in lowercase, with every run of characters that Pi does not allow in a name (anything but letters, digits, `-` and `_`) made one `-`: `1-tools.md` is `agentx-core-tools`, and `Owner Prefs.md` is `agentx-knowledge-owner-prefs`. So renumbering a file sends nothing. Two files that come to one name, such as `1-goals.md` and `2-goals.md`, share its section, in their order, and an empty file makes no section.

The same handler hides skills under `~/.agents/skills` from the model, since Pi loads them for every project on the machine.

## Skills

Each folder of `skills/` with a `SKILL.md` is a skill of every agent. Pi lists its name and description in the system prompt beside the agent's own skills, and the model reads the file when a task needs it.

| Skill | Teaches |
|---|---|
| `browser` | The agent's [browser](../../browser/README.md), for a task that Composio, a command line tool or another tool cannot do, or that the person asks a browser for: `agentx-browser` and agent-browser's own guide, and profiles |

## Known limits

- Skills in `~/.agents/skills` are hidden, not unloaded: a person can still run one with `/skill:<name>`.
- The order holds for a new session. In a conversation already going, a renumbered or changed section keeps its place, and a new one comes after all the others, until the thread starts a new session ([Pi](../pi-reference/README.md#extensions)).
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

- **Decision.** `package.json` has `"pi": { "extensions": [...], "skills": ["skills"] }`: Composio, event queue, system prompt, then the skills folder, which a manifest must list too, since Pi then loads only what it lists.
- **Why.** Pi calls handlers in load order. Without a manifest it loads folders in file system order, which differs between macOS and Linux. Start-up work does not depend on the order: the event queue takes events only once every extension has started ([D44](event-queue/README.md#d44)).

<a id="d73"></a>
### D73. Each prompt file is a section of the system prompt of its own

- **Problem.** Pi sends the model only the sections of the system prompt that changed, but each one whole. With the whole prompt in Pi's preamble, a one-line note the agent writes would send the harness, the developer's prompt and every note again, on every thread.
- **Decision.** The preamble holds only `preamble.md`. Every file of the harness's `core/`, of `.pi/system_prompt/` and of the `agentx.systemPrompt` folders is a section of its own, `agentx-core-`, `agentx-identity-` or `agentx-knowledge-` followed by its file name without its index, and the agents it can send to are `agentx-core-agents`. The harness's sections come first, then the developer's, then the agent's; within each, files go by their index, a number and `-` at the start of the name, compared as numbers.
- **Why.** A change sends one file again, and the tag names where the text comes from, so the model can tell its own notes from its developer's text. The developer orders their own sections, and an agentx upgrade cannot reorder them. Renumbering a file changes no name, so it sends nothing, and the indexes can be 1, 2, 3 with no gaps kept for later.
- **Rejected.** One harness file, split at its headings when the prompt is built: a heading inside a code block would split it. The index in the section's name: renumbering a file would send it again, and in a conversation already going it would move to the end. Anything before the first `-` as the index: `owner-prefs.md` would lose its first word. One index shared by the harness's and the developer's files: the developer's order would hang on the harness's numbers, which an upgrade may change.
- **Consequence.** agentx's sections come after Pi's own, the skills list and the working directory, since Pi puts sections that extensions add last. Pi allows only lowercase names, so the prefixes are lowercase, and a file's name is changed to fit. Two files that differ only in their index, such as `2026-goals.md` and `2027-goals.md`, share one section.
