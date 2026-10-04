import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { resolveTrickroomHome } from "./app-state/home";
import {
	clearActiveProjectLocation,
	deleteProjectLocation,
	getActiveProjectLocation,
	type ProjectLocationRef,
	readProjectRegistry,
	updateProjectLocationName,
} from "./app-state/project-registry";
import {
	parseMcpToolGroupSettingsPatch,
	readTrickroomSettings,
	updateMcpToolGroupSettings,
} from "./app-state/settings";
import { parseDesignResourceUri } from "./mcp/resources";
import { MCP_TOOL_GROUPS } from "./mcp/tool-groups";
import {
	getTrickroomProjectPaths,
	normalizeTrickroomConfig,
	openProject,
	readOrCreateProjectConfig,
	readProjectConfig,
	resolveProjectRoot,
	TrickroomProjectConfigError,
	type TrickroomProjectContext,
	writeProjectConfig,
} from "./project";
import {
	recipeLoadRepairHeaderName,
	repairInvalidKnownRecipeInstances,
} from "./recipes/repair";
import { createEditorChannelRoutes } from "./routes/editor-channel";
import { exportRoutes } from "./routes/export";
import { registerProjectAndDesignMemoryRoutes } from "./routes/memory";
import {
	createScreenshotRoutes,
	type ScreenshotCapture,
} from "./routes/screenshot";
import { systemsRoutes } from "./routes/systems";
import { tailwindRoutes } from "./routes/tailwind";
import {
	isSecureRequest,
	trickroomSessionCookieName,
	trickroomSessionHeaderName,
} from "./server-auth";
import { readJsonFile } from "./server-file-utils";
import {
	asErrnoException,
	isTrickroomConfig,
	isTrickroomDesign,
	jsonError,
} from "./server-utils";
import { DESIGN_FILE_VERSION } from "./services/design-file-schema";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "./services/design-file-service";
import type { DesignFileRevision } from "./services/design-file-service.types";
import {
	applyExtractSubtree,
	DesignTransformError,
} from "./services/design-transform-service";
import {
	createEditorSessions,
	isEditorClientId,
} from "./services/editor-sessions";
import { ProjectFileEvents } from "./services/project-file-events";
import type {
	Node as DesignNode,
	TrickroomConfig,
	TrickroomDesign,
	TrickroomDesignSummary,
} from "./types";
import { normalizeAssetId, readAsset } from "./utils/asset-manifest-service";
import {
	componentAllowsBlankResourceId,
	getResourceIdProp,
	getResourceKindForComponent,
} from "./utils/design-resource-references";
import {
	DesignSystemStorageError,
	findDesignSystem,
} from "./utils/design-system-store";
import { normalizeIconId, readIcon } from "./utils/icon-manifest-service";
import {
	applyProjectDefaultSystemToDesign,
	setConfigDefaultSystemId,
} from "./utils/project-default-system";
import { scanDesignFileSystemComponentUsage } from "./utils/system-component-usage-scan";

export type TrickroomActiveProject = TrickroomProjectContext & {
	locationId: string;
};

export type TrickroomSessionProject = {
	projectId: string;
	locationId: string;
	projectRoot: string;
	name: string;
};

/**
 * Server-process hooks for code that hosts the app (the production entry and
 * the dev plugin), such as keeping the discovery record on the active project.
 */
export type TrickroomAppRuntime = {
	getActiveProject: () => TrickroomSessionProject | null;
	subscribeActiveProject: (
		listener: (project: TrickroomSessionProject | null) => void,
	) => () => void;
};

export type TrickroomAppOptions = {
	trickroomHome?: string;
	initialProjectRoot?: string | null;
	registerInitialProject?: boolean;
	sessionToken?: string | null;
	screenshotCapture?: ScreenshotCapture;
};

const toSessionProject = (
	project: TrickroomActiveProject | ProjectLocationRef,
): TrickroomSessionProject => ({
	projectId:
		"config" in project ? (project.config.projectId ?? "") : project.projectId,
	locationId: project.locationId,
	projectRoot: "projectRoot" in project ? project.projectRoot : project.root,
	name: "config" in project ? project.config.name : project.name,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readRequiredString = (
	value: Record<string, unknown>,
	key: string,
): string => {
	const field = value[key];
	if (typeof field !== "string" || field.trim().length === 0) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Parameter "${key}" must be a non-empty string.`,
		);
	}

	return field;
};

const readOptionalString = (
	value: Record<string, unknown>,
	key: string,
): string | undefined => {
	const field = value[key];
	if (field === undefined) {
		return undefined;
	}
	if (typeof field !== "string") {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Parameter "${key}" must be a string when provided.`,
		);
	}

	return field;
};

const getDesignSystemHandle = (
	design: Pick<TrickroomDesign, "systemId" | "systemName">,
) => {
	if (design.systemId !== undefined) {
		return design.systemId;
	}

	return design.systemName ?? null;
};

const resolveDesignSystemForRoute = async (
	project: Pick<TrickroomActiveProject, "projectRoot">,
	systemHandle: string | null,
) => {
	if (systemHandle === null) {
		return null;
	}

	return findDesignSystem(project.projectRoot, systemHandle);
};

const decorateDesignSystemReference = async (
	project: Pick<TrickroomActiveProject, "projectRoot">,
	design: TrickroomDesign,
): Promise<TrickroomDesign> => {
	const systemHandle = getDesignSystemHandle(design);
	const system = await resolveDesignSystemForRoute(project, systemHandle);
	if (!system) {
		return design;
	}

	const { systemId, systemName } = system.manifest;
	return {
		...design,
		systemId,
		systemName,
	};
};

