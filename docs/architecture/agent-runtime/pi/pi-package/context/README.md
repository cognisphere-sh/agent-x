# Context extension

The extension in every Pi session that keeps the agent's context small. The agent knows its model and window and how many tokens each episode used, and folds earlier episodes into summaries it writes. When the context nears the window's end anyway, the extension's compaction keeps the last episodes and summarizes the rest. `index.ts` is the extension, and `episodes.ts` divides the context into episodes and writes them as Markdown. The ideas of folds the agent decides on, fold nudges and summaries of summaries come from [billion-context](https://github.com/ranxianglei/billion-context); the code and prompts are agentx's.

| When | What it does |
|---|---|
| `input` | When Pi is idle, starts an episode: the message the input becomes starts with the episode's line. |
| `before_agent_start` | Sets the section `agentx-model`. |
| `turn_end` | Applies what a `fold` call of the turn folded. |
| `agent_before_settle` | Adds the episode's end message, and a fold nudge with one more turn when one is due; after that turn, omits the fold nudge and what the agent did for it. |
| `session_before_compact` | Writes Pi's compaction: keeps the last episodes, summarizes the rest in the form of a fold. |

It adds two tools, `fold` and `episode_read`. The harness prompt, `core/11-context.md`, explains episodes and says that a fold nudge asks the agent to fold and says how; the fold nudge holds the instructions ([D89](#d89)).

## The model and its window

The section `agentx-model` names the model and its provider, its context window and its output limit. It is set every run from `ctx.model`, so Pi sends it at a session's start and again, alone, only when the model changes ([Pi](../../pi-reference/README.md#extensions)).

<a id="episodes"></a>

## Episodes

An episode is one of Pi's runs, from its start to its end: the message that starts it, any events steered into it, and all the model did. It is the unit the agent folds and reads back, and the unit of episodic memory later ([D86](#d86)).

- **Its id** is its own, made like an event's id when it starts. Each attempt at an event is an episode of its own.
- **Its first message** starts with a line that gives its id, `Episode t3Kq9Zp0LmXa started.`, and a blank line, then the event or what a person typed. The line marks where the episode starts, and its events are those of that message. The extension puts it there in `input`, which Pi runs before it makes the input a message, when Pi is idle. Pi writes the run's system message before that message, so a session's system prompt stays its first message, which providers need: only a system message at the very start is the system prompt, and a later one is sent as an update ([Pi](../../pi-reference/README.md#context-and-compaction)). An input while a run starts or goes on joins that run and starts nothing.
- **Its end message** is a custom message the model sees with the next episode: `Episode t3Kq9Zp0LmXa ended. It used about 12K tokens of your context.` It counts the episode's messages as the model sees them, as Pi estimates tokens, a quarter of the text's length. It starts no model call by itself. An episode of a one-shot run, such as `agentx chat -p`, gets none, and no fold nudge: Pi's print mode answers with the last message only when it is the model's.
- Which episode a message belongs to comes from the first messages of the whole session as they were written, not from what the model sees: a fold or a compaction can take an episode's first message out of the context. The episode in progress is the newest one; one cut off before its end message, by an abort or a killed process, can still be folded.
- The system messages that carry the prompt's sections belong to no episode, so a fold never omits them.

## Folds

**`fold({ ranges: [{ from, to, summary }] })`** folds each range, episode `from` and the episodes after it up to episode `to`, which stays, into its summary ([D87](#d87)). So the newest episode is never folded.

- **Only during a fold nudge's turn.** Otherwise it refuses: the fold nudge holds the instructions.
- Episodes are named by their ids, as their first messages and end messages give them; an event's id names none.
- **A range that takes in part of an earlier fold takes all of it**, and the new summary replaces the old one, so no episode is in two folds. The agent sees only the old summary, so it writes the new one from it.
- It refuses an episode the thread does not have, a `to` that is not after `from`, an episode a compaction summarized whole, and ranges that overlap. Pi checks the edits of a turn together and drops them all for one bad target, so the tool checks first.
- The fold nudge says what to fold: the oldest finished tasks first, never one whose task is still going on. It gives the rules for the summary: stand alone; keep goals, decisions with reasons, the work's exact paths, names, values, commands and errors, and the ids of what it touched; drop used tool output; write the work's state as history, and end with what is still open; do not name the episodes, which the tag lists.
- At the turn's end the extension returns Pi's `context_edit` entries:
  - each summary replaces the content of the first message the model sees of its range: the first episode's first message, the event's, or, when a compaction cut inside that episode, the first message it kept;
  - every other message of the folded episodes the model sees, their end messages and earlier summaries included, is omitted (`replacement: null`).
- The `fold` call and its result stay until the fold nudge's turn is over, so the model sees what it did for the nudge, and then leave with the rest of that turn.
- The summary names the episodes it folded:

  ```
  <agentx-folded episodes="t3Kq9Zp0LmXa c9Jp4Mx1Ya2R">
  Folded: 2 episodes (t3Kq9Zp0LmXa, c9Jp4Mx1Ya2R), about 38K tokens. `episode_read` with an episode id gives it back.

  The summary.
  </agentx-folded>
  ```
- The session file keeps everything.

**`episode_read({ episode, before?, after?, page? })`** gives back an episode, with `before` and `after` episodes around it, also when it was folded or summarized, from the thread's own session file. It is Markdown: a heading per episode, its messages as they were, the model's text, each tool call with its arguments, each result in a code block. Images are named, not shown: the agent opens their files with `read`. A long answer comes in pages of about 8K tokens.

## Fold nudges

When an episode ends, outside a one-shot run, and the episodes since the last fold nudge used more than `foldNudgeEvery` tokens, the extension adds a fold nudge after the end message and asks Pi for one more turn (`continue: true` from `agent_before_settle`) ([D89](#d89)).

- A fold nudge needs an episode besides the newest, which stays, and comes only after an episode that succeeded.
- It gives the context's size of the window and the instructions to fold: what to fold first and what never, how to give the ranges, the rules for a summary, and to say only that when nothing should be folded. They leave the context with it, so they cost tokens only during its turn.
- When that turn ends, at the next `agent_before_settle`, the fold nudge and everything after it leave the context: the agent's calls, their results and its answer. A message a person types into the turn, in `agentx chat`, stays, with what follows it. A turn cut off by an abort leaves the fold nudge until the end of the next episode.
- The event queue settles an episode's events at the run's first settle, before the turn to fold, so that turn, failed or cut off, does not touch them, and it steers nothing into the turn: an event that arrives meanwhile starts the next episode ([event queue](../event-queue/README.md#the-event-queue-extension)).

## Compaction

Pi compacts when the context passes the window less `compaction.reserveTokens` (reason `threshold`), after the model refused a context as too long (`overflow`), and when a person types `/compact` (`manual`). It checks before an episode's first call to the model, ahead of `before_agent_start`, and between the turns of an episode, a turn being one call to the model and the tool calls it asks for. The extension writes the compaction in all three cases ([D88](#d88)):

- It keeps the newest episodes, the one in progress among them, up to `keepEpisodes` of them and as many as fit in Pi's own `compaction.keepRecentTokens`. Before an episode's first call, its first message is not written yet, so the episode about to start is not one of them.
- When not even the newest fits, or every episode does, it keeps what Pi's own cut keeps, which never parts a tool call from its result and can be inside an episode. A cut on a message the model does not see, such as a refused answer, moves to the next one it does.
- Everything the model sees before the kept part, fold summaries too, goes to a call of the session's model, with the previous compaction's summary and a person's `/compact` instructions. The answer, in the form of a fold, is the compaction's summary: its tag names the episodes it summarizes, the previous summary's too, and says when the cut is inside an episode, whose latest messages follow. That episode can be folded later.
- When the call fails, or its answer is cut off at the token limit or calls a tool, Pi compacts as it does by itself. So it does when the handler throws, after it reports the error.

## The prompt cache

- A fold makes the provider read the context again from its first folded message, once.
- A compaction makes it read everything again, once.
- End messages and fold nudges are at the end of the context, and a fold nudge's turn leaves only what came before it; the model section changes only with the model.

## Settings

Under `agentx.memory.compaction` in the agent's `.pi/settings.json`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` turns off folds, fold nudges and the extension's compactions: `fold` refuses. The model section, the episodes' first lines and end messages and `episode_read` stay. |
| `foldNudgeEvery` | `0.1` | Tokens the episodes since the last fold nudge may use before the next: a whole number is a count of tokens, a fraction a share of the window. |
| `keepEpisodes` | 10 | The most episodes a compaction keeps. |

How much a compaction keeps comes from Pi's own `compaction.keepRecentTokens` (20K by default), and when Pi compacts from its `compaction.reserveTokens` and `compaction.enabled`.

## Known limits

- Pi asks the extension for a compaction only when its own cut leaves something to summarize. Any context near the window's end does.
- `episode_read` reads only the thread's current session file, not its earlier sessions or other threads, until episodes are stored apart (step 2 of the memory task).
- Sizes are estimates, a quarter of the text's length, also for images.
- Each end message is a user-role message before the next episode's first message, so two user messages follow each other. The fake model of the tests takes that; real providers are not tested yet.
- A run that an extension starts with `pi.sendMessage(..., { triggerTurn: true })` has no input, and one that a command typed with `/` starts, a skill's or a prompt template's, in `agentx chat`, keeps its text as typed, since Pi expands it only when the text starts with it. Neither is an episode of its own: its messages join the episode before.
- The summary call has no limit of its own. Near the window's end it can fail, and then Pi's own compaction runs.
- Pi checks each `context_edit` against the whole branch, which a compaction does not shorten, so a fold costs its edits times the thread's entries: about 0.2 s for 300 edits on a branch of 20K entries, twice per fold.

## Decisions

<a id="d86"></a>
### D86. The episode is the unit of folds, with an id of its own, given by the line its first message starts with, and by its end message

- **Problem.** The agent needs names for what it folds, where each part starts and ends, and what folding each would save. Events steered into a run share it, and the same parts are later the unit of episodic memory.
- **Decision.** An episode, one of Pi's runs, is the unit, with an id of its own. Its first message starts with a line that gives its id and marks where it starts; a message where it ends gives its id and the tokens it used.
- **Why.** The line and the end message show the agent each episode's bounds and name, and a size per episode is all a fold needs; unlike a running total, it never goes stale. An id of its own makes each attempt at an event an episode of its own, and leaves event ids to the queue and the inbox. The line is in the first message itself, after the system message Pi writes at a run's start, so the session's system prompt stays first, and the session file keeps it, where this extension and indexing later find the bounds, also when a fold or a compaction took it out of the context.
- **Rejected.** A message of its own before the first message: it would come before the run's system message, and a session's system prompt would then be sent as an update.
- **Rejected.** A line with the context's size on every tool result and event: the total is wrong after the next fold. A tag with an id on every message, as billion-context does: it costs tokens on every message for good.

<a id="d87"></a>
### D87. A fold puts the summary in place of the first message the model sees of its range, omits the rest and the `fold` call, and takes in whole earlier folds

- **Problem.** A fold must leave a context that every provider takes: a tool call kept with its result, and a user message first. The summary must say what was folded, so the agent can read it back, and no episode should be in two folds.
- **Decision.** `fold` folds ranges of whole episodes, each from one episode up to, not including, another, with a summary each. A summary replaces the content of the first message the model sees of the range, the first message of its first episode, line and event both, marked `<agentx-folded>` with the episodes' ids and size. Everything else of the episodes, their end messages and earlier summaries in them are omitted, and the `fold` call itself with the fold nudge's turn. A range that takes in part of an earlier fold grows to take all of it.
- **Why.** Whole episodes never split a call from its result. The first message is a user message, so the context still starts with one, while the last message of an episode can be a tool result, which a replacement would part from its call. Replacing the first message and omitting the end messages leaves no id the agent cannot fold. Omitting the call leaves the summary once, and taking in whole folds leaves one summary per episode.

<a id="d88"></a>
### D88. A compaction keeps the last episodes, or Pi's cut inside the newest, and summarizes all before in the form of a fold

- **Problem.** Pi's compaction cuts at a token count, which can cut an episode in two, and its summary does not say which episodes it holds.
- **Decision.** The extension writes every compaction. It keeps the newest episodes, at most `keepEpisodes` and within Pi's `compaction.keepRecentTokens`, or, when not even the newest fits, what Pi's cut keeps. The session's model summarizes everything before, the agent's fold summaries too, with the fold's rules, into a summary marked as a fold. When the call fails, Pi compacts by itself.
- **Why.** Whole episodes keep each piece of work together. One episode too big to keep needs a cut inside it, which Pi already makes safely. One budget, Pi's, decides both how much Pi's cut and the extension's keep. A summary in a fold's form names its episodes, which `episode_read` gives back, and the rest of a cut episode folds like any other.
- **Rejected.** Having the agent fold when Pi compacts: on an overflow the model has already refused the context, Pi compacts between the model's runs inside an episode, the episode in progress cannot be folded, and Pi's hook must return a compaction.

<a id="d89"></a>
### D89. The agent folds only when a fold nudge asks, after an episode ends, with one turn of its own and the instructions in the fold nudge, which then leave the context

- **Problem.** A request to fold in the middle of an episode breaks into the agent's work. Instructions to fold in the system prompt cost tokens on every call, and the request, its instructions and the agent's answer are of no use once it has folded.
- **Decision.** When an episode ends and the episodes since the last fold nudge used more than `foldNudgeEvery` tokens, the extension adds a fold nudge with the instructions and asks Pi for one more turn. `fold` folds only in that turn. When the turn ends, the fold nudge and what the agent did for it are omitted. The system prompt says only that a fold nudge will come and says how.
- **Why.** Between episodes the agent knows which tasks are done. Counting the episodes since the last fold nudge needs no saved state and is not thrown off by what a fold saves. The tool stays declared all the time: taking it out and putting it back would leave system messages, which no edit can omit, and change the tools the cache starts with.
- **Consequence.** The event queue settles a run's events at its first settle, before the turn to fold, and steers nothing into that turn, so the turn cannot fail or cancel an event and holds none.
