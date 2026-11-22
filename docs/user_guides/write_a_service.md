# Write a service

A service is a part of `agentx serve` besides the agents, such as a webhook that puts events into an agent's inbox, or a poller. agentx ships some, such as Composio's webhook and Telegram ([the coordinator](../architecture/coordinator-runtime/README.md#services)). Write your own in `agent-x/services/<name>/index.ts`. It is checked in, and runs in the coordinator's process, beside agentx's.

## A webhook

```ts
// agent-x/services/github/index.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ApiRequest, ApiResponse, Route, ServiceContext, ServiceDefinition } from "agent-x";

export default class GitHub implements ServiceDefinition {
	secrets = ["GITHUB_WEBHOOK_SECRET"];
	routes: Route[] = [{ method: "POST", path: "webhook", access: "public", summary: "GitHub's events, signed.", handle: (request) => this.receive(request) }];
	private context!: ServiceContext;
	private agent = "main";

	onStart(context: ServiceContext): void {
		if (!context.secrets.GITHUB_WEBHOOK_SECRET) throw new Error("GITHUB_WEBHOOK_SECRET is not set.");
		const { agent } = context.config as { agent?: string };
		if (agent !== undefined) this.agent = agent;
		this.context = context;
	}

	private receive({ headers, body }: ApiRequest): ApiResponse {
		const expected = `sha256=${createHmac("sha256", this.context.secrets.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
		const given = String(headers["x-hub-signature-256"] ?? "");
		if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return { status: 401 };
		const event = JSON.parse(body.toString("utf8"));
		const id = this.context.deliver(this.agent, {
			key: `github:${headers["x-github-delivery"]}`,
			content: `GitHub: ${headers["x-github-event"]} on ${event.repository?.full_name}.`,
			metadata: { source: "github", event: headers["x-github-event"] },
		});
		return { status: 200, body: { event: id } };
	}
}
```

Turn it on in `agent-x/agentx.json`, with its config, `{}` when it has none:

```json
"services": { "github": { "agent": "main" } }
```

Put its secret in `agent-x/.env`, which no agent reads, and start `agentx serve` again. GitHub then sends to `<publicUrl>/services/github/webhook`.

## The contract

The default export is a class; each member may be left out.

| Member | What it is |
|---|---|
| `secrets` | The environment variables it needs, from the coordinator's environment or `agent-x/.env`; `NAME_*` takes every variable that starts with `NAME_`. It gets only these, in `context.secrets`. |
| `routes` | Its API, served under `/services/<name>/`: each route's `method` (`GET` or `POST`), `path` (`:param` for a parameter), `access` and `summary`, and `handle(request)`, which returns `{ status, body }`. `private`, the default, needs `AGENTX_API_TOKEN`; a `public` one must check its caller itself, as above. |
| `onStart(context)` | Sets it up, before the agents start. A throw leaves it off, and says why in the log. |
| `onStop()` | Its last work, after the agents have stopped. |

`context` gives:

- `config`: `services.<name>` in `agentx.json`;
- `secrets`;
- `agents`: each agent's `name`, `root` and `storage`;
- `publicUrl`, from `agentx.json`;
- `stopping()`;
- `deliver(agent, event, files)`, which puts an event into an agent's inbox with `agentX-Service: <name>`. Its `key` is your id for what you deliver, such as the webhook's delivery id, so a retry adds nothing. It throws when there is no such agent, or the event is refused.
- `every(ms, work)`, which runs `work` every `ms` until the service stops. Runs never overlap, and a failure is logged. Poll with it, not with a timer of your own.

The types come with the `agent-x` package. The file is TypeScript that Node runs by stripping its types, unchecked. So `enum`, `namespace` and constructor parameter properties are refused, and a relative import names its `.ts` file, such as `./signature.ts`. Check the types yourself with `tsc`.

## What to know

- **Names** are letters, digits and dashes, and cannot be one of agentx's services, such as `relay` or `composio`.
- **npm packages** go in `agent-x/package.json`, with `pnpm add` in `agent-x/`.
- **Off, alone.** A service that fails to import, has no class as its default export, has the wrong shape, or throws in `onStart` is off until `agentx serve` starts again. The agents and the other services run all the same.
- **Tell the agent** what your events are: in its system prompt or its router, such as by their `source`. The harness prompt knows only agentx's services.
- **Trust.** A service runs in the coordinator's process. It can read the whole environment and every file, and an error it throws outside its hooks, routes and `every` ends `agentx serve` and every agent with it.
