---
name: composio-service
title: Bring Composio's events to agents, and make each agent's triggers
description: A core coordinator service for Composio, in two parts. Its webhook checks Composio's signature and delivers each trigger event to the agent whose user id it names; then it makes the triggers declared for each agent, with a key of its own that is never passed to the agent.
type: feature
priority: none
status: idea
modules: [coordinator-runtime/services/composio, agent-runtime/agent, agent-runtime/pi/pi-package/composio]
created: 2026-11-13
updated: 2026-11-15
---

# Bring Composio's events to agents, and make each agent's triggers

A core [coordinator service](../done/4-coordinator-services.md), built in two parts: the webhook, then the triggers.

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

## The triggers

A Composio trigger makes Composio send an event when something happens in a service, such as a new email in a mailbox. Its webhook (part 1) brings each event to the agent whose Composio user id the trigger was made for, and the agent's [router](../../architecture/agent-runtime/events/README.md) decides what it becomes. Part 2 makes the triggers.

### How triggers are made

Through Composio's trigger API, with a key that has the **Triggers** permission, or by hand with Composio's CLI (`composio dev triggers create`); the dashboard turns triggers on and off. A session gives the model no way. In a check on 2026-11-13, agentx's default session had no trigger tool. With Composio's own `composio` toolkit turned on, the session's search found `COMPOSIO_ENABLE_TRIGGER`, but running it was refused: "Cannot execute meta tool COMPOSIO_ENABLE_TRIGGER directly".

The same check, with a full project key and Gmail's `GMAIL_NEW_GMAIL_MESSAGE`:

- `POST /api/v3.1/trigger_instances/{slug}/upsert` with `user_id` and `trigger_config` makes the trigger on the user id's connected account for the toolkit, and answers 201 with `trigger_id`, `type` and `fallback_reason`. The same config again answers 200 with the same id, and turns the trigger back on if it was off. Another config makes a second trigger and leaves the first running. A user id with no account for the toolkit gets 404, code 1810.
- `GET /api/v3.1/trigger_instances/active` lists triggers, each with its `user_id`, `connected_account_id` and config, the config's defaults filled in. `PATCH /api/v3.1/trigger_instances/manage/{id}` with `{"status": "disable"}` turns one off, and `DELETE` on the same path deletes it.

### Where the key lives

A Composio key belongs to the whole Composio project, and no key can be limited to one user id. A trigger call names any user id, or only a trigger id, and the key accepts it. All agents of a project share one Composio project, each with its own user id. So a key that can make triggers can make, change or delete any agent's triggers, or send their events elsewhere with `egress_url`.

- The agents' key, `COMPOSIO_API_KEY`, is a scoped key for sessions only ([Composio](../../architecture/agent-runtime/pi/pi-package/composio/README.md)), so it cannot touch triggers. It must stay that way: a full project key there would give every agent every trigger and the webhook's secret, and a sandbox would not help.
- Pick: **the coordinator holds a key with Triggers**, `COMPOSIO_COORDINATOR_API_KEY`, and always sends the agent's own user id. It is a secret of the Composio [coordinator service](../done/4-coordinator-services.md), in `agent-x/.env.services`, like the webhook secret, so no agent's process gets it.
- Rejected: tools in agentx's Pi package that call the trigger API with that key. The key would be in the agent's process by design, so even sandboxes could not keep it from the agent. agentx would also own tools over Composio's REST API, which [D40](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d40) avoids.
- Rejected: a command the developer runs to make triggers. The key would move to laptops, and nothing would turn triggers back on after a person reconnects an account.

### Who declares an agent's triggers

The coordinator makes Composio match a list of triggers for each agent. The list can come from:

