# Deploy

How a project runs outside a single agent's terminal: `agentx dev` on a laptop, and `agentx server` on an Ubuntu server ([D105](#d105)). A project has two processes, the agents (the [coordinator](../../coordinator-runtime/README.md), as `agentx serve` runs it) and the web app (`next`). The code is in `src/cli/deploy/`, with the commands in `src/cli/commands/dev.ts` and `server.ts`.

| File | Role |
|---|---|
| `ask-setup.ts` | Asks for what the project lacks to run: each agent's model login, the agents' keys and the services' secrets; makes the API token ([D108](#d108)) |
| `project-scripts.ts` | Runs the project's own `deploy/check.sh` and `deploy/setup.sh` |
| `ports.ts` | The two ports: the agents' 3100 and the web app's 3000, on 127.0.0.1 |
| `tunnel.ts` | The ngrok tunnel of `agentx dev` |
| `server-setup.ts` | `agentx server setup`: DNS, lingering, Caddy with HTTPS, Chrome, logins and keys |
| `server-files.ts` | What `agentx server` writes: Caddy's config and the two systemd units. Pure functions |
| `web-build.ts` | The web app's builds beside the running one ([D107](#d107)) |
| `system.ts` | Runs the server's commands, as the user or as root through sudo |

## `agentx dev`

In the project's root, `agent-x/` or `agent-x/agents/`; the template's root `dev` script runs it, so `pnpm dev` does too.

