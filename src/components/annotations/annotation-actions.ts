import { toast } from "sonner";
import {
	AnnotationRequestError,
	type AnnotationSendResponse,
	type AnnotationSnapshotHint,
	annotationContainerOf,
	closeRoundRequest,
	containerKey,
	fetchAnnotation,
	isAnnotationRevisionMismatch,
	isAnnotationScopeChanged,
	moveAnnotationRequest,
	type OpenRound,
	reanchorAnnotationRequest,
	replyToAnnotationRequest,
	resolveAnnotationsRequest,
	revertAnnotationChangeRequest,
	sendAnnotationsRequest,
	transitionAnnotationRequest,
} from "../../queries/annotations";
import type {
	AnnotationContainer,
	AnnotationTarget,
	AnnotationView,
} from "../../services/annotations.types";
import {
	type AnnotationDraft,
	captureSentDraft,
	clearSentAnnotationDraft,
	clearSentReplyDraft,
} from "../../stores/annotation-draft-store";
import {
	type AnnotationReadToken,
	applyAnnotationRead,
	applyAnnotationWrite,
	applyOpenRound,
	beginAnnotationRead,
	beginAnnotationWrite,
	beginRoundRead,
	editorAnnotationsStore,
} from "../../stores/editor-annotations-store";

// Annotation writes from the editor. Each sends the revision the editor
// holds; when an agent changed the annotation meanwhile (409), the editor
// refetches it and shows what is there now instead of retrying blindly.
// Each also sends the checkout scope the editor listed in: after a
// checkout of another branch the server refuses (409 `SCOPE_CHANGED`), the
// editor lists the new branch's annotations, and the text stays a draft.

type AnnotationRef = Pick<AnnotationView, "id" | "target" | "revision">;

/** The checkout the editor's annotations were listed in. */
const heldScope = () => editorAnnotationsStore.get().scope;

