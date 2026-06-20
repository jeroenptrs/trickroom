import { queryOptions } from "@tanstack/react-query";
import { HttpError, readJsonOrThrow } from "../utils/readJsonOrThrow";
import type {
	TailwindColorTokenBaselineDiff,
	TailwindTokensForPresentation,
} from "../utils/tailwind-color-tokens";
import type { TailwindMeaningfulColorBaselineDiff } from "../utils/tailwind-token-store";

export type TailwindSyncTokensRequest =
	| {
			systemName: string;
	  }
	| {
			cssPath: string;
	  };

/**
 * Sync responses can carry presentation-specific fields (status, presentation
 * tokens, the full baseline diff) that are not part of the canonical stored
 * snapshot. They reflect the result of a sync operation, not the persisted
 * state.
 */
export type TailwindSyncTokensResponse = {
	status: "ok" | "updated";
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: TailwindTokensForPresentation;
	baselineDiff: TailwindColorTokenBaselineDiff;
	syncedAt: string;
	reviewRequired: boolean;
};

/**
 * GET response mirrors the canonical stored snapshot. The route flattens the
 * metadata fields onto the top-level response, but the meaning is identical to
 * `TailwindTokenStorageV2`.
 */
export type StoredTailwindTokensResponse = {
	ok: true;
	systemName: string;
	cssPath: string;
	syncedAt: string;
	tailwindBaselineVersion: string;
	reviewRequired: boolean;
	domains: {
		color: {
			tokens: Record<string, string>;
			overrides: string[];
			baselineDiff: TailwindMeaningfulColorBaselineDiff;
		};
	};
};

export type SaveAndConfirmTailwindTokensRequest = {
	systemName: string;
	domains: {
		color: {
			overrides: string[];
		};
	};
};

export const syncTailwindTokens = async (
	request: TailwindSyncTokensRequest,
) => {
	const response = await fetch("/api/trickroom/tailwind/sync-tokens", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request),
	});
	return readJsonOrThrow<TailwindSyncTokensResponse>(response);
};

export const storedTailwindTokensQueryKey = (systemName: string) => [
	"trickroom-tailwind-tokens",
	systemName,
];

export const getStoredTailwindTokens = async (systemName: string) => {
	const response = await fetch(
		`/api/trickroom/tailwind/systems/${encodeURIComponent(systemName)}/tokens`,
	);

	try {
		return await readJsonOrThrow<StoredTailwindTokensResponse>(response);
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) {
			return null;
		}

		throw error;
	}
};

/**
 * Save and confirm overrides for a system. Persists override selections,
 * preserves synced token/diff data, and clears the server-side
 * `reviewRequired` flag.
 */
export const saveAndConfirmTailwindTokens = async ({
	systemName,
	domains,
}: SaveAndConfirmTailwindTokensRequest) => {
	const response = await fetch(
		`/api/trickroom/tailwind/systems/${encodeURIComponent(systemName)}/tokens`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ domains }),
		},
	);

	return readJsonOrThrow<StoredTailwindTokensResponse>(response);
};

export const storedTailwindTokensQueryOptions = (systemName: string) =>
	queryOptions({
		queryKey: storedTailwindTokensQueryKey(systemName),
		queryFn: () => getStoredTailwindTokens(systemName),
	});
