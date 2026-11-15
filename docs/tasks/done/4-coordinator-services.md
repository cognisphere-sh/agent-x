---
name: coordinator-services
title: Build the coordinator out of services, core and optional
description: Everything the coordinator does besides running the agents is a service, in a folder of its own, with its own config, secrets and routes; the coordinator owns the API server, with a token for its private routes and routes to control the agents.
type: feature
priority: none
status: done
modules: [coordinator-runtime, coordinator-runtime/services/relay, coordinator-runtime/services/scheduler, cli/project]
created: 2026-11-15
updated: 2026-11-15
---

# Build the coordinator out of services, core and optional

Built on 2026-11-15, on top of [the coordinator](3-coordinator-events-storage-router-workflows.md). The design: [coordinator runtime](../../architecture/coordinator-runtime/README.md), [relay](../../architecture/coordinator-runtime/services/relay/README.md), [scheduler](../../architecture/coordinator-runtime/services/scheduler/README.md).

## What was built

In the commit that moves this task to `done/`.

- **Services.** `Service` (`service.ts`): `onStart(context)`, `routes`, `onStop()`, and `secrets`. The context gives a service its config (`services.<name>` in `agentx.json`), its own secrets (from the environment or `agent-x/.env.services`), the agents, the project's `publicUrl`, `stopping()`, `deliver()`, which puts an event into an agent's inbox with `agentX-Service`, and `every()`, its polling. `ServiceRunner` starts a service, runs its polling, never two runs at once, and stops it; one that fails to start is off, alone.
- **Core services**, each in its folder under `services/`: the relay (the outboxes, as before) and the scheduler, which fires nothing while the coordinator stops. Optional services are turned on in `agentx.json`; none ships yet.
- **The API server** (`api-server.ts`), owned by the coordinator. Every route, the coordinator's and each service's, declares its method, path with parameters, access and summary. Private routes need `Authorization: Bearer <AGENTX_API_TOKEN>`; public ones, `/health` and later webhooks, are open. A service's routes are under `/services/<name>/`.
- **Agent control**, as the coordinator's own routes: `GET /agents`, `POST /agents/:agent/start`, `/stop`, `/restart`, and `GET /routes`. A stopped or failed agent can be started again, and `/agents` is 200 when every agent is running or stopped.
- **Template.** `init-project` writes `agent-x/.env` and `agent-x/.env.services`, each with its keys commented out, including `AGENTX_API_TOKEN`.

## Decisions

