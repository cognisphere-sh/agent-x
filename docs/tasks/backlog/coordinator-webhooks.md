---
name: coordinator-webhooks
title: Bring webhook events to agents through installable services
description: The coordinator serves webhooks for the services a project installs, each a module that checks a request and turns it into events for agents; Composio's triggers are the default service, and services Composio has no triggers for get their own module.
type: feature
priority: none
status: idea
modules: [coordinator-runtime, agent-runtime/events, agent-runtime/agent, cli/project]
created: 2026-11-13
updated: 2026-11-14
---

# Bring webhook events to agents through installable services

External services reach agents through the [coordinator](../../architecture/coordinator-runtime/README.md), never directly. A service, such as Composio or Telegram, calls a webhook on the coordinator's HTTP server. The service's own code checks the request and turns it into events, each for one agent. The coordinator puts each event into that agent's inbox, and the agent's router decides what it becomes ([events](../../architecture/agent-runtime/events/README.md)).

Services are modules, and the project's developer chooses which to install. Composio is the default: its triggers cover many services through one webhook. A service Composio has no triggers for gets a module of its own. Making Composio's triggers is a separate task, [Composio triggers](composio-triggers.md).

## A service module

An ES module whose default export is:

```ts
interface WebhookService {
	/** Environment variables the service needs, such as its signing secret. The coordinator keeps them out of every agent. */
	secrets: string[];
	/** Checks the request is from the service: its signature or token. False answers 401. */
	verify(request: WebhookRequest, env: NodeJS.ProcessEnv): boolean;
	/** The events the request carries, each for one agent of the project; none for a request to ignore. */
	events(request: WebhookRequest, project: ProjectAgents): WebhookEvent[];
	/** Optional: points the service at the webhook's public URL, when `serve` starts. */
	register?(url: string, env: NodeJS.ProcessEnv, project: ProjectAgents): Promise<void>;
}

interface WebhookRequest { path: string[]; headers: Record<string, string>; body: Buffer }
/** Each agent's name and the `agentx` section of its checked-in settings, so a service can find the agent an event is for. */
type ProjectAgents = { agent: string; settings: Record<string, unknown> }[];
interface WebhookEvent { agent: string; key: string; content: string; metadata: Record<string, string>; files?: Record<string, Buffer> }
```

`key` is the service's own id for the delivery, so a delivery sent again is added once ([D50](../../architecture/agent-runtime/events/README.md#d50)). `files` go into the event's inbox folder, so a large payload is a file the content names, not text the model reads.

## Installing a service

- `agent-x/webhooks.json` lists the project's services: `{ "<name>": "<module>" }`. The name is the route, `POST /webhooks/<name>/...`; the module is resolved from `agent-x/`, so it is a package installed in `agent-x/package.json` or a path.
- agentx ships the Composio service as `agent-x/webhooks/composio`. `init-project` writes `webhooks.json` with it, so it is on by default; deleting the line turns it off.
- A service needs its secrets in the coordinator's environment or `agent-x/.env`. Without them its route answers 404, and `serve` says at start which services are on and which are off and why.
- A service decides how it finds the agent. It reads the agent's settings, never anything the agent writes.

## What the coordinator does

1. **The route** `POST /webhooks/<name>/...` loads the service's module once, when `serve` starts. A module that does not load or has the wrong shape is off, and `serve` says why.
2. **Checks** the request with `verify` over the raw body. False: 401. The body is limited to 1 MB.
3. **Turns** it into events with `events`. An event for an agent the project does not have is dropped with a log line.
4. **Delivers** each event into its agent's inbox as a mailbox entry ([events](../../architecture/agent-runtime/events/README.md#mailboxes)), with no thread, the key, and `source: <service name>` and `agentX-Webhook: <service name>` in its facts, so no sender can claim a webhook sent it. The answer is 200 once every event's marker is in its inbox, and 503 if one cannot be written, so the service sends again. The agent need not be running.
5. **Errors** thrown by the module answer 500, with a log line; the service sends again.
6. **Registers**, when `serve` has `--public-url`: it calls each service's `register` with `<public url>/webhooks/<name>`, and logs a failure without stopping.
7. **Keeps secrets out of agents.** The `AgentManager` leaves every service's `secrets` out of the agent's process, and `agentEnv` leaves them out of what Pi, the router and workflows get from `agent-x/.env`.

## The Composio service

From Composio's docs, and a check on 2026-11-13 with a Gmail trigger, a webhook subscription to a local listener, and one email:

