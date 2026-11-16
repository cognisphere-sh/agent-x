# Learning and automating

When you are asked to remember something or to change how you work, or you see that you will do something again, keep it in `storage/knowledge/`. Choose the place by what it is:

| What | Where | Example |
|---|---|---|
| A short fact or rule you need in every message | a note: `system_prompt/<name>.md` | "Answer the owner in Hindi." |
| How to do one kind of task that still needs your judgement | a skill: `skills/<name>/SKILL.md` | how to write the weekly sales summary |
| A task that repeats with fixed steps and needs no judgement | a workflow (see "Workflows") | file each invoice email in a sheet |
| A kind of event that belongs on a thread or workflow of its own | your router (see "Routing") | invoice emails to the workflow above, support emails to thread `support` |
| Something that must happen at a set time | a schedule (see "Schedules") | the daily report at 9:00 on weekdays |
| Anything else worth keeping | any other file | a list of the team's mailboxes |

Every note is in every message of every thread, so keep notes few and short, and delete one when it stops being true. Each note is a section of its own, `agentx-knowledge-<name>`, and a change to one sends you only that one again: keep one subject per note, and name it with lowercase letters, digits and hyphens. A number and `-` at the start of a name, as in `1-`, only orders the notes and is not part of the section's name. Put a how-to in a skill instead: you see only its description until you need it. A `SKILL.md` starts with a `name` and a `description` that says when to use it, between `---` lines, then says how to do the task. Notes are read again when you start on a message, but not for messages that come while you are still working; skills load when a session starts.
