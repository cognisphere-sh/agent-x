# Telegram

An optional [service](../../README.md#services) of the coordinator: it gives agents Telegram bots, one per agent. A message a person sends an agent's bot, from a chat the agent lists, goes into the agent's inbox; the agent answers with Composio's Telegram tools, through the same bot, which the service connects in Composio for the agent ([D72](#d72), [D77](#d77)). Code: `src/coordinator-runtime/services/telegram/`: `telegram.ts`, and `composio-bot.ts`, which connects a bot in Composio.

## Setup

- **Config**, in `agentx.json`: the agents with a bot, each with the ids of the chats it takes messages from, and `publicUrl`, where Telegram sends.

  ```json
  "publicUrl": "https://agents.example.com",
  "services": {
  	"telegram": { "agents": { "main": { "chats": [123456789] }, "support": { "chats": [-1001234567890] } } }
  }
  ```

  `apiUrl`, which may be left out, is another address of the Bot API, such as a Bot API server of one's own; the tests point it at a fake.
- **Secrets:** each agent's bot token, `TELEGRAM_BOT_TOKEN_<AGENT>`, the agent's name in capitals with `_` for `-`, such as `TELEGRAM_BOT_TOKEN_MAIN`. The service's `secrets` is `TELEGRAM_BOT_TOKEN_*`, so it gets every such variable, and the two below. Each agent needs a bot of its own.
- **`COMPOSIO_COORDINATOR_API_KEY`**, the coordinator's Composio key, with which the service connects each bot ([below](#the-bot-in-composio)). It is a scoped key of the agents' Composio project with **Auth configs** and **Connected accounts** (read and write), unlike the agents' `COMPOSIO_API_KEY`, which may only make sessions. `COMPOSIO_BASE_URL` points it elsewhere, such as at a fake in the tests.
- **Answers.** A new agent's settings enable Composio's Telegram toolkit; the agent answers with `TELEGRAM_SEND_MESSAGE`, with the event's `chat` as `chat_id`.

`onStart` checks the config, and calls Telegram's `setWebhook` for each bot, with `<publicUrl>/services/telegram/<agent>`, only `message` updates, and the bot's secret token: an HMAC-SHA256 of the bot token, so it needs no setting of its own and only the token's holder can make it. Without `publicUrl`, an agent the coordinator does not run, a listed agent without `chats` or its token, two agents with the same token (a bot has one webhook, so the second would take the first's messages), or a token Telegram refuses, the service is off. Then it connects each bot in Composio.

## The bot in Composio

So that Composio's Telegram tools send as the agent's bot, `onStart` connects each bot for the agent's Composio user id, `agentx.composio.userId` in its checked-in `.pi/settings.json`, with `COMPOSIO_COORDINATOR_API_KEY`:

1. **Lists** the user id's Telegram accounts. The service's own have the alias `agentx-telegram-<hash>`, where the hash is made from the bot token; Composio keeps an alias unique per user id and toolkit.
2. **Deletes** its own accounts of another token, and one of this token that is not active. An account a person connected, with another alias or none, is left alone.
3. **Connects** the bot, when no active account of its token is left: an API key account, the token as Telegram's `generic_api_key`, under the project's Telegram auth config. So a start with the same token changes nothing, and a new token replaces the old one's account.

The auth config must be one that sessions use. Composio runs no auth config for Telegram, as it does for Gmail, so the project has a custom one, and a session that names no auth config, as the agent's does, uses only the accounts under a custom one with `is_enabled_for_tool_router`. The one made in Composio's dashboard in a check had it. The service takes an enabled `API_KEY` one that has it, or makes its own with it, so the agent's session needs no change. Composio does not check a Telegram token when it connects it; a token Telegram refuses has already turned the service off.

Messages come in without Composio, so a failure here leaves the service on, with a log line: without `COMPOSIO_COORDINATOR_API_KEY`, for an agent without a Composio user id, and when Composio refuses or does not answer within 10 seconds. The agent then answers only with a bot connected another way, such as through its Connect Link in `agentx chat`, which in a check went under the project's Telegram auth config made in Composio's dashboard; the next start tries again.

## Messages

`POST /services/telegram/<agent>`, public:

