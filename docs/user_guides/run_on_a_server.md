# Run a project on a server

On a server, the app and the agents run side by side as two services:

| Service | Command, from the project root | Port |
|---|---|---|
| The app | `pnpm --dir web start` (`next start`) | 3000 |
| The agents | `node agent-x/node_modules/agent-x/dist/cli/agentx.js serve` | 3100 |

`agentx serve` runs every agent that `agent-x/agentx.json` lists, restarts an agent that stops, delivers what the agents send, and fires their schedules. To add or remove an agent, start it again.

Start the pinned agentx directly, as above, so no package manager sits in between and `agentx serve` gets the stop signal itself.

## Health and control

Set `AGENTX_API_TOKEN` in `agent-x/.env`, and give it to the web app's server. Every route but `/health` needs it, as `Authorization: Bearer <token>`.

| Route | Answers |
|---|---|
| `GET /health` | 200 while `agentx serve` runs; no token. Point the host's health check here. |
| `GET /agents` | Each agent's state (`starting`, `running`, `restarting`, `failed`, `stopping`, `stopped`), its restarts and how its last process ended. 200 when every agent is `running` or `stopped`, 503 otherwise. Point a monitor that alerts a person here, with the token. |
| `POST /agents/<agent>/stop`, `/start`, `/restart` | Stops an agent once its running work is done, starts it, or both. For the web app's controls. |
| `GET /routes` | Every route, the services' too. |

An agent whose process stops is started again after 1 s, then 2, 4, up to a minute. One that stops 5 times without running 10 minutes in between is `failed` until it is started again with `POST /agents/<agent>/start`, or `agentx serve` starts again. One that stops writing its heartbeat for a minute is killed and started again.

`agentx serve` listens on `127.0.0.1:3100` (`--host`, `--port`), in plain HTTP. It needs no public address: keep it for the host and the web app, and put a reverse proxy such as Caddy or nginx in front of the app for TLS. When a service takes webhooks, forward only its webhook paths, `/services/<name>/...`, from the internet.

The host keeps both services running, with systemd's `Restart=` or Docker's restart policy.

## Stopping without losing work

The first `SIGINT` or `SIGTERM` lets every agent finish its running work, then `agentx serve` exits 0. A second one stops the work at once. Events that arrive meanwhile wait in the inboxes.

A stop drains only if the signal reaches `agentx serve` alone, and the host waits long enough:

- **systemd** signals every process of the service at once by default, which aborts each run. Set `KillMode=mixed`, and `TimeoutStopSec` to the longest you will wait.
- **Docker** signals the container's first process and waits `stop_grace_period`. Set `init: true`.

Every interruption costs the events in flight an attempt; an event fails after three. If `agentx serve` is killed, the agents' processes end with it.

## Agents' state

Every agent's state, its sessions, queue, mailboxes and working files, is in `agent-x/storage/`, a folder per agent. Keep that folder across deploys, for example as a persistent volume, and back it up; everything else comes from git. `agentx serve` makes each agent's `storage` link when it is missing.

