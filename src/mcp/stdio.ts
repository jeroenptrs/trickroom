import { existsSync, watch } from "node:fs";
import path from "node:path";
import type { Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveTrickroomHome } from "../app-state/home";
import { getProjectRegistryPath } from "../app-state/project-registry";
import {
	inferMcpProjectContextFromCwd,
	listMcpEnabledProjectContexts,
	type TrickroomMcpProjectContext,
} from "./project-resolver";
import { createTrickroomMcpServer, type TrickroomMcpServer } from "./server";

export type StartTrickroomMcpStdioServerOptions = {
	stderr?: Writable;
};

const WATCH_DEBOUNCE_MS = 200;

type DebouncedTask = {
	trigger: () => void;
	cleanup: () => void;
};

const createDebouncedTask = (
	task: () => Promise<void> | void,
	delayMs = WATCH_DEBOUNCE_MS,
): DebouncedTask => {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	let enabled = true;

	return {
		trigger: () => {
			if (!enabled) {
				return;
			}

			if (timeout) {
				clearTimeout(timeout);
			}

			timeout = setTimeout(() => {
				timeout = null;
				void Promise.resolve(task()).catch(() => {});
			}, delayMs);
		},
		cleanup: () => {
			enabled = false;
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
		},
	};
};

type Stop = () => void;
type WatchFactory = (
	watchPath: string,
	onChange: (filename: string | null) => void,
) => Stop | null;

const createWatchStop: WatchFactory = (
	watchPath: string,
	onChange: (filename: string | null) => void,
) => {
	try {
		const watcher = watch(watchPath, (eventType, filename) => {
			void eventType;
			onChange(filename ?? null);
		});
		watcher.on("error", () => {
			watcher.close();
		});
		return () => watcher.close();
	} catch {
		return null;
	}
};

