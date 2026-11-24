# Browser

An agent's browser is the [agent-browser](https://agent-browser.dev) that agentx pins, a Rust command line that drives Chrome, run on one of the agent's profiles ([D78](#d78)). The agent runs it with `agentx-browser` in its bash, which the [browser skill](../pi/pi-package/README.md#skills) teaches it. Composio is its main way into external services: the harness prompt and the skill tell it to use the browser only for a task that Composio, a command line tool or another tool cannot do, or when the person asks for a browser. A profile keeps what sites store, such as a sign-in, from one run to the next ([D79](#d79)).

```
src/agent-runtime/browser/
  agent-browser.ts    runBrowser: agent-browser on one profile, with the agent's folders and namespace; installBrowser: Chrome and its libraries, for agentx server setup
  browser-command.ts  agentx-browser, the agent's command
```

## The command

`agentx-browser [--profile <name>] <command> [args]` runs `agent-browser --session <name> --profile storage/workspace/browser/profiles/<name> <command> [args]`, with `default` when no profile is given. Every agent-browser command passes through as it is, such as `open`, `snapshot`, `click`, `skills get core` and `install`.

It is a second executable of the `agent-x` package, so pnpm links it into `agent-x/node_modules/.bin`, which is on the PATH of the agent's processes ([agent env](../agent/README.md)). It is the agent's, not a person's: it finds the agent from `AGENTX_AGENT` and `PI_CODING_AGENT_DIR`, which its processes have, refuses to run without them, and makes the agent's storage when it is missing, as `agentx run` does.

It runs agent-browser with the agent's `.env`, as the agent's processes have it, so a setting there reaches agent-browser too, such as `AGENT_BROWSER_EXECUTABLE_PATH` or a proxy. It adds:

| Variable | Value | Why |
|---|---|---|
| `AGENT_BROWSER_NAMESPACE` | `agentx-` and 12 hex digits of a hash of the real path of the agent's storage | agent-browser keeps its sockets and its own state in `~/.agent-browser/namespaces/<namespace>/`. One per agent, so two agents, also of two projects, never share a session |
| `AGENT_BROWSER_DOWNLOAD_PATH` | `storage/workspace/browser/downloads` | Downloads stay in the agent's storage |
| `AGENT_BROWSER_SCREENSHOT_DIR` | `storage/workspace/browser/screenshots` | So do screenshots taken without a path |

## Profiles

A profile is a Chrome profile folder, `storage/workspace/browser/profiles/<name>/`: cookies, local storage, IndexedDB, service workers and cache. Its agent-browser session has the same name, so a profile is one Chrome, in agent-browser's background process, which outlives the command that started it. Every thread of the agent that names the profile uses that one browser.

- **Names.** Lowercase letters, digits, `-` and `_`, up to 32 characters, starting with a letter or digit. The name is in a socket path, which must stay under 104 bytes.
- **New ones.** A name not used before makes a new, empty profile. The agent makes one for each account or task that must stay apart.
- **Closing.** agent-browser closes a headless browser after an hour with no command, and starts it again, with the same profile, at the next command.
- **Forgetting one.** The agent closes it and deletes its folder.

```
storage/workspace/browser/        the agent's, in its storage
  profiles/<name>/                a Chrome profile
  downloads/  screenshots/
~/.agent-browser/                 agent-browser's own, of the user the agents run as
  browsers/                       Chrome for Testing, for every agent of the machine
  namespaces/agentx-<hash>/       one agent's sockets and agent-browser's own state
```

## Setup

- **Chrome.** `agentx-browser install` downloads the Chrome for Testing build that this agent-browser expects into `~/.agent-browser/browsers/`, once per machine and user. The skill tells the agent to run it when a command says Chrome is missing.
- **Linux.** Chrome needs system libraries: `agentx-browser install --with-deps` installs them too, with the system's package manager, through `sudo` for a user who is not root, while Chrome goes into that user's home. `agentx server setup` runs it ([deploy](../../cli/deploy/README.md#setup)). Chrome for Testing has no Linux ARM64 build: there, install Chromium from the system's packages and set `AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium` in the agent's `.env`.

[Give an agent a browser](../../../user_guides/give_an_agent_a_browser.md) shows how to use it.

## Known limits

- A profile is one browser shared by the agent's threads, which may change its page under each other.
- `~/.agent-browser/` is under `HOME`, and the socket path, `$HOME/.agent-browser/namespaces/agentx-<hash>/run/<profile>.sock`, must stay under 104 bytes: `HOME` and the profile's name together may be 47 characters, such as `/home/agents` with a name of up to 32, or a `HOME` of 40 with `default`.
- Nobody can sign in on an agent's browser for it: a site that needs a person to sign in, such as with a code, stays out of reach of an agent that runs with nobody at its machine.
- A profile's cookies are Chrome's own files in the agent's storage, as plain as Chrome keeps them. Until sandboxes, the agent, which has bash, can read its profiles, and every other agent's.
- agent-browser's background processes outlive `agentx run` and `agentx serve`, until their hour without a command ends them.
- What a page says reaches the model as the output of a command. The skill says it is data, never instructions; nothing enforces it.

## Decisions

<a id="d78"></a>
### D78. An agent's browser is the agent-browser agentx pins, run with `agentx-browser`

- **Problem.** Agents must use websites, sign in to them, and stay signed in, from bash, with little code of agentx's own.
- **Decision.** agentx depends on `agent-browser` at an exact version. The agent runs it through `agentx-browser`, an executable of the `agent-x` package built from `src/agent-runtime/browser/`, which adds the profile, the agent's namespace and its folders, and passes every other argument through. The browser skill in the Pi package teaches it, and points to agent-browser's own guide, `skills get core`, which matches its version.
- **Why.** agent-browser drives a real Chrome, so sign-in pages work, and it is made for an agent in a shell: a snapshot of the page with refs, then `click @e3`, one command at a time, with a background process that keeps the page between commands. A real Chrome profile keeps every kind of state a site uses. Pinned, as Pi is ([D1](../agent/README.md#d1)), every agent runs the same version, and the guide cannot go stale.
- **Rejected.** Lightpanda and Moli, new engines that are lighter and faster: neither documents a sign-in kept as a Chrome profile keeps one (Moli's profile folder lists local storage and IndexedDB, not cookies), and sign-in pages, which need the most of the web platform, are where partial engines break. A script in the skill's folder: plain `node` cannot load agentx's TypeScript the way Pi does, and the model would type its long path in every command. A command of `agentx`, whose commands are for people.
- **Consequence.** agent-browser's domain allowlist is off: it does not work with a profile. Chrome is downloaded once per machine, outside the project.

<a id="d79"></a>
### D79. A profile is a Chrome profile in the agent's storage, and one browser

- **Decision.** Each profile is `storage/workspace/browser/profiles/<name>/`, run as the agent-browser session of the same name. The agent uses `default` unless it names another, and makes a new one by naming it. agent-browser's sockets and its own state go to `~/.agent-browser/namespaces/agentx-<hash>/`, one per agent.
- **Why.** A Chrome profile folder keeps cookies, local storage and IndexedDB as the site wrote them, which a saved state file of cookies and local storage does not. In the agent's storage, a profile is the agent's state, with the rest of it, and is never checked in ([D4](../agent/README.md#d4)). One session per profile keeps one Chrome on a profile folder, which Chrome locks. The sockets cannot be in `storage/`: their paths would pass the 104-byte limit.
- **Rejected.** agent-browser's `--restore` and `state save`: session state only, kept in `~/.agent-browser`. A profile per thread: a sign-in would have to be made again on every thread.
- **Consequence.** Threads that use one profile share its tabs.