What an agent learns goes into its `.pi/knowledge/`, which is checked in ([customize an agent](customize_an_agent.md#what-the-agent-learns)). On a server, commit and push what the agent wrote there before a deploy replaces the checkout, or it is lost.

## Keys

Each agent gets the environment `agentx serve` was started with, plus its own `agent-x/agents/<name>/.env`; a variable in the environment wins. On a server, set an agent's keys, such as `COMPOSIO_API_KEY`, in its `.env`, or in the service's environment for every agent.

The coordinator and its services, such as a webhook, take their secrets from that environment or `agent-x/.env`, which no agent reads. Until agents run in sandboxes, a secret set in the environment reaches the agents' processes too, so prefer `agent-x/.env` for them. Set `publicUrl` in `agent-x/agentx.json` to the address the API server is reached at from outside, for services that register webhooks.

## Composio's events

An agent can get an event each time one of its Composio triggers fires, such as a new email in its Gmail. Composio sends every trigger event of a Composio project to one webhook, and `agentx serve` delivers each to the agent whose Composio user id the trigger was made for ([Composio service](../architecture/coordinator-runtime/services/composio/README.md)).

1. In Composio's dashboard, set the project's webhook to `https://<host>/services/composio/webhook`, version V3, with the event `composio.trigger.message`. Forward that path from the internet to `agentx serve`.
2. Copy the webhook's signing secret into `agent-x/.env`: `COMPOSIO_WEBHOOK_SECRET=...`, and start `agentx serve` again. Without it, `agentx serve` logs `Service "composio" is off`.
3. Make triggers for the agent's user id, `agentx.composio.userId` in its `.pi/settings.json`, with Composio's CLI (`composio dev triggers create`) or API, on an account the agent has connected.

Each event reaches the agent's router with `source: composio`, the trigger's slug in `trigger`, and the event's data in the file `data.json`; route it as any event ([send events](send_events.md)). An event Composio sends again is added once.

Use one Composio project per environment: a project has one webhook URL. On a laptop, forward events with Composio's CLI, logged in to the agents' Composio project: `COMPOSIO_WEBHOOK_SECRET=<its value> composio dev triggers listen --forward http://localhost:3100/services/composio/webhook`; or use a tunnel, such as cloudflared or ngrok, with a Composio project of your own.

## Telegram

An agent can have a Telegram bot: people in the chats you list write to it, and it answers there ([Telegram service](../architecture/coordinator-runtime/services/telegram/README.md)).

1. Make a bot with [@BotFather](https://t.me/BotFather) for each agent, and put its token in `agent-x/.env` as `TELEGRAM_BOT_TOKEN_<AGENT>`, such as `TELEGRAM_BOT_TOKEN_MAIN` for `main`. Each agent needs a bot of its own.
2. In `agent-x/agentx.json`, set `publicUrl` and list the agent with its chats:

   ```json
   "publicUrl": "https://agents.example.com",
   "services": { "telegram": { "agents": { "main": { "chats": [123456789] }, "support": { "chats": [-1001234567890] } } } }
   ```

   A private chat's id is the person's Telegram user id; a group's is negative. In a group, the bot gets only commands and replies to it, unless you turn its privacy mode off with @BotFather's `/setprivacy`. A message from a chat not listed is dropped, and its id is in `agentx serve`'s log, so to find a chat's id, write to the bot and read the log.
3. Forward `/services/telegram/` from the internet to `agentx serve`, and start it again. It points the bot's webhook at `<publicUrl>/services/telegram/<agent>`; it logs `Service "telegram" is off` and why when it cannot.
4. So the agent can answer, give the coordinator a Composio key: in Composio's dashboard (Settings, API Keys), make a key for the agents' project with **Auth configs** and **Connected accounts**, read and write, and put it in `agent-x/.env` as `COMPOSIO_COORDINATOR_API_KEY`. At each start, `agentx serve` connects each bot in Composio for its agent's user id; it logs why when it cannot, and messages still come in. The agents also need their own `COMPOSIO_API_KEY`, each in its `.env` ([External services](customize_an_agent.md#external-services-composio)); keep that one a session-only key.

Each message reaches the agent's router with `source: telegram`, its chat in `chat` and its sender in `from`, with the photos and files it carries in the event's folder. When the agent asks a question with buttons, a tap reaches it the same way, with the button's text as content and the button in `button`, and the buttons leave the question with the choice written under it.

## Webhooks

An agent can give an outside service a URL to call when something happens, such as Retell when a call ends, and each request runs one of the agent's workflows. The agent makes and keeps these webhooks itself, with `agentx webhook`, and sets each URL at the service with its Composio tool ([webhooks service](../architecture/coordinator-runtime/services/webhooks/README.md)). Until you turn the service on, the agent's `agentx webhook create` refuses and says what to set.

1. In `agent-x/agentx.json`, set `publicUrl` and turn the service on:

   ```json
   "publicUrl": "https://agents.example.com",
   "services": { "webhooks": {} }
   ```

2. Forward `/services/webhooks/` from the internet to `agentx serve`, and start it again. Without `publicUrl`, it logs `Service "webhooks" is off`.

Ask the agent for a webhook in plain words, such as "tell me each time a Retell call ends": it writes the workflow, makes the webhook and sets its URL in Retell. `agentx webhook list`, in the agent's directory, shows its webhooks and each one's last request; each has a log in `storage/workspace/webhook-logs/`.

A webhook's URL holds a random token, its only check: anyone who has the URL can call it, and the agent's workflow fetches what a request names from the service before it acts. A webhook takes only POST, up to 1 MB, and answers 200 with JSON, so a service that waits for another answer, such as a handshake or TwiML for a call, cannot use one. On a laptop, use a tunnel, such as cloudflared or ngrok, and set `publicUrl` to its address.
