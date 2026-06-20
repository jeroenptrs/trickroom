import { queryOptions } from "@tanstack/react-query";
import { HttpError, readJsonOrThrow } from "../utils/readJsonOrThrow";
import type {
	TailwindColorTokenBaselineDiff,
	TailwindTokensForPresentation,
} from "../utils/tailwind-color-tokens";
import type {
	TailwindMeaningfulTokenBaselineDiff,
	TailwindTokenDomain,
	TailwindTokenDomainDiffs,
} from "../utils/tailwind-token-domains";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type TailwindSyncTokensRequest =
	| {
			systemId: string;
	  }
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
	systemId: string;
	systemName: string;
	cssPath: string;
	tailwindBaselineVersion: string;
	tokens: TailwindTokensForPresentation;
	baselineDiff: TailwindColorTokenBaselineDiff;
	baselineDiffs: TailwindTokenDomainDiffs;
	syncedAt: string;
	reviewRequired: boolean;
};

export type StoredTailwindTokenDomain = {
	tokens: Record<string, string>;
	overrides: string[];
	baselineDiff: TailwindMeaningfulTokenBaselineDiff;
};

/**
 * GET response mirrors the canonical stored snapshot. The route flattens the
 * metadata fields onto the top-level response, but the meaning is identical to
 * `TailwindTokenStorageV2`.
 */
export type StoredTailwindTokensResponse = {
	ok: true;
	systemId: string;
	systemName: string;
	cssPath: string;
	syncedAt: string;
	tailwindBaselineVersion: string;
	reviewRequired: boolean;
	domains: Record<TailwindTokenDomain, StoredTailwindTokenDomain>;
};

export type SaveAndConfirmTailwindTokensRequest = {
	systemId: string;
	domains: Partial<Record<TailwindTokenDomain, { overrides: string[] }>>;
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

export const storedTailwindTokensQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(["trickroom-tailwind-tokens", systemId], projectScope);

export const getStoredTailwindTokens = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/tailwind/systems/${encodeURIComponent(systemId)}/tokens`,
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
	systemId,
	domains,
}: SaveAndConfirmTailwindTokensRequest) => {
	const response = await fetch(
		`/api/trickroom/tailwind/systems/${encodeURIComponent(systemId)}/tokens`,
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

export const storedTailwindTokensQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: storedTailwindTokensQueryKey(systemId, projectScope),
		queryFn: () => getStoredTailwindTokens(systemId),
	});
