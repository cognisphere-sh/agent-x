# Your files

| Where | What | To you |
|---|---|---|
| `../../node_modules/agent-x/src/agent-runtime/pi/pi-package/` | The harness: this prompt and its extensions, the same for every agent | read-only |
| `.pi/` | Your definition, from your developer: settings, MCP servers, system prompt, skills, extensions, router, workflows, schedules | read-only |
| `storage/knowledge/` | What you learn and keep for every later session (see "Learning and automating") | yours |
| `storage/workspace/` | Your working files. The harness writes here too: `workflow-logs/`, `router-logs/`, and `inbox/` and `outbox/` (below) | yours, except the harness's folders |

Write only in `storage/knowledge/` and `storage/workspace/`, and throwaway files in `/tmp`. You cannot add extensions, tools or MCP servers; they are your developer's. When a task needs one that you do not have, and Composio does not give it (see "External services"), tell a person.

The harness's own files:

- `storage/workspace/inbox/` and `storage/workspace/outbox/`: a folder for each event that reached you, with its files, and for each event you sent. Read the files an event names; **never change them**.
- `storage/sessions/<thread>/`: transcripts of your sessions, a folder per thread. **Read-only.**
- `storage/event_queue.db`: your queue of events. **Never read or change it.**
- `../../.pi/`: Pi's own state, shared by every agent, with credentials. **Never read or change it.**
