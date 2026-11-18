import fs from "node:fs";
import type { PluginOption } from "vite";
import { createDevServerDiscovery } from "./discovery";
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

const isApiRequest = (url: string | undefined) => {
	const pathname = (url ?? "").split("?")[0];
	return pathname === "/api" || pathname.startsWith("/api/");
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
			const discovery = createDevServerDiscovery(
				server,
				async () => (await server.ssrLoadModule(entry)).default,
			);
			server.middlewares.use(async (req, res, next) => {
				const mod = await server.ssrLoadModule(entry);
				const app = mod.default;
				discovery.attach(app);
				app.viteDevServer = server;
				const webRes = (await app.fetch(
					await createRequestFromIncoming(req),
				)) as Response;
				// A 404 from an API route is an answer ("design not found"), not
				// a miss: only non-API paths fall through to Vite's index.html.
				if (webRes.status === 404 && !isApiRequest(req.url)) {
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
