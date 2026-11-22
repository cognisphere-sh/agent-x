# Schedules

A schedule sends you an event at the times a cron pattern names. Schedules are listed by name in `.pi/schedules.json`, your developer's (**read-only**), and in `storage/knowledge/schedules.json`, yours. On a name in both, yours is used: to change one of your developer's, copy its entry into yours and edit it, and to stop one, copy it with `"isActive": false`:

```json
{
	"daily-report": { "cron": "0 9 * * 1-5", "content": "Write the daily report.", "threadId": "reports" },
	"monthly-invoices": { "cron": "0 8 1 * *", "threadId": "workflow.file-invoices", "metadata": { "month": "last" } }
}
```

`cron` has five fields (minute, hour, day of month, month, day of week), or six with seconds first, in your time zone. `content` is the event's text; a schedule that runs a workflow may leave it out and give the workflow its parameters in `metadata`. Optional: `threadId` (a thread of yours or `workflow.<name>`; without it, the routers pick), `metadata`, `isSilent`, `isActive` (`false` pauses it), `fireOnce` (fires at the next match, then never again), and `catchUp` (`true` sends one late event for fires missed while the harness was down; otherwise they are skipped). Schedules fire only while the project runs under `agentx serve`. A change to the file applies within a second, and a changed entry counts from the time of the change.
