import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { Node, RecipeTemplateNode } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import type { SystemComponentManifestRevision } from "../utils/system-component-manifest-service.types";
import type { SystemComponentSummary } from "../utils/system-component-operations.types";
import type {
	SystemComponentDraftPayload,
	SystemComponentOverrideTarget,
	SystemComponentRecord,
	SystemComponentSlotDefinition,
	SystemComponentVariantSchema,
} from "../utils/system-components";
import type { SystemComponentManifestDiagnostic } from "../utils/system-components-validation.types";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemComponentsListResponse = {
	systemId: string;
	systemName: string;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	settings: {
		autoMigrateComponents: boolean;
	};
	components: SystemComponentSummary[];
};

export type SystemComponentDescribeResponse = {
	systemId: string;
	systemName: string;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	componentId: string;
	record: SystemComponentRecord;
	draftTemplateHash?: string;
	draftVariantSchemaHash?: string;
	diagnostics: SystemComponentManifestDiagnostic[];
	valid: boolean;
};

export type SystemComponentExpansionResponse = {
	systemId: string;
	systemName: string;
	componentId: string;
	version: string;
	root: Node;
};

export type SystemComponentMutationResponse = {
	systemId: string;
	systemName: string;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	componentId: string;
	publishedVersion?: string;
};

export type SystemComponentSettingsMutationResponse = {
	systemId: string;
	systemName: string;
	revision: SystemComponentManifestRevision;
	updatedAt: string;
	settings: {
		autoMigrateComponents: boolean;
	};
};

export type UpdateSystemComponentSettingsParams = {
	expectedRevision: SystemComponentManifestRevision;
	autoMigrateComponents: boolean;
};

export type CreateSystemComponentDraftParams = {
	expectedRevision: SystemComponentManifestRevision;
	slug: string;
	name: string;
	description?: string;
	group?: string;
	order?: number;
	draft?: Partial<SystemComponentDraftPayload>;
};

export type UpdateSystemComponentMetadataParams = {
	expectedRevision: SystemComponentManifestRevision;
	name?: string;
	slug?: string;
	description?: string | null;
	group?: string | null;
	order?: number | null;
};

export type UpdateSystemComponentTemplateParams = {
	expectedRevision: SystemComponentManifestRevision;
	expectedDraftTemplateHash?: string;
	root: RecipeTemplateNode;
};

export type UpdateSystemComponentDraftParams = {
	expectedRevision: SystemComponentManifestRevision;
	expectedDraftTemplateHash?: string;
	expectedDraftVariantSchemaHash?: string;
	root?: RecipeTemplateNode;
	slots?: Record<string, SystemComponentSlotDefinition> | null;
	variants?: SystemComponentVariantSchema | null;
	overrideTargets?: Record<string, SystemComponentOverrideTarget> | null;
};

export type UpdateSystemComponentSlotsParams = {
	expectedRevision: SystemComponentManifestRevision;
	slots?: Record<string, SystemComponentSlotDefinition> | null;
};

export type UpdateSystemComponentVariantsParams = {
	expectedRevision: SystemComponentManifestRevision;
	variants?: SystemComponentVariantSchema | null;
};

export type UpdateSystemComponentOverrideTargetsParams = {
	expectedRevision: SystemComponentManifestRevision;
	overrideTargets?: Record<string, SystemComponentOverrideTarget> | null;
};

export type PublishSystemComponentParams = {
	expectedRevision: SystemComponentManifestRevision;
};

export type CopyPublishedSystemComponentToDraftParams = {
	expectedRevision: SystemComponentManifestRevision;
	versionId?: string;
};

const systemComponentsBasePath = (systemId: string) =>
	`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`;

const fetchSystemComponents = async (systemId: string) => {
	const response = await fetch(systemComponentsBasePath(systemId));
	return readJsonOrThrow<SystemComponentsListResponse>(response);
};

const fetchSystemComponent = async (systemId: string, componentId: string) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}`,
	);
	return readJsonOrThrow<SystemComponentDescribeResponse>(response);
};

export const expandSystemComponent = async (
	systemId: string,
	componentId: string,
	version: string,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/versions/${encodeURIComponent(version)}/expand`,
	);
	return readJsonOrThrow<SystemComponentExpansionResponse>(response);
};

export const createSystemComponentDraft = async (
	systemId: string,
	params: CreateSystemComponentDraftParams,
) => {
	const response = await fetch(systemComponentsBasePath(systemId), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(params),
	});
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentSettings = async (
	systemId: string,
	params: UpdateSystemComponentSettingsParams,
) => {
	const response = await fetch(`${systemComponentsBasePath(systemId)}/settings`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(params),
	});
	return readJsonOrThrow<SystemComponentSettingsMutationResponse>(response);
};

export const updateSystemComponentMetadata = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentMetadataParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/metadata`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentTemplate = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentTemplateParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/template`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentDraft = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentDraftParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/draft`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentSlots = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentSlotsParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/slots`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentVariants = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentVariantsParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/variants`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const updateSystemComponentOverrideTargets = async (
	systemId: string,
	componentId: string,
	params: UpdateSystemComponentOverrideTargetsParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/override-targets`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const publishSystemComponent = async (
	systemId: string,
	componentId: string,
	params: PublishSystemComponentParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/publish`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const copyPublishedSystemComponentToDraft = async (
	systemId: string,
	componentId: string,
	params: CopyPublishedSystemComponentToDraftParams,
) => {
	const response = await fetch(
		`${systemComponentsBasePath(systemId)}/${encodeURIComponent(componentId)}/draft-from-published`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<SystemComponentMutationResponse>(response);
};

export const systemComponentsQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-system-components", systemId],
		projectScope,
	);

export const systemComponentQueryKey = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-system-component", systemId, componentId],
		projectScope,
	);

export const systemComponentsQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemComponentsQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemComponents(systemId),
		retry: false,
	});

export const systemComponentQueryOptions = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemComponentQueryKey(systemId, componentId, projectScope),
		queryFn: () => fetchSystemComponent(systemId, componentId),
		retry: false,
	});

export const invalidateSystemComponents = async (
	queryClient: QueryClient,
	systemId: string,
	projectScope?: ProjectQueryScope,
	componentId?: string,
) => {
	await queryClient.invalidateQueries({
		queryKey: systemComponentsQueryKey(systemId, projectScope),
	});
	if (componentId) {
		await queryClient.invalidateQueries({
			queryKey: systemComponentQueryKey(systemId, componentId, projectScope),
		});
	}
};

export type { SystemComponentSummary };
