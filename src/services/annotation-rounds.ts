import { randomUUID } from "node:crypto";
import { type AnnotationRoundCounts, summarizeRound } from "./annotation-model";
import {
	type AnnotationServiceContext,
	AnnotationServiceError,
	type CreateAnnotationInput,
	createAnnotation,
} from "./annotation-service";
import {
	AnnotationStoreError,
	getAnnotationContainer,
	isSameAnnotationContainer,
} from "./annotation-store";
import {
	ANNOTATION_ROUND_FILE_VERSION,
	type AnnotationActor,
	type AnnotationContainer,
	type AnnotationRound,
	type AnnotationScope,
	type AnnotationView,
} from "./annotations.types";

/**
 * Rounds: a designer's bundle of annotations on one design or component,
 * on one branch (docs/proposals/annotation-rounds.md). The designer opens
 * one by sending, and closes it; agents wait on it with `annotation_watch`
 * `round: true`. Round files sit in the container's `rounds` folder (see
 * `AnnotationStore.withRoundLock`).
 */

export type { AnnotationRoundCounts };
export { summarizeRound };

const nowOf = (context: AnnotationServiceContext) =>
	context.now?.() ?? new Date();

/** The newest open round among `rounds` on the checkout's branch, or null. */
const pickOpenRound = (
	rounds: readonly AnnotationRound[],
	scope: Pick<AnnotationScope, "branch">,
) =>
	rounds
		.filter((round) => round.status === "open" && round.branch === scope.branch)
		.at(-1) ?? null;

/** The open round of a container on the checkout's branch, or null. */
export const getOpenRound = async (
	context: AnnotationServiceContext,
	{
		container,
		scope,
	}: { container: AnnotationContainer; scope: Pick<AnnotationScope, "branch"> },
): Promise<AnnotationRound | null> =>
	pickOpenRound((await context.store.listRounds(container)).rounds, scope);

/** A round with its progress over the annotations it lists, as they are now. */
export type AnnotationRoundView = AnnotationRound & {
	counts: AnnotationRoundCounts;
};

/** `round` with counts from the container's annotations as they are now. */
export const viewRound = async (
	context: AnnotationServiceContext,
	round: AnnotationRound,
): Promise<AnnotationRoundView> => {
	const { annotations } = await context.store.list(round.container);
	return {
		...round,
		counts: summarizeRound(
			round,
			annotations.map(({ annotation }) => annotation),
		),
	};
};

export type SendDraft = Omit<
	CreateAnnotationInput,
	"by" | "scope" | "roundId"
> & {
	/** The editor's draft key, echoed back so it knows which were written. */
	key: string;
};

export type SendResult = {
	/** The round the send went into (null when nothing was written). */
	round: AnnotationRound | null;
	/** Written annotations, in draft order. */
	annotations: { key: string; annotation: AnnotationView }[];
	/** Drafts that were not written, with why. */
	failed: { key: string; code: string; error: string }[];
	/**
	 * Why the send stopped before trying every draft (the checkout changed,
	 * an annotation was locked), once some were written; null otherwise. The
	 * drafts it did not write are in `failed` with this code. When nothing
	 * was written the error is thrown instead.
	 */
	interrupted: {
		code: string;
		error: string;
		details?: Record<string, unknown>;
	} | null;
};

/**
 * Sends drafts as one batch into the container's open round on the
 * checkout's branch, opening one when there is none. Under the round lock
 * for the whole send: each annotation is written with the round's id, then
 * the round file lists them in one send. Agents see a sent annotation only
 * once the round lists it (`isPendingAnnotation`), so they never get half a
 * batch. A draft that fails (its target is gone) is reported and does not
 * stop the others. A refusal of the whole request (the checkout changed)
 * stops the send: what was written before it is listed in the round and
 * returned with `interrupted`, so the editor drops those drafts and a retry
 * does not send them twice. With nothing written yet, the error is thrown.
 */
