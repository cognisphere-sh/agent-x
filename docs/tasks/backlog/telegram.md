---
name: telegram
title: Connect agents to Telegram through an optional coordinator service
description: An optional coordinator service gives agents Telegram bots: it registers each bot's webhook, checks Telegram's secret token, and delivers each message to the bot's agent; how the agent answers is settled here.
type: feature
priority: none
status: idea
modules: [coordinator-runtime/services/telegram, agent-runtime/agent]
created: 2026-11-15
updated: 2026-11-15
---

# Connect agents to Telegram through an optional coordinator service

Telegram has no Composio triggers, so it gets a [coordinator service](../done/4-coordinator-services.md) of its own: an optional one, `src/coordinator-runtime/services/telegram/`, on when `agentx.json` lists it under `services`.

## The idea

- **Config.** `services.telegram` in `agentx.json` names each agent's bot by the variable that holds its token, such as `{ "agents": { "main": "TELEGRAM_BOT_TOKEN_MAIN" } }`. The tokens are in `agent-x/.env.services`, with a secret of the service's own for Telegram's `secret_token`.
- **`onStart`** calls Telegram's `setWebhook` for each bot, with `<publicUrl>/services/telegram/<agent>` and the `secret_token`. Without `publicUrl` in `agentx.json`, or with a token Telegram refuses, it throws, and the service is off.
- **The route**, `POST <agent>`, public, checks the `X-Telegram-Bot-Api-Secret-Token` header, and delivers each update with `context.deliver`: keyed by its `update_id`, so an update Telegram sends again is one event, with the chat, the message and the sender in its metadata.
- **The agent** tells a message from Telegram by `agentX-Service: telegram` and that metadata, and its router decides which thread takes it.

## To decide

- **How the agent answers.** A Pi extension with a tool that sends to a chat, with the bot's token kept out of the agent until sandboxes; or the agent sends its answer to `service:telegram` through its outbox, and the relay hands it to the service, which sends it. The second keeps the token in the coordinator, and is the same answer the [web app](web-app-api.md) needs.
- **Who may talk to the bot**: anyone, or the chats `services.telegram` lists.
- **Files** people send: downloaded by the service into the event's folder, or left as Telegram's file ids.

## Not in this plan

- Other chat services, such as Slack: Composio has triggers for some of them ([Composio](composio-service.md)).
