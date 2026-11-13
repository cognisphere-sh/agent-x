# Composio

Every agent gets [Composio](https://docs.composio.dev)'s tools, which act in external services (Gmail, GitHub, Slack and about a thousand more) through the agent's own connected accounts. The Composio extension (`src/agent-runtime/pi-package/extensions/composio/index.ts`) gives each thread a Composio session and hands its MCP server to Pi. The plan it was built from, with its follow-ups: [Composio access](../../../../tasks/done/composio-access.md).

## Composio in brief

| Term | Meaning |
|---|---|
| Project | A Composio workspace with its own API keys, auth configs and connected accounts. One per environment. |
| User id | Whose accounts to use. Connected accounts are kept under it. It carries no policy. |
| Toolkit | One service's tools, such as `gmail`. |
| Connected account | A user id's credentials for one toolkit, kept by Composio. They never reach the model. |
| Session | Made for one user id, with a policy: which toolkits and tools it may use, whether it may start connections, which account to use per toolkit. It keeps runtime state of its own (tool memory, sandbox files) and serves a few meta tools over MCP. |
| Meta tools | `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`, `COMPOSIO_MANAGE_CONNECTIONS` (a Connect Link for a toolkit with no account), `COMPOSIO_MULTI_EXECUTE_TOOL`. |
| Connect Link | A page where a person signs in to the service and consents. Valid for 10 minutes. |

A tool runs only when both say yes: the session's policy allows its toolkit, and the user id has an account for it.

## Settings

`agentx.composio` in the agent's `.pi/settings.json` ([D36](../../agent/README.md#d36)):

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

- `userId` is the agent's identity in Composio ([D38](#d38)). `init-agent` writes `<agent>@<project>`. It never changes, also when the agent is renamed, and no two agents of a Composio project share it.
- `session` goes into the body of Composio's request that creates a session (`POST /api/v3.1/tool_router/session`), in Composio's names ([configuring sessions](https://docs.composio.dev/docs/configuring-sessions)). Its keys go over agentx's defaults key by key, also inside an object: `{ "manage_connections": { "enable": false } }` keeps `enable_connection_removal: false`. `toolkits` is the exception and is replaced whole, because its `enable` and `disable` lists exclude each other.

| Key | agentx's default | Why |
|---|---|---|
| `toolkits` | `{ "enable": ["gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "supabase", "hubspot", "telegram"] }` | The services an agent most often needs. A person approving the Connect Link is the gate for each account. |
| `manage_connections` | `{ "enable": true, "enable_connection_removal": false }` | The agent may ask for connections, but may not delete an account, which Composio allows by default. |
| `workbench` | `{ "enable": false }` | No remote sandbox: the agent has its own shell and workspace. |

| A developer sets | Effect |
|---|---|
| `toolkits.enable` | The agent may find and use only these toolkits. Nothing it does widens the list. A toolkit in the list needs no account yet. |
| `manage_connections.enable: false` | No `COMPOSIO_MANAGE_CONNECTIONS`: the agent cannot ask for a connection, and tells the person to ask its developer to add the service. |
| `connected_accounts` | Pins the account to use for a toolkit. An account connected later is not used until the pin changes. |

## The extension

On `session_start`:

1. Without `COMPOSIO_API_KEY` in the environment, or without a `userId`, it stops there and tells the model ([D41](#d41)).
2. It finds the thread's Composio session: the last `agentx-composio` custom entry in the thread's Pi session holds its id and the `agentx.composio` it was made from. If the settings are the same, it reads the session (`GET /api/v3.1/tool_router/session/{id}`).
3. With no entry, other settings, or a session Composio no longer has (404), it creates one with the defaults, `session` and `user_id`.
4. It registers the session's MCP URL with Pi: `pi.registerMcpServer("composio", { url, headers: { "x-api-key": "${COMPOSIO_API_KEY}" }, exposure: "direct" })` ([D40](#d40)). Only a URL on Composio's own origin gets the key, as Composio's SDK checks.

Both REST calls send `x-api-key` and give up after 10 seconds. The first message already sees the tools, for two reasons. Pi awaits `session_start` handlers one after another, and the Composio extension's comes before the message queue extension's, which starts delivering, because the package's manifest lists it first ([D42](../README.md#d42)). And the first prompt waits for servers with direct tools ([Pi](../../pi/README.md#mcp-servers)). A test guards this. `COMPOSIO_BASE_URL` points the extension elsewhere, as the tests do.

- **A new session is recorded when a run starts** (`before_agent_start`), not at `session_start`: a session that does not hold its thread runs nothing, and a write from it would fork the conversation.
- **A new account needs no new session.** Composio looks up the user id's accounts when a tool runs. A change to `agentx.composio` makes a new session at each thread's next start.
- **The header names the variable**, so the key is not in the server's config, which every extension can read with `pi.getMcpServers()`. Pi fills it in when it connects.
- **A `composio` server in the agent's `.pi/mcp.json` takes the registered one's place**, because Pi gives `mcp.json` precedence.
- **Failures never stop the session.** With no key or no `userId`, or when Composio cannot be reached or refuses a call, the session starts without Composio tools, and a `composio` section of the system prompt says `Composio tools are unavailable in this session: <why>`, set in `before_agent_start`. A prompt section, not a message: a thread that starts many times without Composio does not collect the same note in its conversation, and Pi sends the model only what changed. The text never holds the key. The next start tries again.

## The prompt

Composio's tool descriptions already say how to use them: search first, use the exact slugs and schemas, connect before executing, stop at a restriction. The harness prompt's "External services" section ([Pi package](../README.md#the-system-prompt-extension)) adds only what is agentx's: give a Connect Link the way the agent answers the person, which is not always its final reply; without `COMPOSIO_MANAGE_CONNECTIONS`, name the service and send the person to the agent's developer; `[Session Restriction]` means only the developer can allow the service; never ask for secrets; without the tools, the `composio` section says why; never call Composio's API with the key.

**When availability changes.** The tools are declared only while the MCP server is connected. When Composio becomes available or unavailable between two starts of the thread's Pi process, Pi adds a patch to the conversation: the `composio` section and the four tools' declarations, added or removed. Earlier messages stay cached. Adding the tools again costs about 3,000 tokens, which stay in the conversation; removing them costs little.

## The key

`COMPOSIO_API_KEY` comes from the environment or the project's `agent-x/.env` ([D43](../../agent/README.md#d43)). It is a scoped project key with **Session management** (read, write) and **Session tool execution** (write) only. It cannot use the routes for connected accounts, auth configs, triggers, webhooks, logs or the proxy.

## Known limits

- **The agent can read the key.** It is in the Pi process's environment, and the agent runs as the same OS user. With it, the agent could create a session for any user id of the project, with any policy; no key can be limited to some user ids. The prompt's rule is the only barrier, as it is for Pi's shared `agent-x/.pi/` ([D17](../../agent/README.md#d17)). Keeping the key out of the agent's reach needs the sandboxes of the planned [AgentManager](../../README.md#planned).
- **Connect Links reach only a person at the terminal.** A session the runner started has nobody to show a link to, until [message channels](../../../../tasks/backlog/message-channels.md) exist. An unattended agent's accounts are connected ahead of time, by asking it in `agentx run`.
- **A key refused after the session started** shows in `/mcp` as a server that needs sign-in: Pi takes a refusal from a server with no `Authorization` header for one that wants OAuth.
- **Slower starts.** With a key, every Pi process start makes one or two calls to Composio, and its first prompt waits up to 10 seconds for the MCP connection. A runner's thread is ready later than Pi alone ([Agent runner](../../agent-runner/README.md#known-limits)).
- **Checked against Composio by hand, tested against a fake.** On 2026-11-13 a live project created and read sessions with the defaults (create answers 201 with `mcp.url`), Pi connected to the session's MCP endpoint and declared its four meta tools at the first prompt, the endpoint refused `GET` with 405 without harm, `COMPOSIO_MANAGE_CONNECTIONS` returned a link on `https://connect.composio.dev/link/`, the user id `<agent>@<project>` was accepted, an agent with a real model connected Gmail and sent an email, `manage_connections` turned connection requests and account removal off, and a key with only the two permissions above worked and was refused elsewhere. The automated tests use the fake.

## Decisions

<a id="d38"></a>
### D38. Each agent has its own Composio user id, written into its settings by `init-agent`

- **Decision.** `init-agent` writes `agentx.composio.userId` as `<agent>@<project>`. The extension makes every session for it.
- **Why.** Each agent gets its own connected accounts. Written once and checked in, the id survives renaming the agent or the project, which would otherwise lose its accounts. Composio suggests user ids shaped like an email address.
- **Rejected.** Deriving the id from the names at run time: a rename would change it.

<a id="d39"></a>
### D39. One Composio session per thread, recorded in the thread's Pi session

- **Decision.** Each thread gets its own Composio session. Its id, with the settings it was made from, is a custom entry in the thread's Pi session; a change of settings makes a new one.
- **Why.** A Composio session keeps state that should not mix between threads running at once, while accounts belong to the user id and are shared by every thread. The Pi session already exists per thread, so nothing is added to `storage/` and nothing checked in changes ([D4](../../agent/README.md#d4)).
- **Rejected.** One session per agent: threads running at once would share its state. A static URL in `.pi/mcp.json`: someone would have to create the session and paste its URL, and development and production would need different checked-in files.

<a id="d40"></a>
### D40. The extension registers the session's MCP server, with direct tools, and uses no Composio SDK

- **Decision.** Two REST calls with `fetch`, then `pi.registerMcpServer` with `exposure: "direct"`.
- **Why.** Pi already speaks MCP, so the meta tools need no code of agentx's. Direct tools reach the model like built-in ones, and Composio has only a few. `@composio/core` would add 4.6 MB and require Node 22.22.3; Composio's Pi provider is experimental.
- **Rejected.** Agentx's own tools over Composio's REST API: agentx would own their schemas, results and errors.

<a id="d41"></a>
### D41. Without Composio, the session starts and the model is told why

- **Decision.** No `COMPOSIO_API_KEY`, no user id, or a Composio that fails: no Composio tools, and a section of the system prompt that says why.
- **Why.** Every agent is meant to have Composio, so its absence is something the agent should be able to explain to the person it works for. Nobody watches a runner's session, so a UI notice would reach nobody.
- **Rejected.** A message in the conversation (`pi.sendMessage`): every start of the thread's Pi process would add another copy. A queue message: it would also start a run only to report it.
