---
name: telegram
description: How to answer a person on Telegram, and to ask them a question with fixed answers on buttons. Use it on an event whose agentX-Service is telegram.
metadata:
  version: 2
---

# Telegram

An event with `agentX-Service: telegram` is a message a person wrote to your Telegram bot: the content is their message, `chat` its chat and `from` the person.

- Answer in that chat with Composio's Telegram tools.
- A message in a topic of a group has `topic`, the topic's id. Composio's tools cannot name a topic, so answer there as a reply: `reply_to_message_id` set to the event's `message-id`. A message that is no reply goes to the group's General topic.
- To ask a question with fixed answers, put them on buttons: `TELEGRAM_SEND_MESSAGE` with `reply_markup` set to a JSON string such as `{"inline_keyboard": [[{"text": "Yes", "callback_data": "yes"}, {"text": "No", "callback_data": "no"}]]}`.
- A tap comes back as an event from that chat: its content is the button's text, `button` its `callback_data` and `message-id` your question, whose buttons the harness then takes off, so each question is answered once.
- Never ask with a poll: its answers do not reach you.