const canonicalizeDesignSystemReferenceForStorage = async (
	project: Pick<TrickroomActiveProject, "projectRoot">,
	design: TrickroomDesign,
): Promise<TrickroomDesign> => {
	const systemHandle = getDesignSystemHandle(design);
	const { systemName: _systemName, ...withoutSystemName } = design;
	void _systemName;
	if (systemHandle === null) {
		if (design.systemId !== undefined || design.systemName !== undefined) {
			return { ...withoutSystemName, systemId: null };
		}
		return withoutSystemName;
	}

	const system = await resolveDesignSystemForRoute(project, systemHandle);
	if (!system) {
		return design;
	}

	return {
		...withoutSystemName,
		systemId: system.manifest.systemId,
	};
};

const walkDesignNodes = async (
	node: DesignNode,
	visit: (node: DesignNode) => void | Promise<void>,
) => {
	await visit(node);
	if (typeof node.children === "string") return undefined;
	for (const child of node.children) {
		await walkDesignNodes(child, visit);
	}
	return undefined;
};

const normalizeRouteResourceId = (
	kind: "asset" | "icon",
	resourceId: string,
) => {
	let normalizedResourceId: string;
	try {
		normalizedResourceId =
			kind === "asset"
				? normalizeAssetId(resourceId)
				: normalizeIconId(resourceId);
	} catch {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" is not valid.`,
		);
	}

	if (normalizedResourceId !== resourceId) {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" must be written as canonical id "${normalizedResourceId}".`,
		);
	}

	return normalizedResourceId;
};

const assertExtractedDesignReferencesExist = async (
	project: TrickroomActiveProject,
	design: TrickroomDesign,
) => {
	const systemHandle = getDesignSystemHandle(design);
	const system = await resolveDesignSystemForRoute(project, systemHandle);
	if (systemHandle !== null) {
		if (!system) {
			throw new DesignTransformError(
				"UNKNOWN_DESIGN_SYSTEM",
				`Design system "${systemHandle}" is not configured for this project.`,
			);
		}
	}
	const systemId = system?.manifest.systemId ?? null;
	const systemName = system?.manifest.systemName ?? systemHandle;

	for (const board of design.boards) {
		await walkDesignNodes(board, async (node) => {
			const library = node.props["data-trickroom-library"];
			const component = node.props["data-trickroom-component"];
			const kind = getResourceKindForComponent(library, component);
			if (!kind) return;

			const idProp = getResourceIdProp(kind);
			const resourceId = node.props[idProp];
			const allowsBlank = componentAllowsBlankResourceId(
				library,
				component,
				kind,
			);
			if (
				allowsBlank &&
				(typeof resourceId !== "string" || resourceId.trim().length === 0)
			) {
				return;
			}

			if (!systemId) {
				throw new DesignTransformError(
					"DESIGN_SYSTEM_REQUIRED",
					`${kind === "asset" ? "Asset" : "Icon"} elements require the design to be linked to a system.`,
				);
			}

			if (typeof resourceId !== "string" || resourceId.trim().length === 0) {
				throw new DesignTransformError(
					kind === "asset" ? "MISSING_ASSET_ID" : "MISSING_ICON_ID",
					`${kind === "asset" ? "Asset" : "Icon"} elements require ${idProp}.`,
				);
			}

			const normalizedResourceId = normalizeRouteResourceId(
				kind,
				resourceId.trim(),
			);
			if (kind === "asset") {
				const asset = await readAsset(
					project.projectRoot,
					systemId,
					normalizedResourceId,
				);
				if (!asset) {
					throw new DesignTransformError(
						"UNKNOWN_ASSET_ID",
						`Asset id "${resourceId}" does not exist in system "${systemName}".`,
					);
				}
				return;
			}

			const icon = await readIcon(
				project.projectRoot,
				systemId,
				normalizedResourceId,
			);
			if (!icon) {
				throw new DesignTransformError(
					"UNKNOWN_ICON_ID",
					`Icon id "${resourceId}" does not exist in system "${systemName}".`,
				);
			}
		});
	}
};

const getRequestProject = async (
	activeProject: TrickroomActiveProject | null,
): Promise<TrickroomActiveProject | null> => {
	if (!activeProject) {
		return null;
	}

	const config = await readProjectConfig(activeProject.projectRoot);
	return {
		...getTrickroomProjectPaths(activeProject.projectRoot),
		locationId: activeProject.locationId,
		config,
	};
};

const createNoProjectResponse = () =>
	jsonError("No Trickroom project is selected.", 409);

const designRevisionHeaderName = "x-trickroom-revision";
const designBoardRevisionHeaderName = "x-trickroom-board-revision";
/** Set on design reads whose stored version was migrated in memory. */
const designMigrationHeaderName = "x-trickroom-design-migration";
const expectedDesignRevisionHeaderName = "x-trickroom-expected-revision";
/**
 * Set on design writes whose stored result kept changes the request did not
 * have (another writer's boards), so the response design differs from it.
 */
const designMergedHeaderName = "x-trickroom-design-merged";

const setDesignRevisionHeader = (c: Context, revision: DesignFileRevision) =>
	c.header(designRevisionHeaderName, revision);

const isInvalidDesignIdError = (error: unknown) =>
	error instanceof DesignFileServiceError &&
	error.code === "INVALID_DESIGN_UUID";

