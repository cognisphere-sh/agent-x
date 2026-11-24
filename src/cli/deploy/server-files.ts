// The files agentx server writes on a server: Caddy's config, which brings HTTPS to the project's domain, and the systemd user units of its two
// processes, the agents and the web app. Pure, so a test checks them on any machine.

import { basename, dirname, join } from "node:path";
import { installedCli } from "../pinned-cli.js";
import { agentsPort, webPort } from "./ports.js";
import { nextCli, webBuildFile } from "./web-build.js";

/** The words that mark a file agentx server wrote. */
export const writtenByAgentx = "Written by agentx server";

// The first line of a file agentx server writes, which says to change its source rather than the file.
const writtenBy = (root: string, what: string) => `# ${writtenByAgentx} for ${root}, from ${what}: change that and run it again, rather than this file.`;

/** The domain of a server's public address: https, with no port, path or query; undefined when `url` is not one. */
export function serverDomain(url: string | undefined): string | undefined {
	if (url === undefined) return undefined;
	try {
		const { protocol, port, pathname, search, hostname } = new URL(url);
		return protocol === "https:" && port === "" && pathname === "/" && search === "" ? hostname : undefined;
	} catch {
		return undefined;
	}
}

/** The names of the project's two systemd units, after its root folder: `<project>-agents` and `<project>-web`. */
export function unitNames(root: string): { agents: string; web: string } {
	const project = basename(root).replace(/[^A-Za-z0-9-]+/g, "-");
	return { agents: `${project}-agents`, web: `${project}-web` };
}

/** Whether Caddy's config `config` serves `domain`, as one that `caddyfile` wrote does. */
export const servesDomain = (config: string, domain: string) => config.includes(`\n${domain} {\n`);

/** Caddy's config for the project in `root` at `domain`: HTTPS with Let's Encrypt, `/services/*` to agentx serve, everything else to the web app. */
export function caddyfile(root: string, domain: string): string {
	return `${writtenBy(root, "publicUrl in agent-x/agentx.json")}
{
	# Certificates from Let's Encrypt only; Caddy renews them itself.
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

${domain} {
	# agentx serve: what outside services send, such as Telegram's messages and the agents' webhooks. Its own routes stay off the internet.
	handle /services/* {
		reverse_proxy 127.0.0.1:${agentsPort}
	}
	# The web app.
	handle {
		reverse_proxy 127.0.0.1:${webPort}
	}
}
`;
}

/** The unit of the agents of the project in `root`: its pinned agentx serve, run by the Node at `node`. */
export function agentsUnit(root: string, node: string): string {
	return unit(
		root,
		"the agents (agentx serve)",
		root,
		`"${node}" "${installedCli(join(root, "agent-x"))}" serve`,
		node,
		`# A stop is a SIGTERM to agentx serve alone, which lets running work finish; what still runs after 10 minutes is killed.
KillMode=mixed
TimeoutStopSec=600`,
	);
}

/** The unit of the web app of the project in `root`: next start, on the build that web/.agentx-web.env names. */
export function webUnit(root: string, node: string): string {
	return unit(root, "the web app (next start)", join(root, "web"), `"${nextCli(root)}" start --port ${webPort} --hostname 127.0.0.1`, node, `EnvironmentFile=${webBuildFile(root)}`);
}

// A unit that runs `command` in `directory`, with the folder of `node` first on its PATH, so the commands it runs use the Node that runs agentx.
function unit(root: string, what: string, directory: string, command: string, node: string, more: string): string {
	return `${writtenBy(root, "agentx")}
[Unit]
Description=${basename(root)}: ${what}

[Service]
WorkingDirectory=${directory}
Environment="PATH=${dirname(node)}:/usr/local/bin:/usr/bin:/bin"
ExecStart=${command}
${more}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}
