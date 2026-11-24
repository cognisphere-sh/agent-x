# Tasks

Work on agentx, one Markdown file per task. A task holds the plan, not the design: the design goes to the module's doc as it is built.

- `backlog/`: tasks not done yet.
- `done/`: finished tasks, kept as a record of what stands. The design they produced lives in the module docs. A done task does not change after it is written up, except at a release, when done tasks are cut down, or merged, to what stands.

A task that is dropped is deleted, together with its row below.

## Backlog

| Task | Type | Priority | Status |
|---|---|---|---|
| [Make each agent's Composio triggers](backlog/composio-service.md) | feature | none | idea |
| [Let the web app control agents and talk to them through the coordinator's API](backlog/web-app-api.md) | feature | none | idea |
| [Give each agent memory and sub-agents, built in five steps](backlog/memory.md) | feature | none | in-progress |
| [Run a project on a laptop with agentx dev, and on a server with agentx server](backlog/deploy.md) | feature | none | in-progress |

## Done

| Task | Type | Done |
|---|---|---|
| [Give each agent its own access to external services through Composio](done/1-composio-access.md) | feature | 2026-11-13 |
| [Run an agent with `agentx run`, its event router and its workflows](done/2-agentx-run.md) | feature | 2026-11-14 |
| [Coordinator, events, storage, router and workflows](done/3-coordinator-events-storage-router-workflows.md) | feature | 2026-11-15 |
| [Build the coordinator out of services, core and optional](done/4-coordinator-services.md) | feature | 2026-11-15 |
| [Bring Composio's trigger events to agents through a core coordinator service](done/5-composio-webhook.md) | feature | 2026-11-15 |
| [Connect agents to Telegram through an optional coordinator service](done/6-telegram.md) | feature | 2026-11-15 |
| [Let a project's developer write coordinator services in agent-x/services/](done/7-developer-services.md) | feature | 2026-11-16 |
| [Connect each agent's Telegram bot in Composio from the Telegram service](done/8-telegram-composio-bot.md) | feature | 2026-11-16 |
| [Give every agent a browser that stays signed in](done/9-agent-browser.md) | feature | 2026-11-16 |
| [Keep the model for what needs judgement, and let workflows run Composio tools](done/10-workflow-composio.md) | feature | 2026-11-16 |
| [Ask with Telegram buttons, and let the person choose among services that can do a task](done/11-telegram-buttons-service-choice.md) | feature | 2026-11-18 |
| [Spend fewer tokens on Composio's searches, and keep episodes out of fold summaries](done/12-composio-search-tokens.md) | feature | 2026-11-22 |
| [Upgrade a project and its agents, and give the project and each agent one secrets file](done/13-upgrade-and-env-files.md) | feature | 2026-11-22 |
| [Let each agent make webhooks that run its workflows, and teach routers, workflows, schedules and webhooks as skills](done/14-webhooks-and-skills.md) | feature | 2026-11-22 |
| [Keep each agent's knowledge in its checked-in .pi/knowledge/, one source that the agent and its developer both write](done/15-knowledge-in-pi.md) | feature | 2026-11-23 |

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
