---
name: schedules
description: How to make yourself act at set times with schedules, cron patterns that send you events, and how to poll a service on a schedule to learn what is new in it. Use it before you write or change storage/knowledge/schedules.json, or stop one of your developer's schedules.
metadata:
  version: 1
---

# Schedules

A schedule sends you an event at the times a cron pattern names. Schedules are listed by name in `.pi/schedules.json`, your developer's (**read-only**), and in `storage/knowledge/schedules.json`, yours. On a name in both, yours is used: to change one of your developer's, copy its entry into yours and edit it, and to stop one, copy it with `"isActive": false`:

```json
{
	"daily-report": { "cron": "0 9 * * 1-5", "content": "Write the daily report.", "threadId": "reports" },
	"monthly-invoices": { "cron": "0 8 1 * *", "threadId": "workflow.file-invoices", "metadata": { "month": "last" } }
}
```

`cron` has five fields (minute, hour, day of month, month, day of week), or six with seconds first, in your time zone. `content` is the event's text; a schedule that runs a workflow may leave it out and give the workflow its parameters in `metadata`. Optional: `threadId` (a thread of yours or `workflow.<name>`; without it, the routers pick), `metadata`, `isSilent`, `isActive` (`false` pauses it), `fireOnce` (fires at the next match, then never again), and `catchUp` (`true` sends one late event for fires missed while the harness was down; otherwise they are skipped). Schedules fire only while the project runs under `agentx serve`. A change to the file applies within a second, and a changed entry counts from the time of the change. Its events have `agentX-Schedule: <name>`.

## Polling a service

To learn what is new in a service, check it on a schedule: the schedule runs a workflow (read the `workflows` skill), which lists the newest items with a Composio tool and sends an event for each, keyed by the item's id. An event whose key you sent before adds nothing, so each item reaches you once however often a poll sees it, and the workflow keeps no state. When the service can call a URL when something happens, a webhook is quicker and costs nothing between events (read the `webhooks` skill).

```json
{ "poll-orders": { "cron": "*/10 * * * *", "threadId": "workflow.poll-orders" } }
```

```ts
import type { Workflow } from "agent-x";

const run: Workflow = async (event, ctx) => {
	// The tool's name, arguments and answer are the service's: look them up with COMPOSIO_GET_TOOL_SCHEMAS, or run it once, first.
	const data = await ctx.composio("SHOP_LIST_ORDERS", { limit: 20 });
	for (const order of data.orders as { id: string }[]) await ctx.send(`New order ${order.id}.`, { threadId: "orders", key: `order:${order.id}` });
};

export default run;
```

Each poll is a tool call, so poll no more often than you need. A failed run is reported to you each time, so catch an error that the next poll gets past, such as a timeout, and print it instead of throwing.
