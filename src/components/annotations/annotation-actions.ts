import { toast } from "sonner";
import {
	AnnotationRequestError,
	type AnnotationSnapshotHint,
	annotationContainerOf,
	createAnnotationRequest,
	fetchAnnotation,
	isAnnotationRevisionMismatch,
	moveAnnotationRequest,
	reanchorAnnotationRequest,
	replyToAnnotationRequest,
	resolveAnnotationsRequest,
	revertAnnotationChangeRequest,
	transitionAnnotationRequest,
} from "../../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationTarget,
	AnnotationView,
} from "../../services/annotations.types";
import {
	type AnnotationDraft,
	discardAnnotationDrafts,
	setReplyDraft,
} from "../../stores/annotation-draft-store";
import { upsertAnnotation } from "../../stores/editor-annotations-store";

// Annotation writes from the editor. Each sends the revision the editor
// holds; when an agent changed the annotation meanwhile (409), the editor
// refetches it and shows what is there now instead of retrying blindly.

type AnnotationRef = Pick<AnnotationView, "id" | "target" | "revision">;

const refresh = async (annotation: AnnotationRef) => {
	try {
		upsertAnnotation(
			await fetchAnnotation(
				annotation.id,
				annotationContainerOf(annotation.target),
			),
		);
	} catch {
		// Deleted meanwhile: its `deleted` event removes it.
	}
};

/** Names the layer ids a `CHANGED_SINCE` refusal lists. */
export type LayerNamer = (layerId: string) => string;

const layerList = (error: AnnotationRequestError, nameOf?: LayerNamer) => {
	const layers = error.details?.layers;
	return Array.isArray(layers) && layers.length > 0
		? layers
				.filter((layer): layer is string => typeof layer === "string")
				.map((layer) => nameOf?.(layer) ?? layer)
				.join(", ")
		: null;
};

/** Reports a failed write; on a stale revision, refetches first. */
export async function reportAnnotationWriteError(
	error: unknown,
	annotation: AnnotationRef | null,
	nameOf?: LayerNamer,
) {
	if (isAnnotationRevisionMismatch(error) && annotation) {
		await refresh(annotation);
		toast.warning("This annotation changed meanwhile", {
			id: `annotation-stale-${annotation.id}`,
			description: "It now shows its current state. Check it and try again.",
		});
		return;
	}
	if (
		error instanceof AnnotationRequestError &&
		error.code === "CHANGED_SINCE"
	) {
		const layers = layerList(error, nameOf);
		toast.error("Cannot revert: the layers changed since", {
			description: layers
				? `Changed since: ${layers}.`
				: "Revert only applies while the layers are as the change left them.",
		});
		return;
	}
	toast.error("Annotation not saved", {
		description: error instanceof Error ? error.message : String(error),
	});
}

async function write<T extends { annotation: AnnotationView }>(
	annotation: AnnotationRef,
	run: () => Promise<T>,
	nameOf?: LayerNamer,
): Promise<T | null> {
	try {
		const result = await run();
		upsertAnnotation(result.annotation);
		return result;
	} catch (error) {
		await reportAnnotationWriteError(error, annotation, nameOf);
		return null;
	}
}

/**
 * Sends a draft: from here on it is on disk and in front of an agent. The
 * draft is dropped only once the write succeeded.
 */
export async function sendAnnotationDraft(
	draft: Pick<AnnotationDraft, "key" | "target" | "body">,
	snapshot?: AnnotationSnapshotHint,
) {
	try {
		const result = await createAnnotationRequest({
			target: draft.target,
			body: draft.body.trim(),
			...(snapshot ? { snapshot } : {}),
		});
		upsertAnnotation(result.annotation);
		discardAnnotationDrafts([draft.key]);
		return result.annotation;
	} catch (error) {
		await reportAnnotationWriteError(error, null);
		return null;
	}
}

/** Sends drafts one by one; returns how many were sent. */
export async function sendAnnotationDrafts(
	drafts: readonly Pick<AnnotationDraft, "key" | "target" | "body">[],
	snapshot?: AnnotationSnapshotHint,
) {
	let sent = 0;
	for (const draft of drafts) {
		if (await sendAnnotationDraft(draft, snapshot)) sent += 1;
	}
	if (sent > 0) {
		toast.success(sent === 1 ? "Annotation sent" : `${sent} annotations sent`, {
			id: "annotation-drafts-sent",
		});
	}
	return sent;
}

export async function replyToAnnotation(
	annotation: AnnotationRef,
	body: string,
) {
	const result = await write(annotation, () =>
		replyToAnnotationRequest(annotation, body.trim()),
	);
	if (result) setReplyDraft(annotation.id, "");
	return result;
}

export const resolveAnnotation = (
	annotation: AnnotationRef,
	summary?: string,
) =>
	write(annotation, () =>
		transitionAnnotationRequest(annotation, {
			to: "resolved",
			...(summary ? { summary } : {}),
		}),
	);

export const dismissAnnotation = (annotation: AnnotationRef, reason: string) =>
	write(annotation, () =>
		transitionAnnotationRequest(annotation, { to: "dismissed", reason }),
	);

export const reopenAnnotation = (annotation: AnnotationRef) =>
	write(annotation, () =>
		transitionAnnotationRequest(annotation, { to: "open" }),
	);

export const reanchorAnnotation = (
	annotation: AnnotationRef,
	target: AnnotationTarget,
	snapshot?: AnnotationSnapshotHint,
) =>
	write(annotation, () =>
		reanchorAnnotationRequest(annotation, target, snapshot),
	);

export const moveAnnotationHere = (annotation: AnnotationRef) =>
	write(annotation, () => moveAnnotationRequest(annotation));

/**
 * Reverts a change record. The design itself changes on disk and reaches
 * the editor through live sync like any external change.
 */
export const revertAnnotationChange = (
	annotation: AnnotationRef,
	entryId: string,
	nameOf?: LayerNamer,
) =>
	write(
		annotation,
		() => revertAnnotationChangeRequest(annotation, entryId),
		nameOf,
	);

/**
 * Resolves several annotations at once ("resolve all addressed", "accept
 * all agent-resolved"). Those that changed meanwhile are left alone,
 * refetched, and reported.
 */
export async function resolveAnnotations(
	container: AnnotationContainer,
	annotations: readonly AnnotationView[],
	verb: "Resolved" | "Accepted",
) {
	if (annotations.length === 0) return;
	try {
		const { resolved, skipped } = await resolveAnnotationsRequest(
			container,
			annotations,
		);
		for (const annotation of resolved) upsertAnnotation(annotation);
		const byId = new Map(annotations.map((entry) => [entry.id, entry]));
		await Promise.all(
			skipped.map((skip) => {
				const annotation = byId.get(skip.annotationId);
				return annotation ? refresh(annotation) : undefined;
			}),
		);
		toast.success(
			`${verb} ${resolved.length} ${resolved.length === 1 ? "annotation" : "annotations"}`,
			{
				id: "annotations-bulk-resolve",
				description:
					skipped.length > 0
						? `${skipped.length} changed meanwhile and ${skipped.length === 1 ? "was" : "were"} left as ${skipped.length === 1 ? "it is" : "they are"}.`
						: undefined,
			},
		);
	} catch (error) {
		await reportAnnotationWriteError(error, null);
	}
}
