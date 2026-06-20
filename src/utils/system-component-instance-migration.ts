import type { Node } from "../types";
import type { ResolvedPublishedSystemComponent } from "./system-component-expansion.core";
import {
	getSystemComponentStructuralMetadata,
	isSystemComponentRootStale,
} from "./system-component-markers";
import {
	classifySystemComponentMigration,
	migrateSystemComponentInstance,
	migrateSystemComponentInstanceToCurrent,
	type SystemComponentMigrationClassification,
	type SystemComponentMigrationDiagnostic,
	SystemComponentMigrationError,
	type SystemComponentMigrationResult,
} from "./system-component-migration";
import { variantSchemaHashMatchesDefaultBackfillMigration } from "./system-component-variant-defaults-migration";
import type {
	PublishedSystemComponentVersion,
	SystemComponentManifest,
	SystemComponentRecord,
} from "./system-components";

export class SystemComponentInstanceMigrationError extends Error {
	readonly code:
		| "ELEMENT_NOT_FOUND"
		| "INSTANCE_NOT_FOUND"
		| "INSTANCE_NOT_STALE"
		| "MISSING_TARGET_VERSION";

	constructor(
		code: SystemComponentInstanceMigrationError["code"],
		message: string,
	) {
		super(message);
		this.name = "SystemComponentInstanceMigrationError";
		this.code = code;
	}
}

export type SystemComponentInstanceMigrationContext = {
	systemId: string;
	componentId: string;
	record: SystemComponentRecord;
	sourceVersion: PublishedSystemComponentVersion;
	targetVersion: PublishedSystemComponentVersion;
};

export type SystemComponentInstanceMigrationPreview = {
	classification: SystemComponentMigrationClassification;
	migrationDiagnostics: SystemComponentMigrationDiagnostic[];
	blocked: boolean;
	blockMessage?: string;
};

const isStaleAttachedComponentVersion = (
	rootProps: Node["props"],
	sourceVersion: PublishedSystemComponentVersion,
	currentVersionId: string | null | undefined,
) => {
	const metadata = getSystemComponentStructuralMetadata(rootProps);
	if (!metadata?.isRoot) {
		return false;
	}

	if (currentVersionId && metadata.version !== currentVersionId) {
		return true;
	}

	return (
		isSystemComponentRootStale(rootProps, {
			templateHash: sourceVersion.templateHash,
		}) ||
		(metadata.variantSchemaHash !== sourceVersion.variantSchemaHash &&
			!variantSchemaHashMatchesDefaultBackfillMigration(
				metadata.variantSchemaHash,
				sourceVersion.variants,
			))
	);
};

export const isSystemComponentInstanceMigrationUpdateBlocked = (
	preview: SystemComponentInstanceMigrationPreview | null,
) => !preview || preview.blocked || Boolean(preview.blockMessage);

export const resolveSystemComponentInstanceMigrationContext = (
	metadata: {
		systemId: string;
		componentId: string;
		version: string;
		isRoot?: boolean;
	},
	manifest: SystemComponentManifest,
): SystemComponentInstanceMigrationContext | null => {
	if (!metadata.isRoot) {
		return null;
	}

	const record = manifest.components[metadata.componentId];
	if (!record) {
		return null;
	}

	const published = record.published;
	const sourceVersion = published?.versions[metadata.version];
	const targetVersionId = published?.currentVersion;
	const targetVersion = targetVersionId
		? published?.versions[targetVersionId]
		: undefined;
	if (!sourceVersion || !targetVersion) {
		return null;
	}

	return {
		systemId: metadata.systemId,
		componentId: metadata.componentId,
		record,
		sourceVersion,
		targetVersion,
	};
};

const getMigrationClassificationInput = (
	root: Node,
	context: SystemComponentInstanceMigrationContext,
) => {
	const metadata = getSystemComponentStructuralMetadata(root.props);
	if (!metadata?.isRoot) {
		throw new SystemComponentInstanceMigrationError(
			"INSTANCE_NOT_FOUND",
			`Element "${root.id}" is not a system component root.`,
		);
	}

	return {
		componentId: context.componentId,
		instanceId: metadata.instanceId,
		fromVersion: context.sourceVersion,
		toVersion: context.targetVersion,
		templateHash: metadata.templateHash,
		variantSchemaHash: metadata.variantSchemaHash,
		variantValues: metadata.variantValues,
		overrides: metadata.overrides,
	};
};

export const previewSystemComponentInstanceMigration = (
	boards: readonly Node[],
	rootElementId: string,
	context: SystemComponentInstanceMigrationContext,
): SystemComponentInstanceMigrationPreview => {
	const root = findNodeById(boards, rootElementId);
	if (!root) {
		throw new SystemComponentInstanceMigrationError(
			"ELEMENT_NOT_FOUND",
			`Element "${rootElementId}" not found.`,
		);
	}

	const classification = classifySystemComponentMigration(
		getMigrationClassificationInput(root, context),
	);

	let migrationDiagnostics: SystemComponentMigrationDiagnostic[] = [];
	let blocked = false;
	let blockMessage: string | undefined;

	try {
		const migration = migrateSystemComponentInstance(boards, root.id, {
			systemId: context.systemId,
			componentId: context.componentId,
			sourceVersion: context.sourceVersion,
			targetVersion: context.targetVersion,
			migrationHints: context.targetVersion.migrationHints,
		});
		migrationDiagnostics = migration.metadata.diagnostics;
	} catch (error) {
		if (error instanceof SystemComponentMigrationError) {
			blocked = error.code === "MIGRATION_UNSAFE";
			blockMessage = error.message;
		} else {
			throw error;
		}
	}

	return {
		classification,
		migrationDiagnostics,
		blocked,
		blockMessage,
	};
};

export const updateStaleSystemComponentInstance = (
	boards: readonly Node[],
	rootElementId: string,
	context: SystemComponentInstanceMigrationContext,
	options: { createElementId?: () => string } = {},
): SystemComponentMigrationResult => {
	const root = findNodeById(boards, rootElementId);
	if (!root) {
		throw new SystemComponentInstanceMigrationError(
			"ELEMENT_NOT_FOUND",
			`Element "${rootElementId}" not found.`,
		);
	}

	const metadata = getSystemComponentStructuralMetadata(root.props);
	if (!metadata?.isRoot) {
		throw new SystemComponentInstanceMigrationError(
			"INSTANCE_NOT_FOUND",
			`Element "${rootElementId}" is not a system component root.`,
		);
	}

	if (
		!isStaleAttachedComponentVersion(
			root.props,
			context.sourceVersion,
			context.record.published?.currentVersion,
		)
	) {
		throw new SystemComponentInstanceMigrationError(
			"INSTANCE_NOT_STALE",
			`System component instance "${metadata.instanceId}" is already up to date.`,
		);
	}

	const resolved: ResolvedPublishedSystemComponent = {
		systemId: context.systemId,
		componentId: context.componentId,
		record: context.record,
		version: context.targetVersion,
	};

	return migrateSystemComponentInstanceToCurrent(
		boards,
		rootElementId,
		resolved,
		context.sourceVersion,
		options,
	);
};

const findNodeById = (
	boards: readonly Node[],
	elementId: string,
): Node | null => {
	for (const board of boards) {
		const stack: Node[] = [board];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) {
				continue;
			}
			if (node.id === elementId) {
				return node;
			}
			if (Array.isArray(node.children)) {
				for (const child of node.children) {
					stack.push(child);
				}
			}
		}
	}
	return null;
};
