import { type FSWatcher, watch } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	type AnnotationComponentRead,
	AnnotationServiceError,
	listAnnotations,
	reanchorAnnotation,
	replyToAnnotation,
	summarizeAnnotationCounts,
} from "../../services/annotation-service";
import { AnnotationStoreError } from "../../services/annotation-store";
import {
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationContainer,
	type AnnotationStatus,
	type AnnotationTarget,
	type AnnotationView,
	CLOSED_ANNOTATION_STATUSES,
} from "../../services/annotations.types";
import {
	type ComponentAnchorRead,
	readComponentAnchor,
	resolveAnnotationSystemId,
} from "../../services/component-annotations";
import { createElementNotFoundError } from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import {
	type AnnotationProject,
	compactCounts,
	describeAnnotation,
	MAX_SURFACED_ANNOTATIONS,
	sortForSurfacing,
} from "../annotation-session";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import {
	findElementContext,
	getNodeName,
	readDesignFileForTool,
} from "../payloads/design-tree";
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
			description: `Annotations are remarks a designer anchors to a design, a board or a layer in the Trickroom editor, for an agent to act on. Lists a design's annotations (or a system component's, with systemId and componentId: target nodePath is the template path, variants the configuration a pinned one is about) with ids, target (boardId, elementId), the names they were made on, status and every entry, so each follow-up call has what it needs. Defaults: live ones (open and acknowledged are your work; needs_input and addressed wait on the designer) on the current git branch; branch "all" or a name shows other checkouts'. Filter with boardId, elementId and status. Address an annotation with ${TOOL.designApply} (components: ${TOOL.componentDraftUpdate}) addresses: [{ annotationId, reply }] in the write that makes the change; reply, ask, resolve or dismiss without a write with ${TOOL.annotationReply}. Seeing an open annotation in full acknowledges it for this session. Results of ${TOOL.designRead}, ${TOOL.designApply}, ${TOOL.designValidate}, ${TOOL.designScreenshot} and ${TOOL.editorContext} already show new ones.`,
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
				nodePath: z
					.string()
					.min(1)
					.optional()
					.describe("Component annotations on this template node path."),
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
			systemId: systemHandle,
			componentId,
			boardId,
			elementId,
			nodePath,
			status,
			branch,
			limit,
			project: projectRef,
		}) =>
			withPolicyErrorHandling(projectRef, async (context) => {
				// A system named by name lists the folder of its id.
				const systemId = systemHandle
					? ((await resolveAnnotationSystemId(
							context.projectRoot,
							systemHandle,
						).catch(() => null)) ?? systemHandle)
					: undefined;
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
				// A component's template (draft, else published): detached paths.
				const component =
					container.kind === "component"
						? await readComponentAnchor(
								context.projectRoot,
								container.systemId,
								container.componentId,
							).catch(() => null)
						: null;
				try {
					const listed = await listAnnotations(project.service, {
						container,
						scope: project.scope,
						branch: branch ?? "current",
						statuses: toStatuses(status),
						...(boardId !== undefined ? { boardId } : {}),
						...(elementId !== undefined ? { elementId } : {}),
						...(nodePath !== undefined ? { nodePath } : {}),
						...(read.design ? { design: read.design } : {}),
						...(component ? { component: component.template } : {}),
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
					// The request's filters, applied again to the fresh state of
					// what is shown: another writer may have moved it to another
					// branch, closed it or removed it since it was listed.
					const requestedBranch =
						branch === undefined || branch === "current"
							? project.scope.branch
							: branch;
					const statuses = toStatuses(status);
					const matches = (view: Annotation) =>
						(requestedBranch === "all" || view.branch === requestedBranch) &&
						(statuses === undefined || statuses.includes(view.status)) &&
						(elementId === undefined ||
							(view.target.kind === "layer" &&
								view.target.elementId === elementId)) &&
						(nodePath === undefined ||
							(view.target.kind === "componentNode" &&
								view.target.nodePath === nodePath));
					const shown = await annotations.showInFull(
						project,
						sorted.slice(0, max),
						matches,
						{ branch: requestedBranch !== project.scope.branch },
					);
					// One set for the bodies, total, more and counts.
					const { bodies } = shown;
					const eligible = annotations.refreshListed(sorted, shown, matches);
					const counts = summarizeAnnotationCounts(
						eligible.filter((view) => view.branch === project.scope.branch),
						read.design,
						component?.template,
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
										...(component
											? {
													name: component.name,
													revision: component.revision,
													anchoredTo: component.source,
												}
											: {}),
									},
								}),
						branch: project.scope.branch,
						annotations: bodies,
						total: eligible.length,
						...(eligible.length > bodies.length
							? {
									more: eligible.length - bodies.length,
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
			description: `Answer a designer's annotation without a design write. body: a reply; question: ask the designer (status needs_input until they answer); dismiss: { reason } when you will not do it; resolve: { summary? } only when the designer asked you to resolve it; reanchor: { elementId } or { boardId } moves it to another layer or board of the same design, for example after copySubtree or detachSystemComponent replaced the element it was on, and { nodePath } to another node of the same system component (a pin to a variant configuration stays; status unchanged; returns the new target and snapshot). At most one of question, dismiss, resolve and reanchor; body may go with any. For a change you make, do not reply here: pass addresses: [{ annotationId, reply }] to the ${TOOL.designApply} (components: ${TOOL.componentDraftUpdate} or ${TOOL.componentPublish}) that makes it, which records the change and marks it addressed. Recorded as this agent session; needs read-write mode.`,
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
				reanchor: z
					.union([
						z
							.object({
								elementId: z
									.string()
									.min(1)
									.describe("Layer (or board) in the same design."),
							})
							.strict(),
						z
							.object({
								boardId: z
									.string()
									.min(1)
									.describe("Board in the same design."),
							})
							.strict(),
						z
							.object({
								nodePath: z
									.string()
									.min(1)
									.describe("Template node path in the same component."),
							})
							.strict(),
					])
					.optional()
					.describe(
						"Move the annotation to another layer or board of its design (or node of its component), e.g. the element that replaced the one it was on.",
					),
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
			reanchor,
			designFileId,
			project: projectRef,
		}) =>
			withPolicyErrorHandling(projectRef, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const project = await openProject(context);
				if (isResult(project)) return project;
				const actions = [question, dismiss, resolve, reanchor].filter(
					(value) => value !== undefined,
				);
				if (actions.length > 1) {
					return createToolErrorResult(
						context,
						"INVALID_INPUT",
						"Pass at most one of question, dismiss, resolve and reanchor; body may go with any.",
					);
				}
				if (body === undefined && actions.length === 0) {
					return createToolErrorResult(
						context,
						"INVALID_INPUT",
						"Pass a body, a question, dismiss, resolve or reanchor.",
					);
				}
				// Every text is checked before anything is written, so a call
				// either does all it asks or nothing.
				const blank = (
					[
						["body", body],
						["question", question],
						["dismiss.reason", dismiss?.reason],
						["resolve.summary", resolve?.summary],
					] as const
				).find(([, value]) => value !== undefined && value.trim().length === 0);
				if (blank) {
					return createToolErrorResult(
						context,
						"INVALID_INPUT",
						`${blank[0]} must not be blank. Nothing was written.`,
					);
				}
				const action = question
					? "question"
					: dismiss
						? "dismiss"
						: resolve
							? "resolve"
							: reanchor
								? "reanchor"
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
							...(reanchor ? { reanchor } : {}),
							...(container.kind === "component"
								? {
										systemId: container.systemId,
										componentId: container.componentId,
									}
								: {}),
						},
					};
					// The new target, resolved against the annotation's own design:
					// re-anchoring never leaves it.
					let reanchorTo: {
						target: AnnotationTarget;
						design?: { design: TrickroomDesign; revision: string };
						component?: AnnotationComponentRead;
					} | null = null;
					if (reanchor && "nodePath" in reanchor) {
						if (container.kind !== "component") {
							return createToolErrorResult(
								context,
								"INVALID_INPUT",
								"nodePath re-anchors a component annotation; this one is on a design: pass elementId or boardId.",
								{ annotationId },
							);
						}
						const anchor: ComponentAnchorRead | null =
							await readComponentAnchor(
								context.projectRoot,
								container.systemId,
								container.componentId,
							);
						if (!anchor) {
							return createToolErrorResult(
								context,
								"COMPONENT_NOT_FOUND",
								`Component ${container.componentId} no longer exists in design system ${container.systemId}; its annotations cannot be re-anchored.`,
								{ annotationId },
							);
						}
						const current = await project.service.store.read(
							container,
							annotationId,
						);
						const pinned =
							current?.annotation.target.kind === "componentNode"
								? current.annotation.target.variants
								: undefined;
						reanchorTo = {
							target: {
								kind: "componentNode",
								systemId: container.systemId,
								componentId: container.componentId,
								nodePath: reanchor.nodePath,
								...(pinned ? { variants: pinned } : {}),
							},
							component: {
								template: anchor.template,
								revision: anchor.revision,
							},
						};
					} else if (reanchor) {
						if (container.kind !== "design") {
							return createToolErrorResult(
								context,
								"INVALID_INPUT",
								"A component annotation re-anchors to a node: pass reanchor: { nodePath }.",
								{ annotationId },
							);
						}
						const read = await readDesignFileForTool(
							context,
							container.designId,
						);
						const design = { design: read.design, revision: read.revision };
						const boardId =
							"boardId" in reanchor
								? reanchor.boardId
								: read.design.boards.some(
											(entry) => entry.id === reanchor.elementId,
										)
									? reanchor.elementId
									: null;
						if (boardId !== null) {
							if (!read.design.boards.some((entry) => entry.id === boardId)) {
								return createToolErrorResult(
									context,
									"BOARD_NOT_FOUND",
									`Board "${boardId}" is not in design "${read.design.name}", the annotation's design; re-anchoring stays within it.`,
									{
										designFileId: container.designId,
										availableBoards: read.design.boards.map((entry) => ({
											id: entry.id,
											name: getNodeName(entry) ?? null,
										})),
									},
								);
							}
							reanchorTo = {
								target: {
									kind: "board",
									designId: container.designId,
									boardId,
								},
								design,
							};
						} else if ("elementId" in reanchor) {
							const found = findElementContext(read.design, reanchor.elementId);
							if (!found) {
								const notFound = createElementNotFoundError(
									read.design,
									reanchor.elementId,
								);
								return createToolErrorResult(
									context,
									notFound.code,
									`Element "${reanchor.elementId}" is not in design "${read.design.name}", the annotation's design; re-anchoring stays within it.`,
									{ designFileId: container.designId, ...notFound.details },
								);
							}
							reanchorTo = {
								target: {
									kind: "layer",
									designId: container.designId,
									boardId: found.board.id,
									elementId: reanchor.elementId,
								},
								design,
							};
						}
					}
					let result: CallToolResult;
					try {
						// One write either way: a re-anchor carries its reply.
						const outcome = reanchorTo
							? await reanchorAnnotation(project.service, {
									annotationId,
									container,
									by: project.by,
									target: reanchorTo.target,
									...(reanchorTo.design ? { design: reanchorTo.design } : {}),
									...(reanchorTo.component
										? { component: reanchorTo.component }
										: {}),
									branch: project.scope.branch,
									...(body !== undefined ? { body } : {}),
								})
							: await replyToAnnotation(project.service, {
									annotationId,
									container,
									by: project.by,
									branch: project.scope.branch,
									...(body !== undefined ? { body } : {}),
									...(question !== undefined ? { question } : {}),
									...(dismiss !== undefined ? { dismiss } : {}),
									...(resolve !== undefined ? { resolve } : {}),
								});
						const view = reanchorTo
							? { ...outcome.annotation, detached: false }
							: outcome.annotation;
						annotations.markSeen(project, view);
						annotations.startClock(project);
						const shownView = (
							await annotations.showInFull(project, [view], () => true)
						).bodies[0];
						result = createJsonResult({
							status: "success",
							project: getProjectReference(context),
							annotation:
								shownView ??
								describeAnnotation(view, annotations.sessionId, {
									now: new Date(),
								}),
							...(reanchorTo
								? {
										reanchored: {
											target: view.target,
											snapshot: {
												...(view.snapshot.layerName
													? { name: view.snapshot.layerName }
													: {}),
												...(view.snapshot.ancestorNames
													? { path: view.snapshot.ancestorNames }
													: {}),
												...(view.snapshot.component
													? { component: view.snapshot.component }
													: {}),
												...(view.snapshot.designRevision
													? { designRevision: view.snapshot.designRevision }
													: {}),
											},
										},
									}
								: {}),
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

					// With boardId, the board an annotation is on now (a layer that
					// moved boards counts where it is), from WP2's derivation over a
					// fresh read of the design: only read when there is unseen work.
					const check = async () => {
						let { annotations: live } = await annotations.listLive(
							project,
							designFileId,
							design,
						);
						let unseen = annotations.takeUnseen(project, live, design);
						if (boardId !== undefined && unseen.length > 0) {
							design = await readDesignFileForTool(context, designFileId)
								.then((read) => read.design)
								.catch(() => design);
							({ annotations: live } = await annotations.listLive(
								project,
								designFileId,
								design,
							));
							const onBoard = new Set(
								(
									await listAnnotations(project.service, {
										container: { kind: "design", designId: designFileId },
										scope: project.scope,
										statuses: LIVE_STATUSES,
										boardId,
										design,
									})
								).annotations.map((view) => view.id),
							);
							unseen = annotations
								.takeUnseen(project, live, design)
								.filter((view) => onBoard.has(view.id));
						}
						return { live, unseen };
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

					const keepWaiting = `${TOOL.annotationWatch}({ designFileId: "${designFileId}"${boardId ? `, boardId: "${boardId}"` : ""} })`;
					const keep = annotations.isCurrentWork(project);
					/**
					 * Unseen work, as it is now: acknowledged and shown, with the
					 * live annotations refreshed against it. Null when nothing that
					 * was unseen is still this branch's work (moved, answered or
					 * removed meanwhile): keep waiting.
					 */
					const take = async () => {
						// Re-read: layers may have moved, the batch may have grown.
						design = await readDesignFileForTool(context, designFileId)
							.then((read) => read.design)
							.catch(() => design);
						const found = await check();
						if (found.unseen.length === 0) return null;
						const refreshed = await annotations.showInFull(
							project,
							found.unseen.slice(0, MAX_SURFACED_ANNOTATIONS),
							keep,
						);
						const { shown, bodies } = refreshed;
						if (shown.length === 0) return null;
						const eligible = annotations.refreshListed(
							found.live,
							refreshed,
							(view) =>
								view.branch === project.scope.branch &&
								!CLOSED_ANNOTATION_STATUSES.has(view.status),
						);
						const eligibleIds = new Set(eligible.map((view) => view.id));
						const shownIds = new Set(shown.map((view) => view.id));
						return {
							shown,
							bodies,
							eligible,
							more: found.unseen.filter(
								(view) => eligibleIds.has(view.id) && !shownIds.has(view.id),
							).length,
						};
					};

					let taken: Awaited<ReturnType<typeof take>> = null;
					if ((await check()).unseen.length > 0) taken = await take();
					if (!taken) {
						const changes = createChangeWaiter(directory);
						try {
							while (!signal?.aborted && Date.now() < deadline) {
								await changes.wait(
									Math.min(WATCH_POLL_INTERVAL_MS, deadline - Date.now()),
									signal,
								);
								if (signal?.aborted) break;
								if ((await check()).unseen.length > 0) {
									// The designer may be sending several: collect the batch.
									await sleep(
										Math.min(WATCH_BATCH_WINDOW_MS, deadline - Date.now()),
										signal,
									);
									if (signal?.aborted) break;
									taken = await take();
									if (taken) break;
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
					if (!taken) {
						const { live } = await check();
						return createJsonResult({
							status: "timeout",
							project: getProjectReference(context),
							designFileId,
							waitedMs,
							counts: compactCounts(
								summarizeAnnotationCounts(live, design).total,
							),
							next: `No new annotations in ${Math.round(waitedMs / 1000)} s. Keep waiting with ${keepWaiting}.`,
						});
					}
					const { more } = taken;
					const firstId = taken.shown[0]?.id ?? "<annotationId>";
					return createJsonResult({
						status: "success",
						project: getProjectReference(context),
						designFileId,
						waitedMs,
						annotations: taken.bodies,
						...(more > 0 ? { more } : {}),
						counts: compactCounts(
							summarizeAnnotationCounts(taken.eligible, design).total,
						),
						next: `Address each with your next ${TOOL.designApply}({ designFileId: "${designFileId}", expectedRevision, operations, addresses: [{ annotationId: "${firstId}", reply: "<what you changed>" }] }), or ask with ${TOOL.annotationReply}({ annotationId: "${firstId}", question: "<your question>" }).${more > 0 ? ` ${more} more: ${TOOL.annotationList}({ designFileId: "${designFileId}" }).` : ""} Then ${keepWaiting} again.`,
					});
				}),
			),
	);
};
