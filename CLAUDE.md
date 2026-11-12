# CLAUDE.md

## Project

agentx is a meta harness around the [pi coding agent](https://github.com/earendil-works/pi). The `agentx` CLI creates projects that hold a Next.js full-stack app and Pi agents, runs each agent with only its own config, and gives each agent a message queue. The project is built incrementally; [docs/](docs/README.md) records each component and every decision.

### Design goals

1. **Minimal, readable code.** A reader understands any file without jumping around. Prefer less code over more features. Every line traces to a requirement.
2. **The agent directory is the source of truth.** What a developer gives an agent (system prompt, skills, extensions, MCP servers, settings) lives in its `.pi/` and is checked in. agentx's Pi package comes from the agentx version the project pins, and what the agent learns while it runs is state in its `storage/knowledge/`. Nothing checked in is generated or changed when the agent starts.
3. **Use Pi as it is.** Configure Pi through its own mechanisms (`.pi/settings.json`, extensions, env vars, CLI flags). No forks, no patches, no copies of Pi config.
4. **The same agent under `agentx run` and under the runner.** Both start the same Pi CLI with the same settings (`src/agent-runtime/pi-launch.ts`), so what the agent directory defines applies to a person at a terminal and to the queue alike.
5. **One pinned Pi.** Agents run the Pi version that agentx depends on, never a global `pi`.

### Mental model

```
agentx (this repo, npm package `agent-x`, command `agentx`)
  CLI        init-project, init-agent, run, send (later: serve, upgrade)
  templates  copied by the CLI into a user's project
  pi-package `src/agent-runtime/pi-package`, loaded by Pi into every agent: system prompt extension and harness prompt, message queue extension, Composio extension (each thread's Composio session, for the agent's Composio user id); shared skills are planned
  queue      an agent's message queue (SQLite); its code is in the message queue extension's folder and is used by the CLI and the runner too
  runtime    always-running side. `src/agent-runtime`: everything that runs one agent, with the AgentRunner (built, but no command starts it yet), how Pi is started, and the pi-package. `src/coordinator-runtime` (coordinator) and the AgentManager are not built

my-project/ (created by init-project)
  web/                  Next.js app; its own package
  agent-x/              its own package, installed and deployed apart from web/; pins agentx
  agent-x/agents/<agent>/  one Pi agent = one directory
    .pi/                the agent's definition, its developer's alone and read-only to the agent; `agentx run` adds agentx's Pi package
      settings.json mcp.json   Pi project config; agentx's own settings for the agent are under `agentx` in settings.json
      system_prompt/*.md  the agent's prompt; follows the harness prompt and replaces Pi's default
      skills/ extensions/ the agent's own, apart from the Pi package's; Pi loads them from here by default
    storage/            gitignored runtime state: sessions/ (one per thread), workspace/, message_queue.db,
                        knowledge/ (what the agent learns: its own skills, extensions and prompt text, loaded through the agent's settings)
  agent-x/.pi/          Pi's agent directory for all agents: login, Pi's state; gitignored
  agent-x/.env          keys for all agents (COMPOSIO_API_KEY); gitignored; the environment wins
```

- An agent is a directory. Running it means starting Pi with that directory as `cwd` and the project's `agent-x/.pi` as Pi's agent directory (`PI_CODING_AGENT_DIR`).
- Pi reads config from only two places: its agent directory and `<cwd>/.pi/`. agentx uses `<cwd>/.pi/` for config and `agent-x/.pi` for Pi's state.
- A thread is a Pi session: a queue message names its thread, and the thread id is the session id. `agentx run` opens `main` unless given `--thread-id`, which it passes to Pi as `--session-id`. One process at a time holds a thread.
- Messages reach a session through the message queue extension in it, which claims the thread's messages, starts a run or steers them into one, and settles them. So a session kept open with `agentx run --thread-id <id>` works its thread's queue. The `AgentRunner` does that without a person: it starts a Pi process in RPC mode for each thread that has messages, oldest message first, a limited number at a time. Such a session ends itself when its thread is empty, and the runner touches a message only when the process ends with a failure.
- Planned: a coordinator process that runs every agent's runner, and an `AgentManager` for agent sandboxes.

What is built and what is planned: [docs/high_level_design.md](docs/high_level_design.md#status).

### Documentation

Docs are part of every change. A change is not done until the docs match the code, and nothing in them is stale or said twice.

| What | Where |
|---|---|
| Goals and mental models, briefly | this file |
| Overall design, components, flows, status | `docs/high_level_design.md` |
| A module's behavior, then its "Decisions" section | `docs/architecture/`, in the same hierarchy as `src/`: `cli/`, `agent-runtime/` and `coordinator-runtime/`, each with a `README.md`, and inside each a folder with a `README.md` for every independent module. Images and diagrams go in the module's folder |
| A small part of a module | a section in the module's README |
| How to use something | `docs/user_guides/` |
| Planned work not yet built: one file per item, YAML frontmatter, format in its README | `docs/todos/` |
| Index of all of the above and of all decisions | `docs/README.md` |

After creating a module or sub-module:

1. Add its doc as above.
2. Add it to the tables in `docs/README.md`, and to the components table and diagram in `docs/high_level_design.md`.
3. Update the status table in `docs/high_level_design.md`, this file's mental model if it changed, and the repository layout in `README.md`.

After any other change: update the docs it affects and delete what it made obsolete. The docs describe the design as it is. Do not leave history ("previously", "was removed", "superseded") anywhere in them, decisions included; git keeps how the design got there.

Decisions: one short entry per choice of the current design, in the "Decisions" section of the affected module's README, as `<a id="dN"></a>` + `### DN. Title` + bullets **Problem**, **Decision**, **Why**, and **Rejected** or **Consequence** where they apply. **Rejected** lists only alternatives that were never the design. Numbers are global; take the next free number from `docs/README.md` and add the entry to its table. When a choice changes, rewrite its entry, or delete the entry and its row; a deleted number is not used again.

### Working on this repo

- Read [docs/high_level_design.md](docs/high_level_design.md) first, then the doc of the module you change.
- Check Pi's behavior in its source or docs (`node_modules/@earendil-works/pi-coding-agent`) before relying on it, and record what we rely on in [docs/architecture/agent-runtime/pi/](docs/architecture/agent-runtime/pi/README.md).
- Code: TypeScript, ESM, Node >= 22.19, tabs. One concept per file, a first-line comment saying what the file is for, a one-line doc comment on every export. Comments explain why, not what. No `any`, no inline imports. Exact dependency versions.
- After code changes: `pnpm run check`, and `pnpm test` when the queue, the runner, `run` or the Pi package changed. `pnpm run build` writes `dist/`, which the CLI runs from.
- Instructions, the CLI's hints and the docs use pnpm, and name the command itself (`agentx run`), not a package script.
- Never commit unless asked.

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
