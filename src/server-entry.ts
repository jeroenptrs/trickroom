import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { etag } from "hono/etag";
import { readTrickroomSettings } from "./app-state/settings";
import app from "./server";
import { formatServerUrlHost, requireSessionTokenForHost } from "./server-auth";
import { resolvePublicHost } from "./server-public-host";

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

// Auth policy is decided on the bind host; the public host only affects URLs.
requireSessionTokenForHost(configuredHost, sessionToken);

const readSettingsPublicHost = async () => {
	try {
		return (await readTrickroomSettings()).server?.publicHost;
	} catch (error) {
		console.warn(
			`${error instanceof Error ? error.message : String(error)} Ignoring server.publicHost.`,
		);
		return undefined;
	}
};

const publicHost = resolvePublicHost({
	bindHost: configuredHost,
	flag: process.env.TRICKROOM_CLI_PUBLIC_HOST,
	env: process.env.TRICKROOM_PUBLIC_HOST,
	settings: await readSettingsPublicHost(),
	hostname: os.hostname,
}).host;
const urlHost = formatServerUrlHost(publicHost);

export const serverPublicHost = publicHost;
export let serverPort = configuredPort;
export let serverUrl = `http://${urlHost}:${configuredPort}/`;

export type ServerReadyPayload = {
	type: "trickroom:server-ready";
	version: 1;
	/** Bind address. */
	host: string;
	/** Host used in `url`; differs from `host` for wildcard binds or when configured. */
	publicHost: string;
	port: number;
	url: string;
	token: string | null;
	authenticated: boolean;
};

export const serverReady = new Promise<ServerReadyPayload>((resolve) => {
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
			if (process.env.TRICKROOM_CLI_MANAGED_OUTPUT !== "1") {
				console.log(
					`Running ${sessionToken ? "with session auth" : "locally"} ${cleanUrl}`,
				);
			}
			const payload: ServerReadyPayload = {
				type: "trickroom:server-ready" as const,
				version: 1 as const,
				port,
				host: configuredHost,
				publicHost,
				url: serverUrl,
				token: sessionToken ?? null,
				authenticated: Boolean(sessionToken),
			};
			if (typeof process.send === "function") process.send(payload);
			if (
				process.env.TRICKROOM_READY_JSON === "1" &&
				process.env.TRICKROOM_CLI_MANAGED_OUTPUT !== "1"
			) {
				process.stderr.write(`${JSON.stringify(payload)}\n`);
			}
			resolve(payload);
		},
	);
});
