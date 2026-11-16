---
name: workflow-composio
title: Keep the model for what needs judgement, and let workflows run Composio tools
description: The harness prompt sends whatever a script can do to a workflow, and a workflow runs Composio tools as the agent with ctx.composio, so fixed work such as sending a Telegram message needs no model.
type: feature
priority: none
status: done
modules: [agent-runtime/functions, agent-runtime/workflows, agent-runtime/pi/pi-package, agent-runtime/pi/pi-package/composio]
created: 2026-11-16
updated: 2026-11-16
---

# Keep the model for what needs judgement, and let workflows run Composio tools

Built on 2026-11-16. The design: [Composio in a workflow](../../architecture/agent-runtime/functions/README.md#composio-in-a-workflow).

## What was built

In the commit that adds this task to `done/`.

- **The harness prompt.** "Workflows" says to keep the model for what needs judgement: a workflow does the fixed steps and sends what needs judging, its result or its error, to a thread. It shows `ctx.composio`. "External services" allows Composio through the tools and `ctx.composio` only.
- **`ctx.composio(tool, args)`** on `WorkflowContext` (`functions/composio-tool.ts`): the run's first call makes a Composio session for the agent's user id with its policy, and each call runs a tool with Composio's execute route. It resolves to the tool's data and throws unless the tool completed.
- **`policy.ts`** in the Composio extension: the session policy, moved out of `index.ts` so workflows use the same one.
- **The fake Composio** has the execute route; two tests cover a run's shared session, the policy, the data, a failing tool, and a missing key.

## Decisions

[D82](../../architecture/agent-runtime/functions/README.md#d82): a workflow runs Composio tools with `ctx.composio`, in a session of its run with the agent's policy.

## Changes from the plan

None.

## Verification

- `pnpm run check`, and `pnpm test`: 97 tests pass.
- Checked against Composio on 2026-11-16, with the full project key, through the built `composioTool`, as user id `dory@cogni`, reading only: `COMPOSIO_SEARCH_TOOLS` completed and gave its data; `TELEGRAM_SEND_MESSAGE` takes `chat_id` and `text`, both required; with only `telegram` enabled, a Gmail tool was refused with `[Session Restriction]`; `TELEGRAM_GET_ME` completed with the connected bot; a GitHub tool, with no account, was refused with 400 "No active connection found".
- **Not checked:** the agents' scoped key (Session management and Session tool execution) on the execute route; sending a message.

## Original plan

The request: the harness prompt should say to use the model only where necessary, to prefer a workflow for what a deterministic script can do, and to send a workflow's output or error to a thread when a subjective evaluation is needed. And: can a workflow call Composio, such as to send a Telegram message?

The plan: `ctx.composio(tool, args)` on the workflow's context, which makes a Composio session with the agent's user id and policy, reusing the extension's policy code, and runs the tool through the session's execute route; the prompt names it as the one way besides the tools; a test against the fake Composio, a decision entry, and the docs.
