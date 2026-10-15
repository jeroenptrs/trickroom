import { type FSWatcher, watch } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	type ComponentAnchorTemplate,
	isLiveAnnotationStatus,
	summarizeRound,
} from "../../services/annotation-model";
import {
	listAnnotations,
	scanLanded,
	summarizeAnnotationCounts,
} from "../../services/annotation-service";
import type { StoredAnnotation } from "../../services/annotation-store";
import type {
	Annotation,
	AnnotationContainer,
	AnnotationRound,
	AnnotationView,
} from "../../services/annotations.types";
import {
	readComponentAnchor,
	resolveAnnotationSystemId,
} from "../../services/component-annotations";
import type { TrickroomDesign } from "../../types";
import {
	ADDRESSING_ADVICE,
	type AnnotationProject,
	compactCounts,
	MAX_SURFACED_ANNOTATIONS,
	plural,
} from "../annotation-session";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import { readDesignFileForTool } from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

/**
 * annotation_watch: waits for the designer's annotations on one design or
 * system component. Without `round` it returns unseen agent work; with
 * `round: true` it waits on the designer's round until they close it,
 * returning work, verdicts on this session's work, the close, or idle
 * (docs/proposals/annotation-rounds.md, decision 6).
 */

/** How long it waits by default, and at most. */
export const WATCH_DEFAULT_TIMEOUT_MS = 50_000;
export const WATCH_MAX_TIMEOUT_MS = 300_000;
const WATCH_MIN_TIMEOUT_MS = 1_000;
/** After the first arrival, wait this long for the rest of a batch the designer sends. */
export const WATCH_BATCH_WINDOW_MS = 1_500;
/** The store is checked at least this often while waiting (and on every change event). */
const WATCH_POLL_INTERVAL_MS = 1_000;
const WATCH_PROGRESS_INTERVAL_MS = 10_000;

/**
 * Waits on an annotation folder: `wait` resolves after `ms`, on a change in
 * the folder since the last wait, or on abort. The folder may not exist yet
 * (no annotation on the design); it is watched once it does, and the
 * timeout polls until then. `close` releases the watcher. Round files sit
 * in a subfolder, which the poll covers.
 */
const createChangeWaiter = (directory: string) => {
	let watcher: FSWatcher | null = null;
	let changed = false;
	let wake: (() => void) | null = null;
	const ensureWatcher = () => {
		if (watcher) return;
		try {
			watcher = watch(directory, () => {
				changed = true;
				wake?.();
			});
			watcher.on("error", () => {
				watcher?.close();
				watcher = null;
			});
		} catch {
			// Not there yet: polling covers it.
		}
	};
	return {
		wait: (ms: number, signal: AbortSignal | undefined) =>
			new Promise<void>((resolve) => {
				ensureWatcher();
				if (changed || signal?.aborted) {
					changed = false;
					resolve();
					return;
				}
				const done = () => {
					clearTimeout(timer);
					wake = null;
					changed = false;
					signal?.removeEventListener("abort", done);
					resolve();
				};
				const timer = setTimeout(done, Math.max(0, ms));
				wake = done;
				signal?.addEventListener("abort", done, { once: true });
			}),
		close: () => {
			watcher?.close();
			watcher = null;
		},
	};
};

/** Resolves after `ms` or on abort. */
const sleep = (ms: number, signal: AbortSignal | undefined) =>
	new Promise<void>((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, Math.max(0, ms));
		if (signal?.aborted) done();
		else signal?.addEventListener("abort", done, { once: true });
	});

/** What a watch waits on: a design or a component, and how to talk about it. */
type WatchSubject = {
	container: AnnotationContainer;
	/** The ids of the call, as `next` texts repeat them. */
	ids: string;
	/** "design" or "component", in `next` texts. */
	noun: string;
	/** What results name the subject by. */
	reference: Record<string, unknown>;
	/** Detached and moved targets: the design, or the component's template. */
	design: TrickroomDesign | null;
	template: ComponentAnchorTemplate | null;
	/** Reads the design (or template) again: layers may have moved. */
	refresh: () => Promise<void>;
	/** The write that addresses an annotation, for `next`. */
	addressCall: (annotationId: string) => string;
};

/**
 * One look at the store, in order of precedence: unseen work, then (with
 * `round`) verdicts on this session's work, a closed round, or waiting
 * (on the open round, if any).
 */
type Outcome =
	| { kind: "work"; unseen: AnnotationView[] }
	| { kind: "verdict"; verdicts: AnnotationView[] }
	| { kind: "closed"; round: AnnotationRound }
	| { kind: "waiting"; open: AnnotationRound | null };

