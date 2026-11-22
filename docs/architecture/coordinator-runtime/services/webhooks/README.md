# Webhooks

An optional [service](../../README.md#services) of the coordinator: each agent's webhooks. A webhook is a URL that an outside service calls when something happens, such as a call that ended in Retell or an SMS that came in on ClickSend. The agent makes and keeps its webhooks itself, and each request runs one of its [workflows](../../../agent-runtime/workflows/README.md) ([D101](#d101)). Code: `src/coordinator-runtime/services/webhooks/`: `webhooks.ts`, the service, and `hooks.ts`, the agent's webhooks file, which the [`agentx webhook`](../../../cli/README.md#commands) command keeps too.

## Setup

- **Config**, in `agentx.json`: `webhooks` under `services`, with no config of its own, and `publicUrl`, the address the outside reaches `agentx serve` at. Without `publicUrl` the service is off.

  ```json
  "publicUrl": "https://agents.example.com",
  "services": { "webhooks": {} }
  ```

- **Secrets:** none. Each webhook's token is in its agent's file.
- **Route:** `POST /services/webhooks/<agent>/<name>/<token>`, public: it checks the token itself.

## An agent's webhooks

`storage/knowledge/webhooks.json`, in the agent's storage, lists them by name:

```json
{
	"calls": { "workflow": "call-ended", "description": "Retell agent agent_123's webhook_url", "token": "<43 random characters>" }
}
```

| Key | Meaning |
|---|---|
| `workflow` | The workflow each request runs, the agent's or its developer's. |
| `description` | Who calls it and where its URL is set, so the agent can find it there again to change it or take it off. |
| `token` | The URL's secret part: 32 random bytes in base64url. |

The agent keeps the file with `agentx webhook`, never by hand ([webhooks skill](../../../agent-runtime/pi/pi-package/README.md#skills)):

- `create <name> --workflow <workflow> --description <text>` makes a webhook with a new token and prints its URL, `<publicUrl>/services/webhooks/<agent>/<name>/<token>`. For a name that exists, it changes the workflow and description and keeps the token, so the URL stays. It refuses a workflow the agent does not have, and, until a person has set up the service, says what to set: without `publicUrl` or the service in `agentx.json`, the URL would not work.
- `list` prints each webhook's URL, workflow, description and the last line of its log.
- `rotate <name>` gives it a new token, so its old URL answers 404 at once, and prints the new one.
- `delete <name>` removes it, and reminds the agent to take the URL off where the description says it is set.

The agent sets the URL at the calling service with that service's Composio tool, such as `RETELLAI_UPDATE_AGENT` with `webhook_url`, and takes it off the same way. The service reads the file on every request, so a change applies at once.

## A request

1. **Finds the webhook.** The agent must be one the coordinator runs, and its file must list the name with a workflow and a token of at least 32 characters, equal to the URL's, compared in constant time. Otherwise: 404, the same for each case, so a caller learns nothing ([D102](#d102)). A file that cannot be read: 503, and a line in the coordinator's log.
2. **Delivers** with `context.deliver`, on the thread `workflow.<workflow>`:
   - key `webhook:<random id>`: each request is an event of its own ([D103](#d103));
   - content `Webhook <name> was called. The request's body is in the file body, and its headers are in headers.json.`, and the files line;
   - `body`, the request's body byte for byte, and `headers.json`, its headers, in the event's folder;
   - metadata `source: webhook`, `webhook: <name>` and the request's `content-type`, with the fact `agentX-Service: webhooks`.
3. **Answers** 200 with the event's id once it is in the inbox, and 503 when it cannot be written, so the caller sends it again.
4. **Logs** a line in `storage/workspace/webhook-logs/<name>.log`: the time, in the agent's time zone, the status, and the event's id or why there is none. A request that matched no webhook is not logged.

A request the agent refuses, such as one for a workflow it no longer has, answers 503, so its caller sends it again once the agent has fixed it, and the agent's `main` thread hears why once per webhook and reason, keyed `webhook:<name>:<reason>`, as the [scheduler](../scheduler/README.md) tells of a fire the agent refuses.

The agent need not be running: the event waits in its inbox. Nothing an agent writes runs while the caller waits for its answer.

## The workflow

The token is the only check at the door, so a workflow treats a request as a hint: it reads the item's id from `storage/workspace/inbox/<event id>/body`, fetches the item through `ctx.composio`, such as `RETELLAI_RETRIEVE_CALL_DETAILS_BY_ID`, and acts only on what the service gives back ([D102](#d102)). It keys what it sends by the item's id, so a service that sends one thing twice is heard once.

## Known limits

- **No answer a caller waits for.** The answer is always JSON, so a service that needs a handshake, such as Slack's or Meta's echo of a challenge, or an answer that steers a call, such as Twilio's `voice_url` or Retell's `inbound_webhook_url`, cannot use a webhook ([D103](#d103)).
- **POST only**, with a body of up to 1 MB, the API server's limit: a larger one gets 413 and is never delivered. A service that sends GET, such as ClickSend with `webhook_type: get`, is set to POST.
- **Anyone with the URL can wake the workflow** until the agent rotates it. The token is in every request, so in the service's own logs and dashboard.
- **Events are lost** while `agentx serve` is down for longer than the calling service keeps sending them again. A [schedule](../scheduler/README.md) that polls the service covers the gap.
- **A refusal is reported once** per webhook and reason: a workflow removed, given back and removed again is not reported the second time. Its log still has every request.
- Until sandboxes, an agent can write another agent's webhooks file, as it can any of its files.

## Decisions

<a id="d101"></a>
### D101. An agent's webhook is a URL with a random token, which the agent makes and keeps with `agentx webhook`, and each request runs one of its workflows

- **Problem.** Many services, such as Retell, Twilio and ClickSend, report what happens by calling a URL, and Composio has no trigger for most of them. The agent must be able to set one up and take it down by itself, and handling the requests needs no model.
- **Decision.** The optional webhooks service serves `POST /services/webhooks/<agent>/<name>/<token>`. The agent makes, lists, rotates and deletes its webhooks with `agentx webhook`, which keeps each one, with a 32-byte random token and the workflow it runs, in the agent's own `storage/knowledge/webhooks.json`. The service reads the file on every request and delivers each request to the webhook's workflow, with its body and headers as files.
- **Why.** The agent sets the URL at the service with a Composio tool, so it sets up and takes down both ends. A command makes the token, which a model cannot make random. A workflow is the only target, because a stranger wrote the request, and a script reads it before the model does. The file needs no answer from the coordinator, as with schedules ([D64](../scheduler/README.md#d64)).
- **Rejected.** Webhooks in the agent's `.pi/`: their tokens would be in git, and a developer's fixed endpoint is already a project service. A URL that the coordinator hands out when asked, which the agent would wait for.

<a id="d102"></a>
### D102. The URL's token is a webhook's only check, and the workflow confirms what a request says through Composio

- **Problem.** Each service signs its requests its own way, with a secret of the account, such as Twilio's auth token or Retell's API key. The agent's accounts are in Composio, which does not give those secrets out, and each is a key to the whole account.
- **Decision.** The service checks only the token, in constant time, and answers 404 alike for no agent, no webhook and a wrong token. The webhook's workflow treats a request as a hint, fetches what it names through `ctx.composio`, and acts only on what the service gives back.
- **Why.** Every service that calls a URL carries the token, and no provider's key reaches the agent. A forged request with a made-up id fetches nothing; one with a real id re-reads real data.
- **Rejected.** Checking each provider's signature: a verifier per provider in agentx, and each provider's account key in the agent's environment, around Composio's policy.
- **Consequence.** A leaked URL lets anyone wake the workflow until the agent rotates it.

<a id="d103"></a>
### D103. A webhook answers 200 once the event is in the inbox, and never with an answer its caller waits for

- **Problem.** Some services wait for a particular answer: a handshake that echoes a challenge, as Slack's and Meta's do, or an answer that steers a call, as Twilio's `voice_url` and Retell's `inbound_webhook_url` expect. A workflow runs later and cannot give it.
- **Decision.** The service answers 200 with the event's id once the event is in the inbox, and 503 when it cannot be. Each request is an event of its own, with a random key, and the workflow keys what it sends by the item's id. A request the agent refuses, such as one for a workflow it no longer has, answers 503, so the caller sends again, and the agent's `main` thread hears why once per webhook and reason, as the scheduler tells of a fire the agent refuses.
- **Why.** The services that report what happened, such as a Retell agent's `webhook_url`, Twilio's `status_callback` and ClickSend's inbound rules, take any 200. Code that answers at once would be the first agent code the coordinator runs, in the agent's environment, and later in its sandbox.
- **Rejected.** A function a webhook's workflow exports, which the service runs for each request to make the answer. A key made from a hash of the body: nothing prunes the queue, so a later request with the same body would be dropped for good.
