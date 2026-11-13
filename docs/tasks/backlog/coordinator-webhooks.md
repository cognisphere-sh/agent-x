---
name: coordinator-webhooks
title: Bring Composio trigger events to agents
description: The coordinator serves the webhook of the project's Composio events, checks each event's signature, finds the agent by its Composio user id, and adds the event once to that agent's events, for its router.
type: feature
priority: none
status: idea
modules: [coordinator-runtime, agent-runtime/pi-package/event-queue, agent-runtime/agent]
created: 2026-11-13
updated: 2026-11-13
---

# Bring Composio trigger events to agents

Composio sends every trigger event of a Composio project to one webhook URL, which points at the [coordinator](coordinator.md)'s HTTP server. The coordinator checks the event, finds the agent it is for, and adds it to that agent's [events](agentx-run.md), where the agent's router decides what it becomes. This plan needs both first. Making triggers is a separate task, [Composio triggers](composio-triggers.md). This one delivers the events of any trigger made for an agent's user id.

## How Composio delivers events

From Composio's docs, and a check on 2026-11-13 with a Gmail trigger, a webhook subscription to a local listener, and one email:

- **One subscription per Composio project**, with a URL, a payload version (`V3`), the event types to send, and a signing secret of 64 hex characters, which every read of the subscription returns. A trigger can send to its own URL instead (`egress_url`), but it is still signed with the project's secret.
- **The event:** `{ "id": "msg_…", "timestamp", "type": "composio.trigger.message", "metadata": { "trigger_slug", "toolkit_slug", "trigger_id", "connected_account_id", "auth_config_id", "user_id", "log_id" }, "data": { … } }`. `metadata.user_id` is the Composio user id the trigger was made for, and each agent has its own ([D38](../../architecture/agent-runtime/pi-package/composio/README.md#d38)). The docs allow it to be `null`; it was set in every event of the check. An email that two triggers match makes two events.
- **Signature:** headers `webhook-id` (the event's `id`), `webhook-timestamp` (seconds) and `webhook-signature: v1,<base64>`; Composio's SDK also accepts several, separated by spaces. The value is base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the secret's text as it is: in the check, neither its hex nor its base64 decoding matched. Composio's SDK refuses a timestamp more than 300 s off.
- **At least once.** Any 2xx counts as delivered. After a 500, the same `webhook-id` came again 2 s later, with `x-composio-delivery-attempt: 2`. The docs give no schedule for later attempts.
- **Size.** A Gmail event holds the raw message (`data.payload`) as well as its text: 58 KB for an ordinary email.

## Plan

1. **The route** `POST /webhooks/composio` on the coordinator's HTTP server.
2. **Check the signature** over the raw body with `node:crypto`, as above: any `v1` value may match, and the timestamp must be within 300 s. A failed check gets 401. The secret is `COMPOSIO_WEBHOOK_SECRET`, the name Composio's CLI uses too, from the coordinator's environment, or else from `agent-x/.env` without adding the file to the environment. Without it the route answers 404, and `serve` says when it starts that Composio events are off.
3. **Find the agent**: the one whose `agentx.composio.userId` equals `metadata.user_id`, from the agents' settings, never from parsing the id ([D38](../../architecture/agent-runtime/pi-package/composio/README.md#d38)). No such agent, `user_id` null, or an event type other than `composio.trigger.message`: 200 and a log line, so Composio does not send again what will never be delivered.
4. **Add the event**: the coordinator writes the event's `data` to `storage/attachments/<webhook-id>.json` in the agent's directory, then adds an event with no thread and the key `webhook-id`. Its content is short markdown that names the trigger's slug and the file; its metadata is `source: composio`, `trigger`, the trigger's slug, `trigger-id`, `account` (the connected account's id) and `event-time`. A delivery sent again writes the same file and adds nothing, because of the key. The answer is 200 once the event is in the agent's queue file, and 503 if the file cannot be written, so that Composio sends it again.
5. **Keep the secret out of the agents.** The `AgentManager` leaves `COMPOSIO_WEBHOOK_SECRET` out of the agent's process, and `piEnv` leaves it out of what Pi, the router and workflows get from `agent-x/.env`.
6. **Tests**, with events the test signs with `node:crypto` and a secret of hex text: an event for the second of two agents is added to that agent's events, and its router sends it to `main`; the same `webhook-id` twice adds one event; a wrong or old signature gets 401 and adds nothing; an unknown user id gets 200 and adds nothing; an event that arrives while the runners drain is added, and routed after the next start.
7. **Check against Composio by hand**, through `serve`: a Gmail trigger made for an agent's user id, the subscription pointed at a tunnel to `serve`, and an email that reaches the agent's router.
8. **Docs.** The coordinator's doc (the route and its decisions), the agent's doc (the variables `piEnv` leaves out), the flows in `high_level_design.md` (an event's way to the agent), and the server guide from the [coordinator task](coordinator.md):
   - Set the Composio project's webhook to `https://<host>/webhooks/composio`, version V3, event `composio.trigger.message`, and copy its secret into `COMPOSIO_WEBHOOK_SECRET`.
   - Use one Composio project per environment, because a project has one URL.
   - Locally, forward events with Composio's CLI, `COMPOSIO_WEBHOOK_SECRET=<the value in agent-x/.env> composio dev triggers listen --forward http://localhost:3100/webhooks/composio`, logged in to the agents' Composio project; it is for development only. Or use a tunnel (cloudflared, ngrok) with a Composio project of one's own.

## To decide

- **One endpoint that routes by user id** (pick), or one per agent through each trigger's `egress_url`. Every trigger is signed with the project's one secret, so a path per agent proves nothing, and the coordinator would check `user_id` anyway.
- **Duplicates caught by the events table** (pick), with the `webhook-id` as the event's key, or a list of seen ids in the coordinator. The table makes "stored" and "not seen before" one step, and survives a coordinator restart.

## Known limits

- Until sandboxes, an agent can read the secret the way it reads any file of its OS user, such as `agent-x/.env`, and with it forge events for any agent.
- Events can be lost while the coordinator is down for longer than Composio keeps sending them again, which the docs do not say.
- An event the coordinator does not add, for an unknown user id or of another type, shows only in its log, not in any agent's [audit](agentx-run.md).

## Not in this plan

- Messages from the web app, such as `POST /agents/<agent>/messages`: how the app talks to agents is still open ([project](../../architecture/cli/project/README.md#not-decided-yet)). The server makes it a small step later.
- Composio's other events (`composio.trigger.disabled`, `composio.connected_account.expired`, `composio.connected_account.activated`): [Composio triggers](composio-triggers.md).

## Decisions to record when built

- Composio events reach the coordinator at one URL and are routed to agents by `metadata.user_id`.
- A webhook event becomes an agent event keyed by its `webhook-id`, its data a file in the agent's `storage/attachments/`. The answer is 2xx for everything except a bad signature and a queue file that cannot be written.