1. **The developer**, under `agentx.composio.triggers` in the agent's `.pi/settings.json`, checked in. Every environment gets the same triggers, and no model can add event costs.
2. **The agent**, in `storage/knowledge/composio_triggers.json`, its own ([D35](../../architecture/agent-runtime/agent/README.md#d35)), in the same format. The agent can start watching something when a person asks, as it keeps its own router and workflows. The coordinator still sends only the agent's user id, a slug and a config, so the agent reaches nothing beyond its own triggers. The agent finds trigger types and their configs in the toolkit pages of Composio's docs.
3. **Both** (pick), the way workflows come from `.pi/workflows/` and from the agent's knowledge. A name in both: the developer's wins.

### Plan

1. **Declarations**, keyed by a name the developer or the agent picks:

   ```json
   "triggers": {
   	"support-email": { "slug": "GMAIL_NEW_GMAIL_MESSAGE", "config": { "labelIds": "INBOX" } }
   }
   ```

   `config` is the trigger's config in Composio's names, as `GET /api/v3.1/triggers_types/{slug}` describes it. agentx adds `user_id` and sends nothing else, so no declaration can set `egress_url`. Composio puts the trigger on the user id's first active account for the toolkit.
2. **The Composio extension compares only `userId` and `session`** when it checks whether a thread's Composio session still fits the settings. Today it compares all of `agentx.composio`, so a change of triggers would make a new session for every thread.
3. **The coordinator makes Composio match** the declarations of each agent that has any, in the Composio service that also takes its webhooks, so the two share the trigger ids: in `onStart`, before it takes events; for every such agent on each `composio.connected_account.activated` event, which names no user id that Composio still supports; and when the agent's file changes, which it checks every 5 s with `context.every`.
   - Each declared trigger is upserted with the agent's `user_id`. Without an account for the toolkit, the call fails, the coordinator logs it, and the next match tries again. Two names that get the same trigger id are one trigger, because Composio fills in a config's defaults, so the coordinator logs the second name and skips it. An answer with `type: "poll"` is logged with its `fallback_reason`.
   - The agent's other active triggers are turned off, not deleted, so a mistake can be undone in Composio's dashboard, and declaring the old config again turns it back on. The coordinator lists them with `user_ids` set to the agent's, follows `next_cursor`, and turns off only those whose own `user_id` is the agent's. A changed config makes a new trigger, so this is how the old one stops. If any upsert of the agent failed, this match turns off nothing: a failed upsert returns no id, and a declared trigger would look undeclared.
   - An agent with no declarations keeps the triggers its user id has. An empty list turns them all off.
   - When Composio refuses one of the agent's own declarations, the coordinator adds an event for the agent with the name and Composio's answer, so the agent learns of it.
   - The coordinator keeps each trigger id it got back, with its agent, name and connected account, in memory. An event whose trigger id it does not know is added as the webhook adds any event, without waiting. After the answer, the coordinator matches that agent once more, once per unknown id.
   - Without `COMPOSIO_COORDINATOR_API_KEY`, or with Composio out of reach, `serve` logs it and starts anyway. Events are still delivered, and the next match tries again.
4. **Events of declared triggers** carry `trigger-name: <name>` in their metadata, so a router can tell them apart. The trigger id also finds the agent when an event's `user_id` is null.
5. **Composio's other events.** The subscription also sends `composio.trigger.disabled` (Composio turned a trigger off, for example because the account's login expired), `composio.connected_account.expired` and `composio.connected_account.activated`, all V3 only. Their `data` names a trigger or an account by `data.id`, and the user id in the two account events is one Composio marks as going away. So the coordinator finds the agent by the trigger ids and connected accounts it knows from matches and from earlier events, and adds the first two as events for that agent, so its router can tell a person. The third starts a match, which turns triggers back on once a person has reconnected the account: Composio does not.
6. **Tests.** The fake Composio gets the trigger routes. For an agent that declares a trigger: `serve` upserts it with the agent's user id; another active trigger of that user id is turned off, but not when an upsert fails, and a trigger of another user id is left alone; a changed config turns the old trigger off; a declaration the agent adds to its file is upserted; an event of the declared trigger carries its name; an `expired` event for its account reaches the agent; an `activated` event upserts again. An agent without declarations keeps its triggers. A change of triggers keeps each thread's Composio session.
7. **Check against Composio by hand**, through `serve`, with a scoped key that has only Triggers read and write: a Gmail trigger declared in an agent's settings and one in its knowledge, and an email that reaches its router. It settles what the 2026-11-13 check left open: whether such a key can upsert, list, turn off and delete; whether `user_ids` filters the list (two user ids, each with triggers); whether reconnecting an account keeps its id; what the three lifecycle events carry; and whether Composio's dashboard can choose the subscription's events.
8. **Docs.** The agent's settings table and [customize an agent](../../user_guides/customize_an_agent.md); a triggers section and decisions in the Composio doc; the coordinator's doc; the harness prompt (the agent's own declarations); the server guide. The guide says:
   - Create the coordinator's key in Composio's dashboard (Settings, API Keys, with Triggers read and write; the docs give no other way), and keep `COMPOSIO_API_KEY` the scoped session key.
   - Add the three events to the webhook subscription. If the dashboard cannot choose events, that takes one `PATCH /api/v3.1/webhook_subscriptions/{id}` with all four in `enabled_events`, made by hand with a key that has Webhooks write.
   - A trigger the coordinator logs as `poll` keeps polling until it is deleted by hand once; the next match then makes it again, realtime where Composio can.

### To decide

- **Who declares triggers**: above.
- **The other triggers of an agent with declarations.** Turned off (pick), so the declarations are the whole truth and a changed or removed declaration stops its old trigger. Left alone, every change of config would leave a trigger running.

### Costs

- From Composio's pricing page (composio.dev/pricing/platform, 2026-11-13), for accounts made since 2026-08-15; older accounts keep their plan until 2026-12-31. Composio bills each trigger event it delivers to the webhook. Its Hobby plan includes 50,000 a month, at most 10,000 of them from Composio-managed apps, and then pauses. On Pro, a polling event costs twice a realtime one.
- Gmail triggers are realtime since 2026-11-12 with Composio's own Gmail app: in the check, a new trigger answered `type: webhook` and its event came 23 s after the email, though the trigger type still says `poll`. A trigger made before that keeps polling until it is deleted and made again, because an upsert keeps an existing trigger and its type. Polling triggers check every 2 minutes by default.
- Every trigger event of an agent goes through its router, and a message costs a model run, so a broad trigger such as every email of a mailbox is cheaper with a router or a workflow that drops what the agent does not need.

### Known limits

- Until sandboxes, an agent can read the coordinator's key the way it reads any file or process of its OS user, such as `agent-x/.env`.
- A declaration cannot choose among an agent's accounts for one toolkit: the trigger goes on the first active one, which may not be the one its session uses.

### Decisions to record when built

- An agent's triggers are declared, by its developer in its settings and by the agent in its knowledge, and the coordinator makes Composio match them for the agent's user id.
- The coordinator's Composio key, with Triggers, is never passed to the agent's process.
