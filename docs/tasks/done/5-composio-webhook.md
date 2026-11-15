---
name: composio-webhook
title: Bring Composio's trigger events to agents through a core coordinator service
description: The Composio service's webhook checks Composio's signature and delivers each trigger event to the agent whose Composio user id it names.
type: feature
priority: none
status: done
modules: [coordinator-runtime/services/composio]
created: 2026-11-13
updated: 2026-11-15
---

# Bring Composio's trigger events to agents through a core coordinator service

Built on 2026-11-15, as part 1 of [Composio](../backlog/composio-service.md), on the [coordinator's services](4-coordinator-services.md). The design: [Composio service](../../architecture/coordinator-runtime/services/composio/README.md).

## What was built

In the commit that moves this task to `done/`.

- **The Composio service**, `src/coordinator-runtime/services/composio/composio.ts`, a core service after the scheduler, on when `COMPOSIO_WEBHOOK_SECRET` is set. Its one route, `POST /services/composio/webhook`, public, checks Composio's signature and its timestamp, finds the agent by `agentx.composio.userId` in its checked-in settings, and delivers the event with `context.deliver`, `data` as `data.json`.
- **Template.** `COMPOSIO_WEBHOOK_SECRET`, commented out, in `agent-x/env.services`.
- **Guide.** *Composio's events* in [run on a server](../../user_guides/run_on_a_server.md#composios-events).

## Decisions

[D71](../../architecture/coordinator-runtime/services/composio/README.md#d71) one webhook for the project, which finds the agent by its Composio user id.

## Changes from the plan

- **The key is `composio:<webhook-id>`**, not the bare id, as the scheduler's keys start with `schedule:`, so no other sender's key can take it.
- **A signed body that is not JSON** is ignored with 200, as an event for no agent, instead of failing with 500, which Composio would send again for ever.
- **Not tested:** an event that arrives while the agent drains or is stopped. It waits in the inbox, as every delivered event does, which the coordinator's tests already cover.
- **Not checked against Composio by hand** yet (plan step 3): the signature check follows the 2026-11-13 check of Composio's events.

## The plan

## The webhook

### How a webhook route works

How a service, core or optional, takes an external service's webhook in a route with access `public`, which the API token does not guard:

1. **Checks** the request is from the service, by its signature or token over the raw body. Not: 401.
2. **Turns** it into events, each for one agent of the project, found from the agents' checked-in settings, never from anything an agent writes; none for a request to ignore. An event for an agent the project does not have is dropped with a log line.
3. **Delivers** each with `context.deliver`, with no thread, `source: <service name>` in its metadata, and the service's own id for the delivery as its key, so a delivery sent again is added once ([D50](../../architecture/agent-runtime/events/README.md#d50)). A large payload goes in as a file the content names, not text the model reads. The agent need not be running; the router decides what the event becomes.
4. **Answers** 200 once every event is in its inbox, and 503 if one cannot be written, so the service sends again. A throw answers 500, with a log line; the service sends again too.

### Composio's webhook

Composio's triggers cover many services through one webhook, so it is a core service, `services/composio/`: on whenever its secret is set. Part 2 adds the making of triggers to the same service, which shares the trigger ids it gets back with the webhook in memory.

From Composio's docs, and a check on 2026-11-13 with a Gmail trigger, a webhook subscription to a local listener, and one email:

- **One subscription per Composio project**, with a URL, a payload version (`V3`), the event types to send, and a signing secret of 64 hex characters, which every read of the subscription returns. A trigger can send to its own URL instead (`egress_url`), but it is still signed with the project's secret.
- **The event:** `{ "id": "msg_…", "timestamp", "type": "composio.trigger.message", "metadata": { "trigger_slug", "toolkit_slug", "trigger_id", "connected_account_id", "auth_config_id", "user_id", "log_id" }, "data": { … } }`. `metadata.user_id` is the Composio user id the trigger was made for, and each agent has its own ([D38](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d38)). The docs allow it to be `null`; it was set in every event of the check. An email that two triggers match makes two events.
- **Signature:** headers `webhook-id` (the event's `id`), `webhook-timestamp` (seconds) and `webhook-signature: v1,<base64>`; Composio's SDK also accepts several, separated by spaces. The value is base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the secret's text as it is: in the check, neither its hex nor its base64 decoding matched. Composio's SDK refuses a timestamp more than 300 s off.
- **At least once.** Any 2xx counts as delivered. After a 500, the same `webhook-id` came again 2 s later, with `x-composio-delivery-attempt: 2`. The docs give no schedule for later attempts.
- **Size.** A Gmail event holds the raw message (`data.payload`) as well as its text: 58 KB for an ordinary email.

So the service:

- `secrets`: `COMPOSIO_WEBHOOK_SECRET`, the name Composio's CLI uses too. Without it, `onStart` throws and the service is off.
- Checks the signature as above, any `v1` value may match, the timestamp within 300 s.
- Makes one event for the agent whose `agentx.composio.userId` equals `metadata.user_id`, never from parsing the id ([D38](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d38)). Its key is `webhook-id`; `data` is the file `data.json`; its content is short markdown that names the trigger's slug and the file; its metadata is `trigger`, the trigger's slug, `trigger-id`, `account` (the connected account's id) and `event-time`. No such agent, `user_id` null, or a type other than `composio.trigger.message`: no events, and 200, so Composio does not send again what will never be delivered.
- One endpoint for the project, which finds the agent by user id, not one per agent through each trigger's `egress_url`: every trigger is signed with the project's one secret, so a path per agent proves nothing.
- The subscription is set once, by hand, per Composio project.

### Plan

1. The Composio service, `src/coordinator-runtime/services/composio/`, a core service after the scheduler, with the webhook as a public route, `POST webhook`. Its events go in with `context.deliver`; `data.json` is written to a temporary folder and passed as a file.
2. **Tests**, with Composio events the test signs with `node:crypto` and a secret of hex text:
   - an event for the second of two agents is added to that agent's events, and its router sends it to `main`, with `data.json` in the inbox folder;
   - the same `webhook-id` twice adds one event;
   - a wrong or old signature gets 401 and adds nothing; an unknown Composio user id gets 200 and adds nothing;
   - without `COMPOSIO_WEBHOOK_SECRET` the service is off, and its route 404;
   - an event that arrives while the agent drains, or is stopped, waits in its inbox and is routed after the next start.
3. **Check against Composio by hand**, through `serve`: a Gmail trigger made for an agent's user id, the subscription pointed at a tunnel to `serve`, and an email that reaches the agent's router.
4. **Docs.** The service's doc, `docs/architecture/coordinator-runtime/services/composio/`, with its decisions; `COMPOSIO_WEBHOOK_SECRET` in the template's `agent-x/env.services`; a user guide, *Receive Composio's events*: set the Composio project's webhook to `https://<host>/services/composio/webhook`, version V3, event `composio.trigger.message`, and copy its secret into `COMPOSIO_WEBHOOK_SECRET` in `agent-x/.env.services`. Use one Composio project per environment, because a project has one URL. Locally, forward events with Composio's CLI, `COMPOSIO_WEBHOOK_SECRET=<its value> composio dev triggers listen --forward http://localhost:3100/services/composio/webhook`, logged in to the agents' Composio project; or use a tunnel (cloudflared, ngrok) with a Composio project of one's own.

### Known limits

- Until sandboxes, an agent can read the webhook's secret the way it reads any file of its OS user, such as `agent-x/.env.services`, and with it forge events; it can also write any agent's inbox.
- Events can be lost while the coordinator is down for longer than Composio keeps sending them again.
- A request that makes no event, for an unknown agent or an ignored type, shows only in the coordinator's log.

### Decisions to record when built

- One endpoint for the project, which finds the agent by its Composio user id in its checked-in settings, and delivers keyed by `webhook-id`.
