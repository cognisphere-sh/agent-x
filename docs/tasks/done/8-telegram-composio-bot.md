---
name: telegram-composio-bot
title: Connect each agent's Telegram bot in Composio from the Telegram service
description: The Telegram service connects each agent's bot in Composio for the agent's user id, with a Composio key of the coordinator's own, so the agent can answer without a person connecting the bot by hand.
type: feature
priority: none
status: done
modules: [coordinator-runtime/services/telegram, coordinator-runtime/services/composio]
created: 2026-11-16
updated: 2026-11-16
---

# Connect each agent's Telegram bot in Composio from the Telegram service

Built on 2026-11-16, on the [Telegram service](6-telegram.md). The design: [Telegram service](../../architecture/coordinator-runtime/services/telegram/README.md#the-bot-in-composio).

## What was built

In the commit that adds this task to `done/`.

- **`composio-bot.ts`**, in the Telegram service's folder: `connectBot` lists the user id's Telegram accounts, deletes the service's own accounts of another token, and connects the bot when no active account of its token is left, under a Telegram auth config that sessions use (`is_enabled_for_tool_router`), made when there is none.
- **The Telegram service** names `COMPOSIO_COORDINATOR_API_KEY` and `COMPOSIO_BASE_URL` in its `secrets`, connects each bot at the end of `onStart`, and logs a failure without turning off. It refuses two agents with the same bot token.
- **`composio-user-id.ts`**: the agent's Composio user id from its checked-in settings, which the Composio service read alone before.

## Decisions

[D77](../../architecture/coordinator-runtime/services/telegram/README.md#d77): the Telegram service connects each bot in Composio with the coordinator's own Composio key.

## Changes from the plan

- **The agent's session is unchanged.** Composio's docs say a session uses a custom auth config only when it names its id, which would have meant passing the id to the Composio extension. A check found that a custom auth config with `is_enabled_for_tool_router` is used without it, so the service makes or reuses such a config instead.

## Migration

- Make a scoped key in Composio's dashboard with Auth configs and Connected accounts (read and write), and set `COMPOSIO_COORDINATOR_API_KEY` in `agent-x/.env.services`. Without it, nothing changes: the service logs that it connects no bot.
- A bot already connected by hand for the agent's user id stays. Composio's docs say a session uses the newest account, which is the service's; to be sure, delete the one connected by hand in Composio's dashboard.
- Two agents with the same bot token now turn the service off.

## Verification

- `pnpm test`: two agents, each bot with its own webhook and connected for its own user id, under a new auth config that sessions use, not an existing one they skip; a second start changes nothing; a new token replaces only the service's account and leaves one connected by hand; without the key, or with the agents' session key, the service stays on and logs why; two agents with one token turn it off.
- Checked against Composio on 2026-11-16, with a full project key, everything made deleted afterwards: an auth config `use_custom_auth`/`API_KEY` with empty credentials is made for `telegram`; a connected account takes the token as `generic_api_key` (`api_key` is refused as a missing Bot Token), and Composio does not check it; the account list filters by `user_ids` and `toolkit_slugs` and returns `alias`; a second account with the same alias for the same user id and toolkit is refused, for another user id it is not.
- `connectBot` itself, built, against Composio with a bogus token: it reused the project's Telegram auth config made in the dashboard, a session that names no auth config ran `TELEGRAM_GET_ME` with the account, the same token again changed nothing, and a new token replaced the account.
- Which accounts a session uses, checked the same way with a bogus token and `TELEGRAM_GET_ME`, where Telegram's 401 means the session ran with the account: under a custom auth config made through the API as Composio's docs show it, a session that names no auth config finds no connection; it does when the session names the config, or when the config has `is_enabled_for_tool_router`, which one made in the dashboard has and the create call can set. So the service sets it, and the Composio extension is unchanged.
- **Not checked by hand:** sending a message with a real bot through an agent's session; which account a session takes when a user id has two active Telegram accounts; a scoped key with only Auth configs and Connected accounts, and whether it may set `is_enabled_for_tool_router`.

## Follow-ups

- The Composio service's triggers use the same key, with Triggers too ([Composio triggers](../backlog/composio-service.md)).

## Original plan

The request: there can be a Telegram bot for each agent; and the Telegram service should connect each bot's token for the agent's Composio user id, so the agent can send messages.
