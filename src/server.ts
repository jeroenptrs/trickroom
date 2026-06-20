import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Hono } from "hono";
import { resolveTrickroomHome } from "./app-state/home";
import {
	clearActiveProjectLocation,
	deleteProjectLocation,
	getActiveProjectLocation,
	type ProjectLocationRef,
	readProjectRegistry,
	updateProjectLocationName,
} from "./app-state/project-registry";
import { parseDesignResourceUri } from "./mcp/resources";
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
import { systemsRoutes } from "./routes/systems";
import { tailwindRoutes } from "./routes/tailwind";
import { captureNodeException } from "./sentry/node";
import {
	asErrnoException,
	isTrickroomConfig,
	isTrickroomDesign,
	jsonError,
	readJsonFile,
} from "./server-utils";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "./services/design-file-service";
import {
	applyExtractSubtree,
	DesignTransformError,
} from "./services/design-transform-service";
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

export type TrickroomActiveProject = TrickroomProjectContext & {
	locationId: string;
};

export type TrickroomSessionProject = {
	projectId: string;
	locationId: string;
	projectRoot: string;
	name: string;
};

export type TrickroomAppOptions = {
	trickroomHome?: string;
	initialProjectRoot?: string | null;
	registerInitialProject?: boolean;
};

const electronSessionHeaderName = "x-trickroom-session";

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
			const timestampTime =
				typeof entry.timestamp === "string"
					? Date.parse(entry.timestamp)
					: Number.NaN;
			if (!Number.isNaN(timestampTime) && timestampTime > mostRecentTime) {
				mostRecentTime = timestampTime;
				mostRecentAt = entry.timestamp;
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

export const createTrickroomApp = (options: TrickroomAppOptions = {}) => {
	const app = new Hono();
	const trickroomHome = options.trickroomHome ?? resolveTrickroomHome();
	const registerInitialProject = options.registerInitialProject ?? true;
	let activeProject: TrickroomActiveProject | null = null;
	let initialProjectPromise: Promise<void> | null = null;

	app.onError((error, c) => {
		captureNodeException(error, {
			tags: {
				route: c.req.path,
			},
			extra: {
				method: c.req.method,
			},
		});
		return jsonError("Internal server error", 500);
	});

	app.use("*", async (c, next) => {
		if (process.env.TRICKROOM_ELECTRON !== "1") {
			await next();
			return;
		}

		const sessionToken = process.env.TRICKROOM_SESSION_TOKEN;
		if (!sessionToken) {
			return jsonError("Electron session token is not configured.", 500);
		}

		const requestToken = c.req.header(electronSessionHeaderName);
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
			activeProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId: "locationId" in project ? project.locationId : "loc_test",
			};
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
			mode: process.env.TRICKROOM_ELECTRON === "1" ? "electron" : "browser",
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
			activeProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId: project.locationId,
			};

			return c.json({
				project: toSessionProject(activeProject),
				configPath: activeProject.configPath,
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
			activeProject = {
				projectRoot: project.projectRoot,
				trickroomDir: project.trickroomDir,
				configPath: project.configPath,
				legacyConfigPath: project.legacyConfigPath,
				designsDir: project.designsDir,
				config: project.config,
				locationId: project.locationId,
			};

			const designFileService = createDesignFileService(project.projectRoot);
			const designSummaries = await designFileService.listDesignSummaries();
			const designSummary = designSummaries.find(
				(summary) =>
					summary.uuid.toLowerCase() === parsedUri.designId.toLowerCase(),
			);
			if (!designSummary) {
				return jsonError(
					`Design file "${parsedUri.designId}" not found.`,
					404,
				);
			}

			return c.json({
				project: toSessionProject(activeProject),
				designId: designSummary.uuid,
				designFile: designSummary.file,
			});
		} catch (error) {
			return createProjectErrorResponse(error);
		}
	});

	app.post("/api/trickroom/projects/close", async (c) => {
		activeProject = null;
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
			activeProject = null;
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
				activeProject = {
					...activeProject,
					config: writtenConfig,
				};
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

	const attachProjectToSystemsRequest = async (
		c: Parameters<Parameters<typeof app.use>[1]>[0],
		next: Parameters<Parameters<typeof app.use>[1]>[1],
	) => {
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

	app.get("/api/trickroom/project-root", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		return c.json({ projectRoot: project.projectRoot });
	});

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
			const designFileService = createDesignFileService(project.projectRoot);
			await mkdir(designFileService.designsDir, { recursive: true });
			await writeFile(designFileService.designsGitkeepPath, "", { flag: "a" });
			const writtenConfig = await writeProjectConfig(
				project.projectRoot,
				config,
			);
			activeProject = { ...project, config: writtenConfig };
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
			activeProject = { ...project, config: writtenConfig };
			return c.json(writtenConfig);
		} catch {
			return jsonError("Failed to update MCP settings", 500);
		}
	});

	app.get("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const file = c.req.query("file");
		if (!file) {
			return jsonError("Missing required query parameter: file", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot);
		try {
			const read = await designFileService.readJsonFile(file);
			if (!isTrickroomDesign(read.value)) {
				return c.json(read.value);
			}

			const repair = repairInvalidKnownRecipeInstances(read.value);
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				repair.design,
			);
			const shouldWrite =
				repair.report.repairedCount > 0 ||
				JSON.stringify(canonicalDesign) !== JSON.stringify(read.value);
			if (!shouldWrite) {
				return c.json(await decorateDesignSystemReference(project, read.value));
			}

			const written = await designFileService.writeDesignFile(
				file,
				canonicalDesign,
				{ expectedRevision: read.revision },
			);
			if (repair.report.repairedCount > 0) {
				c.header(recipeLoadRepairHeaderName, JSON.stringify(repair.report));
			}
			return c.json(
				await decorateDesignSystemReference(project, written.design),
			);
		} catch (error) {
			if (
				error instanceof DesignFileServiceError &&
				error.code === "INVALID_DESIGN_FILE_PATH"
			) {
				return jsonError(
					"Design file path must be inside .trickroom/designs",
					400,
				);
			}
			if (
				error instanceof DesignFileServiceError &&
				error.code === "REVISION_MISMATCH"
			) {
				return jsonError(
					"Design file changed while repairing recipe instances",
					409,
				);
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				const designPath = designFileService.resolveDesignFilePath(file);
				return jsonError(`Design file not found at ${designPath}`, 404);
			}

			return jsonError("Failed to read trickroom design file", 500);
		}
	});

	app.get("/api/trickroom/designs", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const designFileService = createDesignFileService(project.projectRoot);
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

		let sourceFile: string;
		let targetFile: string;
		let elementId: string;
		let name: string | undefined;
		try {
			sourceFile = readRequiredString(body, "sourceFile");
			targetFile = readRequiredString(body, "targetFile");
			elementId = readRequiredString(body, "elementId");
			name = readOptionalString(body, "name");
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return jsonError(error.message, 400);
			}
			throw error;
		}

		const designFileService = createDesignFileService(project.projectRoot);
		try {
			designFileService.resolveDesignFilePath(sourceFile);
			designFileService.resolveDesignFilePath(targetFile);
		} catch (error) {
			if (!(error instanceof DesignFileServiceError)) {
				throw error;
			}

			return jsonError(
				"Design file path must be inside .trickroom/designs",
				400,
			);
		}

		try {
			const sourceRead = await designFileService.readDesignFile(sourceFile);
			const result = applyExtractSubtree(sourceRead.design, {
				elementId,
				name,
			});
			const canonicalDesign = await canonicalizeDesignSystemReferenceForStorage(
				project,
				result.newDesign,
			);
			await assertExtractedDesignReferencesExist(project, canonicalDesign);
			const written = await designFileService.createDesignFile(
				targetFile,
				canonicalDesign,
			);
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
					return jsonError("Invalid trickroom design payload", 400);
				}
				if (error.code === "DESIGN_FILE_ALREADY_EXISTS") {
					return jsonError("Design file already exists", 409);
				}
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				const sourcePath = designFileService.resolveDesignFilePath(sourceFile);
				return jsonError(`Design file not found at ${sourcePath}`, 404);
			}

			return jsonError("Failed to extract trickroom design file", 500);
		}
	});

	app.post("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const file = c.req.query("file");
		if (!file) {
			return jsonError("Missing required query parameter: file", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot);
		try {
			designFileService.resolveDesignFilePath(file);
		} catch (error) {
			if (!(error instanceof DesignFileServiceError)) {
				throw error;
			}

			return jsonError(
				"Design file path must be inside .trickroom/designs",
				400,
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
			const written = await designFileService.createDesignFile(
				file,
				canonicalDesign,
			);
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
					return jsonError("Invalid trickroom design payload", 400);
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

		const file = c.req.query("file");
		if (!file) {
			return jsonError("Missing required query parameter: file", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot);
		try {
			designFileService.resolveDesignFilePath(file);
		} catch (error) {
			if (!(error instanceof DesignFileServiceError)) {
				throw error;
			}

			return jsonError(
				"Design file path must be inside .trickroom/designs",
				400,
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
				file,
				canonicalDesign,
			);
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
				return jsonError("Invalid trickroom design payload", 400);
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				const designPath = designFileService.resolveDesignFilePath(file);
				return jsonError(`Design file not found at ${designPath}`, 404);
			}

			return jsonError("Failed to write trickroom design file", 500);
		}
	});

	app.delete("/api/trickroom/design", async (c) => {
		const project = await resolveProjectForRequest();
		if (!project) {
			return createNoProjectResponse();
		}

		const file = c.req.query("file");
		if (!file) {
			return jsonError("Missing required query parameter: file", 400);
		}

		const designFileService = createDesignFileService(project.projectRoot);
		try {
			await designFileService.deleteDesignFile(file);
			return c.json({ ok: true });
		} catch (error) {
			if (
				error instanceof DesignFileServiceError &&
				error.code === "INVALID_DESIGN_FILE_PATH"
			) {
				return jsonError(
					"Design file path must be inside .trickroom/designs",
					400,
				);
			}

			const fsError = asErrnoException(error);
			if (fsError.code === "ENOENT") {
				const designPath = designFileService.resolveDesignFilePath(file);
				return jsonError(`Design file not found at ${designPath}`, 404);
			}

			return jsonError("Failed to delete trickroom design file", 500);
		}
	});

	return app;
};

const initialProjectRoot = process.env.TRICKROOM_PROJECT_DIR
	? resolveProjectRoot()
	: null;

export default createTrickroomApp({
	initialProjectRoot,
	registerInitialProject: process.env.VITEST !== "true",
});