export const createResourceListWatchers = async (
	server: TrickroomMcpServer,
	trickroomHome: string,
	options: {
		createWatchStop?: WatchFactory;
	} = {},
): Promise<Stop> => {
	const watchFactory = options.createWatchStop ?? createWatchStop;
	const notifyResourceListChanged = createDebouncedTask(async () => {
		try {
			await server.sendResourceListChanged();
		} catch {
			// Ignore notification delivery failures.
		}
	});

	const watcherStops = new Set<Stop>();
	const designWatcherStops = new Map<
		string,
		{
			watchPath: string;
			designsDirectory: string;
			stop: Stop;
		}
	>();
	let registryWatchStop: Stop | null = null;

	const registerStop = (stop: Stop) => {
		watcherStops.add(stop);
		return stop;
	};

	const unregisterStop = (stop: Stop | null) => {
		if (!stop) {
			return;
		}

		watcherStops.delete(stop);
		stop();
	};

	const refreshDesignWatch = async () => {
		let contexts: TrickroomMcpProjectContext[] = [];
		try {
			contexts = await listMcpEnabledProjectContexts({
				trickroomHome,
				includeContext: server.getActiveContextSnapshot(),
			});
		} catch {
			return;
		}

		const nextWatchTargets = new Map<
			string,
			{
				watchPath: string;
				designsDirectory: string;
			}
		>();
		for (const context of contexts) {
			try {
				const designsDirectory = path.join(
					context.projectRoot,
					".trickroom",
					"designs",
				);
				const designParentWatchPath = existsSync(path.dirname(designsDirectory))
					? path.dirname(designsDirectory)
					: context.projectRoot;
				const watchPath = existsSync(designsDirectory)
					? designsDirectory
					: designParentWatchPath;
				nextWatchTargets.set(context.locationId, {
					watchPath,
					designsDirectory,
				});
			} catch {}
		}

		for (const [locationId, currentWatch] of designWatcherStops) {
			if (!nextWatchTargets.has(locationId)) {
				unregisterStop(currentWatch.stop);
				designWatcherStops.delete(locationId);
			}
		}

		for (const [locationId, nextWatch] of nextWatchTargets) {
			const currentWatch = designWatcherStops.get(locationId);
			if (currentWatch?.watchPath === nextWatch.watchPath) {
				continue;
			}

			const shouldNotifyFirstDesignAvailability =
				currentWatch != null &&
				nextWatch.watchPath === nextWatch.designsDirectory &&
				currentWatch.watchPath !== nextWatch.designsDirectory;

			if (currentWatch) {
				unregisterStop(currentWatch.stop);
				designWatcherStops.delete(locationId);
			}

			const onChange = (filename: string | null) => {
				if (nextWatch.watchPath === nextWatch.designsDirectory) {
					requestDesignResourceRefresh();
					return;
				}

				const expectedName =
					nextWatch.watchPath === path.dirname(nextWatch.designsDirectory)
						? "designs"
						: ".trickroom";
				if (!filename || filename === expectedName) {
					void refreshDesignWatch();
				}
			};

			const stop = watchFactory(nextWatch.watchPath, onChange);
			if (stop) {
				const registered = registerStop(stop);
				designWatcherStops.set(locationId, {
					...nextWatch,
					stop: registered,
				});
				if (shouldNotifyFirstDesignAvailability) {
					requestDesignResourceRefresh();
				}
			}
		}
	};

	const requestRegistryRefresh = async () => {
		notifyResourceListChanged.trigger();
		void refreshDesignWatch();
	};

	const requestDesignResourceRefresh = () => {
		notifyResourceListChanged.trigger();
	};

	const registryPath = getProjectRegistryPath(trickroomHome);
	const registryFile = path.basename(registryPath);
	const registryDir = path.dirname(registryPath);

	const registryWatcher =
		watchFactory(registryPath, () => {
			void requestRegistryRefresh();
		}) ??
		(existsSync(registryDir)
			? watchFactory(registryDir, (filename) => {
					if (filename === registryFile) {
						void requestRegistryRefresh();
					}
				})
			: null);
	if (registryWatcher) {
		registryWatchStop = registerStop(registryWatcher);
	}

	await refreshDesignWatch();

	return () => {
		notifyResourceListChanged.cleanup();
		unregisterStop(registryWatchStop);
		for (const { stop } of designWatcherStops.values()) {
			unregisterStop(stop);
		}
		designWatcherStops.clear();
		for (const stop of watcherStops) {
			stop();
		}
		watcherStops.clear();
	};
};

export const createTrickroomMcpStdioTransport = () =>
	new StdioServerTransport(process.stdin, process.stdout);

export const startTrickroomMcpStdioServer = async () => {
	const trickroomHome = resolveTrickroomHome();
	const context = await inferMcpProjectContextFromCwd({ trickroomHome });
	const server = createTrickroomMcpServer(context, { trickroomHome });
	const transport = createTrickroomMcpStdioTransport();

	await server.connect(transport);
	if (trickroomHome) {
		const cleanupWatchers = await createResourceListWatchers(
			server,
			trickroomHome,
		);
		let watchersCleanedUp = false;
		const cleanupWatchersOnce = () => {
			if (watchersCleanedUp) {
				return;
			}

			watchersCleanedUp = true;
			server.stopMcpToolGroupControls?.();
			void server.stopScreenshotHosts?.();
			cleanupWatchers();
			process.off("exit", cleanupWatchersOnce);
		};
		const previousOnClose = transport.onclose;
		transport.onclose = () => {
			try {
				previousOnClose?.();
			} finally {
				cleanupWatchersOnce();
			}
		};
		process.once("exit", cleanupWatchersOnce);
	}

	return {
		context,
		server,
		transport,
	};
};

export const runTrickroomMcpStdioServer = async (
	options: StartTrickroomMcpStdioServerOptions = {},
) => {
	void options;
	await startTrickroomMcpStdioServer();

	return 0;
};

export const main = async () => {
	try {
		process.exitCode = await runTrickroomMcpStdioServer();
	} catch (error) {
		const message =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
};
