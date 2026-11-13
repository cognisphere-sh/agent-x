# Tasks

Work on agentx, one Markdown file per task. A task holds the plan, not the design: the design goes to the module's doc as it is built.

- `backlog/`: tasks not done yet.
- `done/`: finished tasks, kept as a record of what was planned and why. The design they produced lives in the module docs; a done task does not change after it is moved.

A task that is dropped is deleted, together with its row below.

## Backlog

| Task | Type | Priority | Status |
|---|---|---|---|
| [Queue the messages typed into a terminal session](backlog/queue-terminal-input.md) | feature | none | idea |
| [Connect agents to people through message channels](backlog/message-channels.md) | feature | none | idea |
| [Start an agent's runner with `agentx work`](backlog/agent-runner-command.md) | feature | none | planned |
| [Run every agent of a project with `agentx serve`](backlog/coordinator.md) | feature | none | planned |
| [Put Composio trigger events on agents' queues](backlog/coordinator-webhooks.md) | feature | none | planned |
| [Set up each agent's Composio triggers from its settings](backlog/composio-triggers.md) | feature | none | idea |

## Done

| Task | Type | Done |
|---|---|---|
| [Give each agent its own access to external services through Composio](done/composio-access.md) | feature | 2026-11-13 |

## A task file

The file name is the task's `name` plus `.md`. It starts with YAML frontmatter, then the plan in prose.

```yaml
---
name: queue-terminal-input        # kebab-case, the same as the file name
title: Queue the messages typed into a terminal session
description: One sentence: what changes and why.
type: feature                     # feature | bug | chore | docs | research
priority: none                    # none | low | medium | high
status: idea                      # idea | planned | in-progress | blocked | done
modules: [agent-runtime/pi-package/message-queue]   # folders under docs/architecture/ it touches
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

When a task is done, set `status: done` and `updated`, move its file to `done/`, and move its row to the Done table.
