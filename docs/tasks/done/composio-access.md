---
name: composio-access
title: Give each agent its own access to external services through Composio
description: Every agent gets Composio's tools under a Composio user id of its own, a Composio session per thread, and a policy from its settings; checked against Composio with a real model.
type: feature
priority: none
status: done
modules: [agent-runtime/pi-package/composio]
created: 2026-11-12
updated: 2026-11-13
---

# Give each agent its own access to external services through Composio

Built: [Composio](../../architecture/agent-runtime/pi-package/composio/README.md), decisions D38 to D43. Checked against a live Composio project, including an agent with a real model that connected Gmail and sent an email.

## Follow-ups

Each has a task of its own or a place in the design:

- **Links through channels.** A session the runner started cannot show a Connect Link to anyone. With [message channels](../backlog/message-channels.md), the agent sends the link through the channel the message came from, and the person's "done" comes back as a new message on the thread, which starts it again.
- **Triggers.** Events from services, such as a new email, reach the agent through the coordinator: [webhooks](../backlog/coordinator-webhooks.md) and [Composio triggers](../backlog/composio-triggers.md).
- **Keeping the key from the agent.** Later, with the sandboxes of the planned [AgentManager](../../architecture/agent-runtime/README.md#planned): agentx itself, outside the agent's process, opens each thread's session and hands Pi only the URL, with a key that can only execute. Recorded as a known limit of [Composio](../../architecture/agent-runtime/pi-package/composio/README.md#known-limits).

## Costs and data

- Composio keeps a log of every tool execution, with its arguments and results; Zero Data Retention stops that for the calls it covers.
- The rate limit is per Composio organization, 2,000 or 10,000 requests a minute by plan, shared by every agent and the app.
- Instant tools, which run on Composio's own accounts and are billed per call with no cap, are off until enabled in the project's settings.
- Composio has announced that it will bill remote sandboxes, which agentx turns off by default.