const invalidDesignIdResponse = () =>
	jsonError("Design id must be a single path segment", 400);

const designNotFoundResponse = (designId: string) =>
	jsonError(`Design "${designId}" not found`, 404);

const parseMcpSettingsPayload = (body: unknown) => {
	if (!body || typeof body !== "object") {
		return null;
	}

	const { enabled, mode } = body as { enabled?: unknown; mode?: unknown };
	if (enabled === false) {
		return { enabled: false } satisfies NonNullable<TrickroomConfig["mcp"]>;
	}

	if (enabled === true && (mode === "read-only" || mode === "read-write")) {
		return { enabled: true, mode } satisfies NonNullable<
			TrickroomConfig["mcp"]
		>;
	}

	return null;
};

const parseDefaultSystemPayload = (
	body: unknown,
): { systemId: string | null } | null => {
	if (!body || typeof body !== "object") {
		return null;
	}

	const { systemId } = body as { systemId?: unknown };
	if (systemId === null) {
		return { systemId: null };
	}

	if (typeof systemId === "string" && systemId.trim().length > 0) {
		return { systemId: systemId.trim() };
	}

	return null;
};

const createProjectErrorResponse = (error: unknown) => {
	if (error instanceof TrickroomProjectConfigError) {
		if (error.code === "INVALID_PROJECT_ROOT") {
			return jsonError(error.message, 400);
		}

		if (error.code === "CONFIG_NOT_FOUND") {
			return jsonError(error.message, 404);
		}

		if (error.code === "INVALID_CONFIG") {
			return jsonError(error.message, 400);
		}
	}
	if (
		error instanceof DesignSystemStorageError &&
		error.code === "DUPLICATE_SYSTEM_KEY"
	) {
		return jsonError(error.message, 409);
	}

	return jsonError("Failed to open Trickroom project", 500);
};

type AuditLogSummary = {
	count: number;
	mostRecentAt: string | null;
};

const maxAuditLogSummaryCacheEntries = 128;

const getLruCacheEntry = <Key, Value>(
	cache: Map<Key, Value>,
	key: Key,
): Value | null => {
	const cached = cache.get(key);
	if (cached === undefined) {
		return null;
	}

	cache.delete(key);
	cache.set(key, cached);
	return cached;
};

const setLruCacheEntry = <Key, Value>(
	cache: Map<Key, Value>,
	key: Key,
	value: Value,
	maxEntries: number,
) => {
	cache.delete(key);
	cache.set(key, value);

	while (cache.size > maxEntries) {
		const oldest = cache.keys().next();
		if (oldest.done) {
			break;
		}
		cache.delete(oldest.value);
	}
};

const auditLogSummaryCache = new Map<
	string,
	{ mtimeMs: number; size: number; summary: AuditLogSummary }
>();

