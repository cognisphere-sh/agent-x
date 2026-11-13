# Todos

Work that is planned or being thought about, one Markdown file per item in this folder. A todo holds the plan, not the design: when it is built, its design goes to the module's doc and the todo file is deleted.

| Todo | Type | Priority | Status |
|---|---|---|---|
| [Queue the messages typed into a terminal session](queue-terminal-input.md) | feature | none | idea |
| [Finish each agent's access to external services through Composio](composio-access.md) | feature | none | in-progress |
| [Connect agents to people through message channels](message-channels.md) | feature | none | idea |

## A todo file

The file name is the todo's `name` plus `.md`. It starts with YAML frontmatter, then the plan in prose.

```yaml
---
name: queue-terminal-input        # kebab-case, the same as the file name
title: Queue the messages typed into a terminal session
description: One sentence: what changes and why.
type: feature                     # feature | bug | chore | docs | research
priority: none                    # none | low | medium | high
status: idea                      # idea | planned | in-progress | blocked
modules: [agent-runtime/pi-package/message-queue]   # folders under docs/architecture/ it touches
created: 2026-11-12
updated: 2026-11-12
---
```

| Field | Meaning |
|---|---|
| `type` | `feature`: new behavior. `bug`: behavior that is wrong. `chore`: code or tooling with no change in behavior. `docs`: documentation only. `research`: a question to answer before anything is built. |
| `priority` | `none` until someone decides when it should happen. |
| `status` | `idea`: worth doing, not planned in detail. `planned`: the plan is settled. `in-progress`: being built. `blocked`: waiting on something the file names. |
| `modules` | Where the design will be documented once it is built. |

A todo that is done or dropped is deleted, together with its row above.
