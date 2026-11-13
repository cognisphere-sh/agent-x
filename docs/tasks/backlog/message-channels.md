---
name: message-channels
title: Connect agents to people through message channels
description: Each agent is connected to one or more message channels, each with an objective, and reaches a person only by calling a channel's tool, because the text it writes is its own thinking.
type: feature
priority: none
status: idea
modules: [agent-runtime/pi/pi-package/system-prompt, agent-runtime/events, agent-runtime/agent]
created: 2026-11-13
updated: 2026-11-13
---

# Connect agents to people through message channels

Every agent is connected to one or more message channels, such as a Telegram chat, a Slack channel or an email inbox. Each channel has an objective that its agent's definition states: what the agent does there and for whom.

## The idea

- **The agent's text is its own thinking.** What the model writes in its turns reaches nobody. To reach a person, the agent calls a channel's tool, such as "send a message to this chat", explicitly.
- **A message names its channel.** A message that comes in through a channel goes on the agent's queue with metadata that names the channel and where in it to answer (the chat, the topic, the message replied to). The agent answers through that channel's tool.
- **At the terminal, text is the answer.** A person who talks to the agent in `agentx chat` reads everything the agent writes, so the agent answers there in text and uses no channel. A message typed at the terminal has no metadata block; a message from the queue always has one ([event queue](../../architecture/agent-runtime/events/README.md#events)). So the block tells the agent which of the two it is answering, also when a queue message arrives in a terminal session.

cognisphere-harness works this way: its prompt says "your text output is internal", each message's metadata carries `Plugin` and `Channel`, and each channel is a plugin with a command-line tool the agent runs (`telegram-cli send-message --chat-id <Channel>`).

## What it changes

- **The harness prompt.** "To ask a person something, ask in your reply" holds only at the terminal. For a queue message: the reply reaches nobody; ask through the channel the message came from.
- **Answers back to senders.** The [event queue's](../../architecture/agent-runtime/events/README.md#known-limits) open question, how an agent's answer gets back to the sender, becomes: through the channel's tool.
- **Composio's Connect Links** reach the person through the same channel ([Composio access](../done/1-composio-access.md#follow-ups)).

## To decide

1. What a channel is in agentx: a Pi extension with its own tools, a Composio toolkit (Slack, Gmail and Telegram have send tools there), or both.
2. How a channel's incoming messages reach the queue. The [coordinator](coordinator.md) is planned to receive Composio trigger events and add them to the agent they are for ([webhooks](coordinator-webhooks.md)), whose router turns them into messages ([events](../../architecture/agent-runtime/events/README.md)); a channel whose service has Composio triggers, such as Slack, Telegram or Gmail, can come in that way.
3. Where a channel's objective is defined: in the agent's `.pi/settings.json`, its system prompt, or both.
4. The metadata names a channel message carries.