const summarizeAuditLog = async (auditLogPath: string) => {
	const fileStat = await stat(auditLogPath);
	const cached = getLruCacheEntry(auditLogSummaryCache, auditLogPath);
	if (
		cached &&
		cached.mtimeMs === fileStat.mtimeMs &&
		cached.size === fileStat.size
	) {
		return cached.summary;
	}

	const auditLog = createInterface({
		input: createReadStream(auditLogPath, { encoding: "utf8" }),
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	let count = 0;
	let mostRecentAt: string | null = null;
	let mostRecentTime = Number.NEGATIVE_INFINITY;

	for await (const line of auditLog) {
		if (line.trim().length === 0) {
			continue;
		}

		count += 1;
		try {
			const entry = JSON.parse(line) as { timestamp?: unknown };
			const timestamp =
				typeof entry.timestamp === "string" ? entry.timestamp : null;
			const timestampTime = timestamp ? Date.parse(timestamp) : Number.NaN;
			if (!Number.isNaN(timestampTime) && timestampTime > mostRecentTime) {
				mostRecentTime = timestampTime;
				mostRecentAt = timestamp;
			}
		} catch {
			// Invalid historical lines still count as audit entries.
		}
	}

	const summary = { count, mostRecentAt };
	setLruCacheEntry(
		auditLogSummaryCache,
		auditLogPath,
		{
			mtimeMs: fileStat.mtimeMs,
			size: fileStat.size,
			summary,
		},
		maxAuditLogSummaryCacheEntries,
	);
	return summary;
};

/** Request variables the project middleware sets for the routes below it. */
type TrickroomAppEnv = {
	Variables: {
		projectRoot: string;
		configPath: string;
		config: TrickroomConfig;
	};
};

export const createTrickroomApp = (options: TrickroomAppOptions = {}) => {
	const app = new Hono<TrickroomAppEnv>();
	const trickroomHome = options.trickroomHome ?? resolveTrickroomHome();
	const registerInitialProject = options.registerInitialProject ?? true;
	const sessionToken =
		options.sessionToken === undefined
			? process.env.TRICKROOM_SESSION_TOKEN?.trim()
			: (options.sessionToken?.trim() ?? undefined);
	let activeProject: TrickroomActiveProject | null = null;
	let initialProjectPromise: Promise<void> | null = null;
	const projectFileEvents = new ProjectFileEvents(undefined, { trickroomHome });
	const editorSessions = createEditorSessions();
	const activeProjectListeners = new Set<
		(project: TrickroomSessionProject | null) => void
	>();
	const setActiveProject = (project: TrickroomActiveProject | null) => {
		activeProject = project;
		projectFileEvents.setProjectRoot(project?.projectRoot ?? null);
		const sessionProject = project ? toSessionProject(project) : null;
		for (const listener of activeProjectListeners) {
			listener(sessionProject);
		}
	};
	const runtime: TrickroomAppRuntime = {
		getActiveProject: () =>
			activeProject ? toSessionProject(activeProject) : null,
		subscribeActiveProject: (listener) => {
			activeProjectListeners.add(listener);
			return () => {
				activeProjectListeners.delete(listener);
			};
		},
	};

	app.onError((error, c) => {
		console.error(`${c.req.method} ${c.req.path}`, error);
		return jsonError("Internal server error", 500);
	});

	app.use("*", async (c, next) => {
		if (!sessionToken) {
			await next();
			return;
		}

		const bootstrapToken = c.req.query("token");
		if (
			(c.req.method === "GET" || c.req.method === "HEAD") &&
			bootstrapToken === sessionToken
		) {
			const cleanUrl = new URL(c.req.url);
			cleanUrl.searchParams.delete("token");
			setCookie(c, trickroomSessionCookieName, sessionToken, {
				httpOnly: true,
				path: "/",
				sameSite: "Strict",
				secure: isSecureRequest(cleanUrl, c.req.header("x-forwarded-proto")),
			});
			return c.redirect(`${cleanUrl.pathname}${cleanUrl.search}`);
		}

		const requestToken =
			getCookie(c, trickroomSessionCookieName) ??
			c.req.header(trickroomSessionHeaderName);
		if (requestToken !== sessionToken) {
			return jsonError("Forbidden", 403);
		}

		await next();
	});

	if (options.initialProjectRoot) {
		const openInitialProject = registerInitialProject
			? openProject({
					projectRoot: options.initialProjectRoot,
					trickroomHome,
				})
			: readOrCreateProjectConfig(options.initialProjectRoot);
		initialProjectPromise = openInitialProject.then((project) => {
			const openedProject: TrickroomActiveProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId:
					"locationId" in project && typeof project.locationId === "string"
						? project.locationId
						: "loc_test",
			};
			setActiveProject(openedProject);
		});
	}

	const resolveProjectForRequest = async () => {
		if (initialProjectPromise) {
			await initialProjectPromise;
			initialProjectPromise = null;
		}

		return getRequestProject(activeProject);
	};

	app.get("/api/trickroom/health", async (c) => {
		if (initialProjectPromise) {
			await initialProjectPromise;
			initialProjectPromise = null;
		}

		return c.json({
			ok: true,
			mode: sessionToken ? "shared" : "local",
			activeProject: activeProject ? toSessionProject(activeProject) : null,
		});
	});

	app.get("/api/trickroom/session", async (c) => {
		if (initialProjectPromise) {
			await initialProjectPromise;
			initialProjectPromise = null;
		}

		const registry = await readProjectRegistry(trickroomHome);
		const registryActiveLocation = getActiveProjectLocation(registry);
		return c.json({
			activeProject: activeProject ? toSessionProject(activeProject) : null,
			registryActiveProject: registryActiveLocation
				? toSessionProject(registryActiveLocation)
				: null,
			recentProjects: registry.locations.map(toSessionProject),
		});
	});

	app.get("/api/trickroom/events", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}
		projectFileEvents.setProjectRoot(project.projectRoot);
		const clientId = c.req.query("clientId");

		return streamSSE(c, async (stream) => {
			let resolveClosed: (() => void) | null = null;
			const closed = new Promise<void>((resolve) => {
				resolveClosed = resolve;
			});
			let sendQueue = Promise.resolve();
			const enqueue = (event: string, data: string) => {
				sendQueue = sendQueue
					.then(() => stream.writeSSE({ event, data }))
					.catch(() => resolveClosed?.());
			};
			const unsubscribe = projectFileEvents.subscribe((event) => {
				enqueue("change", JSON.stringify(event));
			});
			// Tabs identify themselves so the editor channel knows which are
			// connected; the stream is the tab's presence.
			const disconnectEditor = isEditorClientId(clientId)
				? editorSessions.connect(clientId, enqueue)
				: undefined;
			const heartbeat = setInterval(() => enqueue("heartbeat", "{}"), 15_000);
			stream.onAbort(() => resolveClosed?.());
			enqueue("ready", JSON.stringify({ locationId: project.locationId }));

			await closed;
			clearInterval(heartbeat);
			unsubscribe();
			disconnectEditor?.();
		});
	});

	app.route(
		"/api/trickroom",
		createEditorChannelRoutes({
			sessions: editorSessions,
			getActiveProjectId: async () => {
				if (initialProjectPromise) {
					await initialProjectPromise;
					initialProjectPromise = null;
				}
				return activeProject?.config.projectId ?? null;
			},
		}),
	);

	app.post("/api/trickroom/projects/open", async (c) => {
		const body = await c.req.json().catch(() => null);
		const projectPath =
			body &&
			typeof body === "object" &&
			"path" in body &&
			typeof body.path === "string"
				? body.path.trim()
				: "";
		const config =
			body &&
			typeof body === "object" &&
			"config" in body &&
			isTrickroomConfig(body.config)
				? body.config
				: undefined;

		if (!projectPath) {
			return jsonError("Missing required project path.", 400);
		}

		try {
			const project = await openProject({
				projectRoot: projectPath,
				trickroomHome,
				config,
			});
			const openedProject: TrickroomActiveProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId: project.locationId,
			};
			setActiveProject(openedProject);

			return c.json({
				project: toSessionProject(openedProject),
				configPath: openedProject.configPath,
				source: project.source,
			});
		} catch (error) {
			return createProjectErrorResponse(error);
		}
	});

	app.post("/api/trickroom/deeplink/open", async (c) => {
		const body = await c.req.json().catch(() => null);
		const uri =
			body &&
			typeof body === "object" &&
			"uri" in body &&
			typeof body.uri === "string"
				? body.uri.trim()
				: "";

		if (!uri) {
			return jsonError("Missing required deeplink URI.", 400);
		}

		let parsedUri: ReturnType<typeof parseDesignResourceUri>;
		try {
			parsedUri = parseDesignResourceUri(uri);
		} catch (error) {
			return jsonError(
				error instanceof Error ? error.message : "Invalid deeplink URI.",
				400,
			);
		}

		const registry = await readProjectRegistry(trickroomHome);
		const location = registry.locations.find(
			(entry) => entry.locationId === parsedUri.locationId,
		);
		if (!location) {
			return jsonError(
				`Unknown project location "${parsedUri.locationId}".`,
				404,
			);
		}

		try {
			const project = await openProject({
				projectRoot: location.root,
				trickroomHome,
			});
			const openedProject: TrickroomActiveProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId: project.locationId,
			};
			setActiveProject(openedProject);

			const designFileService = createDesignFileService(project.projectRoot, {
				trickroomHome,
			});
			const designSummaries = await designFileService.listDesignSummaries();
			const designSummary = designSummaries.find(
				(summary) =>
					summary.uuid.toLowerCase() === parsedUri.designId.toLowerCase(),
			);
			if (!designSummary) {
				return jsonError(`Design file "${parsedUri.designId}" not found.`, 404);
			}

			return c.json({
				project: toSessionProject(openedProject),
				designId: designSummary.uuid,
				designFile: designSummary.file,
			});
		} catch (error) {
			return createProjectErrorResponse(error);
		}
	});

	app.post("/api/trickroom/projects/close", async (c) => {
		setActiveProject(null);
		await clearActiveProjectLocation(trickroomHome);
		return c.json({ activeProject: null });
	});

	app.post("/api/trickroom/projects/:locationId/delete", async (c) => {
		const locationId = c.req.param("locationId").trim();
		if (!locationId) {
			return jsonError("Missing required project location.", 400);
		}

		const deleted = await deleteProjectLocation({ trickroomHome, locationId });
		if (!deleted) {
			return jsonError("Project location not found.", 404);
		}

		if (activeProject?.locationId === locationId) {
			setActiveProject(null);
		}

		return c.json({
			project: toSessionProject(deleted.location),
			activeProject: activeProject ? toSessionProject(activeProject) : null,
			recentProjects: deleted.registry.locations.map(toSessionProject),
		});
	});

	app.post("/api/trickroom/projects/:locationId/rename", async (c) => {
		const locationId = c.req.param("locationId").trim();
		if (!locationId) {
			return jsonError("Missing required project location.", 400);
		}

		const body = await c.req.json().catch(() => null);
		const name =
			body &&
			typeof body === "object" &&
			"name" in body &&
			typeof body.name === "string"
				? body.name.trim()
				: "";
		if (!name) {
			return jsonError("Missing required project name.", 400);
		}

		const registry = await readProjectRegistry(trickroomHome);
		const location = registry.locations.find(
			(location) => location.locationId === locationId,
		);
		if (!location) {
			return jsonError("Project location not found.", 404);
		}

		try {
			const config = await readProjectConfig(location.root);
			if (config.projectId && config.projectId !== location.projectId) {
				return jsonError("Project location no longer matches config.", 409);
			}

			const writtenConfig = await writeProjectConfig(location.root, {
				...config,
				name,
				projectId: location.projectId,
			});
			const renamed = await updateProjectLocationName({
				trickroomHome,
				locationId,
				name: writtenConfig.name,
			});
			if (!renamed) {
				return jsonError("Project location not found.", 404);
			}

			if (activeProject?.locationId === locationId) {
				setActiveProject({
					...activeProject,
					config: writtenConfig,
				});
			}

			return c.json({
				project: toSessionProject(renamed.location),
				activeProject: activeProject ? toSessionProject(activeProject) : null,
				recentProjects: renamed.registry.locations.map(toSessionProject),
				config: writtenConfig,
			});
		} catch (error) {
			return createProjectErrorResponse(error);
		}
	});

	app.use("/api/trickroom/tailwind/*", async (c, next) => {
		const project = await resolveProjectForRequest().catch((error) => {
			return createProjectErrorResponse(error);
		});
		if (project instanceof Response) {
			return project;
		}
		if (!project) {
			return createNoProjectResponse();
		}

		c.set("projectRoot", project.projectRoot);
		c.set("configPath", project.configPath);
		await next();
	});
	app.route("/api/trickroom/tailwind", tailwindRoutes);

	const attachProjectToSystemsRequest: MiddlewareHandler<
		TrickroomAppEnv
	> = async (c, next) => {
		const project = await resolveProjectForRequest().catch((error) => {
			return createProjectErrorResponse(error);
		});
		if (project instanceof Response) {
			return project;
		}
		if (!project) {
			return createNoProjectResponse();
		}

		c.set("projectRoot", project.projectRoot);
		c.set("configPath", project.configPath);
		c.set("config", project.config);
		await next();
	};
	app.use("/api/trickroom/systems", attachProjectToSystemsRequest);
	app.use("/api/trickroom/systems/*", attachProjectToSystemsRequest);
	app.route("/api/trickroom/systems", systemsRoutes);

	// Project- and design-scoped memory reuse the same project middleware to
	// attach projectRoot + config before reading/writing memory manifests.
	registerProjectAndDesignMemoryRoutes(app, attachProjectToSystemsRequest);

	// Export reuses the systems middleware: it needs projectRoot + config to
	// resolve the system, read its tokens/icons/assets from disk, and compile.
	app.use("/api/trickroom/export", attachProjectToSystemsRequest);
	app.use("/api/trickroom/export/*", attachProjectToSystemsRequest);
	app.route("/api/trickroom/export", exportRoutes);

	app.use("/api/trickroom/screenshot", attachProjectToSystemsRequest);
	app.route(
		"/api/trickroom/screenshot",
		createScreenshotRoutes(options.screenshotCapture),
	);

	app.get("/api/trickroom/config", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		try {
			const config = await readJsonFile<unknown>(project.configPath);
			return c.json(config);
		} catch (error) {
			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return jsonError(`Config file not found at ${project.configPath}`, 404);
			}

			return jsonError("Failed to read trickroom config file", 500);
		}
	});

	app.post("/api/trickroom/config", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const body = await c.req.json().catch(() => null);
		if (!isTrickroomConfig(body)) {
			return jsonError("Invalid trickroom config payload", 400);
		}

		const config: TrickroomConfig = {
			...normalizeTrickroomConfig(body),
			projectId: project.config.projectId,
		};

		try {
			await readFile(project.configPath, "utf8");
			return jsonError(
				`Config file already exists at ${project.configPath}`,
				409,
			);
		} catch (error) {
			const fsError = asErrnoException(error);
			if (fsError.code !== "ENOENT") {
				return jsonError("Failed to check trickroom config file", 500);
			}
		}

		try {
			const designFileService = createDesignFileService(project.projectRoot, {
				trickroomHome,
			});
			await designFileService.initializeDesignsDirectory();
			const writtenConfig = await writeProjectConfig(
				project.projectRoot,
				config,
			);
			setActiveProject({ ...project, config: writtenConfig });
			return c.json(writtenConfig, 201);
		} catch {
			return jsonError("Failed to create trickroom project", 500);
		}
	});

	app.put("/api/trickroom/config/mcp", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const body = await c.req.json().catch(() => null);
		const mcpSettings = parseMcpSettingsPayload(body);
		if (!mcpSettings) {
			return jsonError("Invalid MCP settings payload", 400);
		}

		const nextConfig: TrickroomConfig = {
			...project.config,
			mcp: {
				...project.config.mcp,
				...mcpSettings,
				...(mcpSettings.enabled ? {} : { mode: undefined }),
			},
		};

		try {
			const writtenConfig = await writeProjectConfig(
				project.projectRoot,
				nextConfig,
			);
			setActiveProject({ ...project, config: writtenConfig });
			return c.json(writtenConfig);
		} catch {
			return jsonError("Failed to update MCP settings", 500);
		}
	});

	app.get("/api/trickroom/settings/mcp", async (c) => {
		try {
			const settings = await readTrickroomSettings(trickroomHome);
			return c.json({
				toolGroups: MCP_TOOL_GROUPS.map((group) => ({
					id: group.id,
					label: group.label,
					description: group.description,
					toolCount: group.tools.length,
					enabled: settings.mcp.toolGroups[group.id],
				})),
			});
		} catch {
			return jsonError("Failed to read MCP tool group settings", 500);
		}
	});

	app.put("/api/trickroom/settings/mcp", async (c) => {
		const body = await c.req.json().catch(() => null);
		if (!isRecord(body)) {
			return jsonError("Invalid MCP tool group settings payload", 400);
		}

		const patch = parseMcpToolGroupSettingsPatch(body.toolGroups);
		if (!patch) {
			return jsonError(
				'Invalid MCP tool group settings payload. Expected { "toolGroups": { "<groupId>": boolean } }.',
				400,
			);
		}

		try {
			const settings = await updateMcpToolGroupSettings(patch, trickroomHome);
			return c.json({
				toolGroups: MCP_TOOL_GROUPS.map((group) => ({
					id: group.id,
					label: group.label,
					description: group.description,
					toolCount: group.tools.length,
					enabled: settings.mcp.toolGroups[group.id],
				})),
			});
		} catch {
			return jsonError("Failed to update MCP tool group settings", 500);
		}
	});

	app.put("/api/trickroom/config/default-system", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const body = await c.req.json().catch(() => null);
		const defaultSystemPayload = parseDefaultSystemPayload(body);
		if (!defaultSystemPayload) {
			return jsonError(
				'Invalid default system payload. Expected { "systemId": string | null }.',
				400,
			);
		}

		if (defaultSystemPayload.systemId !== null) {
			const system = await findDesignSystem(
				project.projectRoot,
				defaultSystemPayload.systemId,
			);
			if (!system) {
				return jsonError(
					`Unknown design system "${defaultSystemPayload.systemId}".`,
					404,
				);
			}
		}

		try {
			const writtenConfig = await writeProjectConfig(
				project.projectRoot,
				setConfigDefaultSystemId(project.config, defaultSystemPayload.systemId),
			);
			setActiveProject({ ...project, config: writtenConfig });
			return c.json(writtenConfig);
		} catch {
			return jsonError("Failed to update default system", 500);
		}
	});

	app.get("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		if (!designId) {
			return jsonError("Missing required query parameter: id", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			// Reads never write: version migration, recipe repair, and system
			// reference canonicalisation happen in memory and are persisted by
			// the next real write. The revision is the one of the bytes on disk,
			// so that write's revision check still matches.
			const read = await designFileService.readDesignFile(designId);
			const repair = repairInvalidKnownRecipeInstances(read.design);
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				repair.design,
			);
			if (repair.report.repairedCount > 0) {
				c.header(recipeLoadRepairHeaderName, JSON.stringify(repair.report));
			}
			if (read.migrated) {
				c.header(
					designMigrationHeaderName,
					JSON.stringify({
						fromVersion: read.storedVersion,
						toVersion: DESIGN_FILE_VERSION,
					}),
				);
			}
			setDesignRevisionHeader(c, read.revision);
			return c.json(
				await decorateDesignSystemReference(project, canonicalDesign),
			);
		} catch (error) {
			if (isInvalidDesignIdError(error)) {
				return invalidDesignIdResponse();
			}
			if (
				error instanceof DesignFileServiceError &&
				(error.code === "INVALID_DESIGN_PAYLOAD" ||
					error.code === "UNSUPPORTED_DESIGN_VERSION")
			) {
				return jsonError(error.message, 422);
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return designNotFoundResponse(designId);
			}

			return jsonError("Failed to read trickroom design file", 500);
		}
	});

	// One board with its revision, so a client can reload a single board
	// after a change event names it.
	app.get("/api/trickroom/design/board", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		const boardId = c.req.query("board");
		if (!designId || !boardId) {
			return jsonError("Missing required query parameters: id, board", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			const read = await designFileService.readDesignBoard(designId, boardId);
			if (!read) {
				return jsonError(
					`Board "${boardId}" not found in design "${designId}"`,
					404,
				);
			}
			c.header(designBoardRevisionHeaderName, read.revision);
			return c.json({ board: read.board, revision: read.revision });
		} catch (error) {
			if (isInvalidDesignIdError(error)) {
				return invalidDesignIdResponse();
			}
			if (
				error instanceof DesignFileServiceError &&
				(error.code === "INVALID_DESIGN_PAYLOAD" ||
					error.code === "UNSUPPORTED_DESIGN_VERSION")
			) {
				return jsonError(error.message, 422);
			}
			if (asErrnoException(error).code === "ENOENT") {
				return designNotFoundResponse(designId);
			}
			return jsonError("Failed to read trickroom design board", 500);
		}
	});

	app.get("/api/trickroom/design/system-component-usage", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		if (!designId) {
			return jsonError("Missing required query parameter: id", 400);
		}

		const systemHandle = c.req.query("systemId") ?? undefined;
		const componentId = c.req.query("componentId") ?? undefined;
		const version = c.req.query("version") ?? undefined;

		try {
			const result = await scanDesignFileSystemComponentUsage(
				project.projectRoot,
				designId,
				{
					systemHandle,
					componentId,
					version,
				},
			);
			return c.json({
				designFileId: designId,
				...result,
			});
		} catch (error) {
			if (isInvalidDesignIdError(error)) {
				return invalidDesignIdResponse();
			}

			return jsonError("Failed to scan design system component usage", 500);
		}
	});

	app.get("/api/trickroom/designs", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			const designSummaries = await designFileService.listDesignSummaries();
			const summaries = await Promise.all(
				designSummaries.map(async (summary) => {
					const systemHandle = getDesignSystemHandle(summary);
					const system = await findDesignSystem(
						project.projectRoot,
						systemHandle ?? "",
					);
					return {
						uuid: summary.uuid,
						file: summary.file,
						name: summary.name,
						...(system
							? {
									systemId: system.manifest.systemId,
									systemName: system.manifest.systemName,
								}
							: {
									...(summary.systemId !== undefined
										? { systemId: summary.systemId }
										: {}),
									...(summary.systemId === null
										? { systemName: null }
										: summary.systemName !== undefined
											? { systemName: summary.systemName }
											: {}),
								}),
						boardsCount: summary.boardsCount,
						layersCount: summary.layersCount,
						modifiedAt: summary.modifiedAt,
						...(summary.diagnostic ? { diagnostic: summary.diagnostic } : {}),
						...(summary.warnings ? { warnings: summary.warnings } : {}),
					} satisfies TrickroomDesignSummary;
				}),
			);
			return c.json(summaries);
		} catch {
			return jsonError("Failed to list trickroom design files", 500);
		}
	});

	app.get("/api/trickroom/audit-log/summary", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const auditLogPath = path.join(project.trickroomDir, "audit-log.jsonl");
		try {
			return c.json(await summarizeAuditLog(auditLogPath));
		} catch (error) {
			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return c.json({ count: 0, mostRecentAt: null });
			}

			return jsonError("Failed to summarize MCP audit log", 500);
		}
	});

	app.post("/api/trickroom/design/extract", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const body = await c.req.json().catch(() => null);
		if (!isRecord(body)) {
			return jsonError("Invalid extract design payload", 400);
		}

		let sourceDesignId: string;
		let targetDesignId: string;
		let elementId: string;
		let name: string | undefined;
		try {
			sourceDesignId = readRequiredString(body, "sourceDesignId");
			targetDesignId = readRequiredString(body, "targetDesignId");
			elementId = readRequiredString(body, "elementId");
			name = readOptionalString(body, "name");
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return jsonError(error.message, 400);
			}
			throw error;
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			designFileService.assertDesignId(sourceDesignId);
			designFileService.assertDesignId(targetDesignId);
		} catch (error) {
			if (!isInvalidDesignIdError(error)) {
				throw error;
			}

			return invalidDesignIdResponse();
		}

		try {
			const sourceRead = await designFileService.readDesignFile(sourceDesignId);
			const result = await applyExtractSubtree(sourceRead.design, {
				elementId,
				name,
				projectRoot: project.projectRoot,
			});
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				result.newDesign,
			);
			await assertExtractedDesignReferencesExist(project, canonicalDesign);
			const written = await designFileService.createDesignFile(
				targetDesignId,
				canonicalDesign,
			);
			setDesignRevisionHeader(c, written.revision);
			return c.json(
				await decorateDesignSystemReference(project, written.design),
				201,
			);
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return jsonError(error.message, 400);
			}
			if (error instanceof DesignFileServiceError) {
				if (error.code === "INVALID_DESIGN_PAYLOAD") {
					return jsonError(error.message, 400);
				}
				if (error.code === "DESIGN_FILE_ALREADY_EXISTS") {
					return jsonError("Design file already exists", 409);
				}
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return designNotFoundResponse(sourceDesignId);
			}

			return jsonError("Failed to extract trickroom design file", 500);
		}
	});

	app.post("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		if (!designId) {
			return jsonError("Missing required query parameter: id", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			designFileService.assertDesignId(designId);
		} catch (error) {
			if (!isInvalidDesignIdError(error)) {
				throw error;
			}

			return invalidDesignIdResponse();
		}

		const body = await c.req.json().catch(() => null);

		try {
			if (!isTrickroomDesign(body)) {
				return jsonError("Invalid trickroom design payload", 400);
			}
			const designWithDefault = await applyProjectDefaultSystemToDesign(
				project.projectRoot,
				project.config,
				body,
			);
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				designWithDefault,
			);
			await assertExtractedDesignReferencesExist(project, canonicalDesign);
			const written = await designFileService.createDesignFile(
				designId,
				canonicalDesign,
			);
			setDesignRevisionHeader(c, written.revision);
			return c.json(
				await decorateDesignSystemReference(project, written.design),
				201,
			);
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return jsonError(error.message, 400);
			}
			if (error instanceof DesignFileServiceError) {
				if (error.code === "INVALID_DESIGN_PAYLOAD") {
					return jsonError(error.message, 400);
				}
				if (error.code === "DESIGN_FILE_ALREADY_EXISTS") {
					return jsonError("Design file already exists", 409);
				}
			}

			return jsonError("Failed to create trickroom design file", 500);
		}
	});

	app.put("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		if (!designId) {
			return jsonError("Missing required query parameter: id", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			designFileService.assertDesignId(designId);
		} catch (error) {
			if (!isInvalidDesignIdError(error)) {
				throw error;
			}

			return invalidDesignIdResponse();
		}

		// Writes replace an existing design, so they must name the revision they
		// were based on; new designs are created with POST.
		const expectedRevision = c.req.header(expectedDesignRevisionHeaderName);
		if (!expectedRevision) {
			return jsonError(
				`Missing ${expectedDesignRevisionHeaderName} header. Read the design first and send its revision.`,
				428,
			);
		}

		const body = await c.req.json().catch(() => null);

		try {
			if (!isTrickroomDesign(body)) {
				return jsonError("Invalid trickroom design payload", 400);
			}
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				body,
			);
			await assertExtractedDesignReferencesExist(project, canonicalDesign);
			const written = await designFileService.writeDesignFile(
				designId,
				canonicalDesign,
				{ expectedRevision },
			);
			setDesignRevisionHeader(c, written.revision);
			if (written.merged) {
				c.header(designMergedHeaderName, "true");
			}
			return c.json(
				await decorateDesignSystemReference(project, written.design),
			);
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return jsonError(error.message, 400);
			}
			if (
				error instanceof DesignFileServiceError &&
				error.code === "INVALID_DESIGN_PAYLOAD"
			) {
				return jsonError(error.message, 400);
			}
			if (
				error instanceof DesignFileServiceError &&
				error.code === "REVISION_MISMATCH"
			) {
				return jsonError("Design file changed since it was loaded", 409);
			}
			if (
				error instanceof DesignFileServiceError &&
				error.code === "UNSUPPORTED_DESIGN_VERSION"
			) {
				return jsonError(error.message, 422);
			}
			if (
				error instanceof DesignFileServiceError &&
				error.code === "DESIGN_FILE_LOCKED"
			) {
				return jsonError(
					"Design file is being written by another process; retry shortly",
					423,
				);
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return designNotFoundResponse(designId);
			}

			return jsonError("Failed to write trickroom design file", 500);
		}
	});

	app.delete("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designId = c.req.query("id");
		if (!designId) {
			return jsonError("Missing required query parameter: id", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot, {
			trickroomHome,
		});
		try {
			await designFileService.deleteDesignFile(designId);
			return c.json({ ok: true });
		} catch (error) {
			if (isInvalidDesignIdError(error)) {
				return invalidDesignIdResponse();
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				return designNotFoundResponse(designId);
			}

			return jsonError("Failed to delete trickroom design file", 500);
		}
	});

	return Object.assign(app, { trickroomRuntime: runtime });
};

const initialProjectRoot = process.env.TRICKROOM_PROJECT_DIR
	? resolveProjectRoot()
	: null;

export default createTrickroomApp({
	initialProjectRoot,
	registerInitialProject: process.env.VITEST !== "true",
});
