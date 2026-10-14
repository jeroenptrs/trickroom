import { type FSWatcher, watch } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	AnnotationServiceError,
	listAnnotations,
	replyToAnnotation,
	summarizeAnnotationCounts,
} from "../../services/annotation-service";
import { AnnotationStoreError } from "../../services/annotation-store";
import {
	ANNOTATION_STATUSES,
	type AnnotationContainer,
	type AnnotationStatus,
	type AnnotationView,
	CLOSED_ANNOTATION_STATUSES,
} from "../../services/annotations.types";
import type { TrickroomDesign } from "../../types";
import {
	type AnnotationProject,
	boardIdOf,
	compactCounts,
	MAX_SURFACED_ANNOTATIONS,
	sortForSurfacing,
} from "../annotation-session";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import { readDesignFileForTool } from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { auditToolResult } from "./mutation-support";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

/**
 * annotation_list, annotation_reply and annotation_watch: the remarks
 * designers anchor to designs, boards and layers (and, from WP5, component
 * nodes), as agents read and answer them. Every write is attributed to this
 * session's agent; nothing in the input can change that. Results of the
 * design tools surface new annotations on their own (annotation-session.ts).
 */

/** annotation_list returns at most this many by default. */
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/** annotation_watch: how long it waits by default, and at most. */
export const WATCH_DEFAULT_TIMEOUT_MS = 50_000;
export const WATCH_MAX_TIMEOUT_MS = 300_000;
const WATCH_MIN_TIMEOUT_MS = 1_000;
/** After the first arrival, wait this long for the rest of a batch the designer sends. */
export const WATCH_BATCH_WINDOW_MS = 1_500;
/** The store is checked at least this often while waiting (and on every change event). */
const WATCH_POLL_INTERVAL_MS = 1_000;
const WATCH_PROGRESS_INTERVAL_MS = 10_000;

const LIVE_STATUSES = ANNOTATION_STATUSES.filter(
	(status) => !CLOSED_ANNOTATION_STATUSES.has(status),
);

const statusSchema = z.enum(ANNOTATION_STATUSES);
const statusFilterSchema = z
	.union([statusSchema, z.enum(["live", "all"]), z.array(statusSchema).min(1)])
	.optional()
	.describe(
		'"live" (default: open, acknowledged, needs_input, addressed), "all", one status or a list.',
	);

const elementIdSchema = z.string().min(1);

const toStatuses = (
	status: z.infer<typeof statusFilterSchema>,
): readonly AnnotationStatus[] | undefined => {
	if (status === undefined || status === "live") return LIVE_STATUSES;
	if (status === "all") return undefined;
	return typeof status === "string" ? [status] : status;
};

const isAgentWork = (status: AnnotationStatus) =>
	status === "open" || status === "acknowledged";

/** Agent work first, then what waits on the designer, then closed; by board, oldest first. */
const sortForList = (
	views: AnnotationView[],
	design: TrickroomDesign | null,
) => {
	const group = (view: AnnotationView) =>
		isAgentWork(view.status)
			? 0
			: CLOSED_ANNOTATION_STATUSES.has(view.status)
				? 2
				: 1;
	const sorted = sortForSurfacing(views, design);
	return sorted.sort((a, b) => group(a) - group(b));
};

/** Service and store errors are answers: codes the agent can act on. */
const createAnnotationErrorResult = (
	context: TrickroomMcpServerContext,
	error: unknown,
): CallToolResult | null => {
	if (
		error instanceof AnnotationStoreError ||
		error instanceof AnnotationServiceError
	) {
		return createToolErrorResult(
			context,
			error.code,
			error.message,
			error.details ?? {},
		);
	}
	return null;
};

/** Runs a tool body, answering service and store errors with their codes. */
const withAnnotationErrors = async (
	context: TrickroomMcpServerContext,
	fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
	try {
		return await fn();
	} catch (error) {
		const result = createAnnotationErrorResult(context, error);
		if (result) return result;
		throw error;
	}
};

const projectIdRequired = (context: TrickroomMcpServerContext) =>
	createToolErrorResult(
		context,
		"PROJECT_ID_REQUIRED",
		"This project has no projectId in .trickroom/config.json, so it has no annotations.",
	);

/** Reads a design when it exists; annotations of a deleted design are still listed. */
const readDesignIfPresent = async (
	context: TrickroomMcpServerContext,
	designId: string,
): Promise<{ design: TrickroomDesign | null; error?: unknown }> => {
	try {
		return { design: (await readDesignFileForTool(context, designId)).design };
	} catch (error) {
		return { design: null, error };
	}
};

