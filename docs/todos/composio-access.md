---
name: composio-access
title: Finish each agent's access to external services through Composio
description: The Composio extension is built and checked against Composio; what remains is reaching people through channels, and keeping the key from the agent.
type: feature
priority: none
status: in-progress
modules: [agent-runtime/pi-package/composio]
created: 2026-11-12
updated: 2026-11-13
---

# Finish each agent's access to external services through Composio

What is built: [Composio](../architecture/agent-runtime/pi-package/composio/README.md).

## Still to build

- **Links through channels.** A session the runner started cannot show a Connect Link to anyone. With [message channels](message-channels.md), the agent sends the link through the channel the message came from, and the person's "done" comes back as a new message on the thread, which starts it again.
- **Keeping the key from the agent** (later). agentx itself, outside the agent's process, opens each thread's session and hands Pi only the URL, with a key that can only execute. It pays off only with the sandboxes of the planned [AgentManager](../architecture/agent-runtime/README.md#planned). Composio does not document whether a session can then be used only with the key that made it.

## Costs and data

- Composio keeps a log of every tool execution, with its arguments and results; Zero Data Retention stops that for the calls it covers.
- The rate limit is per Composio organization, 2,000 or 10,000 requests a minute by plan, shared by every agent and the app.
- Instant tools, which run on Composio's own accounts and are billed per call with no cap, are off until enabled in the project's settings.
- Composio has announced that it will bill remote sandboxes, which agentx turns off by default.