1. **Checks** that the agent has a bot and that `X-Telegram-Bot-Api-Secret-Token` is the bot's secret token. Otherwise 404, or 401.
2. **Ignores**, with 200, an update that is not a message, a message from a chat the agent does not list, with a log line, and a message with no text and no file, such as a pin or a member who joined, which would cost a model run for nothing.
3. **Downloads** the message's files into the event: the largest size of a photo, and a document, audio, video, voice note, video note, animation or sticker, each by the name Telegram gives it, such as `file_3.jpg`, with a number first should two have the same name. A file the Bot API will not give, such as one over 20 MB, is said in the content instead, so the message still arrives and holds up none after it.
4. **Delivers** with `context.deliver`, with no thread, so the agent's routers pick one:
   - key `telegram:<update_id>`, so an update Telegram sends again is one event;
   - content: the message's text or caption, then a line for each file that could not be downloaded, and the files line;
   - metadata `source: telegram`, `chat` (its id), `chat-type`, `from` (`@username`, or the sender's name), `from-id` and `message-id`, with the fact `agentX-Service: telegram`.
5. **Answers** 200 with the event's id once it is in the inbox, and 503 when it cannot be written, so Telegram sends it again.

The harness prompt tells the agent that an event with `agentX-Service: telegram` is a person's message, and to answer in its `chat` with Composio's Telegram tools.

## Known limits

- Until sandboxes, an agent can read the bot tokens as it reads any file of its OS user.
- A bot has one webhook, so Composio's tools that read updates, `TELEGRAM_GET_UPDATES` and `TELEGRAM_GET_CHAT_HISTORY`, fail while the service runs.
- In a group, a bot in Telegram's privacy mode, the default, gets only commands and replies to it.
- A file that fails to download for a passing reason, such as a network error, is not tried again.
- Updates are lost while `agentx serve` is down for longer than Telegram keeps them, 24 hours.
- Until sandboxes, an agent can read `COMPOSIO_COORDINATOR_API_KEY` as it reads any file of its OS user, and with it change any agent's Composio accounts.
- Answers depend on Composio: without the agents' `COMPOSIO_API_KEY`, or when the bot could not be connected, the agent gets the message but cannot answer in Telegram.
- A bot that fails to connect in Composio is tried again only at the next start of `agentx serve`.

## Decisions

<a id="d72"></a>
### D72. Telegram messages come in through a service; the agent answers with Composio's Telegram tools

- **Problem.** Composio has no Telegram triggers, so an agent cannot hear a Telegram chat through Composio. And the model's answer, as text, reaches no one under `agentx run`.
- **Decision.** An optional service sets each listed agent's bot webhook at start, and delivers each message from the chats the agent lists, with its files, keyed by `update_id`. The agent answers in the chat with Composio's Telegram tools, through the same bot, which the service connects to its Composio user id ([D77](#d77)). The webhook's secret token is made from the bot token.
- **Why.** Sending through Composio needs no new code in agentx and no path from an agent back to a service: the agent already has Composio's tools. Only listed chats reach the agent, so a stranger who finds the bot cannot run up model costs or speak to the agent. Files are in the event's folder, where the agent reads them as any event's files.
- **Rejected.** A tool in agentx's Pi package that sends with the bot token: the token would be in the agent's process by design. Sending the answer to the service through the agent's outbox, which the relay hands to the service: a new path through the relay and the service contract, which nothing else needs yet. Anyone may write to the bot: anyone who finds it would reach the agent.

<a id="d77"></a>
### D77. The Telegram service connects each bot in Composio with the coordinator's own Composio key

- **Problem.** The agent answers through Composio, so the bot must be connected in Composio for the agent's user id, with the same token the service already holds. The agents' Composio key may only make sessions.
- **Decision.** At start the service connects each bot for the agent's user id with `COMPOSIO_COORDINATOR_API_KEY`, a key with Auth configs and Connected accounts, in `agent-x/.env.services`, under a Telegram auth config that sessions use without naming it (`is_enabled_for_tool_router`), which it makes when the project has none. The account's alias, made from the token, marks it as the service's: the service replaces only its own accounts, and only when the token changes.
- **Why.** The token is set up once, in `agent-x/.env.services`. A Composio key covers the whole project, so a key that can connect accounts stays with the coordinator, never in an agent's process ([Composio](../../../agent-runtime/pi/pi-package/composio/README.md#the-key)). A failure to connect stops no message from coming in.
- **Rejected.** Giving the agents' `COMPOSIO_API_KEY` these rights: every agent could change every agent's accounts, even in a sandbox. A session that names the Telegram auth config, with its id written by the coordinator into the agent's storage, put in the agent's settings, or looked up by the Composio extension: a file the coordinator and the extension share, an id that differs per Composio project in checked-in settings, or more rights for every agent's key, where the auth config's own setting needs none. Deleting and connecting the bot at every start: each start would change the account's id for nothing.