[D66](../../architecture/coordinator-runtime/README.md#d66) services in the coordinator's process, [D67](../../architecture/coordinator-runtime/README.md#d67) polling with `every`, [D68](../../architecture/coordinator-runtime/README.md#d68) config in `agentx.json` and secrets in `.env.services`, [D69](../../architecture/coordinator-runtime/README.md#d69) routes as the API contract, [D70](../../architecture/coordinator-runtime/README.md#d70) the API token, public routes and people in the web app. [D58](../../architecture/coordinator-runtime/README.md#d58) changed: `/agents` needs the token, and a stopped agent is no fault. D60–D62 moved to the [relay](../../architecture/coordinator-runtime/services/relay/README.md), D64 to the [scheduler](../../architecture/coordinator-runtime/services/scheduler/README.md).

## Changes from the plan

- **Running the agents stayed the coordinator's own**, not a service: the agents are the core of the system, and every service waits on them at stop.
- **No `tick` and no `onRequest`.** A service polls with `context.every`, on its own interval, and declares its API as `routes`, with an access each, so the server matches, guards and lists them.
- **The API token and agent control** were added: agents are started and stopped from the server and the web app, not with Ctrl-C. People sign in to the web app, which calls with the token.
- **Secrets are not taken out of the coordinator's environment.** Agents read only `agent-x/.env`; a secret set in the environment reaches them until they run in sandboxes.
- **`publicUrl` is in `agentx.json`**, not `--public-url` on `serve`.
- **Schedules do not fire while the coordinator stops.**
- **`deliver` takes file paths**, as `deliverEvent` does.
- **The Composio webhook moved** to [Composio](../backlog/composio-service.md), with its triggers; the web app and Telegram are tasks of their own, [web app](../backlog/web-app-api.md) and [Telegram](6-telegram.md).

## Migration

- Set `AGENTX_API_TOKEN` in `agent-x/.env.services` (or the coordinator's environment), and add `agent-x/.env.services` to the project's `.gitignore`. Without the token, `/agents` and the other private routes answer 503.
- A monitor on `/agents` sends `Authorization: Bearer <token>`. An agent stopped through the API makes it 200, not 503.
- `agentx serve`'s first line names the services that are on, and `GET /routes` lists the API, in place of `(/health, /agents)`.

## Verification

- `pnpm test`, with new tests: a test service's config, public URL, own secrets, polling without overlap or failure, public and private routes, 401, 404, 405, 413, 500, `GET /routes`, and its stop after the agents; a service that fails to start is off; `deliver` with `agentX-Service`, once per key, and refused for an unknown agent; the scheduler fires nothing while stopping; `agentx serve` stops and starts an agent through the API, with the token only.
- By hand: `pnpm run check`, and every link of the docs.

## Follow-ups

- [Composio](../backlog/composio-service.md): the webhook, then the triggers.
- [The web app](../backlog/web-app-api.md): the token in the web app, its pages, and events from people.
- [Telegram](6-telegram.md), the first optional service.
- How agents' answers get back to the web app and Telegram, settled in those tasks.

## Original plan

### How the coordinator works today

Not as loops, the way the [AgentSupervisor](../../architecture/agent-runtime/supervisor/README.md) runs its three. The [coordinator](../../architecture/coordinator-runtime/README.md) has:

- **An `AgentManager` per agent**, each with its own timers: a heartbeat check every 5 s, and a backoff before a restart.
- **One round each second**, a `setInterval`: every agent's `Scheduler.tick()`, then `deliverOutbox()` for every agent. Synchronous; a throw is logged per agent and the next round tries again.
- **An HTTP server** with two fixed `GET` routes, `/health` and `/agents`. It reads no request body.
- **Stopping:** the agents drain, the round goes on meanwhile, then one more delivery, then the server closes.

Each part is wired into `coordinator.ts` by hand. What is planned, webhooks from external services, [Composio triggers](../backlog/composio-service.md), Telegram, polling and an API for the web app, needs the same things: setting up at start, work on a timer, HTTP routes, a clean stop, and a way to put events into inboxes. This task gives them one contract, moves the built parts onto it, and adds Composio's webhook.

### The Service class

A service does two kinds of work: work it starts itself, on a timer, such as the relay taking outboxes or a poller reading a feed; and work a request starts, such as a webhook. `context.every` is for the first, a route in its `routes` for the second. A service needs either, both or neither.

The class and its types are built: `src/coordinator-runtime/service.ts`, described in the [coordinator's doc](../../architecture/coordinator-runtime/README.md#services), with `publicUrl` from `agentx.json` in the context. The Composio webhook adds to it:

```ts
	/** Puts an event into the agent's inbox, with `deliverEvent`, and `agentX-Service: <name>` in its facts. Its key makes a repeat add nothing. */
	deliver(agent: string, event: NewEvent & { key: string }, files?: string[]): void;
```

### How the coordinator runs them

1. **Config.** `agentx.json` holds each service's config under `services`. A core service is always on, with its config if any; an optional one is on when it is listed there:

   ```json
   "services": {
   	"composio": {},
   	"telegram": { "agents": { "main": "TELEGRAM_BOT_TOKEN_MAIN" } }
   }
   ```

   A name agentx has no service for is an error, and is skipped.
2. **Start.** Each service's `onStart`, in order: the core services, then the optional ones. One that throws is off: `serve` logs why, and starts the others, the agents and the server all the same. A service that is off stays off until `serve` starts again. Then the agents start, without any service's secrets in their environment, and the server listens. `serve` says which services are on and which are off.
3. **Polling.** The work each service started with `context.every`, on its own interval.
4. **Requests.** `GET /health` and `GET /agents` are the coordinator's own, for the host. `/services/<name>/...` goes to that service's route, with the body, read up to 1 MB (413 over it). Any other path: 404.
5. **Stop.** The agents drain, or stop with `force`, while every service still works. Then each service, in the reverse of the start order: its `every` work ends, a run in progress is awaited, and its `onStop` runs. Then the server closes. The relay starts first, so it stops last, and its `onStop` is the last delivery of what the agents sent on their way out. A webhook that comes during the drain still reaches the inbox.

Running the agents stays the coordinator's own, not a service: it is the one part that every service waits on at stop, and the agents will run apart from it, in sandboxes.

Delivering is not a service either. `deliverEvent` stays the one function that writes an inbox. An optional service reaches it only through `context.deliver`; a core service may use the coordinator runtime's functions, as the relay needs `prepareDelivery` to set the sender's facts.

### Where they live

One folder per service:

```
src/coordinator-runtime/
  coordinator.ts       runs the agents and the services: config, start, routes, stop
  service.ts           class Service and its types; context.every
  agent-manager.ts     one agent's process
  deliver-event.ts     deliverEvent: the only code that writes an inbox
  services/
    services.ts        the core services, in order, and the optional ones, by name
    relay/             core: events between agents, from outboxes into inboxes
    scheduler/         core: each agent's schedules
    composio/          core: Composio's webhook, and each agent's triggers
    telegram/          optional
```

Their docs: `docs/architecture/coordinator-runtime/services/<name>/README.md`, one per service.

### Core services

Always on, in this order:

| Service | `onStart` | `every` | `routes` | `onStop` |
|---|---|---|---|---|
| `relay` | | 1 s: each agent's outbox into the inboxes it names, as `deliverOutbox` does today | | one last delivery |
| `scheduler` | | 1 s: each agent's `Scheduler.tick`, as today | | |
| `composio` | checks its secret; makes each agent's triggers match ([Composio triggers](../backlog/composio-service.md)) | 5 s: matches again when an agent's trigger file changes | `POST webhook`, access `public` | |

The relay and the scheduler move with no change in behavior. The scheduler keeps its one-second check, not a timer per schedule: a cron job per schedule would fire at the exact millisecond, not up to a second late, but the files must still be polled for changes ([D64](../../architecture/coordinator-runtime/services/scheduler/README.md#d64)), and each change would mean stopping and making timers again, with catch-up and `fireOnce` handled apart from them. The check costs three file reads of metadata per agent per second.

### A webhook

How a service, core or optional, takes an external service's webhook in a route with access `public`, which the API token does not guard:

1. **Checks** the request is from the service, by its signature or token over the raw body. Not: 401.
2. **Turns** it into events, each for one agent of the project, found from the agents' checked-in settings, never from anything an agent writes; none for a request to ignore. An event for an agent the project does not have is dropped with a log line.
3. **Delivers** each with `context.deliver`, with no thread, `source: <service name>` in its metadata, and the service's own id for the delivery as its key, so a delivery sent again is added once ([D50](../../architecture/agent-runtime/events/README.md#d50)). A large payload goes in as a file the content names, not text the model reads. The agent need not be running; the router decides what the event becomes.
4. **Answers** 200 once every event is in its inbox, and 503 if one cannot be written, so the service sends again. A throw answers 500, with a log line; the service sends again too.

### The Composio service

Composio's triggers cover many services through one webhook, so it is a core service: on whenever its secret is set. This task builds its webhook; [Composio triggers](../backlog/composio-service.md) adds the making of triggers to the same service, which shares the trigger ids it gets back with the webhook in memory.

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

### Optional services

Built into agentx, each in its folder in `services/`, and off until the project lists them, with their config, under `services` in `agentx.json`. Each is a task of its own, on this contract:

- **Telegram**, for a service Composio has no triggers for: its config names each agent's bot token by its variable; `onStart` points each bot at `<public url>/services/telegram/<agent>`, and its webhook route checks Telegram's secret token header and turns each update into an event keyed by its `update_id`, with the chat and message in its metadata.
- Later: polling services, such as a feed, with `context.every`; an API for the web app, such as `POST /services/web/agents/<agent>/events`.

### Picks

- **Services run in the coordinator's process, not each in its own.** They ship with agentx, so they are trusted as the coordinator is, and they mostly wait on files and the network. A process per service would isolate its crashes and its secrets, but needs requests forwarded to it, a way to deliver, and restarts like an agent's. A service that needs that later can start its own child in `onStart`; the contract does not change.
- **A service's path is its name**, `/services/<name>/`, and the service routes the rest itself. Two services never claim one path, and no route table is needed.
- **Every service under `/services/`.** A reverse proxy can make `/services/` public, for webhooks, and keep `/health` and `/agents` for the host.
- **Polling through `context.every`, not a `setInterval` of the service's own, nor a `tick` the coordinator calls each second.** Each service picks its interval, as with its own timer; the coordinator still stops every run, never overlaps one, and catches its errors, which a timer of the service's own would have to do each time, and where an unhandled rejection would stop the coordinator and every agent with it.
- **A service's config is `services.<name>` in `agentx.json`**, the project's config, read once when `serve` starts, checked in. Listing an optional service turns it on. No file of its own.
- **A service that fails to start is off, and nothing else is.** The agents and the other services run; `serve` says why. A service whose config or secrets are wrong is fixed by starting `serve` again.
- **Secrets in `agent-x/.env.services`**, read only by the coordinator, besides its own environment. A service gets only the ones it names. `agentEnv` reads only `agent-x/.env`, so it needs no list of what to leave out; a secret the host sets in the coordinator's environment reaches the agents until they run in sandboxes.
- **Duplicates are caught by the event's key** when the router takes it from the inbox, not by a list of seen ids in the coordinator. The key survives a restart of the coordinator and needs nothing new.
- **No config writes.** A service changes nothing checked in: design goal 2, and `agentx.json` is read once. State a service needs to keep goes into memory or, when one needs it, a file under `agent-x/storage/`.

### Plan

1. `Service` and its types, in `src/coordinator-runtime/service.ts`.
2. The coordinator runs the agents and the services: config, start, `every`, routes, stop. The server takes any method and reads the body. `publicUrl` in `agentx.json`.
3. The relay and the scheduler as core services in `services/`, with no change in behavior. The tests of `serve` pass unchanged.
4. Secrets: `agent-x/.env.services`, gitignored, which `init-project` writes with `agent-x/.env`.
5. The Composio service's webhook.
6. **Tests**, with a test service and Composio events the test signs with `node:crypto` and a secret of hex text:
   - a service's `onStart`, its `every` runs, a request to its path and its `onStop` come in that order, and `onStop` waits for the agents;
   - an `every` run that rejects is logged and the next runs; a slow run is not overlapped;
   - a service whose `onStart` throws is off, 404, and the agents and the other services run;
   - a request to an unknown service is 404, and a body over 1 MB is 413;
   - a service's secret is not in another service's `secrets`;
   - a service gets `services.<name>` of `agentx.json` as its config; an unknown name is skipped;
   - an event for the second of two agents is added to that agent's events, and its router sends it to `main`, with its file in the inbox folder;
   - the same key twice adds one event;
   - a wrong or old signature gets 401 and adds nothing; an unknown Composio user id gets 200 and adds nothing;
   - an event that arrives while the agent drains, or is stopped, waits in its inbox and is routed after the next start.
7. **Check against Composio by hand**, through `serve`: a Gmail trigger made for an agent's user id, the subscription pointed at a tunnel to `serve`, and an email that reaches the agent's router.
8. **Docs.** The coordinator's doc (services, their config, `every`, the routes, stopping) and a doc per service, with their decisions; the project doc (`services` in `agentx.json`, `.env.services`); the modules table and lifecycles in `high_level_design.md`; a user guide, *Receive webhooks*:
   - A service's config, and turning an optional service on, in `agentx.json`.
   - Composio: set the Composio project's webhook to `https://<host>/services/composio/webhook`, version V3, event `composio.trigger.message`, and copy its secret into `COMPOSIO_WEBHOOK_SECRET` in `agent-x/.env.services`. Use one Composio project per environment, because a project has one URL. Locally, forward events with Composio's CLI, `COMPOSIO_WEBHOOK_SECRET=<its value> composio dev triggers listen --forward http://localhost:3100/services/composio/webhook`, logged in to the agents' Composio project; or use a tunnel (cloudflared, ngrok) with a Composio project of one's own.

Then [Composio triggers](../backlog/composio-service.md), and Telegram.

### To decide

- **Answers back to the web app and Telegram.** An agent sends to `service:<name>` through its outbox, and the relay hands the event to a `receive` hook on the service, which sends it on; or each such service gives the agent a tool of its own. Settled with Telegram.

### Known limits

- Until sandboxes, an agent can read a service's secret the way it reads any file of its OS user, such as `agent-x/.env.services`, and with it forge events; it can also write any agent's inbox.
- Events can be lost while the coordinator is down for longer than a service keeps sending them again.
- A request that makes no event, for an unknown agent or an ignored type, shows only in the coordinator's log.

### Not in this plan

- Composio's triggers, and its other events (`composio.trigger.disabled`, `composio.connected_account.expired`, `composio.connected_account.activated`): [Composio triggers](../backlog/composio-service.md).
- Telegram and the other optional services: each a task of its own.
- Services from the project's own modules. The contract allows it later: a module path in a service's config.
- Starting, stopping or adding a service while `serve` runs.

### Decisions to record when built

- The coordinator runs the agents and a list of services with one contract, in its own process: core services always on, optional ones turned on in `agentx.json`, each with its config there.
- A service polls with `context.every`; services stop after the agents, in the reverse of the start order.
- A service that fails to start is off; the coordinator and everything else start.
- A service answers under `/services/<name>/`; `/health` and `/agents` are the coordinator's own.
- A service's secrets stay in the coordinator, in `agent-x/.env.services`, and each service gets only its own.
- A webhook service finds an event's agent from the agents' checked-in settings, and delivers it to the inbox keyed by the service's delivery id.
