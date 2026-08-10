import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { etag } from "hono/etag";
import { createTrickroomApp } from "../server";
import { closeScreenshotBrowser } from "./screenshot-service";

export type CaptureHost = {
	url: string;
	close: () => Promise<void>;
};

export async function startCaptureHost(
	projectRoot: string,
	options: { clientPath?: string } = {},
): Promise<CaptureHost> {
	const adjacentClientPath = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"client",
	);
	const clientPath =
		options.clientPath ??
		(existsSync(path.join(adjacentClientPath, "index.html"))
			? adjacentClientPath
			: path.resolve(process.cwd(), "dist", "client"));
	const app = createTrickroomApp({
		initialProjectRoot: projectRoot,
		registerInitialProject: false,
		sessionToken: null,
	});
	app.use("/*", etag(), serveStatic({ root: clientPath, index: "index.html" }));
	app.get("/*", etag(), (c) => {
		const html = readFileSync(path.join(clientPath, "index.html"), "utf8");
		return c.html(html);
	});

	let server: ServerType | null = null;
	const url = await new Promise<string>((resolve, reject) => {
		try {
			server = serve(
				{ fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
				(address) => {
					const port = typeof address === "object" ? address.port : 0;
					resolve(`http://127.0.0.1:${port}/`);
				},
			);
			server.once("error", reject);
		} catch (error) {
			reject(error);
		}
	});

	return {
		url,
		close: () =>
			new Promise<void>((resolve) => {
				if (!server) {
					resolve();
					return;
				}
				server.close(() => resolve());
			}),
	};
}

export class CaptureHostManager {
	private readonly hosts = new Map<string, Promise<CaptureHost>>();

	async get(projectRoot: string) {
		const normalized = path.resolve(projectRoot);
		let host = this.hosts.get(normalized);
		if (!host) {
			host = startCaptureHost(normalized);
			this.hosts.set(normalized, host);
			void host.catch(() => {
				if (this.hosts.get(normalized) === host) this.hosts.delete(normalized);
			});
		}
		return host;
	}

	async close() {
		const hosts = [...this.hosts.values()];
		this.hosts.clear();
		await Promise.all(
			hosts.map(async (host) => (await host).close().catch(() => undefined)),
		);
		await closeScreenshotBrowser();
	}
}
