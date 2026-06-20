import type { Node, TrickroomDesign } from "../types";
import {
	getSystemComponentStructuralMetadata,
	systemComponentRootProp,
} from "./system-component-markers";
import type { SystemComponentManifest } from "./system-components";
import type {
	SystemComponentInstanceUsage,
	SystemComponentInstanceVersionStatus,
	SystemComponentInstanceVersionStatusKind,
	SystemComponentUsageScanDiagnostic,
	SystemComponentUsageScanResult,
} from "./system-component-usage-scan.types";

const collectNodeAttachedInstanceUsages = (
	node: Node,
	nodePath: string,
	context: {
		designFileId: string;
		designFile: string;
		designName: string;
		systemName: string | null | undefined;
	},
	instances: SystemComponentInstanceUsage[],
	diagnostics: SystemComponentUsageScanDiagnostic[],
) => {
	const rootFlag = node.props?.[systemComponentRootProp];
	const metadata = getSystemComponentStructuralMetadata(node.props);

	if (rootFlag === "true" || rootFlag === true) {
		if (!metadata?.isRoot) {
			diagnostics.push({
				code: "MALFORMED_INSTANCE_MARKER",
				message:
					"Attached system component root marker is missing required instance metadata.",
				designFileId: context.designFileId,
				designFile: context.designFile,
				elementId: node.id,
				path: nodePath,
			});
		} else {
			instances.push({
				systemId: metadata.systemId,
				componentId: metadata.componentId,
				version: metadata.version,
				instanceId: metadata.instanceId,
				designFileId: context.designFileId,
				designFile: context.designFile,
				designName: context.designName,
				elementId: node.id,
				path: nodePath,
				systemName: context.systemName ?? null,
				templateHash: metadata.templateHash,
				variantSchemaHash: metadata.variantSchemaHash,
			});
		}
	}

	if (!Array.isArray(node.children)) {
		return;
	}

	for (const [childIndex, child] of node.children.entries()) {
		collectNodeAttachedInstanceUsages(
			child,
			`${nodePath}.children[${childIndex}]`,
			context,
			instances,
			diagnostics,
		);
	}
};

export const collectDesignAttachedSystemComponentUsages = (
	design: TrickroomDesign,
	context: {
		designFileId: string;
		designFile: string;
		designName: string;
	},
): Pick<SystemComponentUsageScanResult, "instances" | "diagnostics"> => {
	const instances: SystemComponentInstanceUsage[] = [];
	const diagnostics: SystemComponentUsageScanDiagnostic[] = [];

	for (const [boardIndex, board] of design.boards.entries()) {
		collectNodeAttachedInstanceUsages(
			board,
			`boards[${boardIndex}]`,
			{
				...context,
				systemName: design.systemName ?? design.systemId ?? null,
			},
			instances,
			diagnostics,
		);
	}

	return { instances, diagnostics };
};

export const getSystemComponentInstanceVersionStatus = (
	usage: Pick<
		SystemComponentInstanceUsage,
		"componentId" | "version" | "templateHash" | "variantSchemaHash"
	>,
	manifest: SystemComponentManifest | null,
): SystemComponentInstanceVersionStatus | undefined => {
	if (!manifest) {
		return undefined;
	}

	const record = manifest.components[usage.componentId];
	if (!record) {
		return {
			status: "missing-component",
			message: `Attached instance references unknown component "${usage.componentId}".`,
			componentId: usage.componentId,
			instanceVersion: usage.version,
			templateHash: usage.templateHash,
			variantSchemaHash: usage.variantSchemaHash,
			reasons: [],
		};
	}

	const currentVersion = record.published?.currentVersion;
	const publishedVersion = record.published?.versions[usage.version];
	if (!publishedVersion) {
		return {
			status: "missing-version",
			message: `Attached instance references unknown published version "${usage.version}" for component "${usage.componentId}".`,
			componentId: usage.componentId,
			instanceVersion: usage.version,
			currentVersion,
			templateHash: usage.templateHash,
			variantSchemaHash: usage.variantSchemaHash,
			reasons: [],
		};
	}

	const hashReasons: Array<"template-hash" | "variant-schema-hash"> = [];
	if (usage.templateHash !== publishedVersion.templateHash) {
		hashReasons.push("template-hash");
	}
	if (usage.variantSchemaHash !== publishedVersion.variantSchemaHash) {
		hashReasons.push("variant-schema-hash");
	}
	if (hashReasons.length > 0) {
		return {
			status: "hash-mismatch",
			message: `Attached instance hash metadata does not match published version "${usage.version}" for component "${usage.componentId}".`,
			componentId: usage.componentId,
			instanceVersion: usage.version,
			currentVersion,
			publishedVersion: publishedVersion.version,
			templateHash: usage.templateHash,
			expectedTemplateHash: publishedVersion.templateHash,
			variantSchemaHash: usage.variantSchemaHash,
			expectedVariantSchemaHash: publishedVersion.variantSchemaHash,
			reasons: hashReasons,
		};
	}

	if (currentVersion && usage.version !== currentVersion) {
		return {
			status: "stale",
			message: `Attached instance uses version "${usage.version}" but current published version is "${currentVersion}" for component "${usage.componentId}".`,
			componentId: usage.componentId,
			instanceVersion: usage.version,
			currentVersion,
			publishedVersion: publishedVersion.version,
			templateHash: usage.templateHash,
			expectedTemplateHash: publishedVersion.templateHash,
			variantSchemaHash: usage.variantSchemaHash,
			expectedVariantSchemaHash: publishedVersion.variantSchemaHash,
			reasons: ["version"],
		};
	}

	return {
		status: "current",
		message: `Attached instance uses current published version "${usage.version}" for component "${usage.componentId}".`,
		componentId: usage.componentId,
		instanceVersion: usage.version,
		currentVersion,
		publishedVersion: publishedVersion.version,
		templateHash: usage.templateHash,
		expectedTemplateHash: publishedVersion.templateHash,
		variantSchemaHash: usage.variantSchemaHash,
		expectedVariantSchemaHash: publishedVersion.variantSchemaHash,
		reasons: [],
	};
};

export type { SystemComponentInstanceVersionStatusKind };
