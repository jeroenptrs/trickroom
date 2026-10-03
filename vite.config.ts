import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import spaServer from "./plugin/spa-server/index";
import { resolveTrickroomHome } from "./src/app-state/home";
import { requireSessionTokenForHost } from "./src/server-auth";
import { resolvePublicHost } from "./src/server-public-host";

// Reads the raw file rather than importing app-state/settings, which would
// pull the MCP and Tailwind class modules into the node tsconfig project.
const readSettingsPublicHost = async () => {
	try {
		const settings: unknown = JSON.parse(
			await readFile(
				path.join(resolveTrickroomHome(), "settings.json"),
				"utf8",
			),
		);
		const publicHost = (settings as { server?: { publicHost?: unknown } })
			?.server?.publicHost;
		return typeof publicHost === "string" ? publicHost : undefined;
	} catch {
		return undefined;
	}
};

export default defineConfig({
	build: {
		outDir: "dist/client",
	},
	server: {
		watch: {
			ignored: ["**/.trickroom/**"],
		},
	},
	plugins: [
		{
			name: "require-shared-host-auth",
			async config(config) {
				// Vite blocks unknown Host headers; allow the configured public host.
				const env = process.env.TRICKROOM_PUBLIC_HOST;
				const settings = env?.trim()
					? undefined
					: await readSettingsPublicHost();
				if (!env?.trim() && !settings?.trim()) {
					return;
				}
				const { host } = resolvePublicHost({
					bindHost: "localhost",
					env,
					settings,
					hostname: () => "",
				});
				const allowedHosts = config.server?.allowedHosts;
				if (allowedHosts === true) {
					return;
				}
				return {
					server: { allowedHosts: [...(allowedHosts ?? []), host] },
				};
			},
			configResolved(config) {
				const host = config.server.host;
				requireSessionTokenForHost(
					host === true ? "0.0.0.0" : host || "localhost",
					process.env.TRICKROOM_SESSION_TOKEN,
				);
			},
		},
		react(),
		tailwindcss(),
		spaServer({
			port: 18100,
			entry: "./src/server.ts",
		}),
	],
});
