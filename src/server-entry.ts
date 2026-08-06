import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { etag } from "hono/etag";
import app from "./server";
import { formatServerUrlHost, requireSessionTokenForHost } from "./server-auth";

const clientPath = new URL("./client", import.meta.url).pathname;

const isApiPath = (requestPath: string) =>
	requestPath === "/api" || requestPath.startsWith("/api/");

app.use(
	"/*",
	(c, next) => {
		if (isApiPath(c.req.path)) {
			c.header("spa-server", "false");
			return c.notFound();
		}
		return next();
	},
	etag(),
	serveStatic({ root: clientPath, index: "index.html" }),
);

app.get("/*", etag(), (c) => {
	if (isApiPath(c.req.path)) {
		c.header("spa-server", "false");
		return c.notFound();
	}
	const html = readFileSync(path.join(clientPath, "index.html"), "utf-8");
	return c.html(html);
});

const configuredPort = Number(process.env.TRICKROOM_HTTP_PORT ?? "18100");
const configuredHost = process.env.TRICKROOM_HTTP_HOST ?? "localhost";
const sessionToken = process.env.TRICKROOM_SESSION_TOKEN?.trim();
const urlHost = formatServerUrlHost(configuredHost);

requireSessionTokenForHost(configuredHost, sessionToken);

export let serverPort = configuredPort;
export let serverUrl = `http://${urlHost}:${configuredPort}/`;

export const serverReady = new Promise<void>((resolve) => {
	serve(
		{ fetch: app.fetch, port: configuredPort, hostname: configuredHost },
		(address) => {
			const port =
				typeof address === "object" && address ? address.port : configuredPort;
			serverPort = port;
			const cleanUrl = `http://${urlHost}:${port}/`;
			serverUrl = sessionToken
				? `${cleanUrl}?token=${encodeURIComponent(sessionToken)}`
				: cleanUrl;
			console.log(
				`Running ${sessionToken ? "with session auth" : "locally"} ${cleanUrl}`,
			);
			const payload = {
				type: "trickroom:server-ready" as const,
				version: 1 as const,
				port,
				host: configuredHost,
				url: cleanUrl,
				authenticated: Boolean(sessionToken),
			};
			if (typeof process.send === "function") process.send(payload);
			if (process.env.TRICKROOM_READY_JSON === "1") {
				process.stderr.write(`${JSON.stringify(payload)}\n`);
			}
			resolve();
		},
	);
});
