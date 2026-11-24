import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// agentx server builds into web/.next-a/ and web/.next-b/ in turn, beside the running app; next dev uses .next.
	distDir: process.env.AGENTX_WEB_DIST_DIR ?? ".next",
};

export default nextConfig;
