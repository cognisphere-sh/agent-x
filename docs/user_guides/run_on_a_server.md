# Run a project on a server

On a server, the app and the agents run side by side as two services:

| Service | Command, from the project root | Port |
|---|---|---|
| The app | `pnpm --dir web start` (`next start`) | 3000 |
| The agents | `node agent-x/node_modules/agent-x/dist/cli/agentx.js serve` | 3100 |

`agentx serve` runs every agent that `agent-x/agentx.json` lists, restarts an agent that stops, delivers what the agents send, and fires their schedules. To add or remove an agent, start it again.

Start the pinned agentx directly, as above, so no package manager sits in between and `agentx serve` gets the stop signal itself.

## Health and control

Set `AGENTX_API_TOKEN` in `agent-x/.env.services`, and give it to the web app's server. Every route but `/health` needs it, as `Authorization: Bearer <token>`.

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

Every agent's state, its sessions, queue, mailboxes and what it learned, is in `agent-x/storage/`, a folder per agent. Keep that folder across deploys, for example as a persistent volume, and back it up; everything else comes from git. `agentx serve` makes each agent's `storage` link when it is missing.

## Keys

The agents get the environment `agentx serve` was started with, plus `agent-x/.env`; a variable in the environment wins. On a server, set keys such as `COMPOSIO_API_KEY` in the service's environment.

The coordinator's own services, such as a webhook, take their secrets from that environment or `agent-x/.env.services`, which no agent reads. Until agents run in sandboxes, a secret set in the environment reaches the agents' processes too, so prefer `agent-x/.env.services` for them. Set `publicUrl` in `agent-x/agentx.json` to the address the API server is reached at from outside, for services that register webhooks.
