import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import spaServer from "./plugin/spa-server/index";

export default defineConfig({
	build: {
		outDir: "dist/client",
	},
	define: {
		__TRICKROOM_SENTRY_DSN__: JSON.stringify(
			process.env.TRICKROOM_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN,
		),
	},
	server: {
		watch: {
			ignored: ["**/.trickroom/**"],
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		spaServer({
			port: 18100,
			entry: "./src/server.ts",
		}),
	],
});
