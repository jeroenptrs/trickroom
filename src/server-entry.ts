import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { etag } from "hono/etag";
import {
	createServerDiscoveryPublisher,
	resolveLoopbackServerUrl,
} from "./app-state/runtime-servers";
import { readTrickroomSettings } from "./app-state/settings";
import app from "./server";
import { formatServerUrlHost, requireSessionTokenForHost } from "./server-auth";
import { resolvePublicHost, resolvePublicUrl } from "./server-public-host";

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

const readServerSettings = async () => {
	try {
		return (await readTrickroomSettings()).server;
	} catch (error) {
		console.warn(
			`${error instanceof Error ? error.message : String(error)} Ignoring server.publicUrl and server.publicHost.`,
		);
		return undefined;
	}
};

const serverSettings = await readServerSettings();
// A configured public URL wins over every public host source.
const publicUrl =
	resolvePublicUrl({
		flag: process.env.TRICKROOM_CLI_PUBLIC_URL,
		env: process.env.TRICKROOM_PUBLIC_URL,
		settings: serverSettings?.publicUrl,
	})?.url ?? null;
const publicHost = publicUrl
	? new URL(publicUrl).hostname.replace(/^\[|\]$/g, "")
	: resolvePublicHost({
			bindHost: configuredHost,
			flag: process.env.TRICKROOM_CLI_PUBLIC_HOST,
			env: process.env.TRICKROOM_PUBLIC_HOST,
			settings: serverSettings?.publicHost,
			hostname: os.hostname,
		}).host;
const baseUrlForPort = (port: number) =>
	publicUrl ?? `http://${formatServerUrlHost(publicHost)}:${port}/`;

export const serverPublicHost = publicHost;
export const serverPublicUrl = publicUrl;
export let serverPort = configuredPort;
export let serverUrl = baseUrlForPort(configuredPort);

export type ServerReadyPayload = {
	type: "trickroom:server-ready";
	version: 1;
	/** Bind address. */
	host: string;
	/** Host used in `url`; differs from `host` for wildcard binds or when configured. */
	publicHost: string;
	/** Configured public base URL, or null when `url` is built from `publicHost`. */
	publicUrl: string | null;
	port: number;
	url: string;
	token: string | null;
	authenticated: boolean;
};

// Lets local processes such as the MCP server find this server. Losing the
// record only disables agent-to-browser features, so failures just warn.
const publishDiscoveryRecord = (address: string, port: number) => {
	try {
		const publisher = createServerDiscoveryPublisher({
			url: resolveLoopbackServerUrl(address, port),
			token: sessionToken || null,
			project: app.trickroomRuntime.getActiveProject(),
		});
		app.trickroomRuntime.subscribeActiveProject((project) =>
			publisher.setProject(project),
		);
	} catch (error) {
		console.warn(
			`Could not write the Trickroom server discovery record: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export const serverReady = new Promise<ServerReadyPayload>((resolve) => {
	serve(
		{ fetch: app.fetch, port: configuredPort, hostname: configuredHost },
		(address) => {
			const port =
				typeof address === "object" && address ? address.port : configuredPort;
			serverPort = port;
			const cleanUrl = baseUrlForPort(port);
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
				publicUrl,
				url: serverUrl,
				token: sessionToken ?? null,
				authenticated: Boolean(sessionToken),
			};
			publishDiscoveryRecord(
				typeof address === "object" && address
					? address.address
					: configuredHost,
				port,
			);
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
