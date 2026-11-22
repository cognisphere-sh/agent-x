---
name: memory
title: Give each agent memory and sub-agents, built in five steps
description: The agent keeps versioned skills and folds its own context, then searches every thread's transcripts, then has a dream thread turn them into consistent memories and skills, then keeps a daily log per thread and a list of what each thread owns, then delegates tasks to sub-agents that report back to it. Hints come later.
type: feature
priority: none
status: in-progress
modules: [agent-runtime/pi/pi-package, agent-runtime/agent, agent-runtime/events, coordinator-runtime]
created: 2026-11-18
updated: 2026-11-20
---

# Give each agent memory and sub-agents, built in five steps

A thread is the agent at work on one task. Like a person, it keeps its focus on that task, but it knows what it learned on other tasks and can look it up.

## The layers

| Layer | What it is | Step |
|---|---|---|
| Skills | Procedures. Each is a section of the system prompt with its version, so a thread sees when one changes | 1 |
| Focus | The thread's own context, in episodes. The agent folds what the task no longer needs when a fold nudge asks, and knows how much each episode added | 1 |
| Episodes | The raw transcripts of every thread, searchable, readable around a hit | 2 |
| Memories | Facts, preferences, decisions and lessons. A dream thread writes them from new episodes, keeps them consistent, and lets newer ones override older ones | 3 |
| Task logs | Each thread's daily log of its active tasks, and one file that says what each thread owns | 4 |
| Sub-agents | Threads a thread starts for one task, with the prompt, tools and skills it chooses. They report only to it, and it can ask them follow-up questions | 5 |
| Hints | A few lines before a run pointing at relevant skills, memories, episodes and tools, ranked by a fast decision model | later |

Hints wait in the backlog. They need both kinds of memory and a decision model, and where models run is still open.

## Sources

We copy prompts and code from these projects where they fit, changed where our system needs it. A file that takes from one names it at the top as its source.

- **billion-context:** folds the agent decides on, the rules for its summaries, fold nudges as the context grows, summaries of summaries, a forced fold near the limit.
- **pi-hermes-memory:** procedural skills, memories that are consolidated rather than appended, sources on every entry.
- **qmd:** keyword (BM25) and vector search, merged by reciprocal rank fusion.

All three are MIT, so copied code keeps its source's MIT notice. billion-context's license adds one term: a product that uses it says so, with a link to its repository, in its docs. When we copy from it, agentx's README credits it.

## Shared choices

- **Where it runs.** Extensions in agentx's Pi package, so the agent is the same under `agentx chat` and `agentx run`. Skills and episodic memory are always on. A part with something to set has a key under `agentx.memory` in the agent's `.pi/settings.json` (`compaction`, `dream`), and can be turned off there.
- **Where state lives.** In the agent's `storage/knowledge/`, with what else it learns:
  - the skills the agent writes, only in `skills/`, the folder a new agent's settings already list;
  - the index and dream's state in `memory/`.

  Task logs (step 4) are notes on work, so they go in `storage/workspace/`. Nothing is kept outside the agent or shared between agents.
- **The thread.** It is the name of the session's folder, read the way the event-queue extension reads it.
- **One agent, one personality.** An agent is like one person. Its threads share its episodes, memories and skills, and it uses what any person told it in any thread. To keep people apart, a project gives each person an agent of their own.
- **The index** (step 2 on). One SQLite file per agent, `storage/knowledge/memory/index.db`, opened with `node:sqlite` as the event queue is (`src/agent-runtime/sqlite.ts`).
  - It holds a copy of each chunk's text, so keyword search, snippets and `episode_read` all run on it. Pi's session files stay the record. Deleted, the index gets each thread's episodes back when the thread runs.
  - Keyword search uses FTS5 and `bm25()`.
  - Vector search uses sqlite-vec (`sqlite-vec@0.1.9`): a `vec0` table in the same file, loaded with `node:sqlite`'s `loadExtension`. Both work on Node 24.12. One query finds the nearest chunks and filters them by thread and time. Its npm package ships the built library for each platform. Verify when building that it loads on each platform agentx supports, and that the filter works in the same query.
  - Results from the two searches are merged by reciprocal rank fusion.
  - **Rejected: vectors as BLOBs, compared by cosine in JS.** Every search would copy every vector into JS. At 768 numbers a chunk, 50,000 chunks are about 150 MB.
  - **Rejected: qmd as the index.** It indexes markdown files on disk, so transcripts would have to be written out as files. It also brings three local models that the hot path doesn't use.
  - **Rejected: Pi's sessions kept in SQLite.** Pi's SDK can start an in-memory session from entries kept elsewhere (`SessionManager.inMemory`). But agentx runs the `pi` command, which reads only session files, and Pi has no public hook to save each new entry.
