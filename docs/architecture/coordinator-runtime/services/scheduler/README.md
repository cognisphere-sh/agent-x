# Scheduler

A core [service](../../README.md#services) of the coordinator: it fires each agent's schedules into its inbox. Code: `src/coordinator-runtime/services/scheduler/scheduler.ts`.

A schedule sends an agent an event at the times a cron pattern names. Schedules are listed in `.pi/knowledge/schedules/schedules.json`, in the agent's [knowledge](../../../agent-runtime/agent/README.md#knowledge), which the agent and its developer both edit. A new agent has it, empty.

```json
{
	"daily-report": { "cron": "0 9 * * 1-5", "content": "Write the daily report.", "threadId": "reports", "catchUp": true },
	"monthly-invoices": { "cron": "0 8 1 * *", "threadId": "workflow.file-invoices", "metadata": { "month": "last" } }
}
```

| Key | Required | Meaning |
|---|---|---|
| `cron` | yes | Five fields, or six with seconds first, in the agent's `timezone` ([croner](https://github.com/hexagon/croner) patterns). |
| `content` | yes, unless it runs a workflow | The event's text. A workflow's schedule without it sends empty text. |
| `threadId` | no | A thread, or `workflow.<name>`. Without it, the router picks. |
| `metadata`, `isSilent` | no | As for any event; `source: schedule` is added. A workflow gets `metadata` as `event.metadata`, its parameters ([workflows](../../../agent-runtime/workflows/README.md#the-contract)). |
| `isActive` | no | Default `true`; `false` pauses it. |
| `fireOnce` | no | Fires at the next match, then never again until the entry changes. |
| `catchUp` | no | Fires missed while `agentx serve` was down become one late fire. Otherwise they are skipped. |

A `Scheduler` per agent, each second ([D64](#d64)):

1. It reads a file again only when it changed: the list, and the agent's settings for its time zone. A broken entry is reported once on the agent's `main` thread.
2. A new or changed schedule counts from now.
3. A fire due less than 60 s ago is on time; an older one was missed, and fires only with `catchUp`.
4. A fire is delivered into the agent's inbox, sent at the time it was due, with `agentX-Schedule: <name>` and the key `schedule:<name>:<time>`, so a fire is added once. A fire the agent refuses, such as one for a workflow it does not have, is reported on `main`.
5. What it fired is kept in `storage/schedule-state.json`, so a restart neither repeats nor forgets a fire.

It fires nothing once the coordinator begins to stop, while the agents drain. A fire due then is dealt with at the next start, as one due while `agentx serve` was down: on time within 60 s, else only with `catchUp`.


## Decisions

<a id="d64"></a>
### D64. Schedules are files the coordinator polls each second

- **Decision.** Schedules are entries in `.pi/knowledge/schedules/schedules.json`. The coordinator checks the files' times each second, reads one again when it changed, fires what is due into the agent's inbox, and keeps what it fired in `storage/schedule-state.json`.
- **Why.** A few `stat` calls each second cost nothing. A timer per schedule would fire at the exact millisecond, but the files would still be polled for changes, and each change would mean making the timers again, with catch-up and `fireOnce` apart from them. File watching misses changes on mounted and linked folders, which central storage and sandboxes use. The agent writes schedules as it writes workflows.
- **Rejected.** File watching (`fs.watch`); a cron timer per schedule; asking the coordinator to register a schedule, which needs an answer the agent can only get later.
- **Consequence.** An edit applies within a second. Fires missed while `agentx serve` is down are skipped unless the schedule sets `catchUp`.
