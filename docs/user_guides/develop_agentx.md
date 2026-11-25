# Develop agentx

## Build and check

```sh
pnpm install
pnpm run check    # type check
pnpm run build    # writes dist/, which the agentx command runs
pnpm test         # builds, then runs test/*.test.mjs
```

The tests need no login and no network.

- `test/queue.test.mjs` tests the queue, with several processes sharing one file.
- `test/runner.test.mjs` creates scratch projects in the temp directory, with this checkout linked in as their agentx. It runs the built CLI, `agentx run` and real Pi processes against `test/fake-model.mjs`, a fake model server on localhost.
- `test/agentx-run.test.mjs` does the same for the rest of `agentx run`: the routers, workflows and their failure reports, stopping, and a crashed loop.
- `test/coordinator.test.mjs` tests the `AgentManager` with stand-in processes, delivery and schedules, and `agentx serve` end to end: two agents, delivery between them, refusals, restarts and stopping.
- `test/composio.test.mjs` does the same for the Composio extension, also against `test/fake-composio.mjs`, a fake Composio with its session routes and an MCP endpoint.

## Run the local build

Register the checkout's commands once. `agentx` then works in any directory:

```sh
pnpm add -g .                          # in the agentx checkout, after pnpm run build
agentx init-project my-project         # anywhere
```

`pnpm remove -g @cognisphere-sh/agentx` removes them.

## Use a local build in a project

To try a local build in a project, link it in place of the version it pins:

```sh
cd my-project/agent-x
pnpm link <path-to-agentx>        # with npm: npm install <path-to-agentx>
```

Then install the project from its root with the same package manager. pnpm writes the path as `link:` and npm as `file:`, so do not mix them in one project.

After a change to agentx:

| Changed | Do |
|---|---|
| Most code | `pnpm run build`. The project uses `dist/` through the link. |
| `src/agent-runtime/pi/pi-package/`, and `events/queue.ts`, `sqlite.ts`, `project-config.ts` and `time-zone.ts`, which its extensions import | Nothing for Pi, which loads them as source when a session starts. For `queue.ts`, `sqlite.ts`, `project-config.ts` and `time-zone.ts`, also `pnpm run build`: the rest of agentx uses them from `dist/`. |

## Branches, pull requests and releases

Every change reaches `main` through a pull request from a branch of its own:

```sh
git switch -c feat/<name> main    # or fix/, docs/, chore/
pnpm run check && pnpm test
git push -u origin feat/<name>
gh pr create                      # fills in .github/pull_request_template.md
```

- The template asks what changes and why, how it was tested, whether the docs match, and whether it releases. The title becomes the one commit the pull request is squashed into on `main`, and its line in the release notes, so it says what changes: `feat: …`, `fix: …`, `docs: …`, `chore: …`.
- CI, `.github/workflows/ci.yml`, runs `pnpm run check` and `pnpm test` on Ubuntu for every pull request and every push to `main`. A pull request merges once its `test` check passes.
- **A release is a merged pull request that raises `version` in `package.json`**: patch, minor or major. On that push to `main`, CI tests it again, builds `dist/` from nothing, publishes it to npm with provenance, and makes the tag `v<version>` and a GitHub release whose notes list the pull requests merged since the last tag. A push that leaves `version` as it is releases nothing.
- npm takes a publish only from `ci.yml` running in the GitHub environment `npm`, which deploys only from `main`: npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/), with no npm token kept anywhere. Renaming the file or the environment stops releases until the trusted publisher on npmjs.com names the new ones.
- A release that failed runs again from the Actions tab: it skips npm when the version is there already.

To publish by hand instead, from a terminal of your own, where npm can open the browser for 2FA: `rm -r dist && pnpm run build && pnpm test && npm publish` (tsc leaves the output of deleted sources, so build from nothing), then tag the commit `v<version>` and push the tag.

## Before changing code

Follow [CLAUDE.md](../../CLAUDE.md): read the design docs first, and update the docs in the same change.
