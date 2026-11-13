---
name: queue-terminal-input
title: Queue the messages typed into a terminal session
description: Put what a person types under `agentx chat` on the event queue, so the event queue extension delivers it like any other message instead of Pi taking it directly.
type: feature
priority: none
status: idea
modules: [agent-runtime/pi/pi-package/event-queue]
created: 2026-11-12
updated: 2026-11-12
---

# Queue the messages typed into a terminal session

Under `agentx chat`, typed messages go straight to Pi; only messages sent with `agentx event send` go through the queue. Putting typed messages on the queue too gives one path for every message: each gets the metadata block, a queue id, a record in the queue file, and its place in first-in, first-out order with sent messages.

## Plan

Change the `input` handler of the [event queue extension](../../architecture/agent-runtime/pi/pi-package/event-queue/README.md#the-event-queue-extension) (`src/agent-runtime/pi/pi-package/extensions/event-queue/index.ts`):

1. `event.source === "extension"`: continue. That is the queue's own delivery coming back through `pi.sendUserMessage`.
2. Plain text typed in a session that takes messages (`event.source === "interactive"` and `takesEvents(ctx)`): enqueue it on the session's thread and return `{ action: "handled" }`, so Pi starts no run for it. `event.streamingBehavior === "followUp"` becomes `doNotSteer`.
3. Everything else passes through as today.
4. The existing paths deliver it: the tick when Pi is idle, `turn_end` during a run.

Pi's `input` event and its results: [Pi](../../architecture/agent-runtime/pi/pi-reference/README.md#delivering-messages), and `docs/extensions.md` of the Pi package ("Input Events").

## What passes through unchanged, and why

- **Input starting with `/`.** Pi expands skills (`/skill:name`) and prompt templates after `input`, and `sendUserMessage` does not expand them.
- **Input with images.** The queue holds text only. Queuing it would need a column for images.
- **One-shot runs and unsaved sessions** (`-p`, `--mode json`, `--no-session`). They take nothing from the queue ([D28](../../architecture/agent-runtime/pi/pi-package/event-queue/README.md#d28)), so a queued prompt would never be answered.
- **RPC input** (`event.source === "rpc"`). A `prompt` command would report disposition `"handled"`, which tells the client not to wait for `agent_settled`.

## To decide before building

- **Retries.** A typed message whose run fails would be sent again, marked as a retry, up to three attempts ([D24](../../architecture/agent-runtime/pi/pi-package/event-queue/README.md#d24)). Today the person sees the error and decides. Either accept that, or mark typed messages so they get one attempt.
- **Errors.** With no model or login, the message would fail in the queue file without the person seeing why. The extension must notify the terminal when a typed message fails.

## To check in a spike

- How the terminal UI shows input that an `input` handler returned `handled` for: the text leaves the editor, and the message appears later, starting with the `<agentx-metadata>` block.
- Whether delivery can start from inside the `input` handler (a re-entrant `sendUserMessage`). If not, a typed message waits up to one tick (1 second) when Pi is idle.
