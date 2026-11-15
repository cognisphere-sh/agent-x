---
name: telegram
title: Connect agents to Telegram through an optional coordinator service
description: An optional coordinator service gives agents Telegram bots: it registers each bot's webhook, checks Telegram's secret token, and delivers each message to the bot's agent; how the agent answers is settled here.
type: feature
priority: none
status: done
modules: [coordinator-runtime, coordinator-runtime/services/telegram, agent-runtime/pi/pi-package]
created: 2026-11-15
updated: 2026-11-15
---
# Connect agents to Telegram through an optional coordinator service

Built on 2026-11-15, on the [coordinator's services](4-coordinator-services.md). The design: [Telegram service](../../architecture/coordinator-runtime/services/telegram/README.md).

## What was built

In the commit that moves this task to `done/`.

- **The Telegram service**, `src/coordinator-runtime/services/telegram/telegram.ts`, optional, on when `services.telegram` is in `agentx.json`. `onStart` sets each listed agent's bot webhook; its route, `POST /services/telegram/:agent`, public, checks the bot's secret token, drops a message from a chat the agent does not list, downloads the message's files, and delivers it keyed by `update_id`.
- **Secrets by prefix.** A service's `secrets` entry that ends with `*` takes every variable that starts with it, so each agent's bot token is `TELEGRAM_BOT_TOKEN_<AGENT>`.
- **Harness prompt.** An event with `agentX-Service: telegram` is a person's message; the agent answers in its chat with Composio's Telegram tools.
- **Template and guide.** `TELEGRAM_BOT_TOKEN_MAIN`, commented out, in `agent-x/env.services`; *Telegram* in [run on a server](../../user_guides/run_on_a_server.md#telegram).

## Decisions

[D72](../../architecture/coordinator-runtime/services/telegram/README.md#d72): messages come in through the service, and the agent answers with Composio's Telegram tools.

## How the open questions were settled

- **How the agent answers:** with Composio's Telegram tools, through the same bot connected to its Composio user id, neither of the two options the plan named. It needs no new path from an agent to a service.
- **Who may talk to the bot:** only the chats `services.telegram` lists for the agent.
- **Files:** downloaded into the event's folder. One the Bot API will not give, such as one over 20 MB, is said in the content, so the message still arrives.

## Checks

- `pnpm test`: the bot's webhook at start, a message with a photo, sent twice, a file too big, a wrong secret token, a chat not listed, an agent without a bot, a message with no text and no file; the service off without `publicUrl`, without a token, or with a token Telegram refuses.
- Composio's Telegram toolkit, from its docs (docs.composio.dev/toolkits/telegram, 2026-11-15): it connects with an API key, the bot token; `TELEGRAM_SEND_MESSAGE` takes `chat_id` and `text`; no tool sets or deletes a webhook; it has no triggers.
- **Not checked by hand** against Telegram, or with a bot connected in Composio.

## Changes from the plan

- **Config:** `{ "agents": { "<agent>": { "chats": [...] } } }`, and the token's variable is named after the agent, not named in the config.
- **No secret of the service's own** for `secret_token`: it is made from each bot's token.
- **`apiUrl`** in the config points at another Bot API, such as a fake in the tests.

## The plan


Telegram has no Composio triggers, so it gets a [coordinator service](4-coordinator-services.md) of its own: an optional one, `src/coordinator-runtime/services/telegram/`, on when `agentx.json` lists it under `services`.

## The idea

- **Config.** `services.telegram` in `agentx.json` names each agent's bot by the variable that holds its token, such as `{ "agents": { "main": "TELEGRAM_BOT_TOKEN_MAIN" } }`. The tokens are in `agent-x/.env.services`, with a secret of the service's own for Telegram's `secret_token`.
- **`onStart`** calls Telegram's `setWebhook` for each bot, with `<publicUrl>/services/telegram/<agent>` and the `secret_token`. Without `publicUrl` in `agentx.json`, or with a token Telegram refuses, it throws, and the service is off.
- **The route**, `POST <agent>`, public, checks the `X-Telegram-Bot-Api-Secret-Token` header, and delivers each update with `context.deliver`: keyed by its `update_id`, so an update Telegram sends again is one event, with the chat, the message and the sender in its metadata.
- **The agent** tells a message from Telegram by `agentX-Service: telegram` and that metadata, and its router decides which thread takes it.

## To decide

- **How the agent answers.** A Pi extension with a tool that sends to a chat, with the bot's token kept out of the agent until sandboxes; or the agent sends its answer to `service:telegram` through its outbox, and the relay hands it to the service, which sends it. The second keeps the token in the coordinator, and is the same answer the [web app](../backlog/web-app-api.md) needs.
- **Who may talk to the bot**: anyone, or the chats `services.telegram` lists.
- **Files** people send: downloaded by the service into the event's folder, or left as Telegram's file ids.

## Not in this plan

- Other chat services, such as Slack: Composio has triggers for some of them ([Composio](../backlog/composio-service.md)).
