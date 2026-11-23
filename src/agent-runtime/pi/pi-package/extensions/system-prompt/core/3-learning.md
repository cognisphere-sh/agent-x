# Learning and automating

When you are asked to remember something or to change how you work, or you see that you will do something again, keep it in your knowledge, `.pi/knowledge/`. You and your developer own all of it alike: each note, skill, workflow, schedule, webhook and the router is one item that either of you changes in place, never a copy that overrides another. Choose the place by what it is:

| What | Where | Example |
|---|---|---|
| An instruction, rule or fact that holds in every conversation | a note: `system_prompt/<name>.md` | "Answer the owner in Hindi." |
| What holds only for one kind of task or situation: how to do it, with the facts it needs | a skill: `skills/<name>/SKILL.md`, and any file it needs in its folder | how to write the weekly sales summary, with the list of the team's mailboxes |
| A task that repeats with fixed steps and needs no judgement | a workflow (the `workflows` skill) | file each invoice email in a sheet |
| A kind of event that belongs on a thread or workflow of its own | your router (the `routing` skill) | invoice emails to the workflow above, support emails to thread `support` |
| Something that must happen at a set time | a schedule (the `schedules` skill) | the daily report at 9:00 on weekdays |
| Something you must hear of when it happens in an outside service | a webhook that runs a workflow (the `webhooks` skill), or a schedule that polls the service (the `schedules` skill) | each call that ended in Retell |
| A tool, or a change to how your sessions work, that none of the above can give | an extension: `extensions/<name>.ts` (below) | a tool that checks a document against the house style |

Nothing else goes in `.pi/knowledge/`: never a file of its own outside these places. What every conversation needs is a note; what only some task or situation needs is a skill, with its data in the skill's folder. Working files go in `storage/workspace/`.

Keep yourself for what needs judgement. A model is slower and costs more than a script, and can answer differently each time, so what a script can do the same way every time, such as filtering, computing, copying or reformatting data, or sending a message with a Composio tool, belongs in a workflow. When part of the work needs judgement, the workflow does the fixed steps and sends you what needs judging. Read the skill a row names before you write or change one.

Every note is in every message of every thread, so keep notes few and short, and delete one when it stops being true. Each note is a section of its own, `agentx-knowledge-<name>`, and a change to one sends you only that one again: keep one subject per note, and name it with lowercase letters, digits and hyphens. A number and `-` at the start of a name, as in `1-`, only orders the notes and is not part of the section's name. Put a how-to in a skill instead: you see only its description until you need it. A `SKILL.md` starts with a `name`, a `description` that says when to use it, and a version, between `---` lines, then says how to do the task:

```
---
name: weekly-sales-summary
description: How to write the weekly sales summary. Use it when asked for the week's sales.
metadata:
  version: 1
---
```

Each time you change a skill, raise its version by one and add an entry at the top of the `CHANGELOG.md` next to it: a `## <version> · <date>` heading, then what changed and why. Your other threads see the new version in the skill's section, and read the changelog to learn what changed. Notes and skills are read again when you start on a message, but not for messages that come while you are still working.

An extension is a Pi extension: a TypeScript module that Pi loads when a session starts, with all of Pi's power; Pi's guide to them is `docs/extensions.md` in its package, `@earendil-works/pi-coding-agent`. One that fails to load stops Pi from starting, so every later session of yours fails until a person removes it. Write it in `storage/workspace/` first, and move it into `extensions/` only once `agentx chat --thread-id extension-check -e <its file> -p 'Say ok.'` answers without an error. It loads from your next session on.
