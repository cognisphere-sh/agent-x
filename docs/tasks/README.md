# Tasks

Work on agentx, one Markdown file per task. A task holds the plan, not the design: the design goes to the module's doc as it is built.

- `backlog/`: tasks not done yet.
- `done/`: finished tasks, kept as a record of what stands. The design they produced lives in the module docs. A done task does not change after it is written up, except at a release, when done tasks are cut down, or merged, to what stands.

A task that is dropped is deleted, together with its row below.

## Backlog

| Task | Type | Priority | Status |
|---|---|---|---|
| [Connect agents to people through message channels](backlog/message-channels.md) | feature | none | idea |
| [Bring webhook events to agents through installable services](backlog/coordinator-webhooks.md) | feature | none | idea |
| [Make each agent's Composio triggers](backlog/composio-triggers.md) | feature | none | idea |

## Done

| Task | Type | Done |
|---|---|---|
| [Give each agent its own access to external services through Composio](done/1-composio-access.md) | feature | 2026-11-13 |
| [Run an agent with `agentx run`, its event router and its workflows](done/2-agentx-run.md) | feature | 2026-11-14 |
| [Coordinator, events, storage, router and workflows](done/3-coordinator-events-storage-router-workflows.md) | feature | 2026-11-15 |

## A task file

The file name is the task's `name` plus `.md`. In `done/` it starts with the task's number in the order tasks were finished, `<n>-<name>.md`, such as `1-composio-access.md`. It starts with YAML frontmatter, then the plan in prose.

```yaml
---
name: message-channels            # kebab-case, the same as the file name
title: Connect agents to people through message channels
description: One sentence: what changes and why.
type: feature                     # feature | bug | chore | docs | research
priority: none                    # none | low | medium | high
status: idea                      # idea | planned | in-progress | blocked | done
modules: [agent-runtime/events]   # folders under docs/architecture/ it touches
created: 2026-11-12
updated: 2026-11-12
---
```

| Field | Meaning |
|---|---|
| `type` | `feature`: new behavior. `bug`: behavior that is wrong. `chore`: code or tooling with no change in behavior. `docs`: documentation only. `research`: a question to answer before anything is built. |
| `priority` | `none` until someone decides when it should happen. |
| `status` | `idea`: worth doing, not planned in detail. `planned`: the plan is settled. `in-progress`: being built. `blocked`: waiting on something the file names. `done`: built; the file is in `done/`. |
| `modules` | Where the design is documented once it is built. |

When a task is done, move its file to `done/` under the next free number, set `status: done` and `updated`, and move its row to the Done table. Then write it up, in this order, keeping the plan below the notes:

1. **What was built**: the parts, and the commits.
2. **Decisions**: the decisions it made, linked to the module docs.
3. **Changes from the plan**: what the plan said, what was built instead, and why.
4. **Migration**: what an existing project or agent must change to take it up, what behaves differently afterwards, and what to check for.
5. **Verification**: the tests, and what was checked by hand.
6. **Follow-ups**: what is left, linked to its backlog task or to the design.
7. **Original plan**: the plan as approved before building, unchanged except for its links, its headings one level down.
