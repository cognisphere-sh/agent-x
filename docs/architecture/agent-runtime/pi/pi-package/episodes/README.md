# Episode extension

The extension in every Pi session that divides a thread into episodes: it ends each with a message that gives its id and the tokens it added to the context. `index.ts` is the extension, and `episodes.ts` finds the episodes in a session's entries and counts their tokens. The [context extension](../context/README.md) folds episodes, and the [memory extension](../memory/README.md) indexes them; both read them with `episodes.ts`.

| When | What it does |
|---|---|
| `agent_before_settle` | Adds the episode's end message, when an episode is in progress. |

Pi runs each `agent_before_settle` handler with the entries the handlers before it returned ([Pi](../../pi-reference/README.md#context-and-compaction)). The manifest lists this extension before the context extension, which reads the end message from them.

<a id="episodes"></a>

## Episodes

An episode is one of Pi's runs: the message that starts it, any events steered into it, and all the model did, up to its end message ([D86](#d86)).

- **It starts** at the first user message after the end message of the episode before it, or at the session's first user message. Every event reaches Pi as a user message, and so does what a person types in `agentx chat`.
- **It ends** with its end message, a custom message the model sees with the next episode: `Episode t3Kq9Zp0LmXa ended. It used about 12K tokens of your context.` Its `details` hold the same, `{ id, tokens }`. It starts no model call by itself.
- **Its id** is its own, made like an event's id when it ends. Each attempt at an event is an episode of its own: each run ends, failed or not, with its end message.
- Where an episode starts and ends comes from the session's entries as they were written, not from what the model sees: a fold or a compaction can take its first message or its end message out of the context.
- What comes between an end message and the next user message belongs to no episode: a fold nudge and its turn, and the system messages that carry the prompt's sections.
- An episode of a one-shot run, such as `agentx chat -p`, gets no end message: Pi's print mode answers with the last message only when it is the model's.

<a id="tokens"></a>

## Its tokens

What an episode added to the context comes from the model's usage, which Pi keeps on each of its answers ([D95](#d95)):

- what the episode's last answer read and wrote, its input, cached or not, and its output;
- less what its first answer read, which held everything before the episode;
- plus the episode's messages before that first answer, the event's, estimated as Pi does, a quarter of their text.

Answers without usage, such as failed ones, do not count. With none, the whole episode is estimated. When Pi compacted during the episode, its answers read contexts that cannot be compared, and the end message gives no count.

## Known limits

- A run cut off before its end message has no end, and the next episode on that thread takes it in: one a crash or a kill ended, and one aborted, as with Esc in `agentx chat`, for which Pi sends no `agent_before_settle`.
- A one-shot run's episode has no end either, so the next episode on that thread takes it in.
- In a session written before end messages had `details`, the old end messages end nothing: everything up to the first new end message is one episode, under its id. The ids that old fold summaries name are not found, so `fold` refuses in that thread. Removing the thread, or a new session, starts clean.
- Each end message is a user-role message before the next episode's first message, so two user messages follow each other. The fake model of the tests takes that; real providers are not tested yet.

## Decisions

<a id="d86"></a>
### D86. The episode is the unit of folds and of memory, ended by a message that gives its id and the tokens it added

- **Problem.** The agent needs names for what it folds and searches, where each part starts and ends, and what folding each would save. Events steered into a run share it.
- **Decision.** An episode, one of Pi's runs, is the unit. It starts at the first user message after the previous episode's end, and ends with a message that gives its id, its own, and the tokens it added to the context, in its text and its `details`.
- **Why.** One marker bounds both ends: the next user message after it is where the next episode starts, also the session's first. The end message shows the agent each episode's name and size, and a size per episode is all a fold needs; unlike a running total, it never goes stale. An id of its own makes each attempt at an event an episode of its own, and leaves event ids to the queue and the inbox. The session file keeps the end messages, where folds and indexing find the bounds, also when a fold or a compaction took them out of the context.
- **Rejected.** A message of its own before an episode's first message: on a session's first run it would come before the run's system message, which providers then send as an update, not as the system prompt. An episode line in the event's metadata block: what a person types in `agentx chat` has no such block, so episodes would start in two ways.
- **Rejected.** A line with the context's size on every tool result and event: the total is wrong after the next fold. A tag with an id on every message, as billion-context does: it costs tokens on every message for good.

<a id="d95"></a>
### D95. An episode's tokens come from the model's usage: what its last answer used, less what its first answer read, plus its event

- **Problem.** A fold nudge needs to know how much the episodes since the last one added. An estimate of each message misses what the model really reads, and the context right before an episode can hold a fold nudge's turn, whose entries a fold later omits.
- **Decision.** The end message counts what the episode's last answer read and wrote, less what its first answer read, plus the messages before that first answer, estimated. Without answers with usage, the whole episode is estimated. After a compaction inside the episode, there is no count.
- **Why.** The first answer's input holds everything before the episode, whatever it was, so the count is the episode's own. The model's figures are what the provider charged, not a guess. Only the event before the first answer is estimated, and it is small.
- **Consequence.** A fold does not change the counts of the episodes it folds, nor the next episode's: a summary is small.
