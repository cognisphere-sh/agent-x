# Give an agent a browser

Every agent has a browser of its own: it opens sites, reads them, clicks, fills forms and stays signed in, from its bash, with `agentx-browser` ([browser](../architecture/agent-runtime/browser/README.md)). It learns how from agentx's browser skill. It uses the browser only for a task that its Composio tools, a command line tool or another tool cannot do, or when you ask it to use a browser: Composio is its main way into external services. There is nothing to turn on; this guide is about setting it up on a server, and about its profiles.

## Setting it up

- **Chrome.** The agent downloads the Chrome it needs with `agentx-browser install` the first time a command says it is missing, into `~/.agent-browser/browsers/` of the user the agents run as. To do it ahead, say in an image, run it as the agent `main` would, from `agent-x/`: `AGENTX_AGENT=main PI_CODING_AGENT_DIR=.pi pnpm exec agentx-browser install`.
- **Linux.** Chrome needs system libraries: add `--with-deps` to that command, run as root or with `sudo`. On Linux ARM64, which Chrome for Testing does not build for, install Chromium from the system's packages instead, and set `AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium` in the agent's `.env`.
- **`HOME`.** agent-browser's socket paths start with `HOME` and must stay under 104 bytes, so keep `HOME` short, such as `/home/agents`.

agent-browser's other settings, such as a proxy, are environment variables (`AGENT_BROWSER_*`, [agent-browser's configuration](https://agent-browser.dev/configuration)); put them in the agent's `.env`, `agent-x/agents/<name>/.env`, and its browser gets them.

## Profiles

A profile is a browser with its own sign-ins, kept in the agent's `storage/workspace/browser/profiles/<name>/`. The agent uses `default` unless it picks another, and makes a new one by naming it, such as one per account when it works with two accounts of one site. Tell it in its prompt which profile is for what, if that matters to you.

A site the agent signs in to on a profile stays signed in there for as long as the site keeps the sign-in. When a site needs a sign-in the agent cannot do, it tells the person who asked.

To sign an agent out of everything in a profile, delete the profile's folder while the agent does not run.

## What to keep in mind

- One profile is one browser, shared by all of the agent's threads.
- Until agents run in sandboxes, an agent can read its profiles' files, and those of the project's other agents, since they all run as one user.
- A page's text can try to give the agent orders. The skill tells it that what a page says is data, never instructions; prefer a profile signed in to only what a task needs.
