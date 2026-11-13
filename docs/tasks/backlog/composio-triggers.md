---
name: composio-triggers
title: Set up each agent's Composio triggers from its settings
description: An agent's settings declare the Composio triggers it reacts to and the thread of their events; the coordinator makes Composio match them for the agent's user id, with a key of its own that is never passed to Pi.
type: feature
priority: none
status: idea
modules: [coordinator-runtime, agent-runtime/agent, agent-runtime/pi-package/composio]
created: 2026-11-13
updated: 2026-11-13
---

# Set up each agent's Composio triggers from its settings

A Composio trigger makes Composio send an event when something happens in a service, such as a new email in a mailbox. [Webhooks](coordinator-webhooks.md), which this plan needs first, bring each event to the agent whose Composio user id the trigger was made for. This task is about making the triggers.

## Who sets up an agent's triggers

"Agents configure triggers" can mean:

1. **The agent's developer**, in the agent's `.pi/settings.json`, checked in. The coordinator makes Composio match it.
2. **The agent itself, while it runs**, for example when a person asks it to watch for something.

Pick 1 first. The agent's definition stays in its directory, every environment gets the same triggers, and no model can run up event costs. 2 can follow on the same machinery ([below](#later-triggers-the-agent-sets-up-itself)).

## Where the key lives

Making a trigger needs a Composio key with the **Triggers** permission. No Composio key can be limited to one user id, so such a key can change the triggers of every agent of the project. A Composio session gives the model no tools for triggers: "Triggers don't work with sessions yet", say Composio's docs. (From the docs and the source of `@composio/core` 0.29.0, read on 2026-11-13.)

