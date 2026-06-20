import type { Context, Hono } from "hono";
import { jsonError } from "../server-utils";
import type { RecipeTemplateNode } from "../types";
import {
	expandPublishedSystemComponentVersion,
	SystemComponentResolutionError,
} from "../utils/system-component-expansion";
import type { SystemComponentManifestRevision } from "../utils/system-component-manifest-service";
import {
	copyPublishedSystemComponentToDraft,
	createSystemComponentDraft,
	describeSystemComponent,
	listSystemComponentSummaries,
	publishSystemComponentDraft,
	SystemComponentOperationsError,
	type SystemComponentSummary,
	updateSystemComponentDraft,
	updateSystemComponentDraftMetadata,
	updateSystemComponentDraftOverrideTargets,
	updateSystemComponentDraftSlots,
	updateSystemComponentDraftTemplate,
	updateSystemComponentDraftVariants,
	updateSystemComponentSettings,
} from "../utils/system-component-operations";
import type {
	SystemComponentDraftPayload,
	SystemComponentOverrideTarget,
	SystemComponentSlotDefinition,
	SystemComponentVariantSchema,
} from "../utils/system-components";
import { scanProjectSystemComponentUsage } from "../utils/system-component-usage-scan";

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

const readExpectedRevision = (
	body: Record<string, unknown>,
): SystemComponentManifestRevision | undefined => {
	const value = readString(body, "expectedRevision");
	return value?.startsWith("sha256:")
		? (value as SystemComponentManifestRevision)
		: undefined;
};

const readOptionalNumber = (
	body: Record<string, unknown>,
	key: string,
): number | null | undefined => {
	const value = body[key];
	if (value === null) return null;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
};

const hasOwnPayloadKey = (body: Record<string, unknown>, key: string) =>
	Object.hasOwn(body, key);

const createComponentErrorResponse = (error: unknown) => {
	if (error instanceof SystemComponentOperationsError) {
		switch (error.code) {
			case "COMPONENT_NOT_FOUND":
			case "SYSTEM_NOT_FOUND":
				return jsonError(error.message, 404);
			case "STALE_WRITE":
			case "DUPLICATE_SLUG":
			case "DRAFT_ALREADY_EXISTS":
			case "DRAFT_HASH_MISMATCH":
				return jsonError(error.message, 409);
			case "VALIDATION_FAILED":
			case "INVALID_SLUG":
			case "NO_DRAFT":
			case "NO_PUBLISHED":
			case "PUBLISHED_VERSION_NOT_FOUND":
				return jsonError(error.message, 400);
		}
	}

	if (error instanceof SystemComponentResolutionError) {
		switch (error.code) {
			case "UNKNOWN_SYSTEM":
			case "UNKNOWN_COMPONENT":
			case "UNKNOWN_VERSION":
				return jsonError(error.message, 404);
			case "INVALID_INSTANCE_STATE":
			case "UNKNOWN_REGISTRY_LIBRARY":
			case "UNKNOWN_REGISTRY_COMPONENT":
				return jsonError(error.message, 400);
		}
	}

	console.error(error);
	return jsonError("Failed to process system component request", 500);
};

const componentMutationResponse = (
	systemId: string,
	systemName: string,
	result: {
		revision: SystemComponentManifestRevision;
		updatedAt: string;
		componentId: string;
		publishedVersion?: string;
	},
) => ({
	systemId,
	systemName,
	revision: result.revision,
	updatedAt: result.updatedAt,
	componentId: result.componentId,
	...(result.publishedVersion
		? { publishedVersion: result.publishedVersion }
		: {}),
});

const systemSettingsMutationResponse = (
	systemId: string,
	systemName: string,
	result: {
		revision: SystemComponentManifestRevision;
		updatedAt: string;
		manifest: { settings?: { autoMigrateComponents: boolean } };
	},
) => ({
	systemId,
	systemName,
	revision: result.revision,
	updatedAt: result.updatedAt,
	settings: {
		autoMigrateComponents:
			result.manifest.settings?.autoMigrateComponents ?? false,
	},
});

