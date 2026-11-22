# Composio

A core [service](../../README.md#services) of the coordinator: Composio's webhook. It brings each event of a Composio trigger, such as a new email, to the agent whose Composio user id the trigger was made for. Code: `src/coordinator-runtime/services/composio/composio.ts`, and `composio-user-id.ts`, which reads an agent's Composio user id, as the Telegram service does too.

A Composio project sends every trigger event to one URL, its webhook subscription, signed with the project's secret. All agents of an agentx project share one Composio project, each with its own user id ([D38](../../../agent-runtime/pi/pi-package/composio/README.md#d38)). So the service has one route for the project, and finds the agent by user id ([D71](#d71)).

- **On** when `COMPOSIO_WEBHOOK_SECRET`, the subscription's signing secret, is set in the coordinator's environment or `agent-x/.env.services`. Without it the service is off, and its route is not served.
- **Route:** `POST /services/composio/webhook`, public: it checks the caller itself.

What the route does with a request:

1. **Checks the signature.** Composio sends `webhook-id`, `webhook-timestamp` (seconds) and `webhook-signature: v1,<base64>`, which may hold several values separated by spaces. One `v1` value must be the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the secret's text as it is, and the timestamp within 300 s of now. Otherwise: 401.
2. **Finds the agent.** Only `type: composio.trigger.message` makes an event. The agent is the one whose `agentx.composio.userId`, in its checked-in `.pi/settings.json`, equals the event's `metadata.user_id`, read at each request. A body that is not JSON, another type, a `user_id` no agent has, or `null`: no event, a log line, and 200, so Composio does not send again what will never be delivered.
3. **Delivers** with `context.deliver`, with no thread, so the agent's routers pick one:
   - key `composio:<webhook-id>`, so an event Composio sends again is one event;
   - content `Composio trigger <slug> fired. Its event's data is in data.json.`, and the files line;
   - `data.json`, the event's `data`, in the event's folder: it can be large, such as a raw email, so the model reads it only when it needs to;
   - metadata `source: composio`, `trigger` (the trigger's slug), `trigger-id`, `account` (the connected account's id) and `event-time` (when Composio sent it, in the agent's time zone, [D98](../../../agent-runtime/agent/README.md#d98)), with the fact `agentX-Service: composio`.
4. **Answers** 200 with the event's id once it is in the inbox, and 503 when it cannot be written, so Composio sends it again.

The agent need not be running: the event waits in its inbox. A router tells Composio's events apart by `source`, and one trigger's by `trigger`.

## Known limits

- Until sandboxes, an agent can read `COMPOSIO_WEBHOOK_SECRET` as it reads any file of its OS user, and with it forge events; it can also write any agent's inbox.
- An event larger than 1 MB, the API server's limit, gets 413 and is never delivered.
- Events are lost while `agentx serve` is down for longer than Composio keeps sending them again.
- A request that makes no event shows only in the coordinator's log.
- The service does not make triggers: they are made with Composio's CLI or API, for the agent's user id ([Composio triggers](../../../../tasks/backlog/composio-service.md)).

## Decisions

<a id="d71"></a>
### D71. One Composio webhook for the project, which finds the agent by its Composio user id

- **Problem.** A Composio project has one webhook subscription and one signing secret for all its triggers, and all agents of a project share it.
- **Decision.** One public route, `POST /services/composio/webhook`. It checks Composio's signature with `COMPOSIO_WEBHOOK_SECRET`, finds the agent whose checked-in `agentx.composio.userId` equals the event's `user_id`, and delivers the event keyed by its `webhook-id`, with its `data` as a file.
- **Why.** The user id is the agent's identity in Composio, and the developer's settings, not anything an agent writes, map it to the agent. Keyed by `webhook-id`, Composio's retries add one event. An event that can never be delivered gets 200, so Composio stops sending it.
- **Rejected.** A URL per agent, through each trigger's `egress_url`: every trigger is signed with the project's one secret, so a path proves nothing about the agent. Taking the agent's name apart from the user id: an id is an id, and a renamed agent keeps its own ([D38](../../../agent-runtime/pi/pi-package/composio/README.md#d38)).
