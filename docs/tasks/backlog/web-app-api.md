---
name: web-app-api
title: Let the web app control agents and talk to them through the coordinator's API
description: The project's web app signs people in and calls the coordinator's private routes with the API token, to show and control the agents and to send them events; how answers come back is settled here.
type: feature
priority: none
status: idea
modules: [coordinator-runtime, cli/project]
created: 2026-11-15
updated: 2026-11-15
---

# Let the web app control agents and talk to them through the coordinator's API

The coordinator's [API server](../../architecture/coordinator-runtime/README.md#the-api-server) has private routes to read and control the agents, and the web app (`web/`) is where people will use them. People sign in to the web app, never to the coordinator ([D70](../../architecture/coordinator-runtime/README.md#d70)): the web app's server calls the coordinator with `AGENTX_API_TOKEN`, and the browser never holds it.

## The idea

- **The token** is in the web app's server environment, such as `web/.env`, and `init-project` writes a placeholder for it there, as for `agent-x/.env.services`. The web app's route handlers call the coordinator at its address, such as `http://127.0.0.1:3100`.
- **Agents.** A page lists the agents from `GET /agents`, and starts, stops and restarts them with `POST /agents/:agent/start`, `/stop` and `/restart`.
- **Events from people.** A new private route, such as `POST /agents/:agent/events`, delivers what a person sends, with `deliverTo`, as `agentx event deliver` does. The web app names the person who sent it in a header, which the coordinator trusts because the call carries the token, and the coordinator puts it in a harness fact, such as `agentX-FromUser`, so no sender can claim it.
- **The API's list.** `GET /routes` tells the web app what the coordinator and its services offer.

## To decide

- **How answers get back to the web app.** The agent's text is not seen by anyone under `agentx run`. Either the agent sends its answer to a service through its outbox, which the relay hands to the service (a `receive` hook), and the web app reads it, such as through a stream; or the web app reads the agent's sessions.
- **Who may do what.** Whether every signed-in person may control every agent, or the web app keeps roles.
- **Where the web app finds the coordinator** in a deployment: its address in the web app's environment.

## Not in this plan

- Signing people in: the web app's own choice, such as Auth.js.
- Running the web app and the coordinator on different machines, beyond the address and the token.