- Pick: **the coordinator holds the key**, `COMPOSIO_COORDINATOR_API_KEY`, a scoped key with Triggers read and write, and always sends the agent's own user id. It reads the key as it reads the webhook secret, and `piEnv` leaves it out of Pi's environment.
- Rejected: tools in agentx's Pi package that call Composio with a key that has Triggers. The key would be in the agent's process by design, so even sandboxes could not keep it from the agent, and with it any agent could change every agent's triggers or send their events elsewhere with `egress_url`. agentx would also own tools over Composio's REST API, which [D40](../../architecture/agent-runtime/pi-package/composio/README.md#d40) avoids.
- Rejected for now: Composio's own `composio` toolkit has `COMPOSIO_LIST_TRIGGERS` and `COMPOSIO_ENABLE_TRIGGER`. agentx's default toolkits leave it out, nothing documents it inside a session or says which user id it acts for, and none of its tools turns a trigger off.
- Rejected: a command the developer runs to set up triggers. The key would move to laptops, and nothing would turn triggers back on after a person reconnects an account.

## Plan

1. **Settings.** `agentx.composio.triggers` in the agent's `.pi/settings.json`, keyed by a name the developer picks:

   ```json
   "triggers": {
   	"support-email": {
   		"slug": "GMAIL_NEW_GMAIL_MESSAGE",
   		"upsert": { "trigger_config": { "labelIds": "INBOX" } },
   		"threadId": "support"
   	}
   }
   ```

   `slug` is Composio's trigger type. `upsert` goes into the body of Composio's request that makes the trigger, in Composio's names, as `session` does for sessions ([Composio](../../architecture/agent-runtime/pi-package/composio/README.md#settings)); agentx adds `user_id`. `threadId` defaults to `trigger-<name>`. What the agent does with a trigger's events goes in its system prompt, under the trigger's name, which each of its messages carries (`trigger-name: support-email`). The Composio extension then compares only `userId` and `session` when it checks whether a thread's Composio session still fits the settings, so a change of triggers makes no new sessions.
2. **The coordinator makes Composio match** the settings of each agent that has `triggers`, when `serve` starts and before it takes events, and again for every such agent on each `composio.connected_account.activated` event, which names no user id that Composio still supports:
   - Each declared trigger is upserted (`POST /api/v3.1/trigger_instances/{slug}/upsert`) with the agent's `user_id`. Composio uses the user id's first active account for the toolkit. Without one the call fails, the coordinator logs it, and the next match tries again. An upsert also turns a matching trigger back on after Composio turned it off. Two names of one agent with the same `slug` and `upsert` would get one trigger; the coordinator logs the second and skips it.
   - Every other active trigger of the user id (`GET /api/v3.1/trigger_instances/active?user_ids=…`) is turned off with `PATCH /api/v3.1/trigger_instances/manage/{id}` and `{"status": "disable"}`, not deleted, so a mistake can be undone in Composio's dashboard. If any upsert of the agent failed, this match turns off nothing: a failed upsert returns no id, and a declared trigger would look undeclared. The user id `<agent>@<project>` is agentx's ([D38](../../architecture/agent-runtime/pi-package/composio/README.md#d38)), so an agent that declares triggers declares all of them. An agent without `triggers` keeps the triggers its user id has.
   - The coordinator keeps each trigger id it got back, with its agent and name, in memory. An event whose trigger id it does not know is queued as [webhooks](coordinator-webhooks.md) queue any event, without waiting; after the answer, the coordinator matches that agent once more, once per unknown id.
   - `"triggers": {}` turns off every trigger of the agent; no `triggers` key leaves them alone. A name or `threadId` that the rule for thread ids does not allow is logged and skipped.
   - Without `COMPOSIO_COORDINATOR_API_KEY`, or with Composio out of reach, `serve` logs it and starts anyway. Events are still delivered, and the next match tries again.
3. **Routing.** An event of a declared trigger goes to the trigger's `threadId`, with `trigger-name` in its metadata. Other events go as in [webhooks](coordinator-webhooks.md). The trigger id also finds the agent when an event's `user_id` is null.
4. **Composio's lifecycle events.** The webhook subscription also sends `composio.trigger.disabled` (Composio turned a trigger off, for example because the account's login expired) and `composio.connected_account.activated`. The first is logged. The second starts a match, which turns the triggers back on once a person has reconnected the account.
5. **Tests.** The fake Composio gets the trigger routes. For an agent that declares a trigger: `serve` upserts it with the agent's user id; another active trigger of that user id is turned off, but not when an upsert fails; an event of the declared trigger arrives on its thread with its name; an `activated` event upserts again. An agent without `triggers` keeps its triggers.
6. **Check against Composio by hand:** a Gmail trigger from an agent's settings, and an email that reaches its thread. It settles what the docs leave open: whether an upsert with another config makes a second trigger or changes the first; what an upsert answers when the user id has no account; whether reconnecting an account keeps its id; whether the upsert of a Gmail trigger answers `type: webhook`; whether an agent's session offers `COMPOSIO_ENABLE_TRIGGER`; and whether Composio's dashboard can choose the subscription's events.
7. **Docs.** The agent's settings table and [customize an agent](../../user_guides/customize_an_agent.md); a triggers section and decisions in the Composio doc; the coordinator's doc; the server guide. The guide says to create the key in Composio's dashboard (Settings, API Keys; the docs give no other way) and to add the two events to the webhook subscription. If the dashboard cannot choose events, that takes one `PATCH /api/v3.1/webhook_subscriptions/{id}` with all three in `enabled_events`, made by hand with a key that has Webhooks write.

## To decide

- **Who sets up triggers**: above.
- **The other triggers of an agent with `triggers`.** Turned off (pick), so the settings are the whole truth and a removed declaration stops its trigger, or left alone.
- **Instructions.** In the agent's system prompt, per trigger name (pick): written once, read again on every message ([D5](../../architecture/agent-runtime/agent/README.md#d5)). Or an `instructions` field put before each event, which adds the text to the thread for every event.

## Later: triggers the agent sets up itself

The same match can take a second list, which the agent writes into its knowledge, `storage/knowledge/composio_triggers.json`, in the format of the settings ([D35](../../architecture/agent-runtime/agent/README.md#d35)). The coordinator reads both lists with the same user id, matches the agent again when the file changes (it checks the file's time every few seconds), and puts a message on the agent's queue when Composio refuses one of the agent's own. The agent finds trigger types and their config in the toolkit pages of Composio's docs; Composio's API gives them only to a key with Triggers.

## Costs

- From Composio's pricing page (composio.dev/pricing/platform, 2026-11-13), for accounts made since 2026-08-15; older accounts keep their plan until 2026-12-31. Composio bills each trigger event it delivers to the webhook. Its Hobby plan includes 50,000 a month, at most 10,000 of them from Composio-managed apps, and then pauses. On Pro, a polling event costs twice a realtime one.
- Gmail and most Google Calendar triggers are realtime since 2026-11-12 with Composio-managed auth. A trigger made before that keeps polling until it is deleted and made again; an upsert keeps an existing trigger and its type. Polling triggers check every 2 minutes by default.

## Known limits

- Until sandboxes, an agent can read the coordinator's key the way it reads any file or process of its OS user, such as `agent-x/.env`.

## Decisions to record when built

- An agent's triggers are declared in its settings, and the coordinator makes Composio match them.
- The coordinator's Composio key, with Triggers, is never passed to Pi.
