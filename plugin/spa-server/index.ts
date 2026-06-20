import fs from "node:fs";
import type { PluginOption } from "vite";
import { createRequestFromIncoming, sendStream } from "./http-bridge";
import type { SPAServerOptions } from "./types";

const resolveEntry = (entry: string | undefined) => {
	if (entry) return entry;
	const found = ["./src/server.ts", "./src/server.js"].find((candidate) =>
		fs.existsSync(candidate),
	);
	if (!found) {
		throw new Error("SPA server entry not found");
	}
	return found;
};

export const spaServer = (opts: SPAServerOptions = {}): PluginOption => {
	const entry = resolveEntry(opts.entry);

	return {
		name: "vite-spa-server",
		apply: "serve",
		config(self) {
			self.server ??= {};
			if (opts.port != null) {
				self.server.port = opts.port;
			}
			return self;
		},
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const mod = await server.ssrLoadModule(entry);
				const app = mod.default;
				app.viteDevServer = server;
				const webRes = (await app.fetch(
					await createRequestFromIncoming(req),
				)) as Response;
				if (webRes.status === 404) {
					const marker = webRes.headers.get("spa-server");
					if (marker !== "false") {
						return next();
					}
				}
				await sendStream(webRes, res);
			});
		},
	};
};

export default spaServer;
