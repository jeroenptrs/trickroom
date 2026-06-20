import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectQueryScope } from "../queries/project-scope";
import type { SystemSummary } from "../queries/systems";
import {
	syncTailwindTokens,
	type TailwindSyncTokensResponse,
} from "../queries/tailwind-sync-tokens";
import type { TrickroomConfig } from "../types";

export type TailwindSyncStatus =
	| "idle"
	| "pending"
	| "success"
	| "updated"
	| "error";

export type TailwindSystemTarget = {
	systemId: string;
	systemName: string;
	cssPath: string;
};

export type TailwindSyncResult = {
	status: TailwindSyncStatus;
	data?: TailwindSyncTokensResponse;
	error?: Error;
};

export type TailwindSyncController = {
	statusBySystem: Record<string, TailwindSyncStatus>;
	results: Record<string, TailwindSyncResult>;
	systems: TailwindSystemTarget[];
	targetsById: Record<string, TailwindSystemTarget>;
	isIdle: boolean;
	isPending: boolean;
	isSuccess: boolean;
	isPartialError: boolean;
	isError: boolean;
	syncAll: () => Promise<void>;
	syncSystem: (systemId: string) => Promise<void>;
};

export function buildOrderedSystems(
	systemsOrConfig: SystemSummary[] | TrickroomConfig | undefined,
): TailwindSystemTarget[] {
	if (Array.isArray(systemsOrConfig)) {
		return systemsOrConfig.flatMap((system) => {
			const systemId = system.systemId.trim();
			const systemName = system.systemName.trim();
			const cssPath = system.cssPath?.trim() ?? "";
			if (!systemId || !systemName || !cssPath) {
				return [];
			}

			return [{ systemId, systemName, cssPath }];
		});
	}

	return Object.entries(systemsOrConfig?.systems ?? {}).flatMap(
		([systemName, cssPath]) => {
			const trimmedSystemName = systemName.trim();
			const trimmedCssPath = cssPath.trim();
			if (!trimmedSystemName || !trimmedCssPath) {
				return [];
			}

			return [
				{
					systemId: trimmedSystemName,
					systemName: trimmedSystemName,
					cssPath: trimmedCssPath,
				},
			];
		},
	);
}

export function deriveTailwindSyncFlags(
	statusBySystem: Record<string, TailwindSyncStatus>,
) {
	const statuses = Object.values(statusBySystem);
	if (statuses.length === 0) {
		return {
			isIdle: true,
			isPending: false,
			isSuccess: false,
			isPartialError: false,
			isError: false,
		};
	}

	const pendingCount = statuses.filter((status) => status === "pending").length;
	const successCount = statuses.filter(
		(status) => status === "success" || status === "updated",
	).length;
	const errorCount = statuses.filter((status) => status === "error").length;
	const idleCount = statuses.filter((status) => status === "idle").length;

	return {
		isIdle: idleCount === statuses.length,
		isPending: pendingCount > 0,
		isSuccess: successCount === statuses.length,
		isPartialError: errorCount > 0 && successCount > 0,
		isError: errorCount > 0 && successCount === 0 && pendingCount === 0,
	};
}

export function useTailwindSyncController(
	systemsOrConfig: SystemSummary[] | TrickroomConfig | undefined,
	projectScope?: ProjectQueryScope,
): TailwindSyncController {
	const systems = useMemo(
		() => buildOrderedSystems(systemsOrConfig),
		[systemsOrConfig],
	);

	const normalizedProjectScope =
		typeof projectScope === "string" ? projectScope.trim() : "";
	const [resultsState, setResultsState] = useState<{
		projectScope: string;
		results: Record<string, TailwindSyncResult>;
	}>({
		projectScope: normalizedProjectScope,
		results: {},
	});
	const results =
		resultsState.projectScope === normalizedProjectScope
			? resultsState.results
			: {};
	const setScopedResults = useCallback(
		(
			updater: (
				current: Record<string, TailwindSyncResult>,
			) => Record<string, TailwindSyncResult>,
		) => {
			setResultsState((current) => {
				if (current.projectScope !== normalizedProjectScope) {
					return current;
				}

				return {
					projectScope: normalizedProjectScope,
					results: updater(current.results),
				};
			});
		},
		[normalizedProjectScope],
	);

	useEffect(() => {
		setResultsState((current) =>
			current.projectScope === normalizedProjectScope
				? current
				: { projectScope: normalizedProjectScope, results: {} },
		);
	}, [normalizedProjectScope]);

	const statusBySystem = useMemo(() => {
		const nextStatuses: Record<string, TailwindSyncStatus> = {};

		for (const { systemId } of systems) {
			nextStatuses[systemId] = results[systemId]?.status ?? "idle";
		}

		return nextStatuses;
	}, [results, systems]);

	const syncSystem = useCallback(
		async (systemId: string) => {
			const target = systems.find((system) => system.systemId === systemId);
			if (!target) {
				return;
			}

			setScopedResults((current) => ({
				...current,
				[target.systemId]: {
					status: "pending",
				},
			}));

			try {
				const data = await syncTailwindTokens({ systemId: target.systemId });
				setScopedResults((current) => ({
					...current,
					[target.systemId]: {
						status: data.status === "updated" ? "updated" : "success",
						data,
					},
				}));
			} catch (error) {
				const normalizedError =
					error instanceof Error ? error : new Error("Failed to sync system");
				setScopedResults((current) => ({
					...current,
					[target.systemId]: {
						status: "error",
						error: normalizedError,
					},
				}));
			}
		},
		[setScopedResults, systems],
	);
	const syncAll = useCallback(async () => {
		for (const { systemId } of systems) {
			await syncSystem(systemId);
		}
	}, [syncSystem, systems]);

	const syncedSystemsFingerprintRef = useRef<string | null>(null);
	const systemsFingerprint = useMemo(
		() =>
			[
				normalizedProjectScope,
				...systems.map(
					({ systemId, systemName, cssPath }) =>
						`${systemId}\0${systemName}\0${cssPath}`,
				),
			].join("\0"),
		[normalizedProjectScope, systems],
	);

	useEffect(() => {
		if (
			!systemsFingerprint ||
			syncedSystemsFingerprintRef.current === systemsFingerprint
		) {
			return;
		}

		syncedSystemsFingerprintRef.current = systemsFingerprint;
		void syncAll();
	}, [syncAll, systemsFingerprint]);

	return {
		statusBySystem,
		results,
		systems,
		targetsById: Object.fromEntries(
			systems.map((system) => [system.systemId, system]),
		),
		...deriveTailwindSyncFlags(statusBySystem),
		syncAll,
		syncSystem,
	};
}
