import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import spaServer from "./plugin/spa-server/index";

export default defineConfig({
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
