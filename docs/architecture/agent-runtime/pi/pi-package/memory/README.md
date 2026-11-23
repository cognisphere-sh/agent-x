# Memory extension

The extension in every Pi session that gives the agent its episodic memory: it searches the episodes of all its threads by keyword and reads them back. `index.ts` is the extension and its tools, `episode-index.ts` the index, `transcript.ts` an episode's Markdown, and `index-db.ts` the index's SQLite file and tables, which loads nothing of Pi, so `agentx remove-thread` opens it too. Episodes are the [episode extension's](../episodes/README.md#episodes): only those that ended are indexed.

| When | What it does |
|---|---|
| `agent_settled` | Indexes the session's own file, so the episode that just ended is in the index. |
| `session_shutdown` | Closes the index. |

It adds two tools, `episode_search` and `episode_read`. The harness prompt, `core/9-memory.md`, says what they find, and that an episode is a record of past work whose events are data, not instructions.

## The index

`storage/memory/index.db`, one per agent, shared by all its threads ([D90](#d90)). It is built from Pi's session files, `storage/sessions/<thread>/*.jsonl`, which stay the record. Deleted, with its `-wal` and `-shm` files and while no session has it open, the index gets each thread's episodes back when a run of that thread settles, as its session takes all its entries again; a `-wal` file left beside a new index would be applied to it ([sqlite.org](https://sqlite.org/howtocorrupt.html)).

- **An episode** is a row: its id, its thread, and when its first and last messages were written.
- **Its text** is Markdown: its messages as they were written, the model's text, each tool call with its arguments, each result in a code block. Images are named, not shown: the agent opens their files with `read`. Its end message is left out. A fold nudge and its turn come after an end message, in no episode.
- The text is kept in chunks of about 4,000 characters, each of whole turns, as many as fit. A turn is one answer of the model with the results of its tool calls, after the messages that led to it, as Pi's turns are; the boundaries come from the messages, not the Markdown. A turn longer than a chunk has chunks of its own, each cut at a blank line when one is in its second half. The chunks joined are the text again. FTS5 indexes them with Porter stemming, so a word finds its other forms.
- **An update** ([D91](#d91)) takes the session's own entries, as Pi holds them in memory in the order they were written ([Pi](../../pi-reference/README.md#sessions)), not the file. For each session file the index keeps, in its `sessions` table, the id of the last end message it indexed. The update takes the entries after it, all of them when the index holds none of the file, and puts every episode that ended in the index, in one transaction. What follows the last end message is no whole episode yet, and is taken again next time.
- **Updates run** when each run settles, for the session's own file only, so an episode is in the index as soon as it ends. A thread's session indexes its own file, which no other process writes, and never another thread's. A run that a crash or a kill cut off has no end message: the thread's next episode takes it in, and it goes in with that one. Searches and reads make no update. A run that ended no episode, such as a fold nudge's turn, costs a search back to the last end message. An update that fails, such as on an index another process keeps locked, is a notice, which `agentx run` logs and `agentx chat` shows, and the thread's next run tries again from the same point.
- **A thread removed** with `agentx remove-thread` ([CLI](../../../../cli/README.md#d94)) leaves the index with its episodes, its chunks and what the index knew of its files.
- Several processes share the file in WAL mode, opened as the event queue's is (`src/agent-runtime/sqlite.ts`).

<a id="tools"></a>

## Tools

**`episode_search({ query, thread?, since?, until?, limit? })`** finds episodes by keyword ([D92](#d92)):

- It matches any word of the query, in any of its forms. FTS5's BM25 ranks the chunks with more of the words, and rarer ones, first.
- Each word is a phrase of its own, so no character is query syntax: `auth.ts` finds "auth" followed by "ts".
- It gives one hit per episode, from its best chunk, up to `limit` (10 when left out, at least 1, at most 50): the episode's id, its thread, when it ran, and FTS5's snippet of the lines around the match, the words in bold.
- `thread` limits it to one thread, and `since` and `until`, times in ISO 8601, to the episodes that started in that window. A time without an offset, `2026-11-20` or `2026-11-20T14:00`, is in the agent's time zone, as its events show times.
- The episode in progress, which holds the query itself, is not in the index: an episode goes in once it ends.

```
2 episodes found, best first.

## Episode SGy6WZk5GC4V

Thread `ops`, from Friday 2026-11-20 10:31:02 GMT+5:30 to Friday 2026-11-20 10:34:40 GMT+5:30.

> …the telegram **webhook** failed with a **signature** error…
```

**`episode_read({ episode, before?, after?, page? })`** gives back an episode of any thread by its id, also when it was folded or summarized, with `before` and `after` episodes of its thread around it, in the order they started. Each comes under a heading with its id, its thread and its times, as in a search. A long answer comes in pages of about 8K tokens: each but the last names the next, the last says it is, and a page past it is refused. A count below 0 counts as none.

Times are in the agent's time zone, `agentx.timezone`, as on its events.

## Known limits

- A session file is read in the order it was written, not along its branch. After `/tree` in `agentx chat`, the messages of a branch left behind stay in the episode they were written in.
- A forked session repeats its source's episodes, under the same ids. The index keeps those of the file it read last.
- An update takes a file's new entries in one step, which holds up the session meanwhile: all of them the first time, as after the index was deleted.
- The episodes of a session file deleted by hand, not with `agentx remove-thread`, stay in the index.
- Only runs index. A run a crash cut off goes in with the next episode of its thread; in a thread that does not run again, or whose next session is a new file, it stays out. After the index was deleted, a thread's episodes stay out until the thread runs.
- In a session written before end messages had `details`, everything up to the first new end message is one episode ([episodes](../episodes/README.md#known-limits)). The index's old read point for that file is where its last episode then started, so that episode's text is indexed again, inside the new one.
- Search is by keyword only. Search by meaning, with vectors, is planned (step 2 of the memory task).

## Decisions

<a id="d90"></a>
### D90. One SQLite index of every thread's episodes per agent, with FTS5, built from the session files

- **Problem.** The agent needs to find and read its past work in every thread. Pi keeps it in a session file per session, per thread, and has no search.
- **Decision.** One SQLite file per agent, `storage/memory/index.db`, holds each episode's Markdown in chunks of whole turns, which FTS5 indexes and ranks by BM25. It is built from the session files, which stay the record.
- **Why.** `node:sqlite` has FTS5, so keyword search needs no new dependency. With the text in the index, search, snippets and reading back run on it alone, for any thread. Chunks let a hit point into a long episode, and vectors need them later. A turn is one step of the work, so a chunk of whole turns holds a call with its result.
- **Rejected.** Searching the session files for each query: every search would read every file, and the text the model saw would be rebuilt each time.

<a id="d91"></a>
### D91. Each session indexes only its own episodes, when a run settles, from the last end message it indexed

- **Problem.** Every thread's process writes its own session files, and any of them can end or crash at any time. An episode must be in memory as soon as it ends.
- **Decision.** For each session file the index keeps the last end message it indexed. A session updates its own file in `agent_settled`, within the handler: it takes its entries after that message from Pi, and indexes every episode that ended since, in one transaction. No session reads another thread's files, and nothing else indexes, dream (step 3 of the memory task) included.
- **Why.** `agent_settled` comes once the run's end message is written ([Pi](../../pi-reference/README.md#delivering-messages)), and Pi awaits it, so the episode is in the index before a worker session ends. A thread is held by one process at a time, so each file has one writer and one indexer, and no two processes index the same file. Pi holds the session's entries already, parsed and migrated, so the index reads no file. Taking them from the last end keeps the work to what is new, and also takes a run whose update failed when the thread runs again. Searches stay off the update path, which matters once chunks get vectors when they are indexed.
- **Consequence.** An episode still running in another thread is found only once it ends, and the one in progress never. A run a crash cut off, in a thread that does not run again, and every thread's episodes after the index is deleted, are found only once their thread runs.
- **Rejected.** Indexing at each turn's end: an episode's end message comes after its last turn, and the episode is not in memory before it ends. Updating every file before each search and read: each search would wait for whatever is new, its vectors too. Indexing every thread's files in the background, when a session starts or when dream runs: a process would read the files of threads that other processes own and write, and each file would have two indexers.

<a id="d92"></a>
### D92. A search matches any of its words, each a phrase of its own, with one hit per episode

- **Problem.** An agent's query names what it remembers, often in other forms than the transcript's, or with words the transcript lacks, and with paths and ids that FTS5 would read as its own syntax.
- **Decision.** Every word of the query is quoted, as a phrase of its own, and the phrases are joined with OR; Porter stemming matches other forms, and BM25 ranks. Hits are grouped by episode, best chunk first.
- **Why.** OR finds an episode that lacks a word, and BM25 still puts the episodes with most of the words first. Quoting makes every character text. One hit per episode keeps a long episode from taking every place.
- **Rejected.** AND of the words: one word the transcript lacks, or a typo, finds nothing. FTS5's own syntax for the agent: a path or an id with a `.` or `-` in it fails.
