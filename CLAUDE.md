# CLAUDE.md

## Project

agentx is a meta harness around the [pi coding agent](https://github.com/earendil-works/pi). The `agentx` CLI creates projects that hold a Next.js full-stack app and Pi agents, and runs each agent with only its own config. The project is built incrementally; [docs/](docs/README.md) records each component and every decision.

### Design goals

1. **Minimal, readable code.** A reader understands any file without jumping around. Prefer less code over more features. Every line traces to a requirement.
2. **The agent directory is the source of truth.** Everything that defines an agent (system prompt, skills, extensions, MCP servers, settings) lives in its directory and is checked in. Nothing is generated or changed there when the agent starts.
3. **Use Pi as it is.** Configure Pi through its own mechanisms (`.pi/settings.json`, extensions, env vars, CLI flags). No forks, no patches, no copies of Pi config.
4. **The same agent under the CLI and the SDK.** What the agent directory defines applies to `agentx run` (Pi CLI) and to the future runtime (Pi SDK). Small differences, such as global skills, are accepted rather than engineered away.
5. **One pinned Pi.** Agents run the Pi version that agentx depends on, never a global `pi`.

### Mental model

```
agentx (this repo, an npm package)
  CLI        init-project, init-agent, run (later: upgrade, serve)
  templates  copied by the CLI into a user's project
  runtime    always-running side, started by `agentx serve` (not built)

my-project/ (created by init-project)
  app/                  Next.js app
  harness/<agent>/      one Pi agent = one directory
    .pi/                Pi project config (settings.json, mcp.json)
    system_prompt/*.md  replaces Pi's default system prompt
    skills/ extensions/
    storage/            gitignored runtime state: pi/ (Pi agent dir), sessions/, workspace/
```

- An agent is a directory. Running it means starting Pi with that directory as `cwd` and `storage/pi` as Pi's agent directory (`PI_CODING_AGENT_DIR`).
- Pi reads config from only two places: its agent directory and `<cwd>/.pi/`. agentx uses `<cwd>/.pi/` for config and `storage/pi` for state.
- The runtime will be: one coordinator process that owns a message queue; `AgentManager` manages agent sandboxes; `AgentRunner` takes queued messages and invokes the Pi SDK.

What is built and what is planned: [docs/high_level_design.md](docs/high_level_design.md#status).

### Documentation

Docs are part of every change. A change is not done until the docs match the code, and nothing in them is stale or said twice.

| What | Where |
|---|---|
| Goals and mental models, briefly | this file |
| Overall design, components, flows, status | `docs/high_level_design.md` |
| A component's behavior, then its "Decisions" section | `docs/architecture/<component>/README.md`, with its images and diagrams in the same folder |
| A sub-module | a section in its component's README, or `docs/architecture/<component>/<sub-module>/README.md` when it is large enough to stand alone |
| How to use something | `docs/user_guides/` |
| Index of all of the above and of all decisions | `docs/README.md` |

After creating a module or sub-module:

1. Add its doc as above.
2. Add it to the tables in `docs/README.md` and, for a component, to the components table and diagram in `docs/high_level_design.md`.
3. Update the status table in `docs/high_level_design.md`, this file's mental model if it changed, and the repository layout in `README.md`.

After any other change: update the docs it affects and delete what it made obsolete. Do not leave history ("previously", "was removed") in component docs; decisions carry the history.

Decisions: one entry per choice between alternatives, in the "Decisions" section of the affected component's README, as `<a id="dN"></a>` + `### DN. Title` + bullets **Problem**, **Decision**, **Why**, and **Rejected** or **Consequence** where they apply. Numbers are global; take the next free number from `docs/README.md` and add the entry to its table. Never rewrite a decision; mark it superseded and link the new one.

### Working on this repo

- Read [docs/high_level_design.md](docs/high_level_design.md) first, then the doc of the component you change.
- Check Pi's behavior in its source or docs (`node_modules/@earendil-works/pi-coding-agent`) before relying on it, and record what we rely on in [docs/architecture/pi/](docs/architecture/pi/README.md).
- Code: TypeScript, ESM, Node >= 22, tabs. One concept per file, a first-line comment saying what the file is for, a one-line doc comment on every export. Comments explain why, not what. No `any`, no inline imports. Exact dependency versions.
- After code changes: `npm run check`. `npm run build` writes `dist/`, which the CLI runs from.
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
