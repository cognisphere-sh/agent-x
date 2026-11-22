---
name: composio-search-tokens
title: Spend fewer tokens on Composio's searches, and keep episodes out of fold summaries
description: The Composio extension trims each search's answer before the model reads it, the prompt lets the agent run a tool it knows without a search, and a fold's summary no longer names episodes.
type: feature
priority: none
status: done
modules: [agent-runtime/pi/pi-package/composio, agent-runtime/pi/pi-package/context, agent-runtime/pi/pi-reference]
created: 2026-11-22
updated: 2026-11-22
---

# Spend fewer tokens on Composio's searches, and keep episodes out of fold summaries

Built on 2026-11-22, after a review of one of pixel's threads. Of the 7,092 tokens its 12 Composio answers took, its two searches took 4,251. The second repeated the first, although the thread's fold summary held the schema. That summary also named the episodes it folded, which the fold's tag already lists. The design: [search answers](../../architecture/agent-runtime/pi/pi-package/composio/README.md#search-answers), [Composio's prompt](../../architecture/agent-runtime/pi/pi-package/composio/README.md#the-prompt) and [fold](../../architecture/agent-runtime/pi/pi-package/context/README.md).

## What was built

In the commit that adds this task to `done/`.

- **`extensions/composio/trim.ts`**, which a `tool_result` handler in `extensions/composio/index.ts` runs on each `COMPOSIO_SEARCH_TOOLS` answer: it removes the fields it names, and keeps the connections and next steps whole when a service has no account.
- **The harness prompt**, "External services": a tool whose slug and arguments the agent knows runs with `COMPOSIO_MULTI_EXECUTE_TOOL` at once, with no session id; a schema a search left out is loaded with `COMPOSIO_GET_TOOL_SCHEMAS`.
- **Fold summaries.** The fold nudge says not to mention episodes, by id, number or tokens, also ones the work read or was about, and asks for `from` and `to` as the episodes' ids in words that no longer read as a rule for the summary. The harness's line `Folded: N episodes (…)`, which repeated the tag's ids, is gone; the harness prompt already says that `episode_read` takes an episode id.

## Decisions

[D97](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d97): the extension trims a search's answer by removing the fields it names.

## Changes from the plan

- **Unconnected services are trimmed too.** The plan trimmed only answers whose services were all connected. Only the connections and next steps tell the model to connect a service, so only those two stay whole for an unconnected one.
- **The time stays.** The plan removed `time_info`, but a message typed in `agentx chat` carries no time, so `current_time_utc` stays.
- **Stubs of primary tools stay.** They name a tool the task needs.
- **No check in `fold`.** A first version refused a summary that named an episode; the instruction alone does it.

## Migration

None. Threads see trimmed searches from their next start. Session files written before keep their searches whole.

## Verification

- `pnpm test`: a search's answer through Pi, in the fake Composio, is trimmed in the thread's Pi session; one for a service with no account keeps its connections and next steps; a failed answer and one that is not JSON stay as they are; a fold's summary is its tag and the agent's text.
- By hand, against Composio, on 2026-11-22, with read-only tools: six searches over Telegram, Gmail, Google Calendar, HubSpot, Sheets with Drive, and Slack, which the agent may not use, have the same fields. The trim saves 12% to 32% of a search for one task. A search for two tasks, over 20 KB, reaches the hook already cut by Pi, and stays as it is. A run of `TELEGRAM_GET_ME` and `TELEGRAM_GET_CHAT` in a new session, before any search and with no session id, succeeds.

## Follow-ups

- That a real model follows the prompt over Composio's "Always call this tool first" is not tested: check it in a live thread.
- A search over 20 KB reaches the model cut in the middle.

## Original plan

Trim the noise of each search's answer in the Composio extension: Composio's guidance, the stubs of schemas, the session's instructions, the time's advice, and the connections' details when every service is connected. Pass through an answer that failed or that does not parse. Tell the agent in the prompt to run a tool it already knows without a search. Leave `COMPOSIO_MULTI_EXECUTE_TOOL`'s answers and the full schemas as they are. Keep episodes out of fold summaries: the fold's tag lists them.
