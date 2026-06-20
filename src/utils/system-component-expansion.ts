export {
	assertValidSystemComponentInstanceOverrides,
	expandResolvedSystemComponent,
	resolvePublishedVersionId,
	resolveSystemComponentClassName,
	resolveSystemComponentVariantValues,
	SystemComponentResolutionError,
	type ResolvedPublishedSystemComponent,
	type SystemComponentExpansionOptions,
	type SystemComponentExpansionResult,
} from "./system-component-expansion.core";

import {
	expandResolvedSystemComponent,
	resolvePublishedVersionId,
	SystemComponentResolutionError,
	type ResolvedPublishedSystemComponent,
	type SystemComponentExpansionOptions,
	type SystemComponentExpansionResult,
} from "./system-component-expansion.core";
import {
	assertDesignSystemExistsForComponents,
	readSystemComponentManifest,
	SystemComponentManifestServiceError,
} from "./system-component-manifest-service.ts";

export async function resolvePublishedSystemComponentVersion(
	projectRoot: string,
	systemId: string,
	componentId: string,
	version?: string | null,
): Promise<ResolvedPublishedSystemComponent> {
	try {
		await assertDesignSystemExistsForComponents(projectRoot, systemId);
	} catch (error) {
		if (
			error instanceof SystemComponentManifestServiceError &&
			error.code === "SYSTEM_NOT_FOUND"
		) {
			throw new SystemComponentResolutionError(
				"UNKNOWN_SYSTEM",
				`Design system "${systemId}" was not found.`,
			);
		}
		throw error;
	}

	const read = await readSystemComponentManifest(projectRoot, systemId);
	const record = read.manifest.components[componentId];
	if (!record) {
		throw new SystemComponentResolutionError(
			"UNKNOWN_COMPONENT",
			`System component "${componentId}" was not found in system "${systemId}".`,
		);
	}

	const resolvedVersionId = resolvePublishedVersionId(
		componentId,
		systemId,
		record,
		version,
	);
	const publishedVersion = record.published?.versions[resolvedVersionId];
	if (!publishedVersion) {
		throw new SystemComponentResolutionError(
			"UNKNOWN_VERSION",
			`System component "${componentId}" version "${resolvedVersionId}" was not found in system "${systemId}".`,
		);
	}

	return {
		systemId,
		componentId,
		record,
		version: publishedVersion,
	};
}

export async function expandPublishedSystemComponentVersion(
	projectRoot: string,
	systemId: string,
	componentId: string,
	version?: string | null,
	options: SystemComponentExpansionOptions = {},
): Promise<SystemComponentExpansionResult> {
	const resolved = await resolvePublishedSystemComponentVersion(
		projectRoot,
		systemId,
		componentId,
		version,
	);
	return expandResolvedSystemComponent(resolved, options);
}