type Look = Outcome & {
	/** This branch's annotations (on the board, with `boardId`), live ones. */
	live: AnnotationView[];
	/** Every annotation file of the container, for round progress. */
	stored: readonly StoredAnnotation[];
};

export const registerAnnotationWatchTool = (
	ctx: McpToolContext,
	helpers: {
		openProject: (
			context: TrickroomMcpServerContext,
		) => Promise<AnnotationProject | CallToolResult>;
		isResult: (value: unknown) => value is CallToolResult;
		withAnnotationErrors: (
			context: TrickroomMcpServerContext,
			fn: () => Promise<CallToolResult>,
		) => Promise<CallToolResult>;
	},
) => {
	const { server, annotations, withPolicyErrorHandling } = ctx;
	const { openProject, isResult, withAnnotationErrors } = helpers;

	/** The design or component of the call, read; or an error result. */
	const openSubject = async (
		context: TrickroomMcpServerContext,
		input: {
			designFileId?: string | undefined;
			systemId?: string | undefined;
			componentId?: string | undefined;
			boardId?: string | undefined;
		},
	): Promise<WatchSubject | CallToolResult> => {
		const { designFileId, systemId: systemHandle, componentId } = input;
		if (
			designFileId !== undefined
				? systemHandle !== undefined || componentId !== undefined
				: systemHandle === undefined || componentId === undefined
		) {
			return createToolErrorResult(
				context,
				"INVALID_OPERATION_PARAMETERS",
				"Pass designFileId, or systemId and componentId.",
			);
		}
		if (designFileId !== undefined) {
			assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
			// Fails with DESIGN_NOT_FOUND for a wrong id before waiting.
			const subject: WatchSubject = {
				container: { kind: "design", designId: designFileId },
				ids: `designFileId: "${designFileId}"`,
				noun: "design",
				reference: { designFileId },
				design: (await readDesignFileForTool(context, designFileId)).design,
				template: null,
				refresh: async () => {
					subject.design = await readDesignFileForTool(context, designFileId)
						.then((read) => read.design)
						.catch(() => subject.design);
				},
				addressCall: (annotationId) =>
					`${TOOL.designApply}({ designFileId: "${designFileId}", expectedRevision, operations, addresses: [{ annotationId: "${annotationId}", reply: "<what you changed>" }] })`,
			};
			return subject;
		}
		if (input.boardId !== undefined) {
			return createToolErrorResult(
				context,
				"INVALID_OPERATION_PARAMETERS",
				"boardId narrows a design's watch; a component has no boards.",
			);
		}
		// A system named by name watches the folder of its id.
		const systemId =
			(await resolveAnnotationSystemId(
				context.projectRoot,
				systemHandle as string,
			).catch(() => null)) ?? (systemHandle as string);
		const read = () =>
			readComponentAnchor(
				context.projectRoot,
				systemId,
				componentId as string,
			).catch(() => null);
		const anchor = await read();
		if (!anchor) {
			return createToolErrorResult(
				context,
				"COMPONENT_NOT_FOUND",
				`Component "${componentId}" is not in design system "${systemHandle}". ${TOOL.componentRead}({ systemName: "${systemHandle}" }) lists its components.`,
			);
		}
		const subject: WatchSubject = {
			container: {
				kind: "component",
				systemId,
				componentId: componentId as string,
			},
			ids: `systemId: "${systemHandle}", componentId: "${componentId}"`,
			noun: "component",
			reference: {
				component: {
					systemId,
					componentId,
					name: anchor.name,
				},
			},
			design: null,
			template: anchor.template,
			refresh: async () => {
				subject.template = (await read())?.template ?? subject.template;
			},
			addressCall: (annotationId) =>
				`${TOOL.componentDraftUpdate}({ systemName: "${systemId}", componentId: "${componentId}", expectedRevision, root, addresses: [{ annotationId: "${annotationId}", reply: "<what you changed>" }] })`,
		};
		return subject;
	};

	server.registerTool(
		TOOL.annotationWatch,
		{
			title: "Wait For Annotations",
			description: `Wait for the designer's annotations on a design (designFileId) or a system component (systemId and componentId), and return them in full. Without round: status "success" with unseen work (new remarks, reopens, re-anchors; at most ${MAX_SURFACED_ANNOTATIONS}, with more, counts and next) as soon as there is some, else "timeout". With round: true it waits on the designer's round (the remarks they sent as one batch) until they close it, and returns status "work" (remarks for you), "verdict" (the designer accepted or dismissed an annotation you addressed or proposed), "closed" (the round is closed: finish the live annotations it returns, then end your turn), "idle" (no round is open: go on with your task, do not keep waiting) or "timeout" (the round is still open: call again). The loop: address each remark in the write that makes its change (addresses), propose with ${TOOL.annotationReply} propose: { summary } when it needs no change, ask with question when it is unclear, then call ${TOOL.annotationWatch} with round: true again until "closed" or "idle". Returns at once when something is waiting; after the first arrival it waits ${WATCH_BATCH_WINDOW_MS / 1000} s more so remarks sent together come back together. timeoutMs defaults to ${WATCH_DEFAULT_TIMEOUT_MS / 1000} s (at most ${WATCH_MAX_TIMEOUT_MS / 60_000} min; longer than your client's request timeout fails the call). Current git branch only. Seeing an annotation in full acknowledges it for this session.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema
					.optional()
					.describe("Design file UUID. Required unless systemId is set."),
				systemId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"With componentId: watch a system component's annotations.",
					),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("System component id, with systemId."),
				boardId: z
					.string()
					.min(1)
					.optional()
					.describe("Only annotations on this board (designs)."),
				round: z
					.boolean()
					.optional()
					.describe(
						"Wait on the designer's round until they close it (see the description).",
					),
				timeoutMs: z
					.number()
					.int()
					.min(WATCH_MIN_TIMEOUT_MS)
					.max(WATCH_MAX_TIMEOUT_MS)
					.optional()
					.describe(
						`How long to wait, in ms (default ${WATCH_DEFAULT_TIMEOUT_MS}, at most ${WATCH_MAX_TIMEOUT_MS}).`,
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"annotations wait watch poll new remarks designer feedback loop listen round batch",
			},
		},
		async (
			{
				designFileId,
				systemId,
				componentId,
				boardId,
				round: roundMode,
				timeoutMs,
				project: projectRef,
			},
			extra,
		) =>
			withPolicyErrorHandling(projectRef, (context) =>
				withAnnotationErrors(context, async () => {
					const subject = await openSubject(context, {
						designFileId,
						systemId,
						componentId,
						boardId,
					});
					if (isResult(subject)) return subject;
					const project = await openProject(context);
					if (isResult(project)) return project;
					const { container } = subject;
					const store = project.service.store;
					const directory = store.getContainerDirectory(container);
					const signal = extra?.signal;
					const progressToken = extra?._meta?.progressToken;
					const timeout = timeoutMs ?? WATCH_DEFAULT_TIMEOUT_MS;
					const startedAt = Date.now();
					const deadline = startedAt + timeout;
					let lastProgressAt = startedAt;
					const round = roundMode === true;
					const keepWaiting = `${TOOL.annotationWatch}({ ${subject.ids}${boardId ? `, boardId: "${boardId}"` : ""}${round ? ", round: true" : ""} })`;
					const list = `${TOOL.annotationList}({ ${subject.ids} })`;
					const isCurrent = (view: Annotation) =>
						view.branch === project.scope.branch;

					const look = async (): Promise<Look> => {
						// The round index first, then the files (see `scanLanded`).
						const scan = await scanLanded(project.service, container);
						const { stored } = scan;
						// This branch's annotations as agents see them: landed
						// sends only, on the board with boardId (a moved layer
						// counts where it is now).
						const { annotations: current } = await listAnnotations(
							project.service,
							{
								container,
								scope: project.scope,
								landedOnly: true,
								stored,
								roundsById: scan.roundsById,
								...(boardId !== undefined ? { boardId } : {}),
								...(subject.design ? { design: subject.design } : {}),
								...(subject.template ? { component: subject.template } : {}),
							},
						);
						const live = current.filter((view) =>
							isLiveAnnotationStatus(view.status),
						);
						const base = { live, stored: stored.annotations };
						const unseen = annotations.takeUnseen(
							project,
							live,
							subject.design,
						);
						if (unseen.length > 0) return { ...base, kind: "work", unseen };
						if (!round) return { ...base, kind: "waiting", open: null };
						const verdicts = annotations.takeVerdicts(project, current);
						if (verdicts.length > 0) {
							return { ...base, kind: "verdict", verdicts };
						}
						const rounds = [...scan.roundsById.values()];
						const closed = annotations.takeClosedRounds(project, rounds).at(-1);
						if (closed) return { ...base, kind: "closed", round: closed };
						const open =
							rounds
								.filter(
									(entry) =>
										entry.status === "open" &&
										entry.branch === project.scope.branch,
								)
								.at(-1) ?? null;
						if (open) annotations.noteRoundsOpen(project, [open]);
						return { ...base, kind: "waiting", open };
					};

					/** `{ id, openedAt or closedAt, counts }` of a round now. */
					const describeRound = (
						entry: AnnotationRound,
						stored: readonly StoredAnnotation[],
					) => ({
						id: entry.id,
						...(entry.status === "closed"
							? { closedAt: entry.closedAt }
							: { openedAt: entry.openedAt }),
						counts: summarizeRound(
							entry,
							stored.map(({ annotation }) => annotation),
						),
					});
					const countsOf = (views: readonly AnnotationView[]) =>
						compactCounts(
							summarizeAnnotationCounts(views, subject.design, subject.template)
								.total,
						);
					const liveNow = (
						listed: readonly AnnotationView[],
						refreshed: Parameters<typeof annotations.refreshListed>[1],
					) =>
						annotations.refreshListed(
							listed,
							refreshed,
							(view) => isCurrent(view) && isLiveAnnotationStatus(view.status),
						);
					const reportProgress = async () => {
						if (progressToken === undefined) return;
						const now = Date.now();
						if (now - lastProgressAt < WATCH_PROGRESS_INTERVAL_MS) return;
						lastProgressAt = now;
						await extra
							.sendNotification({
								method: "notifications/progress",
								params: {
									progressToken,
									progress: now - startedAt,
									total: timeout,
									message: round
										? "Waiting on the designer's round."
										: "Waiting for annotations.",
								},
							})
							.catch(() => undefined);
					};
					const base = () => ({
						project: getProjectReference(context),
						...subject.reference,
						waitedMs: Date.now() - startedAt,
					});

					/**
					 * The result for a look, as the annotations are now; null
					 * when everything it found has moved away (answered, moved
					 * to another branch, removed): keep waiting.
					 */
					const take = async (
						found: Look,
					): Promise<Record<string, unknown> | null> => {
						const roundNow = async () => {
							if (!round) return {};
							const open = (await store.listRounds(container)).rounds
								.filter(
									(entry) =>
										entry.status === "open" &&
										entry.branch === project.scope.branch,
								)
								.at(-1);
							return open ? { round: describeRound(open, found.stored) } : {};
						};
						if (found.kind === "work") {
							const refreshed = await annotations.showInFull(
								project,
								found.unseen.slice(0, MAX_SURFACED_ANNOTATIONS),
								annotations.isCurrentWork(project),
							);
							if (refreshed.shown.length === 0) return null;
							await annotations.noteRoundsOf(
								project,
								container,
								refreshed.shown,
							);
							const eligible = liveNow(found.live, refreshed);
							const eligibleIds = new Set(eligible.map((view) => view.id));
							const shownIds = new Set(refreshed.shown.map((view) => view.id));
							const more = found.unseen.filter(
								(view) => eligibleIds.has(view.id) && !shownIds.has(view.id),
							).length;
							const firstId = refreshed.shown[0]?.id ?? "<annotationId>";
							return {
								status: round ? "work" : "success",
								...base(),
								...(await roundNow()),
								annotations: refreshed.bodies,
								...(more > 0 ? { more } : {}),
								counts: countsOf(eligible),
								next: [
									`Address each in the write that makes its change: ${subject.addressCall(firstId)}.`,
									ADDRESSING_ADVICE,
									`If a remark is ambiguous, ask with ${TOOL.annotationReply}({ annotationId: "${firstId}", question: "<your question>" }).`,
									...(round
										? [
												`If it needs no change, propose closing it with ${TOOL.annotationReply}({ annotationId: "${firstId}", propose: { summary: "<why>" } }).`,
											]
										: []),
									"Resolve only when the designer asks.",
									...(more > 0 ? [`${more} more: ${list}.`] : []),
									`Then ${keepWaiting} again.`,
								].join(" "),
							};
						}
						if (found.kind === "verdict") {
							const refreshed = await annotations.showInFull(
								project,
								found.verdicts.slice(0, MAX_SURFACED_ANNOTATIONS),
								(view) =>
									isCurrent(view) && !isLiveAnnotationStatus(view.status),
							);
							if (refreshed.shown.length === 0) return null;
							const accepted = refreshed.shown.filter(
								(view) => view.status === "resolved",
							);
							const dismissed = refreshed.shown.filter(
								(view) => view.status === "dismissed",
							);
							return {
								status: "verdict",
								...base(),
								...(await roundNow()),
								annotations: refreshed.bodies,
								counts: countsOf(found.live),
								next: [
									...(accepted.length > 0
										? [
												`The designer accepted ${plural(accepted.length, "annotation")} you addressed or proposed (${accepted.map((view) => view.id).join(", ")}).`,
											]
										: []),
									...(dismissed.length > 0
										? [
												`The designer dismissed ${plural(dismissed.length, "annotation")} you addressed or proposed (${dismissed.map((view) => view.id).join(", ")}).`,
											]
										: []),
									"Nothing more to do for them.",
									`Keep waiting on the round with ${keepWaiting}.`,
								].join(" "),
							};
						}
						if (found.kind === "closed") {
							const left = found.live.filter(
								(view) => view.roundId === found.round.id,
							);
							const refreshed = await annotations.showInFull(
								project,
								left.slice(0, MAX_SURFACED_ANNOTATIONS),
								(view) =>
									isCurrent(view) && isLiveAnnotationStatus(view.status),
							);
							annotations.markRoundReported(project, found.round);
							const stillLive = liveNow(left, refreshed);
							const yours = stillLive.filter((view) =>
								annotations.isCurrentWork(project)(view),
							);
							const more = stillLive.length - refreshed.shown.length;
							const firstId = yours[0]?.id ?? "<annotationId>";
							return {
								status: "closed",
								...base(),
								round: describeRound(found.round, found.stored),
								annotations: refreshed.bodies,
								...(more > 0 ? { more } : {}),
								next: [
									`The designer closed round ${found.round.id}: no more feedback arrives for it, so do not call ${TOOL.annotationWatch} for it again.`,
									stillLive.length === 0
										? "Every annotation in it is resolved or dismissed. End your turn."
										: yours.length > 0
											? `${plural(yours.length, "annotation")} of it ${yours.length === 1 ? "is" : "are"} still your work (above, in full): finish ${yours.length === 1 ? "it" : "them"} with ${subject.addressCall(firstId)} or ${TOOL.annotationReply}, then end your turn.`
											: `${plural(stillLive.length, "annotation")} of it ${stillLive.length === 1 ? "waits" : "wait"} on the designer and ${stillLive.length === 1 ? "needs" : "need"} nothing from you. End your turn.`,
									`${list} lists them later.`,
								].join(" "),
							};
						}
						return null;
					};

					let found = await look();
					let result: Record<string, unknown> | null = null;
					if (found.kind !== "waiting") result = await take(found);
					if (!result && round && found.kind === "waiting" && !found.open) {
						return createJsonResult({
							status: "idle",
							...base(),
							...(found.live.length > 0
								? { counts: countsOf(found.live) }
								: {}),
							next: `The designer has not sent a round on this ${subject.noun} (none is open on branch "${project.scope.branch}"). Go on with your task; do not keep waiting. New remarks arrive in the annotations block of your next ${subject.noun} tool result.`,
						});
					}
					if (!result) {
						const changes = createChangeWaiter(directory);
						try {
							while (!signal?.aborted && Date.now() < deadline) {
								await changes.wait(
									Math.min(WATCH_POLL_INTERVAL_MS, deadline - Date.now()),
									signal,
								);
								if (signal?.aborted) break;
								found = await look();
								if (found.kind === "work" || found.kind === "verdict") {
									// The designer may be sending or accepting several:
									// collect the batch, against a fresh read.
									await sleep(
										Math.min(WATCH_BATCH_WINDOW_MS, deadline - Date.now()),
										signal,
									);
									if (signal?.aborted) break;
									await subject.refresh();
									found = await look();
								}
								if (found.kind !== "waiting") {
									result = await take(found);
									if (result) break;
								} else if (round && !found.open) {
									// The round is gone without a close this session
									// saw: nothing to wait on.
									result = {
										status: "idle",
										...base(),
										next: `No round is open on this ${subject.noun} any more. Go on with your task; do not keep waiting.`,
									};
									break;
								}
								await reportProgress();
							}
						} finally {
							changes.close();
						}
					}
					if (signal?.aborted) {
						return createJsonResult({ status: "cancelled", ...base() });
					}
					if (result) return createJsonResult(result);
					const open = found.kind === "waiting" ? found.open : null;
					const waited = Math.round((Date.now() - startedAt) / 1000);
					const counts = open
						? summarizeRound(
								open,
								found.stored.map(({ annotation }) => annotation),
							)
						: null;
					return createJsonResult({
						status: "timeout",
						...base(),
						...(open ? { round: describeRound(open, found.stored) } : {}),
						counts: countsOf(found.live),
						next:
							open && counts
								? `Round ${open.id} is still open: ${counts.closed} of ${counts.total} closed, ${counts.humanWork} waiting on the designer, who is still reviewing. Keep waiting with ${keepWaiting}.`
								: `No new annotations in ${waited} s. Keep waiting with ${keepWaiting}.`,
					});
				}),
			),
	);
};