1. Opens an ngrok tunnel to port 3100 on the ngrok account's domain, and reads its address from ngrok's log. Without ngrok, or when ngrok stops, such as without its login, it goes on with no tunnel and says why.
2. Sets `AGENTX_PUBLIC_URL` to the tunnel's address, or to nothing, in its own environment, which the coordinator and the agents' processes read before `publicUrl` in `agentx.json` ([D109](../../coordinator-runtime/README.md#d109)). The file keeps the server's address.
3. Asks for logins and keys ([below](#logins-and-keys)), then runs `deploy/check.sh`; a failing check stops it before anything starts.
4. Runs the coordinator in its own process, on `127.0.0.1:3100`, and `next dev` in `web/`, which warns and is skipped when `web/` is not installed.

The first Ctrl-C lets the agents finish their running work, as with `agentx serve`; ngrok and `next dev` stop at once, and with the process however it ends. Telegram sends a bot's messages to one address, so `agentx dev` takes each bot it starts away from the server: a laptop's `agent-x/.env` holds bots of its own.

## `agentx server`

On the server, as the user who runs the project, in the project's root, `agent-x/` or `agent-x/agents/`. It refuses on another system than Linux and as root; it runs `sudo` itself for what needs root, which asks for the password in the terminal ([D106](#d106)).

Before it, once per server: Node 24 from NodeSource's apt repository, pnpm from `npm -g`, the project cloned and installed, `publicUrl` in `agent-x/agentx.json` set to `https://<domain>`, and the domain's DNS records pointing at the server. The [server guide](../../../user_guides/run_on_a_server.md) has the commands.

### `setup`

Each step does only what is missing, so it runs again any time, such as after the domain changes:

1. Stops with the install commands when pnpm is missing.
2. DNS: `systemd-resolved` also asks 1.1.1.1 and 8.8.8.8 (`/etc/systemd/resolved.conf.d/public-dns.conf`), as a hosting provider's resolvers can be slow or not answer, which times out logins and API calls.
3. Lingering (`loginctl enable-linger`), so the user's services start at boot and outlive the login.
4. Checks that `publicUrl` is `https://<domain>`, with no port, path or query, and that the domain resolves to this server's addresses only, as Let's Encrypt checks it by connecting; a tunnel's domain does not.
5. Installs Caddy from its apt repository when it is missing, writes `/etc/caddy/Caddyfile` once `caddy validate` takes it, opens 80 and 443 when ufw is on, reloads Caddy, and waits up to two minutes for the certificate. A Caddyfile agentx did not write is kept as `Caddyfile.before-agentx`.
6. Chrome for the agents' browser: the pinned agent-browser's `install --with-deps`, which puts Chrome in the user's `~/.agent-browser/` and installs its libraries through sudo. When it fails, setup says so and goes on.
7. Logins and keys.
8. `deploy/setup.sh`.

Caddy sends `/services/*` to agentx serve and everything else to the web app, with Let's Encrypt as its only certificate authority. The coordinator's own routes (`/health`, `/agents`, `/routes`) are not reachable from outside, and the web app must not serve paths under `/services/`.

### `start`, `restart`, `stop`, `status`, `logs`

| Action | Does |
|---|---|
| `start` | Refuses until Caddy serves `publicUrl`. Asks for logins and keys, runs `deploy/check.sh`, builds the web app, writes the units when they changed (then `daemon-reload`), enables both, restarts the web app on its new build and starts the agents. |
| `restart` | As `start`, but restarts the agents too, which first finish their running work. |
| `stop` | Disables and stops both, so they stay stopped after a reboot. The agents finish their running work first. |
| `status` | `systemctl --user status` of both, with their latest log lines. |
| `logs [journalctl options]` | Follows both journals. |

The units, in `~/.config/systemd/user/`, are named after the project's folder: `<project>-agents` runs the pinned `agent-x/node_modules/@cognisphere-sh/agentx/dist/cli/agentx.js serve` with the Node that runs `agentx server`, with `KillMode=mixed` and `TimeoutStopSec=600`, so a stop reaches `agentx serve` alone and lets running work finish; `<project>-web` runs `next start` on `127.0.0.1:3000` in `web/`. Both put that Node's folder first on their PATH, so the commands the agents run use it too, restart on failure after 10 s, and start at boot.

A deploy is `git pull`, `pnpm install`, `agentx server restart`.

### The web app's builds

`next start` serves the files of its build folder, so a build into that folder would break the running app. Builds take turns between `web/.next-a/` and `web/.next-b/` ([D107](#d107)):

1. `next build` writes into the folder the app is not serving, with `AGENTX_WEB_DIST_DIR` naming it; the template's `web/next.config.ts` sets `distDir: process.env.AGENTX_WEB_DIST_DIR ?? ".next"`, so `next dev` keeps `.next`.
2. A build that fails, or a `BUILD_ID` in the folder older than the build, as when `next.config.ts` ignores the variable, stops the command; the running app keeps its build.
3. `web/.agentx-web.env` names the new folder, and the web unit, which reads it, starts again on it. The other folder keeps the previous build until the next one.

`next build` adds to `tsconfig.json` the types folders of its build folder that `include` lacks, and never removes one. The template's `tsconfig.json` lists those of `.next`, `.next-a` and `.next-b`, with the other settings Next adds, so a build on the server changes no checked-in file.

## Logins and keys

`agentx dev`, `agentx server setup`, `start` and `restart` check, before they start anything ([D108](#d108)):

- **Each agent's model login.** The provider is `defaultProvider` in the agent's `.pi/settings.json`, else in `agent-x/.pi/settings.json`; Pi's `auth check` for it runs as the agent runs Pi, so a key in the agent's `.env` counts, and refreshes an expired login. A missing one runs Pi's `auth login` once the person says yes, with `--no-browser` over SSH. An agent that names no provider is said, and not checked.
- **The API token**, `AGENTX_API_TOKEN` in `agent-x/.env`: made, at random, when missing or empty.
- **Each agent's keys**: the variables the agent template's `.env` names, such as `COMPOSIO_API_KEY`, in the agent's `.env`.
- **The services' secrets**: those that the services `agentx.json` would start declare and do not mark optional ([D110](../../coordinator-runtime/README.md#d110)), in `agent-x/.env`; one that is one per agent (`PREFIX_*`) once for each agent the service lists under `agents` in its config, else for every agent.

A key is missing when the environment does not set it and its file does not answer it. The question shows what the template says of the key, or which service needs it, and writes the answer into the file, on the line that names it in a comment, else at the end. An empty answer writes `NAME=`, which answers it, so it is not asked again; Ctrl-C at a question stops the command before anything starts. Without a terminal, each missing login and key is listed, and the command goes on.

`agentx serve` asks nothing: under systemd it has no terminal. After it starts, it logs each agent with no login for its provider, which nothing else reports before the agent runs; the services say why they are off themselves.

## The project's own scripts

`init-project` writes `deploy/check.sh` and `deploy/setup.sh`, each a comment saying when it runs and a commented-out example. The commands run them with bash in the project's root, so they need no executable bit; a missing one is skipped.

- `deploy/check.sh` runs before `agentx dev`, `agentx server start` and `restart` start anything, for what only the project needs, such as a key that one of its extensions reads. A non-zero exit stops the command.
- `deploy/setup.sh` runs at the end of `agentx server setup`, for what else the project needs on the server. It runs with each setup, so it does only what is missing.

## Limits

- One project per server: the Caddyfile, and ports 3000 and 3100, are the project's.
- Only Ubuntu, with apt and systemd; other hosts are later targets.
- `upgrade-project` adds no files and changes no `web/` file ([D100](../README.md#d100)). When `next build` writes elsewhere than the folder it was given, `agentx server start` stops and names the line `web/next.config.ts` needs.

## Decisions

<a id="d105"></a>
### D105. Running a project on a laptop or a server is agentx's, and a project adds only its own scripts

- **Problem.** Every project needs the same steps to run its web app and agents locally and on a server, and wrote them as scripts of its own.
- **Decision.** `agentx dev` and `agentx server` do them. What only one project needs goes into its `deploy/check.sh` and `deploy/setup.sh`, which the commands run.
- **Why.** A project gets the steps, and every fix to them, with the agentx it pins. The checks agentx can know, such as each agent's login, stay out of the project's scripts.
- **Rejected.** Scripts in the project template: copied once at `init-project` and never upgraded, as `upgrade-project` adds no files ([D100](../README.md#d100)).

<a id="d106"></a>
### D106. A server is Ubuntu, with Caddy for HTTPS and systemd user services

- **Decision.** `agentx server` targets Ubuntu. Caddy is the reverse proxy, and gets and renews the certificate. The two processes are systemd user services, with lingering on. Node comes from NodeSource's apt repository.
- **Why.** Caddy's config is a few lines and needs no certificate tooling. systemd is on every Ubuntu, logs to the journal with rotation, and drains a stop with `KillMode=mixed` and `TimeoutStopSec`. User services need no sudo to start and stop. NodeSource puts Node in `/usr/bin`, where `apt upgrade` patches it.
- **Rejected.** nginx with certbot and a renewal timer. pm2, which starts at boot through a systemd unit anyway, and whose stop settings would need changing to let running work finish. Docker, which needs volumes for storage, Pi's login and the browser's profiles, and an image per deploy. nvm, whose Node is on the PATH of interactive shells only.

<a id="d107"></a>
### D107. The web app builds beside the running one, in two folders in turn

- **Problem.** `next build` rewrites the build folder that a running `next start` serves.
- **Decision.** Builds alternate between `web/.next-a/` and `web/.next-b/`, which `next.config.ts` takes from `AGENTX_WEB_DIST_DIR`; the web unit reads the serving one from `web/.agentx-web.env`, and starts again on the new build.
- **Why.** The app is down only while `next start` starts, and the previous build stays until the next. Each build is served from the folder it was built in. Next's cache in the folder is kept from one build to the next but one.
- **Rejected.** Stopping the app for the build, which takes minutes. Building into a fresh folder and renaming it: Next records its build folder in the build, such as in `required-server-files.json`.

<a id="d108"></a>
### D108. The commands a person types ask for logins and keys; `agentx serve` only logs a missing login

- **Problem.** A project that lacks a model login or a key starts and fails later, in an agent's run or a service's start.
- **Decision.** `agentx dev`, `agentx server setup`, `start` and `restart` ask for each missing login and key and write it, and make the API token. `agentx serve` logs each agent with no login. A skipped key is written empty, and not asked again.
- **Why.** Under systemd `agentx serve` has no terminal, and under `agentx dev` its questions would mix with Next's output. The keys come from what the templates name and what the services declare, so their text says what each is for, and a project's own keys are its `deploy/check.sh`'s.
- **Rejected.** Every variable a template names in a comment: the template's `TELEGRAM_BOT_TOKEN_MAIN` is not the token of an agent with another name, and keys of services that are off would be asked for.
