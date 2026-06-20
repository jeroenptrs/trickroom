import type { DesignEntity } from "../../stores/design-store";
import { isSystemComponentRootStale } from "../../utils/system-component-markers";
import {
	getContainingSystemComponentSlot,
	getElementSystemComponentMetadata,
	getSystemComponentInstanceMetadata,
	isSystemComponentOwnedStructuralNode,
	isSystemComponentRoot,
	type SystemComponentBoundaryEntityMap,
	type SystemComponentInstanceMetadata,
	type SystemComponentSlotContainment,
} from "../../utils/system-component-ownership";
import type {
	PublishedSystemComponentVersion,
	SystemComponentRecord,
} from "../../utils/system-components";

export type AttachedComponentInspection =
	| { kind: "none" }
	| {
			kind: "root";
			instance: SystemComponentInstanceMetadata;
			rootElementId: string;
	  }
	| {
			kind: "owned-internal";
			instance: SystemComponentInstanceMetadata;
			rootElementId: string;
			templatePath: string;
			slotName: string | null;
	  }
	| {
			kind: "slot-content";
			slot: SystemComponentSlotContainment;
	  };

export const getAttachedComponentInspection = (
	entitiesById: SystemComponentBoundaryEntityMap,
	selectedElement: DesignEntity | null,
): AttachedComponentInspection => {
	if (!selectedElement) {
		return { kind: "none" };
	}

	const metadata = getElementSystemComponentMetadata(selectedElement);
	if (metadata) {
		const instance = getSystemComponentInstanceMetadata(
			entitiesById,
			selectedElement.id,
		);
		if (!instance?.rootId) {
			return { kind: "none" };
		}

		if (metadata.isRoot) {
			return {
				kind: "root",
				instance,
				rootElementId: instance.rootId,
			};
		}

		return {
			kind: "owned-internal",
			instance,
			rootElementId: instance.rootId,
			templatePath: metadata.path,
			slotName: metadata.slotName,
		};
	}

	const slot = getContainingSystemComponentSlot(
		entitiesById,
		selectedElement.id,
	);
	if (slot) {
		return { kind: "slot-content", slot };
	}

	return { kind: "none" };
};

export const canFreelyEditElementInDesignInspector = (
	_entitiesById: SystemComponentBoundaryEntityMap,
	element: DesignEntity | null,
) => {
	if (!element) {
		return true;
	}
	return !isSystemComponentOwnedStructuralNode(element);
};

export const getPublishedVersionForInstance = (
	record: SystemComponentRecord | undefined,
	versionId: string,
): PublishedSystemComponentVersion | null =>
	record?.published?.versions[versionId] ?? null;

export const getCurrentPublishedVersionForInstance = (
	record: SystemComponentRecord | undefined,
): PublishedSystemComponentVersion | null => {
	const currentVersionId = record?.published?.currentVersion;
	return currentVersionId
		? (record?.published?.versions[currentVersionId] ?? null)
		: null;
};

export type AttachedComponentVersionStatus =
	| "current"
	| "stale-version"
	| "stale-template"
	| "stale-variants"
	| "stale-both"
	| "missing-component"
	| "missing-version"
	| "unknown";

export const getAttachedComponentVersionStatus = (
	rootProps: DesignEntity["props"],
	publishedVersion: PublishedSystemComponentVersion | null,
	currentVersionId?: string | null,
): AttachedComponentVersionStatus => {
	if (!publishedVersion) {
		return "unknown";
	}

	const templateStale = isSystemComponentRootStale(rootProps, {
		templateHash: publishedVersion.templateHash,
	});
	const variantStale = isSystemComponentRootStale(rootProps, {
		variantSchemaHash: publishedVersion.variantSchemaHash,
	});

	if (templateStale && variantStale) {
		return "stale-both";
	}
	if (templateStale) {
		return "stale-template";
	}
	if (variantStale) {
		return "stale-variants";
	}

	if (currentVersionId && publishedVersion.version !== currentVersionId) {
		return "stale-version";
	}

	return "current";
};

export const isAttachedComponentStaleStatus = (
	status: AttachedComponentVersionStatus,
) =>
	status === "stale-version" ||
	status === "stale-template" ||
	status === "stale-variants" ||
	status === "stale-both";

export const attachedComponentVersionStatusLabel = (
	status: AttachedComponentVersionStatus,
) => {
	switch (status) {
		case "current":
			return "Up to date";
		case "stale-version":
			return "Update available";
		case "stale-template":
			return "Template changed";
		case "stale-variants":
			return "Variants changed";
		case "stale-both":
			return "Template and variants changed";
		case "missing-component":
			return "Component missing";
		case "missing-version":
			return "Published version missing";
		case "unknown":
			return "Published version unavailable";
	}
};

export const isAttachedComponentRootSelected = (
	_entitiesById: SystemComponentBoundaryEntityMap,
	selectedElement: DesignEntity | null,
) => !!selectedElement && isSystemComponentRoot(selectedElement);
