import { queryOptions } from "@tanstack/react-query";
import type { AnnotationRoundCounts } from "../services/annotation-model";
import type {
	AnnotationContainer,
	AnnotationRound,
	AnnotationScope,
	AnnotationTarget,
	AnnotationView,
} from "../services/annotations.types";
import {
	deliverAnnotationScope,
	parseAnnotationScope,
} from "./annotation-live-events";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

// The editor's client for `/api/trickroom/annotations` (src/routes/annotations.ts).
// Every write is recorded as the human by the server; nothing here can
// change that. Writes to an existing annotation always send the revision
// the editor holds, so an agent's concurrent transition is never silently
// overwritten: a 409 means "refetch and show what is there now". Every
// write also sends the checkout scope the editor listed in
// (`expectedScope`), so a tab left on another branch's annotations after a
// checkout is refused (`SCOPE_CHANGED`) instead of writing to them.

const baseUrl = "/api/trickroom/annotations";

/** An error answer of the annotation API, with its code and details. */
export class AnnotationRequestError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: Record<string, unknown> | undefined;

	constructor(
		message: string,
		status: number,
		code: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "AnnotationRequestError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

/** The checkout changed since the editor listed (`expectedScope`). */
export const isAnnotationScopeChanged = (error: unknown) =>
	error instanceof AnnotationRequestError && error.code === "SCOPE_CHANGED";

/** The annotation changed since the editor read it (`expectedRevision`). */
export const isAnnotationRevisionMismatch = (error: unknown) =>
	error instanceof AnnotationRequestError &&
	error.code === "ANNOTATION_REVISION_MISMATCH";

const readAnnotationJson = async <T>(response: Response): Promise<T> => {
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
			code?: string;
			details?: Record<string, unknown>;
		} | null;
		const scope =
			body?.code === "SCOPE_CHANGED"
				? parseAnnotationScope(body.details?.scope)
				: null;
		// The editor lists the new checkout's annotations.
		if (scope) deliverAnnotationScope(scope);
		throw new AnnotationRequestError(
			body?.error ?? `Request failed with status ${response.status}`,
			response.status,
			body?.code ?? "HTTP_ERROR",
			body?.details,
		);
	}
	return (await response.json()) as T;
};

const post = async <T>(
	path: string,
	body: Record<string, unknown>,
	expectedScope: AnnotationScope | null | undefined,
): Promise<T> =>
	readAnnotationJson<T>(
		await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(expectedScope ? { ...body, expectedScope } : body),
		}),
	);

/** `designId=` or `systemId=&componentId=`: the container of a request. */
export const annotationContainerParams = (
	container: AnnotationContainer,
): Record<string, string> =>
	container.kind === "design"
		? { designId: container.designId }
		: { systemId: container.systemId, componentId: container.componentId };

const hint = (container: AnnotationContainer) =>
	new URLSearchParams(annotationContainerParams(container)).toString();

const annotationUrl = (
	annotationId: string,
	container: AnnotationContainer,
	action?: string,
) =>
	`${baseUrl}/${encodeURIComponent(annotationId)}${action ? `/${action}` : ""}?${hint(container)}`;

/** The folder an annotation of `target` lives in. */
export const annotationContainerOf = (
	target: AnnotationTarget,
): AnnotationContainer =>
	target.kind === "componentNode"
		? {
				kind: "component",
				systemId: target.systemId,
				componentId: target.componentId,
			}
		: { kind: "design", designId: target.designId };

export const containerKey = (container: AnnotationContainer) =>
	container.kind === "design"
		? `design:${container.designId}`
		: `component:${container.systemId}/${container.componentId}`;

export type AnnotationBranchFilter = "current" | "all";

export type AnnotationListResponse = {
	/** The server's checkout: its branch and worktree. */
	scope: AnnotationScope;
	designRevision?: string;
	annotations: AnnotationView[];
	problems: unknown[];
};

export type AnnotationWriteResponse = {
	annotation: AnnotationView;
	written: boolean;
};

export type AnnotationBulkSkip = {
	annotationId: string;
	code: string;
	reason: string;
};

export const annotationListQueryKey = (
	container: AnnotationContainer,
	branch: AnnotationBranchFilter,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-annotations", containerKey(container), branch],
		projectScope,
	);

export const fetchAnnotationList = async (
	container: AnnotationContainer,
	branch: AnnotationBranchFilter = "current",
	signal?: AbortSignal,
) => {
	const params = new URLSearchParams(annotationContainerParams(container));
	if (branch !== "current") params.set("branch", branch);
	return readAnnotationJson<AnnotationListResponse>(
		await fetch(`${baseUrl}?${params.toString()}`, signal ? { signal } : {}),
	);
};

export const annotationListQueryOptions = (
	container: AnnotationContainer,
	branch: AnnotationBranchFilter,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: annotationListQueryKey(container, branch, projectScope),
		queryFn: ({ signal }) => fetchAnnotationList(container, branch, signal),
		retry: false,
		// Live updates arrive as `annotation` events; a refetch on focus would
		// only repeat them.
		refetchOnWindowFocus: false,
	});

/** Agent and designer work per design on the checkout's branch. */
export type AnnotationDesignCounts = Record<
	string,
	{ agentWork: number; humanWork: number }
>;

export const annotationCountsQueryKey = (projectScope?: ProjectQueryScope) =>
	withProjectQueryScope(["trickroom-annotation-counts"], projectScope);

