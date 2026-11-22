# Composio

Every agent gets [Composio](https://docs.composio.dev)'s tools, which act in external services (Gmail, GitHub, Slack and about a thousand more) through the agent's own connected accounts. The Composio extension (`extensions/composio/index.ts`) gives each thread a Composio session and hands its MCP server to Pi, and trims the answers of its searches (`extensions/composio/trim.ts`). The agent's workflows run the same tools with `ctx.composio`, in a session of their own with the same policy (`extensions/composio/policy.ts`, [functions](../../../functions/README.md#composio-in-a-workflow)).

## Composio in brief

| Term | Meaning |
|---|---|
| Project | A Composio workspace with its own API keys and connected accounts. One per environment. |
| User id | Whose accounts to use. Connected accounts are kept under it. |
| Toolkit | One service's tools, such as `gmail`. |
| Connected account | A user id's credentials for one toolkit, kept by Composio. They never reach the model. |
| Session | Made for one user id, with a policy: which toolkits it may use, whether it may start connections. It serves a few meta tools over MCP. |
| Meta tools | `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MANAGE_CONNECTIONS` (a Connect Link for a toolkit with no account), `COMPOSIO_MULTI_EXECUTE_TOOL`. |
| Connect Link | A page where a person signs in to the service. Valid for 10 minutes. |

A tool runs only when the session's policy allows its toolkit and the user id has an account for it.

## Settings

`agentx.composio` in the agent's `.pi/settings.json` ([D36](../../../agent/README.md#d36)):

```json
"agentx": {
	"composio": {
		"userId": "support@acme",
		"session": {
			"toolkits": { "enable": ["gmail", "github"] },
			"manage_connections": { "enable": false }
		}
	}
}
```

- `userId` is the agent's identity in Composio ([D38](#d38)). `init-agent` writes `<agent>@<project>`. It never changes, also when the agent is renamed.
- `session` is the body of Composio's request that creates a session, in Composio's names ([configuring sessions](https://docs.composio.dev/docs/configuring-sessions)), with one addition of agentx's: `"*"` in `toolkits.enable` ([D76](#d76)). It goes over agentx's defaults key by key, also inside an object.

| Key | agentx's default | Why |
|---|---|---|
| `manage_connections` | `{ "enable": true, "enable_connection_removal": false }` | The agent may ask for connections, but may not delete an account. |
| `workbench` | `{ "enable": false }` | No remote sandbox: the agent has its own shell. |

`toolkits` has no default in agentx: without it, Composio allows every toolkit in its catalog. `"toolkits": { "enable": ["*"] }` says the same in the settings: the extension sends no `enable` list, and keeps the rest of `toolkits`, such as `disable`. The [agent template](../../../agent/README.md#pisettingsjson) enables eight, the services an agent most often needs ([D76](#d76)). A person approving the Connect Link gates each account.

A developer limits the agent with `toolkits.enable` (only these toolkits), `toolkits.disable` (all but these), `manage_connections.enable: false` (no new connections; the agent sends the person to its developer), or `connected_accounts` (pins the account per toolkit).

## The extension

On `session_start`:

1. Without `COMPOSIO_API_KEY` or a `userId`, it stops there and tells the model why ([D41](#d41)).
2. It finds the thread's Composio session: the last `agentx-composio` entry in the thread's Pi session holds its id and the request that made it: the policy, agentx's defaults with the settings over them, and the user id. With the same request, it reads that session.
3. Otherwise, or when Composio no longer has it, it creates one.
4. It registers the session's MCP URL with Pi, with direct tools ([D40](#d40)). The header names the key's variable, `${COMPOSIO_API_KEY}`, which Pi fills in when it connects, so the key is not in the server's config.

Each call gives up after 10 seconds. The first event already sees the tools, because the event queue extension delivers only after every extension has started ([D44](../event-queue/README.md#d44)), and Pi's first prompt waits for MCP servers ([Pi](../../pi-reference/README.md#mcp-servers)). `COMPOSIO_BASE_URL` points the extension elsewhere, as the tests do.

- A new session is recorded when a run starts, not at `session_start`: a session that does not hold its thread runs nothing, and a write from it would fork the conversation.
- A newly connected account needs no new session: Composio looks up accounts when a tool runs. A change to `agentx.composio`, or to agentx's defaults in a new agentx version, makes a new session at each thread's next start.
- A `composio` server in the agent's `.pi/mcp.json` takes the place of the registered one.
- **Failures never stop the session.** Without a key or `userId`, or when Composio fails, the session starts without Composio tools, and a `composio` section of the system prompt says why. The next start tries again.

## Search answers

For each task it is given, `COMPOSIO_SEARCH_TOOLS` answers with a plan, its pitfalls, tools' schemas, the connections of their services, the time and Composio's guidance: from about 1,400 to 3,300 tokens for one task, in a live check of six services. The extension trims each successful answer in Pi's `tool_result`, before the model reads it, and Pi saves it as trimmed ([D97](#d97), [Pi](../../pi-reference/README.md#mcp-servers)). It removes:

| What | Why it can go |
|---|---|
| Each result's `execution_guidance`, `plan_id` and `cached_plan_usecase` | Orders to follow the plan step by step, and ids of Composio's cache of plans. |
| Each stub, a schema with `hasFullSchema: false`, of a tool that is not among the results' `primary_tool_slugs` | The results still name the tool, and the prompt says to load its schema with `COMPOSIO_GET_TOOL_SCHEMAS`. |
| Everything in `session` but `id` | The order to pass the id in every call: [the prompt](#the-prompt) says a run needs none. |
| Everything in `time_info` but the time, which stays as `current_time`, in the agent's time zone | Advice on using the time. The time stays, because a message typed in `agentx chat` carries none, in the zone of every time the agent reads ([D98](../../../agent/README.md#d98)). |
| When every service the answer names is connected: everything in each connection but `toolkit` and `has_active_connection`, and `next_steps_guidance` | Account details, and "proceed". When a service has no account, both stay whole: they tell the model to connect it. |

- It removes only the fields it names, so a field Composio adds still reaches the model. An answer that failed, that is not JSON or that is not one text stays as it is.
- In the live check it saved 12% to 32% of a search: most of an answer is the full schemas Composio chooses, which stay.
- The other meta tools' answers stay as they are.

## The prompt

Composio's tool descriptions already say how to use them. The harness prompt's "External services" section adds only what is agentx's: Composio is the agent's main way into external services, and the [browser](../../../browser/README.md) is for a task that Composio, a command line tool or another tool cannot do, or that the person asks a browser for; a tool whose slug and arguments the agent already knows runs with `COMPOSIO_MULTI_EXECUTE_TOOL` at once, with no session id, whatever Composio's descriptions say, since a run needs neither a search nor a session; it searches when it does not know them or the run fails, and loads a schema that a [trimmed](#search-answers) search left out with `COMPOSIO_GET_TOOL_SCHEMAS`; how to give a Connect Link; when several services can do a task and none is connected, offer them to the person to choose from, with the one it would pick and why; without `COMPOSIO_MANAGE_CONNECTIONS`, send the person to the developer; `[Session Restriction]` means only the developer can allow the service; never ask for secrets; use Composio only through the tools and, in a workflow, `ctx.composio`, never Composio's API with the key. The "Workflows" section says how a workflow uses `ctx.composio`: find the tool and its arguments with the meta tools first, and connect accounts from a thread, since a workflow has nobody to show a Connect Link to.

## The key

`COMPOSIO_API_KEY` comes from the environment or the agent's `.env` ([D43](../../../agent/README.md#d43)). It is a scoped project key with **Session management** (read, write) and **Session tool execution** (write) only. What needs more, such as connecting an agent's Telegram bot, the coordinator does with a key of its own, `COMPOSIO_COORDINATOR_API_KEY`, which no agent gets ([D77](../../../../coordinator-runtime/services/telegram/README.md#d77)).

## Known limits

- **The agent can read the key.** It is in the Pi process's environment. With it, the agent could create a session for any user id of the project. The prompt's rule is the only barrier until sandboxes.
- **Connect Links reach a person only at the terminal, or in a [Telegram](../../../../coordinator-runtime/services/telegram/README.md) chat the agent answers.** A session `agentx run` started for any other event has nobody to show a link to. Connect an unattended agent's accounts ahead of time, in `agentx chat`.
- **A key refused after the session started** shows in `/mcp` as a server that needs sign-in.
- **Slower starts.** Every Pi process start makes one or two calls to Composio, and its first prompt waits up to 10 seconds for the MCP connection.
- **A search over 20 KB reaches the model cut, not trimmed.** Pi cuts it in the middle before `tool_result`, so it no longer parses as JSON. A search for several tasks at once can be that long.
- **Composio's descriptions say to always search first.** The prompt says to skip the search for a tool the agent knows; that the model follows the prompt over them is not tested.
- The automated tests use a fake Composio.

## Decisions

<a id="d38"></a>
### D38. Each agent has its own Composio user id, written into its settings by `init-agent`

- **Decision.** `init-agent` writes `agentx.composio.userId` as `<agent>@<project>`. The extension makes every session for it.
- **Why.** Each agent gets its own connected accounts. Written once and checked in, the id survives renaming the agent or the project.
- **Rejected.** Deriving the id from the names at run time: a rename would lose the accounts.

<a id="d39"></a>
### D39. One Composio session per thread, recorded in the thread's Pi session

- **Decision.** Each thread gets its own Composio session. Its id, with the request that made it, is a custom entry in the thread's Pi session; a different request, from the settings or agentx's defaults, or a new Pi session of the thread, as after `/new`, makes a new one.
- **Why.** A session keeps state that should not mix between threads running at once, while accounts belong to the user id. The Pi session already exists per thread, so nothing checked in changes ([D4](../../../agent/README.md#d4)). Composio's sessions never expire, so the request, not the settings, decides: a default agentx changes then reaches every thread.
- **Rejected.** One session per agent, shared by threads running at once. A static URL in `.pi/mcp.json`, which someone would have to create and paste, per environment.

<a id="d40"></a>
### D40. The extension registers the session's MCP server, with direct tools, and uses no Composio SDK

- **Decision.** Two REST calls with `fetch`, then `pi.registerMcpServer` with `exposure: "direct"`.
- **Why.** Pi already speaks MCP, so the meta tools need no code of agentx's. Direct tools reach the model like built-in ones. `@composio/core` would add 4.6 MB and require a newer Node.
- **Rejected.** agentx's own tools over Composio's REST API, whose schemas and errors agentx would own.

<a id="d41"></a>
### D41. Without Composio, the session starts and the model is told why

- **Decision.** No `COMPOSIO_API_KEY`, no user id, or a Composio that fails: no Composio tools, and a section of the system prompt that says why.
- **Why.** Every agent is meant to have Composio, so the agent should be able to explain its absence. A prompt section does not pile up in a thread that starts many times. Nobody watches a session `agentx run` started, so a UI notice would reach nobody.
- **Rejected.** A queued event, which would start a run only to report it.

<a id="d76"></a>
### D76. The agent's settings name its toolkits; agentx's code names none

- **Problem.** Which services may an agent use when its developer has not chosen?
- **Decision.** The extension sends no `toolkits` of its own, so Composio allows every toolkit. The agent template's `.pi/settings.json` enables eight common ones. `"*"` in `toolkits.enable` enables every toolkit; Composio has no such value, so the extension leaves the `enable` list out.
- **Why.** Which services an agent may use is its developer's choice, and the agent directory is where a developer's choices live. A developer reads the list in the agent's settings and edits it there, and `"*"` says "all of them" there instead of by a missing key.
- **Consequence.** An agent whose settings name no toolkits may use the whole catalog; a person approving each Connect Link still gates each account.

<a id="d97"></a>
### D97. The extension trims a search's answer by removing the fields it names

- **Problem.** A search's answer stays in the context until a fold, and much of it is guidance the harness's prompt makes needless, stubs of tools the task may not need, and account details.
- **Decision.** A `tool_result` handler removes the fields listed in [search answers](#search-answers) from each successful `COMPOSIO_SEARCH_TOOLS` answer, and the prompt says that a known tool runs without a search or a session id.
- **Why.** Composio is a hosted service whose answers can change any day, and they look the same for every service. Removing only named fields fails safe: a new field reaches the model, and a renamed one only stops being removed. The fields that tell the model to connect a service stay whenever one has no account.
- **Rejected.** Keeping only known fields, which would drop what Composio adds. Turning the full schemas of tools that are not primary into stubs, which would save the most, but costs the model a call for a schema the task may need, and Composio's "primary" is its guess. Trimming `COMPOSIO_MULTI_EXECUTE_TOOL`'s answers, which saves 30 to 60 tokens a run, most of it the session, which a run with no session id leaves out.
