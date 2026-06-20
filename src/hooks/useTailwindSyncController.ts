import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	syncTailwindTokens,
	type TailwindSyncTokensResponse,
} from "../queries/tailwind-sync-tokens";
import type { TrickroomConfig } from "../types";

export type TailwindSyncStatus = "idle" | "pending" | "success" | "updated" | "error";

export type TailwindSystemTarget = {
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
	isIdle: boolean;
	isPending: boolean;
	isSuccess: boolean;
	isPartialError: boolean;
	isError: boolean;
	syncAll: () => Promise<void>;
	syncSystem: (systemName: string) => Promise<void>;
};

export function buildOrderedSystems(
	config: TrickroomConfig | undefined,
): TailwindSystemTarget[] {
	return Object.entries(config?.systems ?? {}).flatMap(([systemName, cssPath]) => {
		const trimmedSystemName = systemName.trim();
		const trimmedCssPath = cssPath.trim();
		if (!trimmedSystemName || !trimmedCssPath) {
			return [];
		}

		return [
			{
				systemName: trimmedSystemName,
				cssPath: trimmedCssPath,
			},
		];
	});
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
	config: TrickroomConfig | undefined,
): TailwindSyncController {
	const systems = useMemo(() => buildOrderedSystems(config), [config]);

	const [results, setResults] = useState<Record<string, TailwindSyncResult>>({});

	const statusBySystem = useMemo(() => {
		const nextStatuses: Record<string, TailwindSyncStatus> = {};

		for (const { systemName } of systems) {
			nextStatuses[systemName] = results[systemName]?.status ?? "idle";
		}

		return nextStatuses;
	}, [results, systems]);

	const syncSystem = useCallback(
		async (systemName: string) => {
			const target = systems.find((system) => system.systemName === systemName);
			if (!target) {
				return;
			}

			setResults((current) => ({
				...current,
				[systemName]: {
					status: "pending",
				},
			}));

			try {
				const data = await syncTailwindTokens({ systemName });
				setResults((current) => ({
					...current,
					[systemName]: {
						status: data.status === "updated" ? "updated" : "success",
						data,
					},
				}));
			} catch (error) {
				const normalizedError =
					error instanceof Error ? error : new Error("Failed to sync system");
				setResults((current) => ({
					...current,
					[systemName]: {
						status: "error",
						error: normalizedError,
					},
				}));
			}
		},
		[systems],
	);
	const syncAll = useCallback(async () => {
		for (const { systemName } of systems) {
			await syncSystem(systemName);
		}
	}, [syncSystem, systems]);

	const syncedSystemsFingerprintRef = useRef<string | null>(null);
	const systemsFingerprint = useMemo(
		() =>
			systems
				.map(({ systemName, cssPath }) => `${systemName}\0${cssPath}`)
				.join("\0"),
		[systems],
	);

	useEffect(() => {
		if (!systemsFingerprint || syncedSystemsFingerprintRef.current === systemsFingerprint) {
			return;
		}

		syncedSystemsFingerprintRef.current = systemsFingerprint;
		void syncAll();
	}, [syncAll, systemsFingerprint]);

	return {
		statusBySystem,
		results,
		...deriveTailwindSyncFlags(statusBySystem),
		syncAll,
		syncSystem,
	};
}