/**
 * Waits on an annotation folder: `wait` resolves after `ms`, on a change in
 * the folder since the last wait, or on abort. The folder may not exist yet
 * (no annotation on the design); it is watched once it does, and the
 * timeout polls until then. `close` releases the watcher.
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

export const registerAnnotationTools = (ctx: McpToolContext) => {
	const { server, annotations, withPolicyErrorHandling } = ctx;

	/** The store and checkout of the session's project, or an error result. */
	const openProject = async (
		context: TrickroomMcpServerContext,
	): Promise<AnnotationProject | CallToolResult> =>
		(await annotations.openProject(context)) ?? projectIdRequired(context);

	const isResult = (value: unknown): value is CallToolResult =>
		typeof value === "object" && value !== null && "content" in value;

	server.registerTool(
		TOOL.annotationList,
		{
			title: "List Annotations",
			description: `Annotations are remarks a designer anchors to a design, a board or a layer in the Trickroom editor, for an agent to act on. Lists a design's annotations (or a system component's, with systemId and componentId) with ids, target (boardId, elementId), the names they were made on, status and every entry, so each follow-up call has what it needs. Defaults: live ones (open and acknowledged are your work; needs_input and addressed wait on the designer) on the current git branch; branch "all" or a name shows other checkouts'. Filter with boardId, elementId and status. Address an annotation with ${TOOL.designApply} addresses: [{ annotationId, reply }] in the write that makes the change; reply, ask, resolve or dismiss without a write with ${TOOL.annotationReply}. Seeing an open annotation in full acknowledges it for this session. Results of ${TOOL.designRead}, ${TOOL.designApply}, ${TOOL.designValidate}, ${TOOL.designScreenshot} and ${TOOL.editorContext} already show new ones.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema
					.optional()
					.describe("Design file UUID. Required unless systemId is set."),
				systemId: z
					.string()
					.min(1)
					.optional()
					.describe("With componentId: a system component's annotations."),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("System component id, with systemId."),
				boardId: elementIdSchema
					.optional()
					.describe(
						"Board and layer annotations on this board (a moved layer counts where it is now).",
					),
				elementId: elementIdSchema
					.optional()
					.describe("Annotations on this layer."),
				status: statusFilterSchema,
				branch: z
					.string()
					.min(1)
					.optional()
					.describe(
						'"current" (default): this checkout\'s git branch. "all", or a branch name.',
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_LIST_LIMIT)
					.optional()
					.describe(`At most this many (default ${DEFAULT_LIST_LIMIT}).`),
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"annotations remarks review notes designer requests todo pins threads",
			},
		},
		async ({
			designFileId,
			systemId,
			componentId,
			boardId,
			elementId,
			status,
			branch,
			limit,
			project: projectRef,
		}) =>
			withPolicyErrorHandling(projectRef, async (context) => {
				const container: AnnotationContainer | null = designFileId
					? { kind: "design", designId: designFileId }
					: systemId && componentId
						? { kind: "component", systemId, componentId }
						: null;
				if (
					!container ||
					(designFileId !== undefined && systemId !== undefined)
				) {
					return createToolErrorResult(
						context,
						"INVALID_OPERATION_PARAMETERS",
						"Pass designFileId, or systemId and componentId.",
					);
				}
				if (container.kind === "design") {
					assertCanReadDesignFile(
						getMcpPolicy(context.config),
						container.designId,
					);
				}
				const project = await openProject(context);
				if (isResult(project)) return project;
				const read =
					container.kind === "design"
						? await readDesignIfPresent(context, container.designId)
						: { design: null };
				try {
					const listed = await listAnnotations(project.service, {
						container,
						scope: project.scope,
						branch: branch ?? "current",
						statuses: toStatuses(status),
						...(boardId !== undefined ? { boardId } : {}),
						...(elementId !== undefined ? { elementId } : {}),
						...(read.design ? { design: read.design } : {}),
					});
					if (
						container.kind === "design" &&
						read.error &&
						listed.annotations.length === 0
					) {
						// Nothing stored and no such design: most likely a wrong id.
						throw read.error;
					}
					const sorted = sortForList([...listed.annotations], read.design);
					const max = limit ?? DEFAULT_LIST_LIMIT;
					const shown = sorted.slice(0, max);
					const bodies = await annotations.showInFull(project, shown, {
						branch: branch !== undefined && branch !== "current",
					});
					const counts = summarizeAnnotationCounts(
						listed.annotations.filter(
							(view) => view.branch === project.scope.branch,
						),
						read.design,
					);
					return createJsonResult({
						status: "success",
						project: getProjectReference(context),
						...(container.kind === "design"
							? { designFileId: container.designId }
							: {
									component: {
										systemId: container.systemId,
										componentId: container.componentId,
									},
								}),
						branch: project.scope.branch,
						annotations: bodies,
						total: sorted.length,
						...(sorted.length > shown.length
							? {
									more: sorted.length - shown.length,
									next: `Narrow with boardId, elementId or status, or raise limit (at most ${MAX_LIST_LIMIT}).`,
								}
							: {}),
						counts: compactCounts(counts.total),
						...(listed.problems.length > 0
							? { problems: listed.problems }
							: {}),
					});
				} catch (error) {
					const result = createAnnotationErrorResult(context, error);
					if (result) return result;
					throw error;
				}
			}),
	);

	server.registerTool(
		TOOL.annotationReply,
		{
			title: "Reply To Annotation",
			description: `Answer a designer's annotation without a design write. body: a reply; question: ask the designer (status needs_input until they answer); dismiss: { reason } when you will not do it; resolve: { summary? } only when the designer asked you to resolve it. At most one of question, dismiss and resolve; body may go with any. For a change you make, do not reply here: pass addresses: [{ annotationId, reply }] to the ${TOOL.designApply} that makes it, which records the change and marks it addressed. Recorded as this agent session; needs read-write mode.`,
			inputSchema: withProjectScopedInput({
				annotationId: z
					.string()
					.min(1)
					.describe(`Annotation id from ${TOOL.annotationList} or a result.`),
				body: z.string().min(1).optional().describe("Your reply."),
				question: z
					.string()
					.min(1)
					.optional()
					.describe("A question for the designer: the annotation needs input."),
				dismiss: z
					.object({ reason: z.string().min(1).describe("Why not.") })
					.strict()
					.optional()
					.describe("Not doing this, with a reason."),
				resolve: z
					.object({
						summary: z.string().min(1).optional().describe("What was done."),
					})
					.strict()
					.optional()
					.describe("Done. Only when the designer asked you to resolve it."),
				designFileId: designFileIdSchema
					.optional()
					.describe("The annotation's design, to find it faster."),
			}),
			annotations: { ...mutationAnnotations },
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"annotation reply answer question ask designer resolve dismiss remark",
			},
		},
		async ({
			annotationId,
			body,
			question,
			dismiss,
			resolve,
			designFileId,
			project: projectRef,
		}) =>
			withPolicyErrorHandling(projectRef, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const project = await openProject(context);
				if (isResult(project)) return project;
				const action = question
					? "question"
					: dismiss
						? "dismiss"
						: resolve
							? "resolve"
							: "reply";
				try {
					const container = await project.service.store.locate(
						annotationId,
						designFileId
							? { kind: "design", designId: designFileId }
							: undefined,
					);
					if (!container) {
						return createToolErrorResult(
							context,
							"ANNOTATION_NOT_FOUND",
							`Annotation ${annotationId} does not exist in this project. ${TOOL.annotationList} shows the design's annotations.`,
							{ annotationId },
						);
					}
					if (container.kind === "design") {
						assertCanWriteDesignFile(policy, container.designId);
					}
					const auditBase = {
						toolName: TOOL.annotationReply,
						operation: action,
						projectId: context.config.projectId ?? null,
						designFileId:
							container.kind === "design" ? container.designId : null,
						expectedRevision: null,
						details: {
							annotationId,
							...(container.kind === "component"
								? {
										systemId: container.systemId,
										componentId: container.componentId,
									}
								: {}),
						},
					};
					let result: CallToolResult;
					try {
						const outcome = await replyToAnnotation(project.service, {
							annotationId,
							container,
							by: project.by,
							...(body !== undefined ? { body } : {}),
							...(question !== undefined ? { question } : {}),
							...(dismiss !== undefined ? { dismiss } : {}),
							...(resolve !== undefined ? { resolve } : {}),
						});
						annotations.markSeen(project, outcome.annotation);
						annotations.startClock(project);
						result = createJsonResult({
							status: "success",
							project: getProjectReference(context),
							annotation: (
								await annotations.showInFull(project, [outcome.annotation])
							)[0],
							written: outcome.written,
						});
					} catch (error) {
						const errorResult = createAnnotationErrorResult(context, error);
						if (!errorResult) throw error;
						result = errorResult;
					}
					await auditToolResult(context, auditBase, result);
					return result;
				} catch (error) {
					const result = createAnnotationErrorResult(context, error);
					if (result) return result;
					throw error;
				}
			}),
	);

	server.registerTool(
		TOOL.annotationWatch,
		{
			title: "Wait For Annotations",
			description: `Wait until the designer sends new annotations (or answers or reopens one) on a design, then return them in full; for sessions told to keep working on the designer's remarks while no other tool is being called. Returns at once when there is unseen work; after the first arrival it waits ${WATCH_BATCH_WINDOW_MS / 1000} s more so remarks sent together come back together. timeoutMs defaults to ${WATCH_DEFAULT_TIMEOUT_MS / 1000} s (at most ${WATCH_MAX_TIMEOUT_MS / 60_000} min; longer than your client's request timeout fails the call); on timeout status is "timeout" and next is the call that keeps waiting. Current git branch only. Seeing an annotation in full acknowledges it for this session.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				boardId: elementIdSchema
					.optional()
					.describe("Only annotations on this board."),
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
					"annotations wait watch poll new remarks designer feedback loop listen",
			},
		},
		async ({ designFileId, boardId, timeoutMs, project: projectRef }, extra) =>
			withPolicyErrorHandling(projectRef, (context) =>
				withAnnotationErrors(context, async () => {
					assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
					// Fails with DESIGN_NOT_FOUND for a wrong id before waiting.
					let design = (await readDesignFileForTool(context, designFileId))
						.design;
					const project = await openProject(context);
					if (isResult(project)) return project;
					const directory = project.service.store.getContainerDirectory({
						kind: "design",
						designId: designFileId,
					});
					const signal = extra?.signal;
					const progressToken = extra?._meta?.progressToken;
					const timeout = timeoutMs ?? WATCH_DEFAULT_TIMEOUT_MS;
					const startedAt = Date.now();
					const deadline = startedAt + timeout;
					let lastProgressAt = startedAt;

					const check = async () => {
						const { annotations: live } = await annotations.listLive(
							project,
							designFileId,
							design,
						);
						const unseen = annotations.takeUnseen(project, live, design);
						return {
							live,
							unseen:
								boardId === undefined
									? unseen
									: unseen.filter((view) => boardIdOf(view.target) === boardId),
						};
					};
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
									message: "Waiting for annotations.",
								},
							})
							.catch(() => undefined);
					};

					let found = await check();
					if (found.unseen.length === 0) {
						const changes = createChangeWaiter(directory);
						try {
							while (!signal?.aborted && Date.now() < deadline) {
								await changes.wait(
									Math.min(WATCH_POLL_INTERVAL_MS, deadline - Date.now()),
									signal,
								);
								if (signal?.aborted) break;
								found = await check();
								if (found.unseen.length > 0) {
									// The designer may be sending several: collect the batch.
									await sleep(
										Math.min(WATCH_BATCH_WINDOW_MS, deadline - Date.now()),
										signal,
									);
									break;
								}
								await reportProgress();
							}
						} finally {
							changes.close();
						}
					}
					const waitedMs = Date.now() - startedAt;
					if (signal?.aborted) {
						return createJsonResult({
							status: "cancelled",
							project: getProjectReference(context),
							designFileId,
							waitedMs,
						});
					}
					if (found.unseen.length > 0) {
						// Re-read: the batch may have grown, layers may have moved.
						design = await readDesignFileForTool(context, designFileId)
							.then((read) => read.design)
							.catch(() => design);
						found = await check();
					}
					const counts = compactCounts(
						summarizeAnnotationCounts(found.live, design).total,
					);
					const keepWaiting = `${TOOL.annotationWatch}({ designFileId: "${designFileId}"${boardId ? `, boardId: "${boardId}"` : ""} })`;
					if (found.unseen.length === 0) {
						return createJsonResult({
							status: "timeout",
							project: getProjectReference(context),
							designFileId,
							waitedMs,
							counts,
							next: `No new annotations in ${Math.round(waitedMs / 1000)} s. Keep waiting with ${keepWaiting}.`,
						});
					}
					const shown = found.unseen.slice(0, MAX_SURFACED_ANNOTATIONS);
					const more = found.unseen.length - shown.length;
					const firstId = shown[0]?.id ?? "<annotationId>";
					return createJsonResult({
						status: "success",
						project: getProjectReference(context),
						designFileId,
						waitedMs,
						annotations: await annotations.showInFull(project, shown),
						...(more > 0 ? { more } : {}),
						counts,
						next: `Address each with your next ${TOOL.designApply}({ designFileId: "${designFileId}", expectedRevision, operations, addresses: [{ annotationId: "${firstId}", reply: "<what you changed>" }] }), or ask with ${TOOL.annotationReply}({ annotationId: "${firstId}", question: "<your question>" }).${more > 0 ? ` ${more} more: ${TOOL.annotationList}({ designFileId: "${designFileId}" }).` : ""} Then ${keepWaiting} again.`,
					});
				}),
			),
	);
};
