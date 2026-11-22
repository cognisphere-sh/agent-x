# Telegram

An optional [service](../../README.md#services) of the coordinator: it gives agents Telegram bots, one per agent. A message a person sends an agent's bot, from a chat the agent lists, goes into the agent's inbox, and so does a tap on a button the agent put under its message; the agent answers with Composio's Telegram tools, through the same bot, which the service connects in Composio for the agent ([D72](#d72), [D77](#d77)). Code: `src/coordinator-runtime/services/telegram/`: `telegram.ts`, and `composio-bot.ts`, which connects a bot in Composio.

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

`onStart` checks the config, and calls Telegram's `setWebhook` for each bot, with `<publicUrl>/services/telegram/<agent>`, only `message` and `callback_query` updates, and the bot's secret token: an HMAC-SHA256 of the bot token, so it needs no setting of its own and only the token's holder can make it. Without `publicUrl`, an agent the coordinator does not run, a listed agent without `chats` or its token, two agents with the same token (a bot has one webhook, so the second would take the first's messages), or a token Telegram refuses, the service is off. Then it connects each bot in Composio.

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
2. **Ignores**, with 200, an update that is neither a message nor a [tap](#button-taps), a message from a chat the agent does not list, with a log line, and a message with no text and no file, such as a pin or a member who joined, which would cost a model run for nothing.
3. **Downloads** the message's files into the event: the largest size of a photo, and a document, audio, video, voice note, video note, animation or sticker, each by the name Telegram gives it, such as `file_3.jpg`, with a number first should two have the same name. A file the Bot API will not give, such as one over 20 MB, is said in the content instead, so the message still arrives and holds up none after it.
4. **Delivers** with `context.deliver`, with no thread, so the agent's routers pick one:
   - key `telegram:<update_id>`, so an update Telegram sends again is one event;
   - content: the message's text or caption, then a line for each file that could not be downloaded, and the files line;
   - metadata `source: telegram`, `chat` (its id), `chat-type`, `from` (`@username`, or the sender's name), `from-id` and `message-id`, with the fact `agentX-Service: telegram`;
   - for a reply, also `reply-to`, the id of the message it answers, and `reply-to-bot`, whether that message is the bot's: the bot's user id is the part of its token before the colon. A router can then send answers to the agent and leave people's talk among themselves elsewhere.
5. **Answers** 200 with the event's id once it is in the inbox, and 503 when it cannot be written, so Telegram sends it again.

## Albums

Telegram sends an album, several photos or files sent together, as one message per photo or file, with the same `media_group_id`, and sends a chat's messages one at a time, each once the one before is answered. The service makes an album one event ([D93](#d93)):

1. **Answers** each part 200 at once, and starts downloading its files, so Telegram sends the next part. A part it has already, sent again, is dropped.
2. **Waits** until no part of the album has come for 2 s, and its files are in. A part that comes meanwhile restarts the wait.
3. **Delivers** one event: its parts' text and files in the order they were sent, a number first on a file whose name another part's file has; the metadata of its first part, with `album`, the `media_group_id`, and `reply-to` from a part that is a reply; key `telegram:<update_id>` of its first part. An event the inbox cannot take is tried three times, a second apart; then a log line says it is lost.
4. **Remembers** the album's parts for 10 minutes, and drops a part Telegram sends again. A part that comes after the album was delivered is an event of its own.

When `agentx serve` stops, the service delivers the albums on their way in before it stops; they wait in the inboxes for the agents' next start.

## Button taps

The agent asks a question with fixed answers on inline buttons, which it sends with `TELEGRAM_SEND_MESSAGE`'s `reply_markup` ([D84](#d84)). A tap on one comes as a `callback_query` update to the same route, which the service:

1. **Answers** with `answerCallbackQuery` at once, so the button stops spinning. A second answer, to an update Telegram sends again, is refused, which does no harm.
2. **Ignores**, with 200, a tap on a message Telegram no longer gives (its `date` is 0), and one from a chat the agent does not list, with a log line.
3. **Delivers** it as a message: key `telegram:<update_id>`, content the button's text, metadata as a message's with `button`, the button's `callback_data`, and `message-id` the message the button is on. 503 when it cannot be written.
4. **Takes the buttons off** the message, so each question is answered once, and adds `✅ <from>: <button>` under its text, keeping its formatting, so the chat shows the choice. A message without text, such as a photo, or one too long to add to, only loses its buttons; when that fails too, a log line says the question can be answered again.

The harness prompt tells the agent that an event with `agentX-Service: telegram` is from Telegram, and to read the harness's `telegram` skill, which says it is a person's message or tap, to answer in its `chat` with Composio's Telegram tools, and to put the answers to a question with fixed answers on inline buttons.

## Known limits

- Until sandboxes, an agent can read the bot tokens as it reads any file of its OS user.
- A bot has one webhook, so Composio's tools that read updates, `TELEGRAM_GET_UPDATES` and `TELEGRAM_GET_CHAT_HISTORY`, fail while the service runs.
- In a group, a bot in Telegram's privacy mode, the default, gets only commands and replies to it.
- A file that fails to download for a passing reason, such as a network error, is not tried again.
- An album is answered before it is delivered, so one the inbox cannot take, or that is on its way in when `agentx serve` dies without stopping, is lost: Telegram does not send it again.
- An album's event comes 2 s after its last part. A part that comes more than 2 s after the one before, such as on a very slow link, is an event of its own.
- Updates are lost while `agentx serve` is down for longer than Telegram keeps them, 24 hours.
- Until sandboxes, an agent can read `COMPOSIO_COORDINATOR_API_KEY` as it reads any file of its OS user, and with it change any agent's Composio accounts.
- Answers depend on Composio: without the agents' `COMPOSIO_API_KEY`, or when the bot could not be connected, the agent gets the message but cannot answer in Telegram.
- A bot that fails to connect in Composio is tried again only at the next start of `agentx serve`.
- Every inline button answers once: the service takes a message's buttons off at the first tap, so buttons that stay, such as a menu, are not possible. Two taps at the same moment, before the buttons are off, are two events.

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
- **Decision.** At start the service connects each bot for the agent's user id with `COMPOSIO_COORDINATOR_API_KEY`, a key with Auth configs and Connected accounts, in `agent-x/.env`, under a Telegram auth config that sessions use without naming it (`is_enabled_for_tool_router`), which it makes when the project has none. The account's alias, made from the token, marks it as the service's: the service replaces only its own accounts, and only when the token changes.
- **Why.** The token is set up once, in `agent-x/.env`. A Composio key covers the whole project, so a key that can connect accounts stays with the coordinator, never in an agent's process ([Composio](../../../agent-runtime/pi/pi-package/composio/README.md#the-key)). A failure to connect stops no message from coming in.
- **Rejected.** Giving the agents' `COMPOSIO_API_KEY` these rights: every agent could change every agent's accounts, even in a sandbox. A session that names the Telegram auth config, with its id written by the coordinator into the agent's storage, put in the agent's settings, or looked up by the Composio extension: a file the coordinator and the extension share, an id that differs per Composio project in checked-in settings, or more rights for every agent's key, where the auth config's own setting needs none. Deleting and connecting the bot at every start: each start would change the account's id for nothing.

<a id="d84"></a>
### D84. The agent asks a question with fixed answers on inline buttons, which the service closes at the first tap

- **Problem.** A person answers a question with a few fixed answers faster with a tap than by typing, and the agent should learn the answer once.
- **Decision.** The harness's `telegram` skill has the agent put the answers on inline buttons, with `TELEGRAM_SEND_MESSAGE`'s `reply_markup`. The service takes `callback_query` updates too: it answers each tap, delivers it as an event with the button's text as content, then takes the message's buttons off and adds the choice under its text. The prompt rules out polls.
- **Why.** The buttons sit under the question, the chat shows the choice, and nobody answers twice. Only the service holds the bot token and gets the tap, so only it can answer the tap in time, before the button spins on, and close the question at once instead of waiting on a model run.
- **Rejected.** A reply keyboard, whose tap is a plain message, so it needs no change to the service: the keyboard sits under the input instead of the question, and the tap is a message in the chat. Polls: a `poll_answer` names no chat, so the service would have to know which chat each poll went to. Every option of the old harness's Telegram plugin, such as several answers, a question for one person or buttons that stay: no agent needs them yet.

### D93. An album is one event, gathered after each part is answered

- **Problem.** Telegram sends each photo or file of an album as a message of its own, so an agent answered an album of two photos twice, as if two people had each sent one.
- **Decision.** The service answers each part with a `media_group_id` at once, and gathers the parts in memory until none has come for 2 s and their files are in; it then delivers one event, keyed by its first part's update, with every part's text and files and `album` in its metadata. It drops a part it has, or delivered in the last 10 minutes, sent again, and delivers the albums on their way in when it stops.
- **Why.** Telegram sends the next part of an album only once the one before is answered, so the service can see the whole album only by answering each part before the album is delivered. Gathering in the service makes an album one event for every agent and router, which then need no rule of their own.
- **Rejected.** Holding each part's answer until the album is delivered: Telegram would wait to send the next part, and each part would go in alone. Delivering each part and merging them in the agent's queue, or in the agent's workflow: the queue knows nothing of Telegram, and every agent would need its own merge. Keying the event by `media_group_id`: a part that comes after the album was delivered would have the same key, and be dropped as the same event.