- **One subscription per Composio project**, with a URL, a payload version (`V3`), the event types to send, and a signing secret of 64 hex characters, which every read of the subscription returns. A trigger can send to its own URL instead (`egress_url`), but it is still signed with the project's secret.
- **The event:** `{ "id": "msg_…", "timestamp", "type": "composio.trigger.message", "metadata": { "trigger_slug", "toolkit_slug", "trigger_id", "connected_account_id", "auth_config_id", "user_id", "log_id" }, "data": { … } }`. `metadata.user_id` is the Composio user id the trigger was made for, and each agent has its own ([D38](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d38)). The docs allow it to be `null`; it was set in every event of the check. An email that two triggers match makes two events.
- **Signature:** headers `webhook-id` (the event's `id`), `webhook-timestamp` (seconds) and `webhook-signature: v1,<base64>`; Composio's SDK also accepts several, separated by spaces. The value is base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the secret's text as it is: in the check, neither its hex nor its base64 decoding matched. Composio's SDK refuses a timestamp more than 300 s off.
- **At least once.** Any 2xx counts as delivered. After a 500, the same `webhook-id` came again 2 s later, with `x-composio-delivery-attempt: 2`. The docs give no schedule for later attempts.
- **Size.** A Gmail event holds the raw message (`data.payload`) as well as its text: 58 KB for an ordinary email.

So the service:

- `secrets`: `COMPOSIO_WEBHOOK_SECRET`, the name Composio's CLI uses too.
- `verify`: the signature as above, any `v1` value may match, the timestamp within 300 s.
- `events`: one event for the agent whose `agentx.composio.userId` equals `metadata.user_id`, never from parsing the id ([D38](../../architecture/agent-runtime/pi/pi-package/composio/README.md#d38)). Its key is `webhook-id`; `data` is the file `data.json`; its content is short markdown that names the trigger's slug and the file; its metadata is `trigger`, the trigger's slug, `trigger-id`, `account` (the connected account's id) and `event-time`. No such agent, `user_id` null, or a type other than `composio.trigger.message`: no events, and 200, so Composio does not send again what will never be delivered.
- No `register`: the subscription is set once, by hand, per Composio project.

## Plan

1. The `WebhookService` contract, in `src/coordinator-runtime/`, exported for service packages.
2. The route, loading `webhooks.json`, delivery to inboxes, and the answers, in the coordinator; `--public-url` on `serve`.
3. The Composio service, as `agent-x/webhooks/composio`; `init-project` writes `webhooks.json` with it.
4. Secrets kept out of agents, in the `AgentManager` and `agentEnv`.
5. **Tests**, with a test service module (a fixed token, two agents by path) and Composio events the test signs with `node:crypto` and a secret of hex text:
   - an event for the second of two agents is added to that agent's events, and its router sends it to `main`, with its file in the inbox folder;
   - the same key twice adds one event;
   - a wrong or old signature gets 401 and adds nothing;
   - an unknown Composio user id gets 200 and adds nothing;
   - a service without its secret is off, 404, and `serve` says so; a module that does not load is off;
   - a module that throws gets 500;
   - a service's secret is not in the agent's environment;
   - an event that arrives while the agent drains, or is stopped, waits in its inbox and is routed after the next start.
6. **Check against Composio by hand**, through `serve`: a Gmail trigger made for an agent's user id, the subscription pointed at a tunnel to `serve`, and an email that reaches the agent's router.
7. **Docs.** The coordinator's doc (the route, the contract, and their decisions), the agent's doc (the variables kept out), the project doc (`webhooks.json`), the flows in `high_level_design.md`, and a user guide, *Receive webhooks*:
   - Turning a service on or off in `webhooks.json`, and installing one from a package.
   - Writing a service module.
   - Composio: set the Composio project's webhook to `https://<host>/webhooks/composio`, version V3, event `composio.trigger.message`, and copy its secret into `COMPOSIO_WEBHOOK_SECRET`. Use one Composio project per environment, because a project has one URL. Locally, forward events with Composio's CLI, `COMPOSIO_WEBHOOK_SECRET=<the value in agent-x/.env> composio dev triggers listen --forward http://localhost:3100/webhooks/composio`, logged in to the agents' Composio project; or use a tunnel (cloudflared, ngrok) with a Composio project of one's own.

## To decide

- **Where a service runs:** in the coordinator's process (pick), or in a child process per request. The developer installs it, as they install agentx, so it is trusted as the coordinator is; a child process would cost a start per request.
- **Composio: one endpoint that routes by user id** (pick), or one per agent through each trigger's `egress_url`. Every trigger is signed with the project's one secret, so a path per agent proves nothing.
- **Duplicates caught by the event's key** (pick), when the router takes it from the inbox, or a list of seen ids in the coordinator. The key survives a coordinator restart and needs nothing new.

## Known limits

- Until sandboxes, an agent can read a service's secret the way it reads any file of its OS user, such as `agent-x/.env`, and with it forge events; it can also write any agent's inbox.
- Events can be lost while the coordinator is down for longer than the service keeps sending them again.
- A request that makes no event, for an unknown agent or an ignored type, shows only in the coordinator's log.

## Not in this plan

- Services other than Composio, such as Telegram: each is a module of its own, a task of its own, built when Composio has no triggers for it.
- Messages from the web app, such as `POST /agents/<agent>/messages`: how the app talks to agents is still open ([project](../../architecture/cli/project/README.md#not-decided-yet)).
- Composio's other events (`composio.trigger.disabled`, `composio.connected_account.expired`, `composio.connected_account.activated`): [Composio triggers](composio-triggers.md).
- Polling, which reaches agents through the coordinator the same way, later. Schedules are built ([coordinator](../../architecture/coordinator-runtime/README.md#schedules)).

## Decisions to record when built

- External services reach agents through webhook services, modules the project installs in `agent-x/webhooks.json`; Composio is the default.
- A service checks its own requests and finds the agent from the agents' checked-in settings; the coordinator delivers to the inbox, keyed by the service's delivery id.
- A service's secrets stay in the coordinator.