export const registerSystemComponentRoutes = (
	systemsRoutes: Hono,
	getProjectRoot: (c: Context) => string,
	getRouteSystem: (c: Context) => { systemId: string; systemName: string },
) => {
	systemsRoutes.get("/:systemName/components", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);

		try {
			const result = await listSystemComponentSummaries(projectRoot, systemId);
			return c.json({
				systemId,
				systemName,
				revision: result.revision,
				updatedAt: result.updatedAt,
				settings: {
					autoMigrateComponents:
						result.manifest.settings?.autoMigrateComponents ?? false,
				},
				components: result.components,
			});
		} catch (error) {
			return createComponentErrorResponse(error);
		}
	});

	systemsRoutes.get("/:systemName/components/usage", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const componentId = c.req.query("componentId") ?? undefined;
		const version = c.req.query("version") ?? undefined;
		const designFileId = c.req.query("designFileId") ?? undefined;

		try {
			const result = await scanProjectSystemComponentUsage(projectRoot, {
				systemHandle: systemId,
				componentId,
				version,
				designFileId,
				validateManifest: true,
			});
			return c.json({
				systemId,
				systemName,
				...result,
			});
		} catch (error) {
			return createComponentErrorResponse(error);
		}
	});

	systemsRoutes.post("/:systemName/components/settings", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const body = await parseJsonBody(c.req.raw);

		if (!isRecord(body)) {
			return jsonError("Request body must be a JSON object", 400);
		}

		const expectedRevision = readExpectedRevision(body);
		if (
			!expectedRevision ||
			typeof body.autoMigrateComponents !== "boolean"
		) {
			return jsonError(
				"Request body must include expectedRevision and autoMigrateComponents",
				400,
			);
		}

		try {
			const result = await updateSystemComponentSettings(
				projectRoot,
				systemId,
				{ autoMigrateComponents: body.autoMigrateComponents },
				{ expectedRevision },
			);
			return c.json(systemSettingsMutationResponse(systemId, systemName, result));
		} catch (error) {
			return createComponentErrorResponse(error);
		}
	});

	systemsRoutes.get("/:systemName/components/:componentId", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const componentId = c.req.param("componentId");

		try {
			const result = await describeSystemComponent(
				projectRoot,
				systemId,
				componentId,
			);
			return c.json({
				systemId,
				systemName,
				revision: result.revision,
				updatedAt: result.updatedAt,
				componentId: result.componentId,
				record: result.record,
				draftTemplateHash: result.draftTemplateHash,
				draftVariantSchemaHash: result.draftVariantSchemaHash,
				diagnostics: result.diagnostics,
				valid: result.valid,
			});
		} catch (error) {
			return createComponentErrorResponse(error);
		}
	});

	systemsRoutes.get(
		"/:systemName/components/:componentId/used-by",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");

			try {
				const result = await scanProjectSystemComponentUsage(projectRoot, {
					systemHandle: systemId,
					componentId,
				});
				return c.json({
					systemId,
					systemName,
					componentId,
					usedByCount: result.usedByCount,
				});
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.get(
		"/:systemName/components/:componentId/usage",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const version = c.req.query("version") ?? undefined;
			const designFileId = c.req.query("designFileId") ?? undefined;

			try {
				const result = await scanProjectSystemComponentUsage(projectRoot, {
					systemHandle: systemId,
					componentId,
					version,
					designFileId,
					validateManifest: true,
				});
				return c.json({
					systemId,
					systemName,
					componentId,
					...result,
				});
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.get(
		"/:systemName/components/:componentId/versions/:version/expand",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const version = c.req.param("version");

			try {
				const result = await expandPublishedSystemComponentVersion(
					projectRoot,
					systemId,
					componentId,
					version,
				);
				return c.json({
					systemId,
					systemName,
					componentId,
					version: result.version,
					root: result.root,
				});
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post("/:systemName/components", async (c) => {
		const projectRoot = getProjectRoot(c);
		const { systemId, systemName } = getRouteSystem(c);
		const body = await parseJsonBody(c.req.raw);

		if (!isRecord(body)) {
			return jsonError("Request body must be a JSON object", 400);
		}

		const slug = readString(body, "slug");
		const name = readString(body, "name");
		const expectedRevision = readExpectedRevision(body);
		if (!slug || !name || !expectedRevision) {
			return jsonError(
				"Request body must include slug, name, and expectedRevision",
				400,
			);
		}

		const draft = isRecord(body.draft)
			? (body.draft as Partial<SystemComponentDraftPayload>)
			: undefined;

		try {
			const result = await createSystemComponentDraft(
				projectRoot,
				systemId,
				{
					slug,
					name,
					description: readString(body, "description"),
					group: readString(body, "group"),
					order: readOptionalNumber(body, "order"),
					...(draft ? { draft } : {}),
				},
				{ expectedRevision },
			);
			return c.json(
				componentMutationResponse(systemId, systemName, result),
				201,
			);
		} catch (error) {
			return createComponentErrorResponse(error);
		}
	});

	systemsRoutes.post(
		"/:systemName/components/:componentId/metadata",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}

			try {
				const result = await updateSystemComponentDraftMetadata(
					projectRoot,
					systemId,
					componentId,
					{
						name: readString(body, "name"),
						slug: readString(body, "slug"),
						description:
							body.description === null
								? null
								: readString(body, "description"),
						group: body.group === null ? null : readString(body, "group"),
						order: readOptionalNumber(body, "order"),
					},
					{ expectedRevision },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/draft",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			const expectedDraftTemplateHash = readString(
				body,
				"expectedDraftTemplateHash",
			);
			const expectedDraftVariantSchemaHash = readString(
				body,
				"expectedDraftVariantSchemaHash",
			);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}

			const input = {
				...(hasOwnPayloadKey(body, "root")
					? { root: body.root as RecipeTemplateNode }
					: {}),
				...(hasOwnPayloadKey(body, "slots")
					? {
							slots:
								body.slots === null
									? null
									: (body.slots as Record<
											string,
											SystemComponentSlotDefinition
										>),
						}
					: {}),
				...(hasOwnPayloadKey(body, "variants")
					? {
							variants:
								body.variants === null
									? null
									: (body.variants as SystemComponentVariantSchema),
						}
					: {}),
				...(hasOwnPayloadKey(body, "overrideTargets")
					? {
							overrideTargets:
								body.overrideTargets === null
									? null
									: (body.overrideTargets as Record<
											string,
											SystemComponentOverrideTarget
										>),
						}
					: {}),
			};

			try {
				const result = await updateSystemComponentDraft(
					projectRoot,
					systemId,
					componentId,
					input,
					{
						expectedRevision,
						expectedDraftTemplateHash,
						expectedDraftVariantSchemaHash,
					},
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/template",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			const expectedDraftTemplateHash = readString(
				body,
				"expectedDraftTemplateHash",
			);
			const root = body.root as RecipeTemplateNode | undefined;
			if (!expectedRevision || !root || typeof root !== "object") {
				return jsonError(
					"Request body must include expectedRevision and root",
					400,
				);
			}

			try {
				const result = await updateSystemComponentDraftTemplate(
					projectRoot,
					systemId,
					componentId,
					root,
					{ expectedRevision, expectedDraftTemplateHash },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/slots",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}
			if (
				!hasOwnPayloadKey(body, "slots") ||
				(body.slots !== null && !isRecord(body.slots))
			) {
				return jsonError("Request body must include slots", 400);
			}

			const slots =
				body.slots === null
					? null
					: (body.slots as Record<string, SystemComponentSlotDefinition>);

			try {
				const result = await updateSystemComponentDraftSlots(
					projectRoot,
					systemId,
					componentId,
					slots,
					{ expectedRevision },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/variants",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}
			if (
				!hasOwnPayloadKey(body, "variants") ||
				(body.variants !== null && !isRecord(body.variants))
			) {
				return jsonError("Request body must include variants", 400);
			}

			const variants =
				body.variants === null
					? null
					: (body.variants as SystemComponentVariantSchema);

			try {
				const result = await updateSystemComponentDraftVariants(
					projectRoot,
					systemId,
					componentId,
					variants,
					{ expectedRevision },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/override-targets",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}
			if (
				!hasOwnPayloadKey(body, "overrideTargets") ||
				(body.overrideTargets !== null && !isRecord(body.overrideTargets))
			) {
				return jsonError("Request body must include overrideTargets", 400);
			}

			const overrideTargets =
				body.overrideTargets === null
					? null
					: (body.overrideTargets as Record<
							string,
							SystemComponentOverrideTarget
						>);

			try {
				const result = await updateSystemComponentDraftOverrideTargets(
					projectRoot,
					systemId,
					componentId,
					overrideTargets,
					{ expectedRevision },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/publish",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}

			try {
				const result = await publishSystemComponentDraft(
					projectRoot,
					systemId,
					componentId,
					{ expectedRevision },
				);
				return c.json(
					componentMutationResponse(systemId, systemName, {
						...result,
						publishedVersion: result.publishedVersion,
					}),
				);
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);

	systemsRoutes.post(
		"/:systemName/components/:componentId/draft-from-published",
		async (c) => {
			const projectRoot = getProjectRoot(c);
			const { systemId, systemName } = getRouteSystem(c);
			const componentId = c.req.param("componentId");
			const body = await parseJsonBody(c.req.raw);

			if (!isRecord(body)) {
				return jsonError("Request body must be a JSON object", 400);
			}

			const expectedRevision = readExpectedRevision(body);
			if (!expectedRevision) {
				return jsonError("Request body must include expectedRevision", 400);
			}

			try {
				const result = await copyPublishedSystemComponentToDraft(
					projectRoot,
					systemId,
					componentId,
					readString(body, "versionId"),
					{ expectedRevision },
				);
				return c.json(componentMutationResponse(systemId, systemName, result));
			} catch (error) {
				return createComponentErrorResponse(error);
			}
		},
	);
};

export type { SystemComponentSummary };
