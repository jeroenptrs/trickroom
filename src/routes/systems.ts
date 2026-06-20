import type { Context } from "hono";
import { Hono } from "hono";
import { jsonError } from "../server-utils";
import type { TrickroomConfig } from "../types";
import {
	type AssetManifestAsset,
	AssetManifestError,
	deleteAsset,
	readAsset,
	readAssetFile,
	readAssetManifest,
	refreshAssetMetadata,
	registerAsset,
	updateAsset,
} from "../utils/asset-manifest-service";
import {
	findProjectResourceUsage,
	findProjectSystemDesigns,
} from "../utils/design-resource-references";
import {
	addIconFolderPath,
	createDesignSystemStorage,
	type DesignSystemRecord,
	DesignSystemStorageError,
	deleteDesignSystemStorage,
	findDesignSystem,
	listDesignSystems,
	removeIconFolderPath,
	writeDesignSystemManifest,
} from "../utils/design-system-store";
import {
	deleteFont,
	FontManifestError,
	type FontFace,
	type FontManifestFont,
	importManagedFontFile,
	readFont,
	readFontManifest,
	readManagedFontFile,
	readProjectFontFile,
	registerFont,
	type SupportedFontFormat,
	updateFont,
} from "../utils/font-manifest-service";
import { syncFontsFromSystemStylesheet } from "../utils/font-manifest-sync.ts";
import {
	IconManifestError,
	type IconManifestIcon,
	readIcon,
	readIconManifest,
	readSanitizedIconSvg,
	syncIconManifest,
} from "../utils/icon-manifest-service";
import { registerSystemComponentRoutes } from "./system-components";

export const systemsRoutes = new Hono();

const getProjectRoot = (c: Context) => c.get("projectRoot") as string;
const getConfig = (c: Context) => c.get("config") as TrickroomConfig;
const getSystem = (c: Context) => c.get("system") as DesignSystemRecord;
const systemNamePattern = /^[A-Za-z0-9_@-]+$/u;

systemsRoutes.use("/:systemName/*", async (c, next) => {
	const projectRoot = getProjectRoot(c);
	const systemHandle = c.req.param("systemName");
	const system = await findDesignSystem(projectRoot, systemHandle);
	if (!system) {
		return jsonError(`Unknown design system "${systemHandle}".`, 404);
	}

	c.set("system", system);
	await next();
});

const assetSummary = (id: string, asset: AssetManifestAsset) => ({
	id,
	...asset,
});

const parseJsonBody = async (request: Request) =>
	request.json().catch(() => null) as Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (
	body: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = body[key];
	return typeof value === "string" ? value : undefined;
};

const readStringArray = (
	body: Record<string, unknown>,
	key: string,
): string[] | null => {
	const value = body[key];
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		return null;
	}
	return value;
};

const validateSystemName = (systemName: string): string | null => {
	const trimmed = systemName.trim();
	if (!trimmed) return null;
	if (!systemNamePattern.test(trimmed)) return null;
	return trimmed;
};

const createSystemStorageErrorResponse = (error: unknown) => {
	if (error instanceof DesignSystemStorageError) {
		return jsonError(error.message, 400);
	}
	console.error(error);
	return jsonError("Failed to process system request", 500);
};

const systemSummary = (system: DesignSystemRecord) => ({
	systemId: system.manifest.systemId,
	systemName: system.manifest.systemName,
	...(system.manifest.cssPath ? { cssPath: system.manifest.cssPath } : {}),
	iconFolderPaths: system.manifest.iconFolderPaths ?? [],
});

