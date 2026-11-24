// The ports of a project's two processes, on 127.0.0.1: the agents' and the web app's (Next's default).

/** Where `agentx serve` listens unless told otherwise; the tunnel and the server's proxy forward `/services/*` here. */
export const agentsPort = 3100;

/** Where the web app listens; the server's proxy forwards everything else here. */
export const webPort = 3000;
