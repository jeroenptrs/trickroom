/** Clients that defer tool schemas load tools with this flag up front. */
export const ALWAYS_LOAD_META_KEY = "anthropic/alwaysLoad";

/** Extra search keywords for clients that find deferred tools by search. */
export const SEARCH_HINT_META_KEY = "anthropic/searchHint";

/** Largest result a client should accept from a tool before truncating. */
export const MAX_RESULT_SIZE_META_KEY = "anthropic/maxResultSizeChars";

export const readOnlyClosedWorldAnnotations = {
	readOnlyHint: true,
	openWorldHint: false,
} as const;

export const mutationAnnotations = {
	readOnlyHint: false,
	openWorldHint: false,
	idempotentHint: false,
	destructiveHint: false,
} as const;

export const screenshotAnnotations = {
	readOnlyHint: false,
	openWorldHint: true,
	idempotentHint: false,
	destructiveHint: false,
} as const;

export const destructiveMutationAnnotations = {
	...mutationAnnotations,
	destructiveHint: true,
	idempotentHint: false,
} as const;
