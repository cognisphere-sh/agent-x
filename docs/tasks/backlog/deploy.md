---
name: deploy
title: Run a project on a laptop with agentx dev, and on a server with agentx server
description: agentx gets the commands that run a project's web app and agents locally behind an ngrok tunnel, and set up and run them on an Ubuntu VPS behind Caddy under systemd, so every project deploys the same way and gets fixes with each agentx version.
type: feature
priority: none
status: planned
modules: [cli, cli/deploy, coordinator-runtime]
created: 2026-11-24
updated: 2026-11-24
---

# Run a project on a laptop with agentx dev, and on a server with agentx server

A project has two processes, the web app (`next`) and the agents (`agentx serve`), and today each project writes its own scripts to run them. lps has three (`start.sh`, `setup-server.sh`, `server.sh` in `projects-x/lps`): most of each is not specific to lps, and a copy in every project would never get a fix. These become agentx commands, which a project gets, and gets again with each new version, by pinning agentx. What only one project needs goes into the project's own scripts, which the commands call.

Nothing runs in production yet, so nothing here has to stay compatible.

## Choices

- **One target: an Ubuntu 24.04 VPS (Contabo).** Other hosts, such as AWS or GCP, come later as other targets.
- **Caddy** as the HTTPS reverse proxy. It gets and renews the Let's Encrypt certificate itself, its config is a few lines, and it already runs lps. nginx would need certbot, a renewal timer and a longer config, for nothing a single VPS uses.
- **systemd user services**, with lingering on, so they start at boot and outlive the SSH session. systemd is on every Ubuntu, logs to the journal with rotation, and drains a stop with `KillMode=mixed` and `TimeoutStopSec`. pm2 would sit on a systemd unit all the same (`pm2 startup`), and its defaults signal every child and kill after 1.6 s. Docker would need volumes for storage, Pi's login and the browser profiles, and an image build on each deploy.
- **Node from NodeSource's apt repository, pnpm from `npm -g`.** Node and pnpm land in `/usr/bin`, on systemd's default PATH, so the units set none: the agents' own commands, `agentx` and `agentx-browser`, are already first on their PATH (`agent-env.ts`). `apt upgrade` patches Node. nvm puts Node on the PATH of interactive shells only. Corepack leaves Node after 24.

## `agentx dev`, on a laptop

In the project root, `agentx dev`:

