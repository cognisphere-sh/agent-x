---
name: webhooks-and-skills
title: Let each agent make webhooks that run its workflows, and teach routers, workflows, schedules and webhooks as skills
description: Agents make, list, rotate and delete webhooks with agentx webhook, and an optional coordinator service delivers each request to the webhook's workflow; the how-tos of routers, workflows and schedules move from the harness prompt into skills.
type: feature
priority: none
status: done
modules: [coordinator-runtime/services/webhooks, cli, agent-runtime/pi/pi-package]
created: 2026-11-22
updated: 2026-11-22
---

# Let each agent make webhooks that run its workflows, and teach routers, workflows, schedules and webhooks as skills

## What was built

- **The webhooks service**, optional ([webhooks](../../architecture/coordinator-runtime/services/webhooks/README.md)): `src/coordinator-runtime/services/webhooks/webhooks.ts` serves `POST /services/webhooks/<agent>/<name>/<token>`, checks the token, delivers the request to `workflow.<workflow>` with `body` and `headers.json`, answers 200 or 503, logs each request in `storage/workspace/webhook-logs/<name>.log`, and tells `main` once when a webhook's workflow is gone. `hooks.ts` reads and writes the agent's `storage/knowledge/webhooks.json`.
- **`agentx webhook create|list|rotate|delete`** (`src/cli/commands/webhook.ts`), in an agent directory: makes a webhook with a random token and prints its URL, keeps the URL when a webhook is made again, lists each with its last request, gives a new URL, deletes. `create` and `rotate` refuse without `publicUrl` or the service in `agentx.json`, and `create` refuses a workflow the agent does not have.
- **Skills in the Pi package**: `routing`, `workflows`, `schedules` (with polling a service), and `webhooks`. The harness prompt's `5-routing.md`, `6-workflows.md` and `7-schedules.md` are gone; the rest of `core/` is numbered 1 to 9, and its rules name the skill to read.
- Not committed yet.

## Decisions

- [D101](../../architecture/coordinator-runtime/services/webhooks/README.md#d101): an agent's webhook is a URL with a random token, which the agent makes and keeps with `agentx webhook`, and each request runs one of its workflows.
- [D102](../../architecture/coordinator-runtime/services/webhooks/README.md#d102): the URL's token is a webhook's only check, and the workflow confirms what a request says through Composio.
- [D103](../../architecture/coordinator-runtime/services/webhooks/README.md#d103): a webhook answers 200 once the event is in the inbox, and never with an answer its caller waits for.
- [D104](../../architecture/agent-runtime/pi/pi-package/README.md#d104): how to write a router, a workflow, a schedule or a webhook is a skill of the package, and the harness's rules name it.

## Changes from the plan

- A webhook whose workflow is gone answers 503 and tells `main` once per webhook and workflow; the plan did not say. The scheduler reports a fire the agent refuses in the same way.
- A token shorter than 32 characters never matches, so one shortened by hand in the file cannot be guessed.
- The service is off without `publicUrl`, as Telegram is.
- The rule that keeps the model for what needs judgement stayed in the harness prompt (`3-learning.md`), not in the `workflows` skill: the agent needs it to choose a workflow before it reads the skill.

## Migration

- **To take webhooks up**, a project adds `"services": { "webhooks": {} }` and `publicUrl` to `agentx.json`, forwards `/services/webhooks/` to `agentx serve`, and starts it again ([run on a server](../../user_guides/run_on_a_server.md#webhooks)). Nothing changes until then: `agentx webhook create` refuses and says what to set.
- **The prompt changes for every agent** at its next run: the sections `agentx-core-routing`, `agentx-core-workflows` and `agentx-core-schedules` are gone, and four skill sections are new. A session already going gets the removals and the new sections, as with any changed section.
- **An agent's or developer's skill named `routing`, `workflows`, `schedules` or `webhooks`** is now left out, since agentx's skills come first, and `agentx-skills` lists it as taken. Rename it.

## Verification

- `test/coordinator.test.mjs`: through a real `agentx serve`, `agentx webhook create` refuses without `publicUrl`, without the service and for a workflow the agent lacks; a request runs the workflow, which reads `body` and `headers.json` from the event's folder as the skill shows; a wrong token, another webhook, another agent and a token shortened by hand get 404; `list` shows the URL, workflow, description and last request in the agent's time zone; made again, the URL stays; rotated, the old URL gets 404 and the new one 200; deleted, 404; a webhook whose workflow is gone gets 503 twice, and `main` hears of it once.
- `test/context.test.mjs`: the four skills are sections with version 1, and none of them is a core section.
- `pnpm run check`; `pnpm test`: 124 of 124. In an earlier run, "an agentx run that is killed takes its sessions with it…" timed out once waiting for an abandoned lease under the suite's load; it touches nothing this task changed.
- Retell's webhook docs confirm the body the `webhooks` skill's example reads: `event`, such as `call_ended`, and `call.call_id`; Retell sends it again up to 3 times without a 2xx in 10 s.
- Not checked against Retell, Twilio or ClickSend by hand.

## Follow-ups

- An answer a caller waits for (handshakes, TwiML, Retell's inbound webhook), if a service the agents need requires one ([D103](../../architecture/coordinator-runtime/services/webhooks/README.md#d103)).
- [Make each agent's Composio triggers](../backlog/composio-service.md), for services with no URL to set, such as Gmail.
- Check a webhook end to end with Retell: `RETELLAI_UPDATE_AGENT` with the URL, and `call_ended` reaching the workflow.

## Original plan

### Webhooks

1. `agentx webhook create|list|rotate|delete` manages webhooks in the agent's own `storage/knowledge/webhooks.json`, with a random token made by the command. `create` takes the workflow and a description that says who calls the webhook and where its URL is set.
2. An optional `webhooks` service checks the token on `POST /services/webhooks/:agent/:name/:token`, delivers the request to `workflow.<name>` with the body as a file, and logs each request.
3. The workflow reads the id from the body and fetches the real item through Composio. That fetch is the auth: no provider's secret reaches the agent.
4. The agent sets and removes the URL at each provider with Composio tools, such as `RETELLAI_UPDATE_AGENT`, `TWILIO_UPDATE_INCOMING_PHONE_NUMBER` and `CLICKSEND_CREATE_AUTOMATIONS_SMS_INBOUND`.
5. No `respond`: every webhook answers 200 with JSON once the event is in the inbox. Each request gets a random key; the workflow keys what it sends by the item's id.

### Skills

Tell the agent how to create a webhook with a skill, and move the harness prompt's sections on routing, workflows and schedules into skills too.
