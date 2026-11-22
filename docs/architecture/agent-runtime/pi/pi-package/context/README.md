# Context extension

The extension in every Pi session that keeps the agent's context small: the agent folds earlier [episodes](../episodes/README.md) into summaries it writes, when a fold nudge asks. When the context nears the window's end anyway, Pi compacts it by itself. The ideas of folds the agent decides on and of fold nudges come from [billion-context](https://github.com/ranxianglei/billion-context); the code and prompts are agentx's.

| When | What it does |
|---|---|
| `turn_end` | Applies what a `fold` call of the turn folded. |
| `agent_before_settle` | After an episode's end message, which the episode extension adds first, a fold nudge with one more turn when one is due; after that turn, omits the fold nudge and what the agent did for it. |

It adds the tool `fold`. The harness prompt, `core/11-context.md`, explains episodes and says that a fold nudge asks the agent to fold and says how; the fold nudge holds the instructions ([D89](#d89)).

## Folds

**`fold({ ranges: [{ from, to, summary }] })`** folds each range, episode `from` and the episodes after it up to episode `to`, which stays, into its summary ([D87](#d87)). So the newest episode is never folded.

- **Only during a fold nudge's turn.** Otherwise it refuses: the fold nudge holds the instructions.
- Episodes are named by their ids, as their end messages give them; an event's id names none.
- **A range takes in an earlier fold whole or not at all.** The new summary replaces the old one, so no episode is in two folds. The agent sees only the old summary, so it writes the new one from it. The tool finds earlier folds by their tags, read only on the messages folds replaced: a tool's output can start with the same tag.
- It refuses an episode the thread does not have, a `to` that is not after `from`, a range that cuts an earlier fold, an episode a compaction summarized whole, and ranges that overlap. Pi checks the edits of a turn together and drops them all for one bad target, so the tool checks first.
- **One call per answer.** Folds apply at the turn's end, so two calls in one answer would each be checked against the context before either, and could overlap. When an answer has more than one, each fails: only one is allowed, and it can have many ranges. The agent then calls `fold` again, once ([Pi](../../pi-reference/README.md#tools)). The fold nudge asks for all the ranges in a single call.
- The fold nudge says what to fold: the oldest finished tasks first, never one whose task is still going on; long explorations, multi-step processes and executions once they are over, keeping only what was learned and the information that matters. It gives the rules for the summary: stand alone; keep goals, decisions with reasons, the work's exact paths, names, values, commands and errors, and the ids of what it touched; drop used tool output; write the work's state as history, and end with what is still open; do not mention episodes, by id, number or tokens, also ones the work read or was about, since the tag lists those it covers. It asks for `from` and `to` as the ids the episodes' end messages give.
- At the turn's end the extension returns Pi's `context_edit` entries:
  - each summary replaces the content of the first message the model sees of its range: the first episode's event, an earlier fold's summary, or, when a compaction cut inside that episode, the first message it kept;
  - every other message of the folded episodes the model sees, their end messages and earlier summaries included, is omitted (`replacement: null`).
- The `fold` call and its result stay until the fold nudge's turn is over, so the model sees what it did for the nudge, and then leave with the rest of that turn.
- The summary's tag names the episodes it folded, and nothing else does: `episode_read` takes those ids, as the harness prompt says.

  ```
  <agentx-folded episodes="t3Kq9Zp0LmXa c9Jp4Mx1Ya2R">
  The summary.
  </agentx-folded>
  ```
- The session file keeps everything.

The memory extension's `episode_read` gives a folded episode back ([memory](../memory/README.md#tools)).

## Fold nudges

When an episode ends, outside a one-shot run, and the episodes since the last fold nudge added more than `foldNudgeEvery` tokens, as their end messages give ([episodes](../episodes/README.md#tokens)), the extension adds a fold nudge after the end message and asks Pi for one more turn (`continue: true` from `agent_before_settle`) ([D89](#d89)).

- A fold nudge needs an episode besides the newest, which stays, and comes only after an episode that succeeded.
- It gives the context's size, as Pi estimates it, of the window, and the instructions to fold: what to fold first and what never, how to give the ranges, the rules for a summary, and to say only that when nothing should be folded. They leave the context with it, so they cost tokens only during its turn.
- When that turn ends, at the next `agent_before_settle`, the fold nudge and everything after it leave the context: the agent's calls, their results and its answer. A message a person types into the turn, in `agentx chat`, stays, with what follows it. A turn cut off by an abort leaves the fold nudge until the end of the next episode.
- The event queue settles an episode's events at the run's first settle, before the turn to fold, so that turn, failed or cut off, does not touch them, and it steers nothing into the turn: an event that arrives meanwhile starts the next episode ([event queue](../event-queue/README.md#the-event-queue-extension)).

## Compaction

Pi compacts by itself when the context passes the window less `compaction.reserveTokens`, after the model refused a context as too long, and when a person types `/compact`, with its own cut and summary. Its cut can fall inside an episode. A fold of that episode puts its summary on the first message the model still sees of it.

## The prompt cache

- A fold makes the provider read the context again from its first folded message, once.
- End messages and fold nudges are at the end of the context, and a fold nudge's turn leaves only what came before it.

## Settings

Under `agentx.memory.compaction` in the agent's `.pi/settings.json`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` turns off folds and fold nudges: `fold` refuses. End messages stay. |
| `foldNudgeEvery` | `0.1` | Tokens the episodes since the last fold nudge may add before the next: a whole number is a count of tokens, a fraction a share of the window. |

When Pi compacts, and how much it keeps, comes from Pi's own `compaction` settings.

## Known limits

- Pi checks each `context_edit` against the whole branch, which a compaction does not shorten, so a fold costs its edits times the thread's entries: about 0.2 s for 300 edits on a branch of 20K entries, twice per fold.

## Decisions

<a id="d87"></a>
### D87. A fold puts the summary in place of the first message the model sees of its range, omits the rest and the `fold` call, and takes in earlier folds whole or not at all

- **Problem.** A fold must leave a context that every provider takes: a tool call kept with its result, and a user message first. The summary must say what was folded, so the agent can read it back, and no episode should be in two folds.
- **Decision.** `fold` folds ranges of whole episodes, each from one episode up to, not including, another, with a summary each. A summary replaces the content of the first message the model sees of the range, its first episode's event, marked `<agentx-folded>` with the episodes' ids. Everything else of the episodes, their end messages and earlier summaries in them are omitted, and the `fold` call itself with the fold nudge's turn. A range that cuts an earlier fold is refused.
- **Why.** Whole episodes never split a call from its result. The first message is a user message, so the context still starts with one, while the last message of an episode can be a tool result, which a replacement would part from its call. Replacing the first message and omitting the end messages leaves no id the agent cannot fold. Omitting the call leaves the summary once. An earlier fold's summary stands for all its episodes, so a range takes in all of it or none, and each episode stays in one summary.

<a id="d89"></a>
### D89. The agent folds only when a fold nudge asks, after an episode ends, with one turn of its own and the instructions in the fold nudge, which then leave the context

- **Problem.** A request to fold in the middle of an episode breaks into the agent's work. Instructions to fold in the system prompt cost tokens on every call, and the request, its instructions and the agent's answer are of no use once it has folded.
- **Decision.** When an episode ends and the episodes since the last fold nudge added more than `foldNudgeEvery` tokens, the sum of their end messages' counts, the extension adds a fold nudge with the instructions and asks Pi for one more turn. `fold` folds only in that turn. When the turn ends, the fold nudge and what the agent did for it are omitted. The system prompt says only that a fold nudge will come and says how.
- **Why.** Between episodes the agent knows which tasks are done. The end messages already hold each episode's count, so the sum needs no saved state, and what a fold saves does not throw it off. The tool stays declared all the time: taking it out and putting it back would leave system messages, which no edit can omit, and change the tools the cache starts with.
- **Consequence.** The event queue settles a run's events at its first settle, before the turn to fold, and steers nothing into that turn, so the turn cannot fail or cancel an event and holds none.