systemsRoutes.get("/", async (c) => {
	const projectRoot = getProjectRoot(c);
	try {
		const systems = await listDesignSystems(projectRoot);
		return c.json({ systems: systems.map(systemSummary) });
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
});

systemsRoutes.get("", async (c) => {
	const projectRoot = getProjectRoot(c);
	try {
		const systems = await listDesignSystems(projectRoot);
		return c.json({ systems: systems.map(systemSummary) });
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
});

const createSystemRouteHandler = async (c: Context) => {
	const projectRoot = getProjectRoot(c);
	const config = getConfig(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const systemName = validateSystemName(readString(body, "systemName") ?? "");
	const cssPath = readString(body, "cssPath")?.trim();
	if (!systemName || !cssPath) {
		return jsonError("Request body must include systemName and cssPath", 400);
	}
	if (await findDesignSystem(projectRoot, systemName)) {
		return jsonError(`Design system "${systemName}" already exists.`, 409);
	}

	try {
		const manifest = await createDesignSystemStorage(projectRoot, {
			systemName,
			cssPath,
		});
		return c.json(
			{
				systemId: manifest.systemId,
				systemName: manifest.systemName,
				cssPath: manifest.cssPath,
				config,
			},
			201,
		);
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
};

systemsRoutes.post("/", createSystemRouteHandler);
systemsRoutes.post("", createSystemRouteHandler);

systemsRoutes.patch("/:systemName", async (c) => {
	const projectRoot = getProjectRoot(c);
	const config = getConfig(c);
	const systemHandle = c.req.param("systemName");
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const system = await findDesignSystem(projectRoot, systemHandle);
	if (!system) {
		return jsonError(`Unknown design system "${systemHandle}".`, 404);
	}

	const nextSystemName = readString(body, "systemName")
		? validateSystemName(readString(body, "systemName") ?? "")
		: system.manifest.systemName;
	const cssPath =
		readString(body, "cssPath")?.trim() ?? system.manifest.cssPath;
	if (!nextSystemName || !cssPath) {
		return jsonError(
			"Request body contains an invalid systemName or cssPath",
			400,
		);
	}
	const existingByName = await findDesignSystem(projectRoot, nextSystemName);
	if (
		nextSystemName !== system.manifest.systemName &&
		existingByName &&
		existingByName.manifest.systemId !== system.manifest.systemId
	) {
		return jsonError(`Design system "${nextSystemName}" already exists.`, 409);
	}

	try {
		const previousSystemNames =
			nextSystemName === system.manifest.systemName
				? system.manifest.previousSystemNames
				: [
						...(system.manifest.previousSystemNames ?? []),
						system.manifest.systemName,
					];
		const updated = await writeDesignSystemManifest(
			projectRoot,
			system.manifest.systemId,
			{
				...system.manifest,
				systemName: nextSystemName,
				previousSystemNames,
				cssPath,
			},
		);
		return c.json({
			systemId: updated.systemId,
			systemName: updated.systemName,
			cssPath: updated.cssPath,
			config,
		});
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
});

systemsRoutes.delete("/:systemName", async (c) => {
	const projectRoot = getProjectRoot(c);
	const config = getConfig(c);
	const systemHandle = c.req.param("systemName");
	const system = await findDesignSystem(projectRoot, systemHandle);
	if (!system) {
		return jsonError(`Unknown design system "${systemHandle}".`, 404);
	}

	try {
		await deleteDesignSystemStorage(projectRoot, system.manifest.systemId);
		return c.json({
			ok: true,
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			config,
		});
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
});

const createAssetErrorResponse = (error: unknown) => {
	if (error instanceof AssetManifestError) {
		if (error.code === "ASSET_NOT_FOUND") {
			return jsonError(error.message, 404);
		}
		if (error.code === "DUPLICATE_ASSET_ID") {
			return jsonError(error.message, 409);
		}
		if (
			error.code === "INVALID_ASSET_ID" ||
			error.code === "INVALID_ASSET_MANIFEST" ||
			error.code === "INVALID_ASSET_PATH" ||
			error.code === "UNSUPPORTED_ASSET_TYPE"
		) {
			return jsonError(error.message, 400);
		}
	}

	console.error(error);
	return jsonError("Failed to process system asset request", 500);
};

const fontSummary = (id: string, font: FontManifestFont) => ({
	id,
	...font,
});

const iconSummary = (id: string, icon: IconManifestIcon) => ({
	id,
	...icon,
});

const createFontErrorResponse = (error: unknown) => {
	if (error instanceof FontManifestError) {
		if (error.code === "FONT_NOT_FOUND" || error.code === "SYSTEM_NOT_FOUND") {
			return jsonError(error.message, 404);
		}
		if (error.code === "DUPLICATE_FONT_ID") {
			return jsonError(error.message, 409);
		}
		if (
			error.code === "INVALID_FONT_ID" ||
			error.code === "INVALID_FONT_MANIFEST" ||
			error.code === "INVALID_FONT_PATH" ||
			error.code === "INVALID_FONT_SOURCE" ||
			error.code === "INVALID_REMOTE_URL" ||
			error.code === "UNSUPPORTED_FONT_TYPE"
		) {
			return jsonError(error.message, 400);
		}
	}

	console.error(error);
	return jsonError("Failed to process system font request", 500);
};

const fontMimeTypeForFormat = (format: string) => {
	switch (format) {
		case "woff":
			return "font/woff";
		case "woff2":
			return "font/woff2";
		case "opentype":
			return "font/otf";
		case "truetype":
			return "font/ttf";
		default:
			return "application/octet-stream";
	}
};

const createIconErrorResponse = (error: unknown) => {
	if (error instanceof IconManifestError) {
		if (error.code === "ICON_NOT_FOUND") {
			return jsonError(error.message, 404);
		}
		if (
			error.code === "INVALID_ICON_ID" ||
			error.code === "INVALID_ICON_PATH" ||
			error.code === "INVALID_ICON_MANIFEST" ||
			error.code === "UNSAFE_SVG"
		) {
			return jsonError(error.message, 400);
		}
	}

	console.error(error);
	return jsonError("Failed to process system icon request", 500);
};

const getRouteSystem = (c: Context) => {
	const system = getSystem(c);
	return {
		system,
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
	};
};

systemsRoutes.get("/:systemName/assets", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const manifest = await readAssetManifest(projectRoot, systemId);
		return c.json({
			systemId,
			systemName,
			assets: Object.entries(manifest.assets).map(([id, asset]) =>
				assetSummary(id, asset),
			),
		});
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/assets/:assetId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const assetId = c.req.param("assetId");

	try {
		const asset = await readAsset(projectRoot, systemId, assetId);
		if (!asset) {
			return jsonError(`Unknown asset id "${assetId}"`, 404);
		}

		return c.json({
			systemId,
			systemName,
			asset: assetSummary(assetId, asset),
		});
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/assets/:assetId/file", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId } = getRouteSystem(c);
	const assetId = c.req.param("assetId");

	try {
		const asset = await readAsset(projectRoot, systemId, assetId);
		if (!asset) {
			return jsonError(`Unknown asset id "${assetId}"`, 404);
		}

		const file = await readAssetFile(projectRoot, asset);
		const body = file.contents.buffer.slice(
			file.contents.byteOffset,
			file.contents.byteOffset + file.contents.byteLength,
		) as ArrayBuffer;
		return new Response(body, {
			headers: {
				"content-type": file.mimeType,
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return jsonError(`Asset file not found for "${assetId}"`, 404);
		}
		if (fsError.code === "EISDIR") {
			return jsonError(`Asset sourcePath is not a file for "${assetId}"`, 400);
		}

		return createAssetErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/assets/:assetId/used-by", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const assetId = c.req.param("assetId");

	try {
		const asset = await readAsset(projectRoot, systemId, assetId);
		if (!asset) {
			return jsonError(`Unknown asset id "${assetId}"`, 404);
		}

		const usages = await findProjectResourceUsage(
			projectRoot,
			"asset",
			systemId,
			assetId,
		);

		return c.json({
			systemId,
			systemName,
			assetId,
			usedByCount: usages.length,
		});
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/assets", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const name = readString(body, "name");
	const sourcePath = readString(body, "sourcePath");
	if (!name || !sourcePath) {
		return jsonError("Request body must include name and sourcePath", 400);
	}

	try {
		const result = await registerAsset(projectRoot, systemId, {
			assetId: readString(body, "assetId"),
			name,
			sourcePath,
			alt: readString(body, "alt"),
		});
		return c.json(
			{
				systemId,
				systemName,
				asset: assetSummary(result.assetId, result.asset),
			},
			201,
		);
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/assets/bulk", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body) || !Array.isArray(body.assets)) {
		return jsonError("Request body must include an assets array", 400);
	}

	const assets = body.assets.filter(isRecord);
	if (assets.length !== body.assets.length) {
		return jsonError("Each asset must be a JSON object", 400);
	}

	try {
		const results = [];
		for (const asset of assets) {
			const name = readString(asset, "name");
			const sourcePath = readString(asset, "sourcePath");
			if (!name || !sourcePath) {
				return jsonError("Each asset must include name and sourcePath", 400);
			}
			const result = await registerAsset(projectRoot, systemId, {
				assetId: readString(asset, "assetId"),
				name,
				sourcePath,
				alt: readString(asset, "alt"),
			});
			results.push(assetSummary(result.assetId, result.asset));
		}
		return c.json({ systemId, systemName, assets: results }, 201);
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/assets/refresh", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const assetIds = readStringArray(body, "assetIds");
	if (!assetIds) {
		return jsonError("Request body must include assetIds array", 400);
	}

	try {
		const assets = [];
		for (const assetId of assetIds) {
			const result = await refreshAssetMetadata(projectRoot, systemId, assetId);
			assets.push(assetSummary(result.assetId, result.asset));
		}
		return c.json({ systemId, systemName, assets });
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/assets/:assetId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const assetId = c.req.param("assetId");
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	try {
		const result = await updateAsset(projectRoot, systemId, assetId, {
			name: readString(body, "name"),
			sourcePath: readString(body, "sourcePath"),
			alt:
				body.alt === null
					? null
					: typeof body.alt === "string"
						? body.alt
						: undefined,
		});
		return c.json({
			systemId,
			systemName,
			asset: assetSummary(result.assetId, result.asset),
		});
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/assets/:assetId/refresh", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const assetId = c.req.param("assetId");

	try {
		const result = await refreshAssetMetadata(projectRoot, systemId, assetId);
		return c.json({
			systemId,
			systemName,
			asset: assetSummary(result.assetId, result.asset),
		});
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.delete("/:systemName/assets/:assetId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const assetId = c.req.param("assetId");

	try {
		const asset = await readAsset(projectRoot, systemId, assetId);
		if (!asset) {
			return jsonError(`Unknown asset id "${assetId}"`, 404);
		}

		const usages = await findProjectResourceUsage(
			projectRoot,
			"asset",
			systemId,
			assetId,
		);
		if (usages.length > 0) {
			return c.json(
				{
					error: `Asset "${assetId}" is still used by designs.`,
					usages,
				},
				409,
			);
		}

		await deleteAsset(projectRoot, systemId, assetId);
		return c.json({ ok: true, systemId, systemName, assetId });
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.delete("/:systemName/assets", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const assetIds = readStringArray(body, "assetIds");
	if (!assetIds) {
		return jsonError("Request body must include assetIds array", 400);
	}

	try {
		const uniqueAssetIds = [...new Set(assetIds)];
		for (const assetId of uniqueAssetIds) {
			const asset = await readAsset(projectRoot, systemId, assetId);
			if (!asset) {
				return jsonError(`Unknown asset id "${assetId}"`, 404);
			}
		}

		const usagesByAssetId: Record<string, unknown[]> = {};
		for (const assetId of uniqueAssetIds) {
			const usages = await findProjectResourceUsage(
				projectRoot,
				"asset",
				systemId,
				assetId,
			);
			if (usages.length > 0) {
				usagesByAssetId[assetId] = usages;
			}
		}
		if (Object.keys(usagesByAssetId).length > 0) {
			return c.json(
				{
					error: "One or more assets are still used by designs.",
					usagesByAssetId,
				},
				409,
			);
		}

		for (const assetId of uniqueAssetIds) {
			await deleteAsset(projectRoot, systemId, assetId);
		}
		return c.json({ ok: true, systemId, systemName, assetIds });
	} catch (error) {
		return createAssetErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/fonts/project-file", async (c) => {
	const projectRoot = getProjectRoot(c);
	const sourcePath = c.req.query("path");
	if (!sourcePath) {
		return jsonError("Query parameter path is required", 400);
	}

	try {
		const file = await readProjectFontFile(projectRoot, sourcePath);
		const body = file.contents.buffer.slice(
			file.contents.byteOffset,
			file.contents.byteOffset + file.contents.byteLength,
		) as ArrayBuffer;
		return new Response(body, {
			headers: {
				"content-type": fontMimeTypeForFormat(file.format),
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return jsonError(`Project font file not found for "${sourcePath}"`, 404);
		}
		if (fsError.code === "EISDIR") {
			return jsonError(`Font path is not a file for "${sourcePath}"`, 400);
		}

		return createFontErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/fonts/managed-file", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId } = getRouteSystem(c);
	const managedPath = c.req.query("path");
	if (!managedPath) {
		return jsonError("Query parameter path is required", 400);
	}

	try {
		const file = await readManagedFontFile(projectRoot, systemId, managedPath);
		const body = file.contents.buffer.slice(
			file.contents.byteOffset,
			file.contents.byteOffset + file.contents.byteLength,
		) as ArrayBuffer;
		return new Response(body, {
			headers: {
				"content-type": fontMimeTypeForFormat(file.format),
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return jsonError(`Managed font file not found for "${managedPath}"`, 404);
		}
		if (fsError.code === "EISDIR") {
			return jsonError(`Managed font path is not a file for "${managedPath}"`, 400);
		}

		return createFontErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/fonts/import", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const absoluteSourcePath = readString(body, "absoluteSourcePath");
	const targetRelativePath = readString(body, "targetRelativePath");
	if (!absoluteSourcePath || !targetRelativePath) {
		return jsonError(
			"Request body must include absoluteSourcePath and targetRelativePath",
			400,
		);
	}

	try {
		const result = await importManagedFontFile(projectRoot, systemId, {
			absoluteSourcePath,
			targetRelativePath,
			format:
				typeof body.format === "string"
					? (body.format as SupportedFontFormat)
					: undefined,
		});
		return c.json({
			systemId,
			systemName,
			managedPath: result.managedPath,
			format: result.format,
		});
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/fonts", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const syncResult = await syncFontsFromSystemStylesheet(projectRoot, systemId, {
			onlyWhenEmpty: true,
		});
		const manifest = syncResult.manifest;
		return c.json({
			systemId,
			systemName,
			updatedAt: manifest.metadata.updatedAt,
			fonts: Object.entries(manifest.fonts).map(([id, font]) =>
				fontSummary(id, font),
			),
			...(syncResult.addedFontIds.length > 0 ||
			syncResult.updatedFontIds.length > 0
				? {
						sync: {
							addedFontIds: syncResult.addedFontIds,
							updatedFontIds: syncResult.updatedFontIds,
							skippedFontIds: syncResult.skippedFontIds,
						},
					}
				: {}),
		});
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/fonts/sync-from-stylesheet", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const syncResult = await syncFontsFromSystemStylesheet(projectRoot, systemId);
		const manifest = syncResult.manifest;
		return c.json({
			systemId,
			systemName,
			updatedAt: manifest.metadata.updatedAt,
			fonts: Object.entries(manifest.fonts).map(([id, font]) =>
				fontSummary(id, font),
			),
			sync: {
				addedFontIds: syncResult.addedFontIds,
				updatedFontIds: syncResult.updatedFontIds,
				skippedFontIds: syncResult.skippedFontIds,
				diagnostics: syncResult.diagnostics,
			},
		});
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/fonts/:fontId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const fontId = c.req.param("fontId");

	try {
		const font = await readFont(projectRoot, systemId, fontId);
		if (!font) {
			return jsonError(`Unknown font id "${fontId}"`, 404);
		}

		return c.json({
			systemId,
			systemName,
			font: fontSummary(fontId, font),
		});
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/fonts", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	const name = readString(body, "name");
	const family = readString(body, "family");
	const faces = body.faces;
	if (!name || !family || !Array.isArray(faces)) {
		return jsonError("Request body must include name, family, and faces", 400);
	}

	try {
		const result = await registerFont(projectRoot, systemId, {
			fontId: readString(body, "fontId"),
			name,
			family,
			faces: faces as FontFace[],
		});
		return c.json(
			{
				systemId,
				systemName,
				font: fontSummary(result.fontId, result.font),
			},
			201,
		);
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/fonts/:fontId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const fontId = c.req.param("fontId");
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}

	try {
		const result = await updateFont(projectRoot, systemId, fontId, {
			name: readString(body, "name"),
			family: readString(body, "family"),
			faces: Array.isArray(body.faces) ? (body.faces as FontFace[]) : undefined,
		});
		return c.json({
			systemId,
			systemName,
			font: fontSummary(result.fontId, result.font),
		});
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.delete("/:systemName/fonts/:fontId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const fontId = c.req.param("fontId");

	try {
		const font = await readFont(projectRoot, systemId, fontId);
		if (!font) {
			return jsonError(`Unknown font id "${fontId}"`, 404);
		}

		await deleteFont(projectRoot, systemId, fontId);
		return c.json({ ok: true, systemId, systemName, fontId });
	} catch (error) {
		return createFontErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/icons", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const manifest = await readIconManifest(projectRoot, systemId);
		return c.json({
			systemId,
			systemName,
			indexedAt: manifest.metadata.indexedAt,
			iconFolderPaths: manifest.iconFolderPaths,
			icons: Object.entries(manifest.icons).map(([id, icon]) =>
				iconSummary(id, icon),
			),
			diagnostics: manifest.diagnostics,
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/used-by", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const linkedDesigns = await findProjectSystemDesigns(projectRoot, systemId);

		return c.json({
			systemId,
			systemName,
			usedByCount: linkedDesigns.length,
		});
	} catch (error) {
		return createSystemStorageErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/icons/folders", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const folderPath = readString(body, "folderPath");
	if (!folderPath) {
		return jsonError("Request body must include folderPath", 400);
	}

	try {
		const manifest = await addIconFolderPath(projectRoot, systemId, folderPath);
		const icons = await syncIconManifest(projectRoot, systemId);
		return c.json({
			systemId: manifest.systemId,
			systemName,
			iconFolderPaths: icons.iconFolderPaths,
			indexedAt: icons.metadata.indexedAt,
			icons: Object.entries(icons.icons).map(([id, icon]) =>
				iconSummary(id, icon),
			),
			diagnostics: icons.diagnostics,
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.put("/:systemName/icons/folders", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const folderPaths = readStringArray(body, "folderPaths");
	if (!folderPaths) {
		return jsonError("Request body must include folderPaths array", 400);
	}

	try {
		await writeDesignSystemManifest(projectRoot, systemId, {
			...getSystem(c).manifest,
			iconFolderPaths: folderPaths,
		});
		const icons = await syncIconManifest(projectRoot, systemId);
		return c.json({
			systemId,
			systemName,
			iconFolderPaths: icons.iconFolderPaths,
			indexedAt: icons.metadata.indexedAt,
			icons: Object.entries(icons.icons).map(([id, icon]) =>
				iconSummary(id, icon),
			),
			diagnostics: icons.diagnostics,
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.delete("/:systemName/icons/folders", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const body = await parseJsonBody(c.req.raw);

	if (!isRecord(body)) {
		return jsonError("Request body must be a JSON object", 400);
	}
	const folderPaths = readStringArray(body, "folderPaths");
	const singleFolderPath = readString(body, "folderPath");
	if (!folderPaths && !singleFolderPath) {
		return jsonError(
			"Request body must include folderPath or folderPaths",
			400,
		);
	}

	try {
		for (const folderPath of folderPaths ?? [singleFolderPath as string]) {
			await removeIconFolderPath(projectRoot, systemId, folderPath);
		}
		const icons = await syncIconManifest(projectRoot, systemId);
		return c.json({
			systemId,
			systemName,
			iconFolderPaths: icons.iconFolderPaths,
			indexedAt: icons.metadata.indexedAt,
			icons: Object.entries(icons.icons).map(([id, icon]) =>
				iconSummary(id, icon),
			),
			diagnostics: icons.diagnostics,
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.post("/:systemName/icons/sync", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);

	try {
		const manifest = await syncIconManifest(projectRoot, systemId);
		return c.json({
			systemId,
			systemName,
			indexedAt: manifest.metadata.indexedAt,
			iconFolderPaths: manifest.iconFolderPaths,
			icons: Object.entries(manifest.icons).map(([id, icon]) =>
				iconSummary(id, icon),
			),
			diagnostics: manifest.diagnostics,
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/icons/:iconId", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId, systemName } = getRouteSystem(c);
	const iconId = c.req.param("iconId");

	try {
		const icon = await readIcon(projectRoot, systemId, iconId);
		if (!icon) {
			return jsonError(`Unknown icon id "${iconId}"`, 404);
		}

		return c.json({
			systemId,
			systemName,
			icon: iconSummary(iconId, icon),
		});
	} catch (error) {
		return createIconErrorResponse(error);
	}
});

systemsRoutes.get("/:systemName/icons/:iconId/svg", async (c) => {
	const projectRoot = getProjectRoot(c);
	const { systemId } = getRouteSystem(c);
	const iconId = c.req.param("iconId");

	try {
		const result = await readSanitizedIconSvg(projectRoot, systemId, iconId);
		if (!result) {
			return jsonError(`Unknown icon id "${iconId}"`, 404);
		}

		return new Response(result.svg, {
			headers: {
				"content-type": "image/svg+xml; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code === "ENOENT") {
			return jsonError(`Icon file not found for "${iconId}"`, 404);
		}

		return createIconErrorResponse(error);
	}
});

registerSystemComponentRoutes(systemsRoutes, getProjectRoot, getRouteSystem);