1. Checks the logins and keys, asking for what is missing ([below](#logins-and-keys)), and runs the project's `deploy/check.sh` if it exists.
2. Opens an ngrok tunnel to port 3100, on the ngrok account's domain, and reads its address from ngrok's local API. Without ngrok, or without its login, it goes on with no tunnel and says which services are off for want of an address.
3. Runs the coordinator in its own process, as `serve` does, with the tunnel's address as `publicUrl` for this run only. `publicUrl` in `agentx.json` is the server's address and is not changed.
4. Runs `next dev` in `web/`.

The first Ctrl-C lets the agents finish their running work, as with `serve`, and stops ngrok and `next dev`. The template's root `dev` script runs `agentx dev`.

Telegram sends a bot's messages to one place: `agentx dev` points each bot at the laptop. The laptop's `agent-x/.env` holds a bot of its own, never the server's.

## `agentx server`, on a VPS

### Before it, once per VPS

`agentx` runs on Node, so it cannot install Node. The guide gives:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm@11
```

then `git clone` the project, `pnpm install`, set `publicUrl` in `agent-x/agentx.json` to `https://<domain>`, and point the domain's DNS A record (and AAAA, if any) at the VPS.

### `agentx server setup`

Run as the user who runs the app, in a terminal (`ssh -t <server>`; for a provider whose sign-in ends on a local port, forward it too, such as `-L 1455:127.0.0.1:1455` for ChatGPT's, so the sign-in completes by itself); it asks for the sudo password itself and refuses to run as root. Running it again changes only what differs. In order:

1. Checks Node (at least 24.12, agentx's `engines`) and pnpm, and prints the commands above when either is missing.
2. DNS: `systemd-resolved` also asks 1.1.1.1 and 8.8.8.8, since the provider's resolvers can be slow or not answer, which times out logins and API calls.
3. Lingering: `loginctl enable-linger`.
4. Checks that `publicUrl` is `https://<domain>` with no port or path, and that the domain resolves to this VPS only, as Let's Encrypt requires.
5. Installs Caddy from its apt repository, and writes `/etc/caddy/Caddyfile`: `/services/*` to `127.0.0.1:3100`, everything else to `127.0.0.1:3000`, so the web app must not serve paths under `/services/`. The coordinator's own routes (`/agents`, `/routes`, `/health`) stay off the internet. A Caddyfile agentx did not write is kept beside it. Opens 80 and 443 in ufw when ufw is on, reloads Caddy, and waits for the certificate.
6. Chrome for the agents' browser: the pinned agent-browser's `install --with-deps`, run as the agent `main` would ([browser guide](../../user_guides/give_an_agent_a_browser.md)), puts Chrome for Testing in the user's `~/.agent-browser/browsers/` and its system libraries in the system. Every project gets it, since an agent can start using its browser at any time.
7. Logins and keys, asking for what is missing.
8. The project's `deploy/setup.sh`.

### `agentx server start | stop | restart | status | logs`

- `start` and `restart` check the logins and keys, asking for what is missing, run `deploy/check.sh`, build the web app, write the two units when they changed, enable them, and start or restart both. They refuse when Caddy does not serve `publicUrl`, and say to run `setup`.
- The web app is built beside the running one, so it is up while it builds. Builds alternate between two folders, `web/.next-a/` and `web/.next-b/`: `next build` writes the one not serving, then the web app restarts on it, down only while `next start` starts. The template's `next.config.ts` reads the folder from `AGENTX_WEB_DIST_DIR` (`.next` when unset, as under `next dev`), and the web unit reads it from a file `server` writes, so the unit does not change between builds. The other folder keeps the previous build until the next one.
- `next build` adds to `web/tsconfig.json` the types folders of its build folder that `include` lacks, and never removes one (`writeConfigurationDefaults.js` in Next 16.4.5). The template's `tsconfig.json` lists them for `.next`, `.next-a` and `.next-b` (`<folder>/types/**/*.ts` and `<folder>/dev/types/**/*.ts`), with the other settings Next adds, so a build on the server never changes a checked-in file and `git pull` stays clean.
- The units, named after the project's folder: `<project>-web` runs `next start` in `web/`; `<project>-agents` runs the pinned `agentx.js serve` with the Node that runs agentx, `KillMode=mixed`, `TimeoutStopSec=600` and `Restart=on-failure`.
- `stop` stops and disables both, so they stay stopped after a reboot. It says the agents finish their running work first.
- `status` shows both with their latest log lines; `logs` follows both journals, and passes on `journalctl` options such as `--since today`.

A deploy is `git pull`, `pnpm install`, `agentx server restart`.

## Logins and keys

One check, in the coordinator runtime so that `serve` can use it, finds what is missing:

- each agent's model login: Pi's `auth check` for its provider (`defaultProvider` in its `.pi/settings.json`, else Pi's in `agent-x/.pi/`);
- each agent's keys that the agent template's `.env` names, such as `COMPOSIO_API_KEY`;
- each secret that a service `agentx.json` turns on declares in `secrets`, agentx's and the project's own: a name with `*` once per agent the service lists, such as `TELEGRAM_BOT_TOKEN_ROSIE`.

A key counts as missing when neither its `.env` nor the environment sets it, and the check says what is off without it. A project's own agent keys, such as lps's `LPS_SUPABASE_REF`, are its `deploy/check.sh`'s.

The commands a person types (`dev`, `server setup`, `server start` and `restart`) ask for each: a missing login runs Pi's `auth login` (with `--no-browser` over SSH), and a key is written into its `.env`; an empty answer skips it. `serve` only logs what is missing, since under systemd it has no terminal, and under `dev` its questions would mix with Next's output.

## The project's own scripts

`init-project` writes `deploy/` with two stubs, each a comment saying when it runs and an example, commented out. The developer fills them in; the commands run each with `bash`, from the project root, so no executable bit is needed.

- `deploy/check.sh` runs before `dev` and `server start` and `restart`, for the project's own keys and checks, such as lps's `LPS_SUPABASE_REF`. A non-zero exit stops the command.
- `deploy/setup.sh` runs at the end of `server setup`, for what else the project needs on the server.

A missing file is skipped, as in a project made before these commands: `upgrade-project` adds no files ([D100](../../architecture/cli/README.md#d100)).

## To decide while building

- Whether `install --with-deps` asks for `sudo` itself or must run under it, and that Chrome still lands in the user's home, not root's. agent-browser ships no source to check. On ARM64, which Chrome for Testing does not build for, `setup` says to install Chromium as the browser guide does; Contabo's VPSes are x86-64.
- Verify on a fresh Contabo VPS what this plan takes from memory: its Ubuntu version, NodeSource's `setup_24.x`, ngrok's local API for the tunnel's address, Corepack leaving Node after 24, and pm2's stop defaults.

## Docs when built

- `docs/architecture/cli/deploy/README.md`, with the decisions above; `dev` and `server` in the CLI's commands table; the coordinator's README for the check and the run's `publicUrl`.
- `run_on_a_server.md` rewritten around `agentx server`, `quick_start.md` for `agentx dev`, and in the project's doc the template's `deploy/` stubs, its root `dev` script, `next.config.ts`'s build folder, the build folders in `tsconfig.json`, and the two folders in `.gitignore`.
- `docs/README.md` and `docs/high_level_design.md`: the module, its decisions and the status.

## Not in this plan

- Other hosts (AWS, GCP), Docker, and more than one server per project.
- A test server beside production: a second checkout with its own domain, Composio project and bots.
- The web app's environment in production, such as the API token and the coordinator's address: [web-app-api](web-app-api.md).
- Pulling and installing as part of a command.
- Installing agentx from a checkout until it is published: a server links one, as lps's does.
- Moving lps onto the commands, which replaces its three scripts with its `deploy/check.sh`; done in lps afterwards.
