// `agentx server setup`: makes an Ubuntu server ready to run the project. Each step does only what is missing, so it runs again any time, such as
// after the domain changes: DNS that answers, user services that outlive the login, Caddy with HTTPS for publicUrl, Chrome for the agents' browser,
// the logins and keys, and the project's own deploy/setup.sh.

import { lookup } from "node:dns/promises";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { installBrowser } from "../../agent-runtime/browser/agent-browser.js";
import { projectConfig, publicUrl } from "../../agent-runtime/project-config.js";
import { Coordinator } from "../../coordinator-runtime/coordinator.js";
import { askSetup } from "./ask-setup.js";
import { runProjectScript } from "./project-scripts.js";
import { caddyfile, serverDomain, writtenByAgentx } from "./server-files.js";
import { output, run, sudo, writeAsRoot } from "./system.js";

/** Caddy's config file, which agentx server setup owns on the server. */
export const caddyConfig = "/etc/caddy/Caddyfile";

/** Sets up this server for the project whose `agent-x/` directory is `agentX`. */
export async function setUpServer(agentX: string): Promise<void> {
	const root = dirname(agentX);
	if (output("pnpm", ["--version"]) === undefined) {
		throw new Error(`pnpm is not installed. Install Node and pnpm once:
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
  sudo npm install -g pnpm@11`);
	}
	await useAnsweringDns();
	keepUserServices();
	const domain = await ownDomain(agentX);
	await serveWithCaddy(root, domain);
	if (installBrowser() !== 0) console.error("Chrome is not installed, so the agents' browser does not work; the rest goes on. Run this again to try once more.");
	await askSetup(agentX, new Coordinator(agentX));
	runProjectScript(root, "setup");
	console.log(`Set up: https://${domain}/services/* goes to the agents, the rest to the web app. Start them with agentx server start.`);
}

// The system resolver also asks Cloudflare and Google, as a hosting provider's resolvers can take seconds or not answer, which times out logins and API
// calls. With the routing domain "~.", systemd-resolved sends every query to these as well as the provider's, and takes the first answer.
async function useAnsweringDns(): Promise<void> {
	const conf = "[Resolve]\nDNS=1.1.1.1 8.8.8.8 2606:4700:4700::1111 2001:4860:4860::8888\nDomains=~.\n";
	if (writeAsRoot("/etc/systemd/resolved.conf.d/public-dns.conf", conf)) sudo(["systemctl", "restart", "systemd-resolved"]);
	await lookup("acme-v02.api.letsencrypt.org").catch(() => {
		throw new Error("DNS does not answer: check it with resolvectl status.");
	});
	console.log("DNS: public resolvers on.");
}

// Lingering starts the user's services at boot and keeps them running after the person logs out.
function keepUserServices(): void {
	const user = userInfo().username;
	if (output("loginctl", ["show-user", user, "--property=Linger", "--value"]) !== "yes") sudo(["loginctl", "enable-linger", user]);
	console.log(`User services: ${user}'s run at boot and after logout.`);
}

// The domain of publicUrl, once it resolves to this server only, as Let's Encrypt checks the domain by connecting to it.
async function ownDomain(agentX: string): Promise<string> {
	const url = publicUrl(projectConfig(agentX));
	const domain = serverDomain(url);
	if (domain === undefined) {
		throw new Error(`publicUrl in agent-x/agentx.json is ${JSON.stringify(url)}: set it to https://<your domain>, with the domain's DNS pointing at this server.`);
	}
	const here = Object.values(networkInterfaces())
		.flatMap((addresses) => addresses ?? [])
		.filter((address) => !address.internal)
		.map((address) => address.address);
	const addresses = await lookup(domain, { all: true }).catch(() => []);
	if (addresses.length === 0) throw new Error(`${domain} does not resolve: add a DNS A record for it with this server's address (${here.join(", ")}).`);
	for (const { address } of addresses) {
		if (!here.includes(address)) throw new Error(`${domain} resolves to ${address}, which is not this server (${here.join(", ")}): fix its DNS records (A and AAAA), then run this again.`);
	}
	return domain;
}

// Caddy as the HTTPS proxy for `domain`, installed from its apt repository, with the firewall open for Let's Encrypt and HTTPS; waits for the certificate.
async function serveWithCaddy(root: string, domain: string): Promise<void> {
	if (output("caddy", ["version"]) === undefined) {
		console.log("Installing Caddy from its apt repository...");
		run("bash", [
			"-c",
			`set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq curl gnupg > /dev/null
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -qq
sudo apt-get install -y -qq caddy > /dev/null`,
		]);
	}
	const config = caddyfile(root, domain);
	const draft = mkdtempSync(join(tmpdir(), "agentx-"));
	writeFileSync(join(draft, "Caddyfile"), config);
	const valid = run("caddy", ["validate", "--adapter", "caddyfile", "--config", join(draft, "Caddyfile")], true);
	rmSync(draft, { recursive: true });
	if (!valid) throw new Error(`Caddy refused this config:\n${config}`);
	// A Caddyfile that agentx did not write, such as the package's sample, is kept beside it.
	if (existsSync(caddyConfig) && !readFileSync(caddyConfig, "utf8").includes(writtenByAgentx)) sudo(["cp", caddyConfig, `${caddyConfig}.before-agentx`]);
	writeAsRoot(caddyConfig, config);
	if (output("sudo", ["ufw", "status"])?.startsWith("Status: active")) {
		// 80 for Let's Encrypt's check and the redirect to HTTPS.
		sudo(["ufw", "allow", "80/tcp"]);
		sudo(["ufw", "allow", "443/tcp"]);
	}
	sudo(["systemctl", "enable", "--quiet", "caddy"]);
	sudo(["systemctl", "reload-or-restart", "caddy"]);

	console.log(`Getting the certificate for ${domain} from Let's Encrypt...`);
	for (const end = Date.now() + 120_000; Date.now() < end; ) {
		// Any answer means the certificate is valid: until the project runs, Caddy answers 502.
		const answered = await fetch(`https://${domain}/services/`, { signal: AbortSignal.timeout(10_000) }).then(
			() => true,
			() => false,
		);
		if (answered) return console.log(`HTTPS: https://${domain} has its certificate.`);
		await new Promise((resolve) => setTimeout(resolve, 4000));
	}
	run("sudo", ["journalctl", "--unit=caddy", "--lines=25", "--no-pager"], true);
	throw new Error(`No valid certificate for ${domain} after two minutes: Caddy's log is above. It keeps trying by itself; run this again to check.`);
}
