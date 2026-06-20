import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { DesignFileSummary } from "../services/design-file-service";
import { createDesignFileService } from "../services/design-file-service";
import type {
	Node as DesignNode,
	RegistryComponentDefinition,
	TrickroomDesign,
} from "../types";
import { normalizeAssetId } from "./asset-manifest-service";
import {
	findDesignSystem,
	resolveDesignSystemSafeKey,
} from "./design-system-store";
import { normalizeIconId } from "./icon-manifest-service";
import { assetIdProp, iconIdProp } from "./resource-props";

export { assetIdProp, iconIdProp } from "./resource-props";

export type DesignResourceKind = "asset" | "icon";

export type DesignResourceReference = {
	kind: DesignResourceKind;
	resourceId: string | null;
	allowsBlank: boolean;
	elementId: string;
	path: string;
};

export type DesignResourceUsage = {
	designFileId: string;
	designName: string;
	systemId?: string | null;
	systemName: string | null;
	elementId: string;
	path: string;
	resourceId: string | null;
};

export type LinkedSystemDesign = DesignFileSummary;

export function getResourceKindForComponent(
	library: string,
	component: string,
): DesignResourceKind | null {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		return null;
	}

	for (const { kind, prop } of resourceKindProps) {
		if (componentDeclaresResourceProp(resolution.definition, prop)) {
			return kind;
		}
	}

	return null;
}

const resourceKindProps = [
	{ kind: "asset", prop: assetIdProp },
	{ kind: "icon", prop: iconIdProp },
] as const satisfies ReadonlyArray<{
	kind: DesignResourceKind;
	prop: string;
}>;

function componentDeclaresResourceProp(
	definition: RegistryComponentDefinition,
	prop: string,
) {
	if (
		Object.hasOwn(definition.defaultProps ?? {}, prop) ||
		getControlDefinitions(definition).some((control) => control.prop === prop)
	) {
		return true;
	}

	return false;
}

export function getResourceIdProp(kind: DesignResourceKind) {
	return kind === "asset" ? assetIdProp : iconIdProp;
}

export function componentAllowsBlankResourceId(
	library: string,
	component: string,
	kind: DesignResourceKind,
) {
	return (
		kind === "asset" && library === "base-ui" && component === "avatar.image"
	);
}

export function collectDesignResourceReferences(
	design: TrickroomDesign,
): DesignResourceReference[] {
	const references: DesignResourceReference[] = [];

	for (const [rootIndex, board] of design.boards.entries()) {
		collectNodeResourceReferences(board, `boards[${rootIndex}]`, references);
	}

	return references;
}

export async function findProjectResourceUsage(
	projectRoot: string,
	kind: DesignResourceKind,
	systemHandle: string,
	resourceId?: string,
	options: {
		allowedDesignFileIds?: ReadonlySet<string> | null;
	} = {},
): Promise<DesignResourceUsage[]> {
	const service = createDesignFileService(projectRoot);
	const system = await findDesignSystem(projectRoot, systemHandle);
	const summaries = await findProjectSystemDesigns(projectRoot, systemHandle);
	const usages: DesignResourceUsage[] = [];
	const normalizedFilter =
		resourceId === undefined
			? undefined
			: normalizeResourceReferenceId(kind, resourceId);

	for (const summary of summaries) {
		if (
			options.allowedDesignFileIds &&
			!options.allowedDesignFileIds.has(summary.uuid)
		) {
			continue;
		}

		const read = await service.readDesignFile(summary.file);
		for (const reference of collectDesignResourceReferences(read.design)) {
			if (reference.kind !== kind) {
				continue;
			}

			if (
				normalizedFilter !== undefined &&
				reference.resourceId !== normalizedFilter
			) {
				continue;
			}

			usages.push({
				designFileId: summary.uuid,
				designName: summary.name,
				systemId: read.design.systemId ?? system?.manifest.systemId ?? null,
				systemName:
					read.design.systemName ?? system?.manifest.systemName ?? null,
				elementId: reference.elementId,
				path: reference.path,
				resourceId: reference.resourceId,
			});
		}
	}

	return usages;
}

export function designReferencesSystemHandle(
	design: Pick<TrickroomDesign | DesignFileSummary, "systemId" | "systemName">,
	systemHandle: string,
	system: Awaited<ReturnType<typeof findDesignSystem>>,
): boolean {
	if (design.systemId !== undefined) {
		return design.systemId === systemHandle;
	}

	const summarySystemName = design.systemName ?? null;
	if (!system) {
		return summarySystemName === systemHandle;
	}

	const legacySystemNames = new Set([
		system.manifest.systemName,
		...(system.manifest.previousSystemNames ?? []),
	]);
	return (
		summarySystemName !== null &&
		(legacySystemNames.has(summarySystemName) ||
			safeSystemNameMatchesStorageKey(summarySystemName, system.storageKey))
	);
}

export async function findProjectSystemDesigns(
	projectRoot: string,
	systemHandle: string,
): Promise<LinkedSystemDesign[]> {
	const service = createDesignFileService(projectRoot);
	const summaries = await service.listDesignSummaries();
	const system = await findDesignSystem(projectRoot, systemHandle);

	return summaries.filter((summary) =>
		designReferencesSystemHandle(summary, systemHandle, system),
	);
}

function safeSystemNameMatchesStorageKey(
	systemName: string,
	storageKey: string,
) {
	try {
		return resolveDesignSystemSafeKey(systemName) === storageKey;
	} catch {
		return false;
	}
}

function collectNodeResourceReferences(
	node: DesignNode,
	path: string,
	references: DesignResourceReference[],
) {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	const kind = getResourceKindForComponent(library, component);
	if (kind) {
		const rawResourceId = node.props[getResourceIdProp(kind)];
		const resourceId =
			typeof rawResourceId === "string" && rawResourceId.trim().length > 0
				? normalizeResourceReferenceId(kind, rawResourceId)
				: null;
		references.push({
			kind,
			resourceId,
			allowsBlank: componentAllowsBlankResourceId(library, component, kind),
			elementId: node.id,
			path,
		});
	}

	if (!Array.isArray(node.children)) {
		return;
	}

	for (const [childIndex, child] of node.children.entries()) {
		collectNodeResourceReferences(
			child,
			`${path}.children[${childIndex}]`,
			references,
		);
	}
}

function normalizeResourceReferenceId(
	kind: DesignResourceKind,
	resourceId: string,
): string {
	try {
		return kind === "asset"
			? normalizeAssetId(resourceId)
			: normalizeIconId(resourceId);
	} catch {
		return resourceId.trim();
	}
}
