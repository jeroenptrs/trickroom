import { queryOptions } from "@tanstack/react-query";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationTarget,
	AnnotationView,
} from "../services/annotations.types";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

// The editor's client for `/api/trickroom/annotations` (src/routes/annotations.ts).
// Every write is recorded as the human by the server; nothing here can
// change that. Writes to an existing annotation always send the revision
// the editor holds, so an agent's concurrent transition is never silently
// overwritten: a 409 means "refetch and show what is there now".

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
		throw new AnnotationRequestError(
			body?.error ?? `Request failed with status ${response.status}`,
			response.status,
			body?.code ?? "HTTP_ERROR",
			body?.details,
		);
	}
	return (await response.json()) as T;
};

const post = async <T>(path: string, body: unknown): Promise<T> =>
	readAnnotationJson<T>(
		await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
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
) => {
	const params = new URLSearchParams(annotationContainerParams(container));
	if (branch !== "current") params.set("branch", branch);
	return readAnnotationJson<AnnotationListResponse>(
		await fetch(`${baseUrl}?${params.toString()}`),
	);
};

export const annotationListQueryOptions = (
	container: AnnotationContainer,
	branch: AnnotationBranchFilter,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: annotationListQueryKey(container, branch, projectScope),
		queryFn: () => fetchAnnotationList(container, branch),
		retry: false,
		// Live updates arrive as `annotation` events; a refetch on focus would
		// only repeat them.
		refetchOnWindowFocus: false,
	});

export const fetchAnnotation = async (
	annotationId: string,
	container: AnnotationContainer,
) =>
	(
		await readAnnotationJson<{ annotation: AnnotationView }>(
			await fetch(annotationUrl(annotationId, container)),
		)
	).annotation;

export type AnnotationSnapshotHint = {
	stageMode?: string;
	responsiveWidth?: number;
};

export const createAnnotationRequest = (input: {
	target: AnnotationTarget;
	body: string;
	snapshot?: AnnotationSnapshotHint;
}) => post<AnnotationWriteResponse>(baseUrl, input);

export const replyToAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	body: string,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"entries",
		),
		{ body, expectedRevision: annotation.revision },
	);

export const transitionAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	input:
		| { to: "resolved"; summary?: string }
		| { to: "dismissed"; reason: string }
		| { to: "open" },
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"transition",
		),
		{ ...input, expectedRevision: annotation.revision },
	);

export const reanchorAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
	target: AnnotationTarget,
	snapshot?: AnnotationSnapshotHint,
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
	);

export const moveAnnotationRequest = (
	annotation: Pick<AnnotationView, "id" | "target" | "revision">,
) =>
	post<AnnotationWriteResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"move",
		),
		{ expectedRevision: annotation.revision },
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
) =>
	post<AnnotationRevertResponse>(
		annotationUrl(
			annotation.id,
			annotationContainerOf(annotation.target),
			"revert",
		),
		{ entryId, expectedRevision: annotation.revision },
	);

/**
 * Bulk resolve exactly these annotations ("resolve all addressed", and
 * "accept all agent-resolved"); each is checked against the revision sent
 * and reported in `skipped` when it changed meanwhile.
 */
export const resolveAnnotationsRequest = (
	container: AnnotationContainer,
	annotations: readonly Pick<AnnotationView, "id" | "revision">[],
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
	);
