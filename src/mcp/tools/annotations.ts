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
