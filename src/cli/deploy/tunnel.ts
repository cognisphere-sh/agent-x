// The tunnel `agentx dev` opens so that outside services, such as Telegram, reach agentx serve on a laptop: ngrok, on its account's domain.

import { type ChildProcess, spawn } from "node:child_process";

/** An open tunnel: its public address, and the ngrok process that holds it. */
export interface Tunnel {
	url: string;
	ngrok: ChildProcess;
}

/** Opens an ngrok tunnel to `port` on this machine. Resolves to the tunnel, or to why there is none, such as ngrok missing or not logged in. */
export function openTunnel(port: number): Promise<Tunnel | string> {
	return new Promise((resolve) => {
		const ngrok = spawn("ngrok", ["http", String(port), "--log=stdout"], { stdio: ["ignore", "pipe", "pipe"] });
		let log = "";
		let open = false;
		// Once the tunnel is open, the promise is settled, and a later failure changes nothing.
		const fail = (why: string) => {
			clearTimeout(timer);
			resolve(why);
		};
		const timer = setTimeout(() => {
			ngrok.kill();
			fail("ngrok opened no tunnel within 20 seconds.");
		}, 20_000);
		ngrok.on("error", (error) => fail((error as NodeJS.ErrnoException).code === "ENOENT" ? "ngrok is not installed (https://ngrok.com/download)." : `ngrok did not start: ${error.message}`));
		ngrok.on("exit", () => fail(`ngrok stopped:\n${log.trim().split("\n").slice(-3).join("\n")}`));
		// ngrok goes on logging every request: read on, so its output never fills up and blocks it, and keep only what comes before the tunnel.
		const read = (chunk: Buffer) => {
			if (open) return;
			log += chunk;
			const url = /msg="started tunnel".* url=(\S+)/.exec(log)?.[1];
			if (url === undefined) return;
			open = true;
			clearTimeout(timer);
			resolve({ url, ngrok });
		};
		ngrok.stdout.on("data", read);
		ngrok.stderr.on("data", read);
	});
}
