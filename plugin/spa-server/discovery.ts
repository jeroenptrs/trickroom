import type { ViteDevServer } from "vite";
import {
	createServerDiscoveryPublisher,
	resolveLoopbackServerUrl,
	type ServerDiscoveryPublisher,
} from "../../src/app-state/runtime-servers";

type ActiveProjectRuntime = {
	getActiveProject: () => {
		projectId: string;
		projectRoot: string;
	} | null;
	subscribeActiveProject: (
		listener: (
			project: { projectId: string; projectRoot: string } | null,
		) => void,
	) => () => void;
};

const getRuntime = (app: unknown): ActiveProjectRuntime | null => {
	if (typeof app !== "object" || app === null || !("trickroomRuntime" in app)) {
		return null;
	}
	const runtime = app.trickroomRuntime;
	return typeof runtime === "object" &&
		runtime !== null &&
		"getActiveProject" in runtime &&
		"subscribeActiveProject" in runtime
		? (runtime as ActiveProjectRuntime)
		: null;
};

/**
 * Publishes the dev server's discovery record once Vite listens and keeps it
 * on the active project of the current server module. Vite re-evaluates the
 * server module after edits, so `attach` re-subscribes when the app changes.
 */
export const createDevServerDiscovery = (
	server: ViteDevServer,
	loadApp: () => Promise<unknown>,
) => {
	const httpServer = server.httpServer;
	let publisher: ServerDiscoveryPublisher | null = null;
	let attachedApp: unknown = null;
	let unsubscribe: (() => void) | null = null;

	const attach = (app: unknown) => {
		if (!publisher || app === attachedApp) {
			return;
		}
		const runtime = getRuntime(app);
		if (!runtime) {
			return;
		}
		unsubscribe?.();
		attachedApp = app;
		const current = publisher;
		current.setProject(runtime.getActiveProject());
		unsubscribe = runtime.subscribeActiveProject((project) =>
			current.setProject(project),
		);
	};

	httpServer?.once("listening", () => {
		const address = httpServer.address();
		if (!address || typeof address === "string") {
			return;
		}
		try {
			publisher = createServerDiscoveryPublisher({
				url: resolveLoopbackServerUrl(address.address, address.port),
				token: process.env.TRICKROOM_SESSION_TOKEN?.trim() || null,
			});
		} catch (error) {
			server.config.logger.warn(
				`Could not write the Trickroom server discovery record: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		loadApp().then(attach, () => undefined);
	});

	httpServer?.once("close", () => {
		unsubscribe?.();
		unsubscribe = null;
		publisher?.dispose();
		publisher = null;
	});

	return { attach };
};
