import type { ServerScriptOptions, ServerTypeFunc } from "../types";
import { createRequestFromIncoming, StringBuilder, sendStream } from "./util";

const createStatic = ({ clientDir, areas }: ServerScriptOptions) => {
	const init = new StringBuilder();
	init.append(`import { etag } from "hono/etag";`);
	init.append(`import fs from "node:fs";`);
	init.append(`import path from "node:path";`);
	init.append(
		`const clientPath = new URL("./${clientDir}", import.meta.url).pathname;`,
	);
	init.append(
		`const isApiPath = (requestPath) => requestPath === "/api" || requestPath.startsWith("/api/");`,
	);
	init.append(
		areas
			.map(({ path, index, isMain, dir, wildcard }, i) => {
				const str = new StringBuilder();
				if (isMain && path !== "/") {
					str.append(`app.get("/", (c) => c.redirect("${path}"));`);
				}
				const wild = wildcard ? "*" : "";
				const routePath = path + (path === "/" ? "" : "/") + wild;
				str.append(`const setServeStatic${i} = (serveStatic) => {
  app.use(
    "${path === "/" ? "" : path}/*",
    (c, next) => {
      if (isApiPath(c.req.path)) {
        c.header("spa-server", "false");
        return c.notFound();
      }
      return next();
    },
    etag(),
    serveStatic({
      root: clientPath + "${dir}",
      index: "${index}",
      rewriteRequestPath: (path) => path.replace("${path}", "/")
    })
  );
  app.get("${routePath}", etag(), (c) => {
    if (isApiPath(c.req.path)) {
      c.header("spa-server", "false");
      return c.notFound();
    }
    const pathfile = path.join(clientPath, ".${dir}/${index}");
    const html = fs.readFileSync(pathfile, { encoding: "utf-8" });
    return c.html(html);
  });
}`);
				str.append(`setServeStatic${i}(serveStatic);`);
				return str.toString();
			})
			.join(""),
	);
	return init.toString();
};

const withRuntime = ({
	port,
	clientDir,
	areas,
	startServer,
}: ServerScriptOptions) => {
	return {
		node: () => {
			const sb = new StringBuilder();
			sb.append(`import app from "./app.js";`);
			if (startServer) {
				sb.append(`import { serve } from "@hono/node-server";`);
			}
			sb.append(
				`import { serveStatic } from "@hono/node-server/serve-static";`,
			);
			sb.append(createStatic({ clientDir, areas }));
			if (startServer) {
				sb.append(`export const serverPort = ${port};`);
				sb.append(`serve({ fetch: app.fetch, port: serverPort });`);
				sb.append(
					`console.log("Running locally http://localhost:" + serverPort + "/");`,
				);
			} else {
				sb.append(`export default app;`);
			}
			return sb.toString();
		},
	};
};

/**
 * Hono web framework implementation for SPA server.
 * Provides static file serving and routing capabilities with support for multiple runtimes.
 *
 * Features:
 * - Static file serving with ETag support
 * - SPA routing with HTML5 history
 * - Area-based routing configuration
 * - Automatic server initialization
 * - Main path redirection
 *
 * @example
 * ```ts
 * import { spaServer, honoServer } from 'vite-spa-server'
 *
 * export default {
 *   plugins: [
 *     spaServer({
 *       serverType: honoServer,
 *       runtime: 'node',
 *       port: 3000
 *     })
 *   ]
 * }
 * ```
 */
export const honoServer: ServerTypeFunc = {
	name: "hono",
	script(opts) {
		return withRuntime(opts).node?.() ?? "";
	},
	async handle(app: any, req, res, next) {
		const resWeb = (await app.fetch(
			await createRequestFromIncoming(req),
		)) as Response;
		if (resWeb.status === 404) {
			const SPAServer = resWeb.headers.get("spa-server");
			if (!(SPAServer && SPAServer === "false")) {
				return next();
			}
		}
		await sendStream(resWeb, res);
	},
};
