# Telegram

An optional [service](../../README.md#services) of the coordinator: it gives agents Telegram bots. A message a person sends an agent's bot, from a chat the agent lists, goes into the agent's inbox; the agent answers with Composio's Telegram tools ([D72](#d72)). Code: `src/coordinator-runtime/services/telegram/telegram.ts`.

## Setup

- **Config**, in `agentx.json`: the agents with a bot, each with the ids of the chats it takes messages from, and `publicUrl`, where Telegram sends.

  ```json
  "publicUrl": "https://agents.example.com",
  "services": {
  	"telegram": { "agents": { "main": { "chats": [123456789] } } }
  }
  ```

  `apiUrl`, which may be left out, is another address of the Bot API, such as a Bot API server of one's own; the tests point it at a fake.
- **Secrets:** each agent's bot token, `TELEGRAM_BOT_TOKEN_<AGENT>`, the agent's name in capitals with `_` for `-`, such as `TELEGRAM_BOT_TOKEN_MAIN`. The service's `secrets` is `TELEGRAM_BOT_TOKEN_*`, so it gets every such variable and no other.
- **Answers.** The agent's Composio user id has the same bot connected in Composio, by its token. A new agent's settings enable Composio's Telegram toolkit; the agent answers with `TELEGRAM_SEND_MESSAGE`, with the event's `chat` as `chat_id`.

`onStart` checks the config, and calls Telegram's `setWebhook` for each bot, with `<publicUrl>/services/telegram/<agent>`, only `message` updates, and the bot's secret token: an HMAC-SHA256 of the bot token, so it needs no setting of its own and only the token's holder can make it. Without `publicUrl`, an agent the coordinator does not run, a listed agent without `chats` or its token, or a token Telegram refuses, the service is off.

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
- Answers depend on Composio: without `COMPOSIO_API_KEY`, or without the bot connected for the agent's user id, the agent gets the message but cannot answer in Telegram.

## Decisions

<a id="d72"></a>
### D72. Telegram messages come in through a service; the agent answers with Composio's Telegram tools

- **Problem.** Composio has no Telegram triggers, so an agent cannot hear a Telegram chat through Composio. And the model's answer, as text, reaches no one under `agentx run`.
- **Decision.** An optional service sets each listed agent's bot webhook at start, and delivers each message from the chats the agent lists, with its files, keyed by `update_id`. The agent answers in the chat with Composio's Telegram tools, through the same bot connected to its Composio user id. The webhook's secret token is made from the bot token.
- **Why.** Sending through Composio needs no new code in agentx and no path from an agent back to a service: the agent already has Composio's tools. Only listed chats reach the agent, so a stranger who finds the bot cannot run up model costs or speak to the agent. Files are in the event's folder, where the agent reads them as any event's files.
- **Rejected.** A tool in agentx's Pi package that sends with the bot token: the token would be in the agent's process by design. Sending the answer to the service through the agent's outbox, which the relay hands to the service: a new path through the relay and the service contract, which nothing else needs yet. Anyone may write to the bot: anyone who finds it would reach the agent.
- **Consequence.** The bot is set up twice: its token in `agent-x/.env.services`, and connected in Composio for the agent's user id.
