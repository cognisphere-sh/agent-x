# Relay

A core [service](../../README.md#services) of the coordinator: it delivers the events agents send, between agents and to themselves. Code: `src/coordinator-runtime/services/relay/relay.ts`.

Each second, and once more after the agents have stopped, the relay takes every agent's outbox, oldest first ([D60](#d60)). An outbox is the sender's own folder, so it names the sender. Everything in it is the sender's word, and is checked as input from outside.

1. An outbox reached through a link inside the agent's central folder is not read at all, and the round logs it: it could point at another folder of the host, such as another agent's inbox, whose events the relay would take and quote back. An event that cannot be read, or whose folder is a link, is set aside in the outbox's `.rejected/`.
2. It is refused when the agent it names does not exist, when the sender's `canSendTo` does not allow it ([D62](#d62)), when its id was not made from its key ([D50](../../../agent-runtime/events/README.md#d50)), or when its folder holds anything but plain files. An agent may always send to itself.
3. Otherwise it is delivered as `deliverEvent` delivers, with the files of its folder. The coordinator drops any `agentX-` fact the sender wrote and sets its own: `agentX-FromAgent`, the agent whose outbox it was; `agentX-FromThread`; and `agentX-FromWorkflow` when a workflow sent it. The receiver answers with `agentx event send --agent <sender> --thread-id <thread>`, or without `--agent` when it sent to itself.
4. A refused event comes back to the sending thread as an event that says why and quotes it, keyed `undeliverable:<id>` ([D61](#d61)). The sending thread is `main` when the outbox names none it has.
5. The marker is deleted; the folder stays as a record of what the agent sent.

A delivery repeated after a crash adds nothing, since the id is already there. A file that cannot be written leaves the marker, and the event is tried again a second later.


## Decisions

<a id="d60"></a>
### D60. Every event an agent sends goes from its outbox, through the coordinator, into the receiver's inbox

- **Decision.** An agent writes every event it sends, to another agent or to itself, into its own outbox. The coordinator takes every outbox each second, takes the sender from the folder, checks the event and the sender's `canSendTo`, and delivers it with `agentX-FromAgent` and `agentX-FromThread`.
- **Why.** In a sandbox an agent can write only its own `storage/`, so its folder names it and no token is needed. Files travel as files. A send waits while the coordinator is down. One place decides who may send to whom, from settings the agent cannot change.
- **Rejected.** `POST /agents/<agent>/events` with a token per process: it refuses at once, but needs a token, a way from the sandbox to the coordinator, the coordinator up at the moment of sending, and file bytes in the request.
- **Consequence.** A refusal comes back later, as an event, not as an error of the send.

<a id="d61"></a>
### D61. A send that cannot be delivered is reported on the sending thread

- **Decision.** Every outbox event names its sending thread: Pi's session when the model runs `agentx event send`, a workflow's babysitter thread, `main` otherwise. A refusal goes there as an event keyed `undeliverable:<id>`.
- **Why.** The thread that sent knows what it meant, and can fix it or tell a person. A workflow's own thread would run the workflow with its refusal, so a workflow sends from the thread that looks after it.
- **Rejected.** The sender's routers, which would have to guess which thread sent it.

<a id="d62"></a>
### D62. The sender's entry in `agentx.json` says which agents it may send to

- **Decision.** An agent's `canSendTo` in `agentx.json` lists the agents it may send to; without it, every agent of the project. The coordinator refuses a send to any other. The agent's system prompt lists the same agents, with their descriptions.
- **Why.** The list the agent is shown and the list it is held to are one list. It is outside the agent's directory, which is the only place the agent writes.
- **Consequence.** A receiver cannot turn away an agent that lists it; its developer changes the sender's entry.