- **Models.** Embeddings (step 2) are reached over HTTP, at an endpoint in the project's config. Where models run is [to decide](#to-decide). Without an embedding endpoint, search is keyword only.
- **Safety.** Transcripts hold event content, which the harness treats as data, never instructions.
  - Every memory carries its sources: thread, episode and time.
  - The prompt says memories are context. They never override the harness, the developer's prompt or a current message.
- **Prompt cache.** What changes every run goes at the end of the context, in a message or an entry, not into the system prompt.
  - System prompt sections change only when their content does, such as a skill's version or the model.
  - Pi sends a changed section as one appended system message that patches only that section. Models that accept a system message mid-conversation keep their cache; other models miss it once per change (Pi's `docs/extensions.md`).

## Step 1: skills

Built: the [skills extension](../../architecture/agent-runtime/pi/pi-package/README.md#the-skills-extension).

### What Pi does

- At startup, Pi finds the skills in every location: the agent's `.pi/skills/`, the folders in its `skills` setting, and Pi packages, agentx's among them.
- From them it builds one system prompt section, `skills`: a short how-to, then each skill's name, description and path. There is no version, and any change sends the whole list again.
- It doesn't look again until `/reload`, so a skill written during a session is missing, and a changed description isn't seen.
- `before_agent_start` gets the list as `systemPromptOptions.skills`, fresh each run. Pi builds its `skills` section from that list after the hook, and leaves the section out when the list is empty (`dist/core/system-prompt.js`).

### The skills extension

It replaces Pi's one `skills` section with a section per skill.

- In `before_agent_start`, it empties `systemPromptOptions.skills`, so Pi writes no `skills` section.
- Pi still finds the skills, so `/skill:name` keeps working. It uses Pi's own list, not the one in the prompt (`dist/core/agent-session.js`).
- Every run, the extension reads the skills again itself: every skill Pi found, and any new one in the folders of the `skills` setting. A new or changed skill shows up without `/reload`.
- **Rejected: `--no-skills`.** It drops the skills of the `skills` setting and of other packages, which the extension would then have to find itself.
- **Sections:**
  - `agentx-skills`: how to use a skill and how to change one (below), and any skill it leaves out, with why.
  - `agentx-skill-<name>`, one per skill: its name, description, version and path.
  - A new skill adds its section. A change to a skill's description or version changes only its section, which Pi sends again. A removed skill's section goes.
  - That is how a thread learns that a skill changed: it sees the new version, and reads the skill's `CHANGELOG.md` for what changed.
- **Left out:**
  - skills with `disable-model-invocation`, as Pi does;
  - skills in `~/.agents/skills`, which Pi loads for every project and which are not part of the agent. The system-prompt extension's filter for them moves into this extension, and the system-prompt extension no longer touches skills.
- **A broken skill** (no name or description, or a name that isn't lowercase letters, digits and hyphens) is skipped and listed in `agentx-skills`. It never stops the run.

### A skill

- A folder, `<name>/`, with:
  - `SKILL.md`, whose frontmatter has `name`, `description` and `metadata.version`, a number;
  - `CHANGELOG.md`, one entry per version, newest first: a `## <version> · <date>` heading, then what changed and why.
- The agent reads and writes skills with Pi's `read`, `write` and `edit`. There is no skill tool.
- Whoever changes a skill (the agent, dream or the developer) raises its version and adds an entry. The harness prompt, `core/3-learning.md`, says so. A change without a new version shows nothing to other threads.
- The agent's own skills are only in `storage/knowledge/skills/`. Skills in `.pi/` and in packages are the developer's, and the agent only reads them.

## Step 1: episodes and folds

Built: the [episode extension](../../architecture/agent-runtime/pi/pi-package/episodes/README.md) and the [context extension](../../architecture/agent-runtime/pi/pi-package/context/README.md).

- **The episode is the unit:** one of Pi's runs, with the message that started it and any events steered into it. It starts at the first user message after the previous episode's end, and ends with a message that gives its id, its own, so each attempt at an event is an episode of its own, and the tokens it added: what its last answer used, less what its first answer read, plus its event, estimated. No model call follows it.
- **`fold({ ranges: [{ from, to, summary }] })`** folds ranges of whole episodes that do not overlap, each from episode `from` up to episode `to`, which stays. A range takes in an earlier fold whole or not at all, and then its summary replaces the old one. Each summary takes the place of the first message the model sees of its range, the first episode's event, marked as folded with the episodes' ids; everything else of the episodes, their end messages too, is omitted with `context_edit` entries, and the `fold` call with the rest of the fold nudge's turn. `fold` folds only during a fold nudge's turn.
- **Fold nudges** come when an episode ends and the episodes since the last fold nudge added more than `foldNudgeEvery` tokens, the sum of their end messages, with one more turn to fold, after the episode's events are settled. The fold nudge holds the instructions: what to fold, long explorations, multi-step processes and executions among them, keeping only what was learned and what matters; and the summary rules as guidance: stand alone, keep goals, decisions and exact values, drop used output, end with what is still open, do not name the episodes. It and that turn then leave the context; the system prompt says only that a fold nudge will come.
- **Reading back:** step 2's `episode_read` gives back a folded or compacted episode.
- **Compaction** is Pi's own.
- **Settings:** `agentx.memory.compaction`: `enabled`, `foldNudgeEvery`.

## Step 2: episodic memory

Built, search by keyword: the [memory extension](../../architecture/agent-runtime/pi/pi-package/memory/README.md). Search by meaning, with vectors, is next.

### What is indexed

- **The source** is Pi's session files in `storage/sessions/<thread>/`. They hold the raw history, which folds and compaction never change.
- **The unit is an episode,** as in step 1, keyed by the id its end message gives. Its id is unique across threads. Its text is the Markdown that `episode_read` gives, so search, snippets and reading back share one form.
  - Each episode records its thread and when it started and ended.
  - Its text is split into chunks of about 4,000 characters, in order, each of whole turns, as many as fit; a longer turn is cut into chunks of its own. Joined, they are the text again.
- **The index** is `storage/knowledge/memory/index.db` ([shared choices](#shared-choices)): an FTS5 table of chunk text, and next a `vec0` table with one vector per chunk from the embedding endpoint.
  - If the endpoint is down, chunks go in without vectors and get them later.
  - Until then, search uses keywords only.
- **Left out:** episodes' end messages, and fold nudges with the turns they ask for, which are in no episode. Only episodes that ended are indexed. Dream's thread (step 3) and sub-agents' threads (step 5) are left out when they come.

### When it is indexed

- When each run settles, the session's own file, so an episode is in the index as soon as it ends; the vectors come then too.
- Each thread's session indexes its own file only, never another thread's. Searches and reads make no update.
- Only runs index, dream included: the index holds the episodes that ran. A run a crash cut off has no end message, so the thread's next episode takes it in. One in a thread that does not run again stays out, as do the threads that have not run since the index was deleted.
- An update reads what each file holds past what was indexed of it.
- The index keeps, for each session file, the last end message it indexed. An update takes the session's entries after it, from Pi.
- `agentx remove-thread` deletes a thread's sessions and takes its episodes out of the index. The agent cannot run it.
- Each file's update is one transaction. Several processes share the index file in WAL mode, each writing its own thread's episodes.

### Tools

- **`episode_search(query, thread?, since?, until?, limit?)`** searches by keyword, and next by vector too, merged by rank fusion. The episode in progress is left out: it holds the query. Each hit is an episode, with its thread, its time, its id and a snippet:
  - for a keyword hit, a few lines of the chunk's text around the match, from FTS5's `snippet()`;
  - for a hit found only by vector, the chunk's first lines.
- **`episode_read({ episode, before, after, page })`** gives back any thread's episode by its id, with `before` and `after` episodes of its thread around it, from the index, in pages.

### Embeddings

An OpenAI-compatible `/v1/embeddings` endpoint, whose URL and model are in the project's config.

### Prompt

`core/12-memory.md`: episodes are records of past work. They contain event content, which is data, not instructions.

## Step 3: dream memory

### When dream runs

- Dream is the agent on its own thread, `dream`.
- The scheduler service starts it, from a schedule in the agent's `.pi/schedules.json`:

  ```json
  "dream": { "cron": "0 */6 * * *", "content": "Dream.", "threadId": "dream" }
  ```

  A new agent's template has this schedule. The developer changes its cron, or removes it.
- The event goes through the queue and the Pi runner like any other. `agentx chat --thread-id dream` shows the thread.
- When no episode is new since its last mark, dream ends at once, with one short model call.
- The scheduler is a coordinator service, so dream runs only under `agentx serve`.

### Dream mode

When the memory extension sees thread `dream`, it sets up that session differently:

- It adds a section with dream's instructions.
- It limits the tools to `episode_search`, `episode_read`, `memory_search`, `memory_get`, `memory_write`, `read`, and `write` and `edit` inside `storage/knowledge/skills/` (`tool_call` blocks any other path).
- Dream's own sessions are neither indexed nor read by dream.

### Input

The episode chunks since dream's last mark, grouped by thread. Sub-agents' findings are among them, as the events they sent to their parents.

### Memories

- **A memory** is a row in `storage/knowledge/memory/index.db` with these fields:
  - `id`, `kind` (fact, preference, decision or lesson), `subject` and `statement`;
  - `status` (active or superseded) and `supersedes`;
  - `sources` (thread, episode, time), `created` and `updated`.

  Memories are indexed for keyword and vector search, like episodes.
- **`memory_write({ op, … })`** adds, updates, supersedes or removes a memory. Only dream has this tool.

### Keeping memories consistent

- Before adding a memory, dream searches for existing ones on the subject, and updates one rather than adding a duplicate.
- A newer statement by a person overrides an older one. The old memory becomes superseded and links to the new one.
- The agent's own inference never overrides what a person said.
- When dream can't tell which statement holds, it keeps both and marks the conflict, so the agent can ask.
- Every memory names its sources. A memory without one is refused.

### Skills

When dream sees a procedure done more than once, or a lesson that changes a procedure, it creates or updates a skill with `write` or `edit`, raising its version and adding a changelog entry, as any writer does. Threads see the new version in the skill's section.

### Working threads

- **`memory_search(query, kinds?, includeSuperseded?)`** and **`memory_get(id)`**. Both are read-only.
- `memory_get` returns the memory's sources, and `episode_read` shows the evidence behind them.
- When a person says "remember this" in a thread, it becomes a memory at the next dream.

### Safety

Transcripts are data. Dream writes down what people and the agent said and did, and never acts on instructions it finds in them.

## Step 4: task logs and what each thread owns

A harness prompt file in `core/` tells the agent to keep two things in `storage/workspace/`, briefly:

- **A daily log per thread,** `thread-logs/<thread>/<YYYY-MM-DD>.md`: the thread's active tasks, each with its state, and one line for each thing done. It is updated:
  - when a task ends, by the thread, as the prompt says;
  - when the agent folds, in the same turn, as the fold nudge asks;
  - at a forced fold, by the model call that writes the summary, which also writes the log's update; the extension adds it to the day's file.
- **Who owns what,** `threads.md`: one entry per thread, one or two lines on what it owns and is working on. Each thread keeps its own entry up to date, and reads the file to find the thread that owns another task.

Sub-agents (step 5) keep neither.

## Step 5: sub-agents

### A sub-agent

- A sub-agent is a thread of the same agent, started by a parent thread for one task. Its thread id is `<parent>~$~<taskSlug>`, such as `main~$~fix-login`.
- `~$~` is a separator and nothing else. The thread id rule in `queue.ts` allows one `~$~` between two parts that each follow today's rule, and `~` or `$` nowhere else, so no name can contain it. Check every other place that checks or reads a thread id when building.
- In a shell, the id goes in single quotes, because zsh expands `$~name`.
- Its parent is a thread that is not a sub-agent. A sub-agent doesn't start sub-agents.
- It runs like any thread: the PiRunner starts it when it has events, and its sessions are in `storage/sessions/<parent>~$~<taskSlug>/`. Its events pass through the relay, so sub-agents run only under `agentx serve`.

### Delegating

- **`delegate({ task, message, systemPrompt?, tools?, skills? })`** is a tool for threads that aren't sub-agents. `task` is the slug.
  - The first call for a task starts the sub-agent. Its event carries the setup, the prompt, tools and skills the parent chose, in a file of the event, `subagent.json`. Verify when building how the extension reads that file before the first run starts.
  - A later call for the same task is a follow-up: the sub-agent goes on in its session, with all it did so far. The setup stays as it was.
- **The setup.** The extension keeps it as a session entry (`pi.appendEntry`) and applies it at the start of every run (`before_agent_start`):
  - **prompt:** the harness's core sections, except those on learning, routing, workflows, schedules and task logs; a short section on being a sub-agent and its parent; and the parent's `systemPrompt` in place of the agent's own prompt and notes. Without a `systemPrompt`, the agent's own prompt stays, without its notes;
  - **tools:** only those named, with `pi.setActiveTools()`, or all the agent's tools when none are named. The episode tools and `delegate` are never among them;
  - **skills:** only the sections of the skills named (step 1's extension), or none when none are named.

### Reporting

- A sub-agent sends events only to its parent thread. The relay refuses any other, as it does for `canSendTo`, and tells the sub-agent why.
- At the end of each run, the extension sends the sub-agent's final message to the parent as an event, from the sub-agent's thread.
  - Its prompt says to put all its findings in that message: what it found and did, with paths, ids and sources.
  - When it needs an answer, its final message asks. The parent answers with a follow-up.
- Tools that reach people directly, such as Composio's Telegram tools, are the parent's to give. The harness prompt tells it not to.

### Memory

- Sub-agents' threads are not indexed, and the episode tools aren't open to them.
- Their findings reach the parent's thread as events. That is how they get into episodes, and from there into dream.
- Folds and forced folds work in a sub-agent as in any thread.

## Later: hints

Not part of the five steps; this stays in the backlog.

### When

- At the start of each run (`before_agent_start`), within `hints.timeoutMs`, which is 2 to 3 seconds in total.
- Pi doesn't run that hook for an event steered into a run already going, so a steered event gets no hint.

### The query

- The event's text.
- The thread's objective and state, taken from what is already there, with no model call:
  - what the latest fold summary says is still open, or the thread's first event, shortened, when the thread has no fold yet;
  - the last episode, shortened.

### Candidates

- Memories and episodes: the top K of each by keyword and vector search.
- Skills: by name and description.
- Tools the agent can call but that aren't declared, such as MCP tools behind codemode or Composio toolkits: by description.

### Filter, then rank

- **Before ranking,** drop anything already hinted in this thread in the last N runs, a skill already read in this session, and a memory or episode already returned to this thread.
- **Ranking:** the decision model scores each candidate against the query. Those above a cut-off are kept, best first, until the hint budget (for example 300 tokens) is full.

### The hint

- One short custom message after the event, returned by `before_agent_start`. Verify when building that it lands after the event in the context. It has one line per item: its kind, title and id, and how to open it (`read` the skill, `memory_get` or `episode_read`).
- It never includes the full text.
- Hints are context, not instructions.
- They are recorded so they aren't repeated. The agent can fold them like any other message.
- On a timeout or an error, there is no hint.

### The decision model

The endpoint is in the project's config. The choices:

- **OpenAI's Decisions API** (`POST /v1/decisions`, model `gpt-6-luna`).
  - It gives typed answers: a probability, a choice, or a score on 2 to 10 levels.
  - It has no ranking type, so each candidate gets one `score` question. A request can carry up to 400.
  - Input costs $0.10 per million tokens, and output is free.
- **TypeSafe's Jev,** a decision model for routing and reranking.

Measure latency and quality with about 30 candidates for each, and pick the default from that.

## Not in this plan

- Memory shared between agents, and reading another agent's threads.
- A view of memory in the web app.

## To decide

### Every step

- **Where the models run:** on the machine, or as hosted APIs. Until this is settled, step 2's search is keyword only.
- **Hosted endpoints.** A hosted embedding or decision API receives transcript text. If the models are hosted, decide which projects may use one.

### Step 2

- Retention: index everything forever, or a window.
- The embedding model: English-only, or multilingual.

### Step 3

- **Dream's session:** a new session each run, so the thread doesn't grow, or one long session that folds like any thread. A new session each run means the Pi launcher (`pi-launch.ts`) starts thread `dream` without `--continue`.
- **Dream's model:** the agent's own, or a cheaper one.
- **Direct writes:** whether a working thread may write a memory at once, or only dream can.
- **Corrections by a person:** whether a person can pin or correct a memory directly, such as from the command line.
- **Notes.** `core/3-learning.md` tells the agent to keep short rules as notes in `storage/knowledge/system_prompt/`. Decide whether notes stay once dream writes memories.

### Hints

- The default decision model, after the measurement.
- Defaults for K, the cut-off, the token budget and N.
- Whether steered events get hints, at a turn's end.