const refresh = async (annotation: AnnotationRef) => {
	const token = beginAnnotationRead();
	try {
		applyAnnotationRead(
			token,
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
	if (isAnnotationScopeChanged(error)) {
		// The request layer already handed the new scope to the editor,
		// which lists that branch's annotations.
		const scope = (error as AnnotationRequestError).details?.scope as
			| { branch?: unknown }
			| undefined;
		const branch = typeof scope?.branch === "string" ? scope.branch : null;
		toast.warning("The checkout changed: nothing was saved", {
			id: "annotation-scope-changed",
			description: `${branch && branch !== "*" ? `Branch ${branch} is checked out now` : "Another checkout is active now"}; its annotations are shown instead. Unsent text is kept.`,
		});
		return;
	}
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

/**
 * Shows a write's answer if nothing newer set the annotation while it was
 * out; otherwise reads it again through the ordered read path.
 */
const applyWriteAnswer = async (
	token: AnnotationReadToken,
	annotation: AnnotationView,
) => {
	if (applyAnnotationWrite(token, annotation) === "stale") {
		await refresh(annotation);
	}
};

async function write<T extends { annotation: AnnotationView }>(
	annotation: AnnotationRef,
	run: () => Promise<T>,
	nameOf?: LayerNamer,
): Promise<T | null> {
	// The write's place in the order is when it started, not when it
	// answered: an agent's change that arrived meanwhile is newer.
	const token = beginAnnotationWrite();
	try {
		const result = await run();
		await applyWriteAnswer(token, result.annotation);
		return result;
	} catch (error) {
		await reportAnnotationWriteError(error, annotation, nameOf);
		return null;
	}
}

type SendableDraft = Pick<AnnotationDraft, "key" | "target" | "body">;

type SendOutcome = {
	written: AnnotationView[];
	failed: AnnotationSendResponse["failed"];
	/** The send stopped part way; one message reported both halves. */
	interrupted: boolean;
};

/**
 * Sends drafts of one design (or component) in one request: the server
 * writes them into the open round, or opens one. The container is the one
 * the editor has open; drafts of another are left alone. A draft is
 * dropped only when the answer lists it as written, and only the text that
 * was sent: the composers stay editable while the request is out, and the
 * drafts belong to the project they were written in. Null when the request
 * failed (reported).
 */
async function sendBatch(
	listed: readonly SendableDraft[],
	snapshot?: AnnotationSnapshotHint,
): Promise<SendOutcome | null> {
	const first = listed[0];
	if (!first) return { written: [], failed: [], interrupted: false };
	const container =
		editorAnnotationsStore.get().container ??
		annotationContainerOf(first.target);
	const key = containerKey(container);
	const batch = listed.filter(
		(draft) => containerKey(annotationContainerOf(draft.target)) === key,
	);
	const sent = new Map(
		batch.map((draft) => [draft.key, captureSentDraft(draft.body)]),
	);
	const token = beginAnnotationWrite();
	// The round in the answer is as old as the request: a round read that
	// started later (an `annotation-round` event, a close) is newer.
	const roundToken = beginRoundRead();
	try {
		const answer = await sendAnnotationsRequest(
			container,
			batch.map((draft) => ({
				key: draft.key,
				target: draft.target,
				body: draft.body.trim(),
				...(snapshot ? { snapshot } : {}),
			})),
			heldScope(),
		);
		for (const { key: draftKey } of answer.annotations) {
			const capture = sent.get(draftKey);
			if (capture) clearSentAnnotationDraft(draftKey, capture);
		}
		// The annotations first: the round's progress counts the ones it lists
		// that the editor holds.
		const applying = answer.annotations.map(({ annotation }) =>
			applyWriteAnswer(token, annotation),
		);
		if (answer.round) {
			applyOpenRound(roundToken, container, answer.scope, answer.round);
		}
		await Promise.all(applying);
		const { interrupted } = answer;
		if (interrupted) {
			// The written drafts are cleared above, so a retry does not send
			// them twice; the rest stay drafts. One message for both halves.
			const saved = answer.annotations.length;
			const kept = answer.failed.length;
			const scope = interrupted.details?.scope as
				| { branch?: unknown }
				| undefined;
			const branch = typeof scope?.branch === "string" ? scope.branch : null;
			toast.warning(
				`${saved} ${saved === 1 ? "annotation" : "annotations"} sent, ${kept} kept as ${kept === 1 ? "a draft" : "drafts"}`,
				{
					id: "annotation-drafts-interrupted",
					description:
						interrupted.code === "SCOPE_CHANGED"
							? `The checkout changed while sending. ${branch && branch !== "*" ? `Branch ${branch} is checked out now` : "Another checkout is active now"}; its annotations are shown instead.`
							: interrupted.error,
				},
			);
		}
		return {
			written: answer.annotations.map(({ annotation }) => annotation),
			failed: answer.failed,
			interrupted: Boolean(interrupted),
		};
	} catch (error) {
		await reportAnnotationWriteError(error, null);
		return null;
	}
}

/**
 * Sends a draft: from here on it is on disk, in the open round, and in
 * front of an agent. The draft is dropped only once it was written.
 */
export async function sendAnnotationDraft(
	draft: SendableDraft,
	snapshot?: AnnotationSnapshotHint,
) {
	const outcome = await sendBatch([draft], snapshot);
	if (!outcome) return null;
	const failure = outcome.failed[0];
	// An interrupted send was reported already.
	if (failure && !outcome.interrupted) {
		toast.error("Annotation not saved", { description: failure.error });
	}
	return outcome.written[0] ?? null;
}

/**
 * Sends drafts in one request; returns how many were written. Drafts the
 * server could not write stay drafts and are counted in a toast.
 */
export async function sendAnnotationDrafts(
	drafts: readonly SendableDraft[],
	snapshot?: AnnotationSnapshotHint,
) {
	const outcome = await sendBatch(drafts, snapshot);
	if (!outcome) return 0;
	const sent = outcome.written.length;
	// A partial send has its own message (sendBatch).
	if (sent > 0 && !outcome.interrupted) {
		toast.success(sent === 1 ? "Annotation sent" : `${sent} annotations sent`, {
			id: "annotation-drafts-sent",
		});
	}
	const failed = outcome.failed.length;
	if (failed > 0 && !outcome.interrupted) {
		toast.error(
			`${failed} of ${sent + failed} ${sent + failed === 1 ? "annotation" : "annotations"} not sent`,
			{
				id: "annotation-drafts-failed",
				description: `${outcome.failed[0]?.error ?? "The server refused them."} ${failed === 1 ? "It stays" : "They stay"} as ${failed === 1 ? "a draft" : "drafts"}.`,
			},
		);
	}
	return sent;
}

/**
 * Closes the open round. Annotations in it keep their status; the next
 * send opens a new round.
 */
export async function closeOpenRound(
	container: AnnotationContainer,
	round: Pick<OpenRound, "id">,
) {
	// The answer is as old as the request: a round read or send that started
	// later is newer, and may already show the next round.
	const roundToken = beginRoundRead();
	try {
		const answer = await closeRoundRequest(container, round.id, heldScope());
		// Whatever is open on this branch now is read through the event that
		// follows; the closed round no longer is. Only that round is cleared.
		if (editorAnnotationsStore.get().round?.id === round.id) {
			applyOpenRound(roundToken, container, null, null);
		}
		toast.success("Round closed", { id: "annotation-round-closed" });
		return answer.round;
	} catch (error) {
		await reportAnnotationWriteError(error, null);
		return null;
	}
}

export async function replyToAnnotation(
	annotation: AnnotationRef,
	body: string,
) {
	const sent = captureSentDraft(body);
	const result = await write(annotation, () =>
		replyToAnnotationRequest(annotation, body.trim(), heldScope()),
	);
	if (result) clearSentReplyDraft(annotation.id, sent);
	return result;
}

export const resolveAnnotation = (
	annotation: AnnotationRef,
	summary?: string,
) =>
	write(annotation, () =>
		transitionAnnotationRequest(
			annotation,
			{ to: "resolved", ...(summary ? { summary } : {}) },
			heldScope(),
		),
	);

export const dismissAnnotation = (annotation: AnnotationRef, reason: string) =>
	write(annotation, () =>
		transitionAnnotationRequest(
			annotation,
			{ to: "dismissed", reason },
			heldScope(),
		),
	);

export const reopenAnnotation = (annotation: AnnotationRef) =>
	write(annotation, () =>
		transitionAnnotationRequest(annotation, { to: "open" }, heldScope()),
	);

export const reanchorAnnotation = (
	annotation: AnnotationRef,
	target: AnnotationTarget,
	snapshot?: AnnotationSnapshotHint,
) =>
	write(annotation, () =>
		reanchorAnnotationRequest(annotation, target, snapshot, heldScope()),
	);

export const moveAnnotationHere = (annotation: AnnotationRef) =>
	write(annotation, () => moveAnnotationRequest(annotation, heldScope()));

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
		() => revertAnnotationChangeRequest(annotation, entryId, heldScope()),
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
	const token = beginAnnotationWrite();
	try {
		const { resolved, skipped } = await resolveAnnotationsRequest(
			container,
			annotations,
			heldScope(),
		);
		await Promise.all(
			resolved.map((annotation) => applyWriteAnswer(token, annotation)),
		);
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
