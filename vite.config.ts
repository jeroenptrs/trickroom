import { readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import spaServer from "./plugin/spa-server/index";
import { resolveTrickroomHome } from "./src/app-state/home";
import { requireSessionTokenForHost } from "./src/server-auth";
import { resolvePublicHost, resolvePublicUrl } from "./src/server-public-host";

// Reads the raw file rather than importing app-state/settings, which would
// pull the MCP and Tailwind class modules into the node tsconfig project.
const readServerSettings = async () => {
	try {
		const settings: unknown = JSON.parse(
			await readFile(
				path.join(resolveTrickroomHome(), "settings.json"),
				"utf8",
			),
		);
		const server = (settings as { server?: Record<string, unknown> })?.server;
		const read = (key: string) =>
			typeof server?.[key] === "string" ? server[key] : undefined;
		return { publicHost: read("publicHost"), publicUrl: read("publicUrl") };
	} catch {
		return {};
	}
};

// Configured public URL and public host names; inference is not included.
const configuredPublicHosts = async () => {
	const settings = await readServerSettings();
	const hosts: string[] = [];
	const publicUrl = resolvePublicUrl({
		env: process.env.TRICKROOM_PUBLIC_URL,
		settings: settings.publicUrl,
	});
	if (publicUrl) {
		hosts.push(publicUrl.host);
	}
	const env = process.env.TRICKROOM_PUBLIC_HOST;
	if (env?.trim() || settings.publicHost?.trim()) {
		hosts.push(
			resolvePublicHost({
				bindHost: "localhost",
				env,
				settings: settings.publicHost,
				hostname: () => "",
			}).host,
		);
	}
	return hosts;
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
				// Vite blocks unknown Host headers; allow the configured public hosts.
				const hosts = await configuredPublicHosts();
				if (hosts.length === 0) {
					return;
				}
				const allowedHosts = config.server?.allowedHosts;
				if (allowedHosts === true) {
					return;
				}
				return {
					server: { allowedHosts: [...(allowedHosts ?? []), ...hosts] },
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
