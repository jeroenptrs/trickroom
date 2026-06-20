import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import type {
	SystemComponentInstanceUsage,
	SystemComponentInstanceVersionStatusKind,
	SystemComponentMigrationPolicyPrompt,
	SystemComponentUsageScanDiagnostic,
} from "../utils/system-component-usage-scan.types";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemComponentUsedByResponse = {
	systemId: string;
	systemName: string;
	componentId: string;
	usedByCount: number;
};

export type SystemComponentUsageResponse = {
	systemId?: string;
	systemName?: string;
	componentId?: string;
	instances: SystemComponentInstanceUsage[];
	diagnostics: SystemComponentUsageScanDiagnostic[];
	usedByCount: number;
	scannedDesignCount: number;
	statusCounts: Record<SystemComponentInstanceVersionStatusKind, number>;
	migrationPolicyPrompt?: SystemComponentMigrationPolicyPrompt;
};

export type DesignSystemComponentUsageResponse =
	SystemComponentUsageResponse & {
		designFile?: string;
	};

const fetchSystemComponentUsedBy = async (
	systemId: string,
	componentId: string,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(componentId)}/used-by`,
	);
	return readJsonOrThrow<SystemComponentUsedByResponse>(response);
};

const fetchSystemComponentUsage = async (
	systemId: string,
	componentId: string,
	options: { version?: string; designFileId?: string } = {},
) => {
	const params = new URLSearchParams();
	if (options.version) {
		params.set("version", options.version);
	}
	if (options.designFileId) {
		params.set("designFileId", options.designFileId);
	}
	const query = params.toString();
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(componentId)}/usage${query ? `?${query}` : ""}`,
	);
	return readJsonOrThrow<SystemComponentUsageResponse>(response);
};

const fetchSystemComponentsUsage = async (
	systemId: string,
	options: { version?: string; designFileId?: string } = {},
) => {
	const params = new URLSearchParams();
	if (options.version) {
		params.set("version", options.version);
	}
	if (options.designFileId) {
		params.set("designFileId", options.designFileId);
	}
	const query = params.toString();
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/usage${query ? `?${query}` : ""}`,
	);
	return readJsonOrThrow<SystemComponentUsageResponse>(response);
};

export const fetchDesignSystemComponentUsage = async (
	designFile: string,
	options: {
		systemId?: string;
		componentId?: string;
		version?: string;
	} = {},
) => {
	const params = new URLSearchParams({ file: designFile });
	if (options.systemId) {
		params.set("systemId", options.systemId);
	}
	if (options.componentId) {
		params.set("componentId", options.componentId);
	}
	if (options.version) {
		params.set("version", options.version);
	}
	const response = await fetch(
		`/api/trickroom/design/system-component-usage?${params.toString()}`,
	);
	return readJsonOrThrow<DesignSystemComponentUsageResponse>(response);
};

export const systemComponentUsedByQueryKey = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-system-component-used-by", systemId, componentId],
		projectScope,
	);

export const systemComponentUsageQueryKey = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
	options: { version?: string; designFileId?: string } = {},
) =>
	withProjectQueryScope(
		[
			"trickroom-system-component-usage",
			systemId,
			componentId,
			options.version ?? null,
			options.designFileId ?? null,
		],
		projectScope,
	);

export const systemComponentsUsageQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
	options: { version?: string; designFileId?: string } = {},
) =>
	withProjectQueryScope(
		[
			"trickroom-system-components-usage",
			systemId,
			options.version ?? null,
			options.designFileId ?? null,
		],
		projectScope,
	);

export const designSystemComponentUsageQueryKey = (
	designFile: string,
	projectScope?: ProjectQueryScope,
	options: { systemId?: string; componentId?: string; version?: string } = {},
) =>
	withProjectQueryScope(
		[
			"trickroom-design-system-component-usage",
			designFile,
			options.systemId ?? null,
			options.componentId ?? null,
			options.version ?? null,
		],
		projectScope,
	);

export const systemComponentUsedByQueryOptions = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemComponentUsedByQueryKey(
			systemId,
			componentId,
			projectScope,
		),
		queryFn: () => fetchSystemComponentUsedBy(systemId, componentId),
		retry: false,
	});

export const systemComponentUsageQueryOptions = (
	systemId: string,
	componentId: string,
	projectScope?: ProjectQueryScope,
	options: { version?: string; designFileId?: string } = {},
) =>
	queryOptions({
		queryKey: systemComponentUsageQueryKey(
			systemId,
			componentId,
			projectScope,
			options,
		),
		queryFn: () => fetchSystemComponentUsage(systemId, componentId, options),
		retry: false,
	});

export const systemComponentsUsageQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
	options: { version?: string; designFileId?: string } = {},
) =>
	queryOptions({
		queryKey: systemComponentsUsageQueryKey(systemId, projectScope, options),
		queryFn: () => fetchSystemComponentsUsage(systemId, options),
		retry: false,
	});

export const designSystemComponentUsageQueryOptions = (
	designFile: string,
	projectScope?: ProjectQueryScope,
	options: { systemId?: string; componentId?: string; version?: string } = {},
) =>
	queryOptions({
		queryKey: designSystemComponentUsageQueryKey(
			designFile,
			projectScope,
			options,
		),
		queryFn: () => fetchDesignSystemComponentUsage(designFile, options),
		retry: false,
	});