export const annotationCountsQueryOptions = (
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: annotationCountsQueryKey(projectScope),
		queryFn: async ({ signal }) =>
			(
				await readAnnotationJson<{ designs: AnnotationDesignCounts }>(
					await fetch(`${baseUrl}/counts`, { signal }),
				)
			).designs,
		retry: false,
		// `annotation` events invalidate it (useProjectFileEvents).
		refetchOnWindowFocus: false,
	});

/**
 * One annotation. The checkout scope its answer reports goes to
 * `subscribeAnnotationScope` first, so an editor holding another scope's
 * annotations lists again (and this read, of the old generation, no
 * longer applies).
 */
export const fetchAnnotation = async (
	annotationId: string,
	container: AnnotationContainer,
	signal?: AbortSignal,
) => {
	const answer = await readAnnotationJson<{
		annotation: AnnotationView;
		scope?: unknown;
	}>(
		await fetch(
			annotationUrl(annotationId, container),
			signal ? { signal } : {},
		),
	);
	const scope = parseAnnotationScope(answer.scope);
	if (scope) deliverAnnotationScope(scope);
	return answer.annotation;
};

export type AnnotationSnapshotHint = {
	stageMode?: string;
	responsiveWidth?: number;
	/** Component nodes: the variant values in view. */
	variants?: Record<string, string>;
};

/** The checkout the editor's annotations were listed in; null before a list. */
type ExpectedScope = AnnotationScope | null;

export const createAnnotationRequest = (
	input: {
		target: AnnotationTarget;
		body: string;
		snapshot?: AnnotationSnapshotHint;
	},
	expectedScope: ExpectedScope = null,
) => post<AnnotationWriteResponse>(baseUrl, input, expectedScope);

export const replyToAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	body: string,
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"entries",
		),
		{ body, expectedRevision: annotation.revision },
		expectedScope,
	);

export const transitionAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	input:
		| { to: "resolved"; summary?: string }
		| { to: "dismissed"; reason: string }
		| { to: "open" },
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"transition",
		),
		{ ...input, expectedRevision: annotation.revision },
		expectedScope,
	);

export const reanchorAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	target: AnnotationTarget,
	snapshot?: AnnotationSnapshotHint,
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"anchor",
		),
		{
			target,
			...(snapshot ? { snapshot } : {}),
			expectedRevision: annotation.revision,
		},
		expectedScope,
	);

export const moveAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"move",
		),
		{ expectedRevision: annotation.revision },
		expectedScope,
	);

export type AnnotationRevertResponse = {
	annotation: AnnotationView;
	/** The design revision after the revert. */
	revision: string;
	restoredLayerIds: string[];
};

export const revertAnnotationChangeRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	entryId: string,
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationRevertResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"revert",
		),
		{ entryId, expectedRevision: annotation.revision },
		expectedScope,
	);

/**
 * Bulk resolve exactly these annotations ("resolve all addressed", and
 * "accept all agent-resolved"); each is checked against the revision sent
 * and reported in `skipped` when it changed meanwhile.
 */
export const resolveAnnotationsRequest = (
	container: AnnotationContainer,
	annotations: readonly Pick<AnnotationView, "id" | "revision">[],
	expectedScope: ExpectedScope = null,
) =>
	post<{ resolved: AnnotationView[]; skipped: AnnotationBulkSkip[] }>(
		`${baseUrl}/resolve`,
		{
			...annotationContainerParams(container),
			annotationIds: annotations.map((annotation) => annotation.id),
			expectedRevisions: Object.fromEntries(
				annotations.map((annotation) => [annotation.id, annotation.revision]),
			),
		},
		expectedScope,
	);

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/** A round as the server answers it: the round file and its progress. */
export type OpenRound = AnnotationRound & { counts: AnnotationRoundCounts };

/** One draft of a send, keyed by the editor's draft key. */
export type AnnotationSendDraft = {
	key: string;
	target: AnnotationTarget;
	body: string;
	snapshot?: AnnotationSnapshotHint;
};

export type AnnotationSendResponse = {
	scope: AnnotationScope;
	/** The round the drafts went into; null when there is none. */
	round: OpenRound | null;
	/** The annotations written, by the key of the draft each came from. */
	annotations: { key: string; annotation: AnnotationView }[];
	/** Drafts that were not written; the others were. */
	failed: { key: string; code: string; error: string }[];
};

/**
 * Sends a batch of drafts of one design or component in one request: the
 * server writes them into the open round (or opens one) and says which
 * were written.
 */
export const sendAnnotationsRequest = (
	container: AnnotationContainer,
	drafts: readonly AnnotationSendDraft[],
	expectedScope: ExpectedScope = null,
) =>
	post<AnnotationSendResponse>(
		`${baseUrl}/send`,
		{ ...annotationContainerParams(container), drafts },
		expectedScope,
	);

/**
 * The open round of the container on the checkout's branch, or null, with
 * the scope the server answered in. The caller decides what another scope
 * than the editor's means: before the first list there is none to compare.
 */
export const fetchOpenRound = async (
	container: AnnotationContainer,
	signal?: AbortSignal,
) => {
	const answer = await readAnnotationJson<{
		scope?: unknown;
		round: OpenRound | null;
	}>(
		await fetch(
			`${baseUrl}/rounds?${hint(container)}`,
			signal ? { signal } : {},
		),
	);
	return { scope: parseAnnotationScope(answer.scope), round: answer.round };
};

/** Closes a round; closing a closed one changes nothing (`written: false`). */
export const closeRoundRequest = (
	container: AnnotationContainer,
	roundId: string,
	expectedScope: ExpectedScope = null,
) =>
	post<{ round: OpenRound; written: boolean }>(
		`${baseUrl}/rounds/${encodeURIComponent(roundId)}/close`,
		annotationContainerParams(container),
		expectedScope,
	);
