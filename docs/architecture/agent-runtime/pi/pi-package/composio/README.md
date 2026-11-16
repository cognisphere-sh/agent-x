# Composio

Every agent gets [Composio](https://docs.composio.dev)'s tools, which act in external services (Gmail, GitHub, Slack and about a thousand more) through the agent's own connected accounts. The Composio extension (`extensions/composio/index.ts`) gives each thread a Composio session and hands its MCP server to Pi.

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
2. It finds the thread's Composio session: the last `agentx-composio` entry in the thread's Pi session holds its id and the settings it was made from. With the same settings, it reads that session.
3. Otherwise, or when Composio no longer has it, it creates one.
4. It registers the session's MCP URL with Pi, with direct tools ([D40](#d40)). The header names the key's variable, `${COMPOSIO_API_KEY}`, which Pi fills in when it connects, so the key is not in the server's config.

Each call gives up after 10 seconds. The first event already sees the tools, because the event queue extension delivers only after every extension has started ([D44](../event-queue/README.md#d44)), and Pi's first prompt waits for MCP servers ([Pi](../../pi-reference/README.md#mcp-servers)). `COMPOSIO_BASE_URL` points the extension elsewhere, as the tests do.

- A new session is recorded when a run starts, not at `session_start`: a session that does not hold its thread runs nothing, and a write from it would fork the conversation.
- A newly connected account needs no new session: Composio looks up accounts when a tool runs. A change to `agentx.composio` makes a new session at each thread's next start.
- A `composio` server in the agent's `.pi/mcp.json` takes the place of the registered one.
- **Failures never stop the session.** Without a key or `userId`, or when Composio fails, the session starts without Composio tools, and a `composio` section of the system prompt says why. The next start tries again.

## The prompt

Composio's tool descriptions already say how to use them. The harness prompt's "External services" section adds only what is agentx's: how to give a Connect Link; without `COMPOSIO_MANAGE_CONNECTIONS`, send the person to the developer; `[Session Restriction]` means only the developer can allow the service; never ask for secrets; never call Composio's API with the key.

## The key

`COMPOSIO_API_KEY` comes from the environment or `agent-x/.env` ([D43](../../../agent/README.md#d43)). It is a scoped project key with **Session management** (read, write) and **Session tool execution** (write) only. What needs more, such as connecting an agent's Telegram bot, the coordinator does with a key of its own, `COMPOSIO_COORDINATOR_API_KEY`, which no agent gets ([D77](../../../../coordinator-runtime/services/telegram/README.md#d77)).

## Known limits

- **The agent can read the key.** It is in the Pi process's environment. With it, the agent could create a session for any user id of the project. The prompt's rule is the only barrier until sandboxes.
- **Connect Links reach a person only at the terminal, or in a [Telegram](../../../../coordinator-runtime/services/telegram/README.md) chat the agent answers.** A session `agentx run` started for any other event has nobody to show a link to. Connect an unattended agent's accounts ahead of time, in `agentx chat`.
- **A key refused after the session started** shows in `/mcp` as a server that needs sign-in.
- **Slower starts.** Every Pi process start makes one or two calls to Composio, and its first prompt waits up to 10 seconds for the MCP connection.
- The automated tests use a fake Composio.

## Decisions

<a id="d38"></a>
### D38. Each agent has its own Composio user id, written into its settings by `init-agent`

- **Decision.** `init-agent` writes `agentx.composio.userId` as `<agent>@<project>`. The extension makes every session for it.
- **Why.** Each agent gets its own connected accounts. Written once and checked in, the id survives renaming the agent or the project.
- **Rejected.** Deriving the id from the names at run time: a rename would lose the accounts.

<a id="d39"></a>
### D39. One Composio session per thread, recorded in the thread's Pi session

- **Decision.** Each thread gets its own Composio session. Its id, with the settings it was made from, is a custom entry in the thread's Pi session; a change of settings, or a new Pi session of the thread, as after `/new`, makes a new one.
- **Why.** A session keeps state that should not mix between threads running at once, while accounts belong to the user id. The Pi session already exists per thread, so nothing checked in changes ([D4](../../../agent/README.md#d4)).
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
