import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import spaServer from "./plugin/spa-server/index";
import { requireSessionTokenForHost } from "./src/server-auth";

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
