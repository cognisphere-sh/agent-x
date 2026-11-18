---
name: telegram-buttons-service-choice
title: Ask with Telegram buttons, and let the person choose among services that can do a task
description: The agent asks a question with fixed answers on inline buttons in Telegram, whose taps the Telegram service delivers, and asks the person to choose when several Composio services can do a task and none is connected.
type: feature
priority: none
status: done
modules: [coordinator-runtime/services/telegram, agent-runtime/pi/pi-package, agent-runtime/pi/pi-package/composio]
created: 2026-11-16
updated: 2026-11-18
---

# Ask with Telegram buttons, and let the person choose among services that can do a task

Built on 2026-11-18, on the [Telegram service](6-telegram.md). The design: [button taps](../../architecture/coordinator-runtime/services/telegram/README.md#button-taps) and [Composio's prompt](../../architecture/agent-runtime/pi/pi-package/composio/README.md#the-prompt).

## What was built

In the commit that adds this task to `done/`.

- **The harness prompt.** "External services" (`core/9-external-services.md`): when several services can do a task, such as Gmail and Outlook, and none is connected, the agent offers them to the person, says which it would pick and why, and connects the one chosen; when one is connected, it uses it. "Events" (`core/4-events.md`): in Telegram, a question with fixed answers goes on inline buttons, with `TELEGRAM_SEND_MESSAGE`'s `reply_markup`, never in a poll.
- **The Telegram service** takes `callback_query` updates too. It answers each tap, ignores one from a chat the agent does not list or on a message Telegram no longer gives, delivers it with the button's text as content and `button`, its `callback_data`, then takes the message's buttons off and adds `✅ <from>: <button>` under its text.

## Decisions

[D84](../../architecture/coordinator-runtime/services/telegram/README.md#d84): the agent asks a question with fixed answers on inline buttons, which the service closes at the first tap.

## Changes from the plan

- **Inline buttons, not a reply keyboard.** The first version put the answers on a reply keyboard, whose tap is a plain message, so the service needed no change. Inline buttons sit under the question and leave the choice in the chat, so the service takes their taps instead.
- **No polls.** A `poll_answer` names no chat, so the service would have to know which chat each poll went to.

## Migration

- Start `agentx serve` again: it sets each bot's webhook at start, and only then does Telegram send taps.
- Every inline button now answers once: a message whose buttons a developer meant to stay, such as a menu sent with Composio's tools, loses them at the first tap.

## Verification

- `pnpm test`: the webhook asks for `message` and `callback_query`; a tap on a text question is one event, with the button's text, `button` and the question's `message-id`, and the question gets the choice under its text, its formatting kept, and loses its buttons; a photo only loses its buttons; a tap from a chat the agent does not list, or on a message Telegram no longer gives, is no event; every tap is answered.
- Composio's tool schemas, read on 2026-11-16: `TELEGRAM_SEND_MESSAGE` takes `reply_markup` as a JSON string, and `TELEGRAM_SEND_POLL` exists.
- **Not checked by hand:** a real bot and chat: an agent sending inline buttons through Composio, and a tap coming back.

## Follow-ups

- Buttons that stay, several answers, and a question for one person, which the old harness's Telegram plugin had, when an agent needs them.

## Original plan

The request: in the system prompt, when several Composio services can do a task and no account is connected, give the person the services to choose from; and in Telegram, use a poll or quick-answer buttons for a question with fixed options. Then: use inline buttons, as the `pixel` agent of the old harness does.

### Plan

1. The Telegram service takes `callback_query` updates from the chats the agent lists.
2. It answers each tap at once, so the button stops spinning.
3. It takes the buttons off and adds `✅ <from>: <choice>` to the question, so the chat shows the choice and nobody answers twice.
4. It delivers an event whose content is the choice, with the chat, who tapped and the question's message id.
5. The prompt has the agent send the options as an `inline_keyboard` in `TELEGRAM_SEND_MESSAGE`'s `reply_markup`, and no polls.
6. A test, the Telegram doc, and D84.
