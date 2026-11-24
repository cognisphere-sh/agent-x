# Upgrade agentx

A project pins one agentx version, in `agent-x/package.json`, and every agent of the project runs it. A new version may add settings and keys. The upgrade adds them to your files, with their default values, and changes nothing you set.

## The project

In the project's root, `agent-x/` or `agent-x/agents/`:

```sh
agentx upgrade-project
```

It moves `@cognisphere-sh/agentx` to the latest version and installs it, with pnpm. Then the new version adds what its templates have and your files lack, and prints each change:

| File | What it adds |
|---|---|
| `agent-x/agentx.json` | New keys |
| `agent-x/.env` | New secrets of the coordinator and its services, commented out |
| `.gitignore` | New lines |
| Each agent's files | What `agentx upgrade-agent` adds, below |

Check the changes with `git diff` and commit them. A second run changes nothing.

With agentx linked from a checkout, nothing is installed: the files are brought up to the checkout's templates.

A project that pins a version without `upgrade-project` upgrades once by hand, in `agent-x/`: `pnpm add --save-exact @cognisphere-sh/agentx@latest`, then `agentx upgrade-project`.

## One agent

In the project's root, `agent-x/` or `agent-x/agents/`:

```sh
agentx upgrade-agent main
```

| File | What it adds or changes |
|---|---|
| `.pi/settings.json` | Each `agentx` setting the agent lacks, with its default. Each Pi package the agent lists at the version the new agentx pins, such as `pi-web-access`. A package you removed stays removed. |
| `.env` | New keys, commented out. The file is written when it is missing. |

A setting you deleted comes back with its default. To turn a setting off, give it a value instead, such as `"systemPrompt": []`.