export const sendAnnotations = async (
	context: AnnotationServiceContext,
	input: {
		container: AnnotationContainer;
		scope: AnnotationScope;
		by: AnnotationActor;
		drafts: readonly SendDraft[];
	},
): Promise<SendResult> => {
	if (input.by.role !== "human") {
		throw new AnnotationServiceError(
			"INVALID_INPUT",
			"Rounds are the designer's: only the editor sends them.",
		);
	}
	if (input.drafts.length === 0) {
		throw new AnnotationServiceError(
			"INVALID_INPUT",
			"Pass at least one draft to send.",
		);
	}
	for (const draft of input.drafts) {
		if (
			!isSameAnnotationContainer(
				getAnnotationContainer(draft.target),
				input.container,
			)
		) {
			throw new AnnotationServiceError(
				"WRONG_CONTAINER",
				"Every draft of a send must be on the design or component it is sent to.",
				{ key: draft.key },
			);
		}
	}
	return context.store.withRoundLock(input.container, async (writeRound) => {
		const at = nowOf(context).toISOString();
		const { rounds } = await context.store.listRounds(input.container);
		const round: AnnotationRound = pickOpenRound(rounds, input.scope) ?? {
			version: ANNOTATION_ROUND_FILE_VERSION,
			id: randomUUID(),
			projectId: context.store.projectId,
			container: input.container,
			branch: input.scope.branch,
			worktreePath: input.scope.worktreePath,
			status: "open",
			openedAt: at,
			annotationIds: [],
			sends: [],
		};
		const written: SendResult["annotations"] = [];
		const failed: SendResult["failed"] = [];
		let interrupted: SendResult["interrupted"] = null;
		/** Lists what was written in the round: from then on agents see it. */
		const land = async (): Promise<AnnotationRound | null> => {
			if (written.length === 0) return null;
			const ids = written.map(({ annotation }) => annotation.id);
			const next: AnnotationRound = {
				...round,
				annotationIds: [...round.annotationIds, ...ids],
				sends: [...round.sends, { id: randomUUID(), at, annotationIds: ids }],
			};
			// Not refused by `beforeWrite`: these annotations are on disk with
			// this round's id already, and must be listed with it.
			await writeRound(next, { guard: false });
			return next;
		};
		for (const [index, draft] of input.drafts.entries()) {
			const { key, ...create } = draft;
			try {
				const { annotation } = await createAnnotation(context, {
					...create,
					by: input.by,
					scope: input.scope,
					roundId: round.id,
				});
				written.push({ key, annotation });
			} catch (error) {
				const perDraft =
					(error instanceof AnnotationServiceError &&
						error.code !== "SCOPE_CHANGED") ||
					(error instanceof AnnotationStoreError &&
						error.code !== "ANNOTATION_LOCKED");
				if (!perDraft) {
					if (written.length === 0) throw error;
					const code =
						error instanceof AnnotationServiceError ||
						error instanceof AnnotationStoreError
							? error.code
							: "INTERNAL";
					const message =
						error instanceof Error ? error.message : String(error);
					interrupted = {
						code,
						error: message,
						...(error instanceof AnnotationServiceError ||
						error instanceof AnnotationStoreError
							? error.details
								? { details: error.details }
								: {}
							: {}),
					};
					for (const rest of input.drafts.slice(index)) {
						failed.push({ key: rest.key, code, error: message });
					}
					break;
				}
				failed.push({
					key,
					code: (error as AnnotationServiceError | AnnotationStoreError).code,
					error: (error as Error).message,
				});
			}
		}
		const landed = await land();
		return { round: landed, annotations: written, failed, interrupted };
	});
};

/**
 * Closes a round: the designer has no more feedback. Its annotations keep
 * their status. Only the designer closes a round; closing a closed one
 * writes nothing.
 */
export const closeRound = async (
	context: AnnotationServiceContext,
	input: {
		container: AnnotationContainer;
		roundId: string;
		by: AnnotationActor;
		scope: Pick<AnnotationScope, "branch">;
	},
): Promise<{ round: AnnotationRound; written: boolean }> => {
	if (input.by.role !== "human") {
		throw new AnnotationServiceError(
			"INVALID_INPUT",
			"Rounds are the designer's: only the editor closes them.",
		);
	}
	return context.store.withRoundLock(input.container, async (writeRound) => {
		const round = await context.store.readRound(input.container, input.roundId);
		if (!round) {
			throw new AnnotationStoreError(
				"ROUND_NOT_FOUND",
				`Round ${input.roundId} does not exist.`,
				{ roundId: input.roundId },
			);
		}
		if (round.branch !== input.scope.branch) {
			throw new AnnotationServiceError(
				"WRONG_BRANCH",
				`Round ${round.id} is on branch "${round.branch}", not this checkout's branch "${input.scope.branch}".`,
				{
					roundId: round.id,
					branch: round.branch,
					currentBranch: input.scope.branch,
				},
			);
		}
		if (round.status === "closed") return { round, written: false };
		const closed: AnnotationRound = {
			...round,
			status: "closed",
			closedAt: nowOf(context).toISOString(),
			closedBy: input.by,
		};
		await writeRound(closed);
		return { round: closed, written: true };
	});
};
