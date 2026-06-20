import "./sentry/backend-init";
import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { etag } from "hono/etag";
import app from "./server";

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

serve(
	{ fetch: app.fetch, port: configuredPort, hostname: configuredHost },
	(address) => {
		const port =
			typeof address === "object" && address ? address.port : configuredPort;
		const url = `http://${configuredHost}:${port}/`;
		console.log(`Running locally ${url}`);
		const payload = {
			type: "trickroom:server-ready" as const,
			version: 1 as const,
			port,
			host: configuredHost,
			url,
			electronMode: process.env.TRICKROOM_ELECTRON === "1",
		};
		if (typeof process.send === "function") process.send(payload);
		if (process.env.TRICKROOM_READY_JSON === "1") {
			process.stderr.write(`${JSON.stringify(payload)}\n`);
		}
	},
);
