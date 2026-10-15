import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isPendingAnnotation } from "../../services/annotation-model";
import {
	type AnnotationComponentRead,
	AnnotationServiceError,
	listAnnotations,
	reanchorAnnotation,
	replyToAnnotation,
	scanLanded,
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
	boardIdOf,
	compactCounts,
	describeAnnotation,
	plural,
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
import { registerAnnotationWatchTool } from "./annotation-watch";
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

const LIVE_STATUSES = ANNOTATION_STATUSES.filter(
	(status) => !CLOSED_ANNOTATION_STATUSES.has(status),
);

const statusSchema = z.enum(ANNOTATION_STATUSES);
const statusFilterSchema = z
	.union([statusSchema, z.enum(["live", "all"]), z.array(statusSchema).min(1)])
	.optional()
	.describe(
		'"live" (default: open, acknowledged, needs_input, addressed, proposed), "all", one status or a list.',
	);

const elementIdSchema = z.string().min(1);

const toStatuses = (
	status: z.infer<typeof statusFilterSchema>,
): readonly AnnotationStatus[] | undefined => {
	if (status === undefined || status === "live") return LIVE_STATUSES;
	if (status === "all") return undefined;
	return typeof status === "string" ? [status] : status;
};

/**
 * For an annotation_list that returned nothing: what its status and branch
 * filters left out of the container, which the agent cannot see, with the
 * filter that lists it. Null when they left out nothing.
 */
const describeHiddenAnnotations = async (
	project: AnnotationProject,
	container: AnnotationContainer,
	{
		branch,
		statuses,
	}: { branch: string; statuses: readonly AnnotationStatus[] | undefined },
) => {
	let stored: Annotation[];
	try {
		// As agents see them: a send still being written is not hinted at.
		const scan = await scanLanded(project.service, container);
		const now = project.service.now?.() ?? new Date();
		stored = scan.stored.annotations
			.map(({ annotation }) => annotation)
			.filter(
				(annotation) => !isPendingAnnotation(annotation, scan.roundsById, now),
			);
	} catch {
		return null;
	}
	const closed =
		statuses === undefined
			? 0
			: stored.filter(
					(annotation) =>
						(branch === "all" || annotation.branch === branch) &&
						CLOSED_ANNOTATION_STATUSES.has(annotation.status) &&
						!statuses.includes(annotation.status),
				).length;
	const elsewhere =
		branch === "all"
			? 0
			: stored.filter(
					(annotation) =>
						annotation.branch !== branch &&
						!CLOSED_ANNOTATION_STATUSES.has(annotation.status),
				).length;
	if (closed === 0 && elsewhere === 0) return null;
	const where = container.kind === "design" ? "This design" : "This component";
	return [
		"No annotations match.",
		...(closed > 0
			? [
					`${where} has ${plural(closed, "closed annotation")} (resolved or dismissed), which status: "all" lists.`,
				]
			: []),
		...(elsewhere > 0
			? [
					`${where} has ${plural(elsewhere, "live annotation")} on other git branches, which branch: "all" lists. Only the designer can move one to this branch.`,
				]
			: []),
	].join(" ");
};

const isAgentWork = (status: AnnotationStatus) =>
	status === "open" || status === "acknowledged";

/**
 * Where an annotation sits in a list: [group, board rank, createdAt, id].
 * Group 0 is agent work, 1 what waits on the designer, 2 closed. Board rank
 * follows the design's board order: design-level annotations rank -1, boards
 * the design does not have rank after all of its boards (the rule of
 * `sortForSurfacing`). The sort and the pagination cursor both use this key.
 */
type ListKey = readonly [number, number, string, string];

const listKeyOf = (
	view: AnnotationView,
	boardOrder: ReadonlyMap<string, number>,
): ListKey => {
	const boardId = boardIdOf(view.target);
	return [
		isAgentWork(view.status)
			? 0
			: CLOSED_ANNOTATION_STATUSES.has(view.status)
				? 2
				: 1,
		boardId === null ? -1 : (boardOrder.get(boardId) ?? boardOrder.size),
		view.createdAt,
		view.id,
	];
};

const compareListKeys = (a: ListKey, b: ListKey) =>
	a[0] - b[0] ||
	a[1] - b[1] ||
	a[2].localeCompare(b[2]) ||
	a[3].localeCompare(b[3]);

const createBoardOrder = (design: TrickroomDesign | null) =>
	new Map((design?.boards ?? []).map((board, index) => [board.id, index]));

const isListKey = (value: unknown): value is ListKey =>
	Array.isArray(value) &&
	value.length === 4 &&
	typeof value[0] === "number" &&
	typeof value[1] === "number" &&
	typeof value[2] === "string" &&
	typeof value[3] === "string";

/** annotation_list cursor: opaque to the agent, tied to the filters it came from. */
const CURSOR_VERSION = 1;

const fingerprintListFilters = (filters: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(filters))
		.digest("hex")
		.slice(0, 16);

const encodeListCursor = (fingerprint: string, key: ListKey) =>
	Buffer.from(
		JSON.stringify({ v: CURSOR_VERSION, f: fingerprint, k: key }),
	).toString("base64url");

/** The cursor's position key, or null when it is not a cursor of this call's filters. */
const decodeListCursor = (
	cursor: string,
	fingerprint: string,
): ListKey | null => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			(parsed as { v?: unknown }).v !== CURSOR_VERSION ||
			(parsed as { f?: unknown }).f !== fingerprint
		) {
			return null;
		}
		const key = (parsed as { k?: unknown }).k;
		return isListKey(key) ? key : null;
	} catch {
		return null;
	}
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
			description: `Annotations are remarks a designer anchors to a design, a board or a layer in the Trickroom editor, for an agent to act on. Lists a design's annotations (or a system component's, with systemId and componentId: target nodePath is the template path, variants the configuration a pinned one is about) with ids, target (boardId, elementId), the names they were made on, status and every entry, so each follow-up call has what it needs. Defaults: live ones (open and acknowledged are your work; needs_input, addressed and proposed wait on the designer) on the current git branch; branch "all" or a name shows other checkouts'. Filter with boardId, elementId and status. Past limit, pass the nextCursor of the previous call with the same filters as cursor; an annotation whose status changes between pages may appear again on a later page (it moved to a later group) or not be returned again (it moved to an earlier group). Address an annotation with ${TOOL.designApply} (components: ${TOOL.componentDraftUpdate}) addresses: [{ annotationId, reply }] in the write that makes the change; reply, ask, resolve or dismiss without a write with ${TOOL.annotationReply}. Seeing an open annotation in full acknowledges it for this session. Results of ${TOOL.designRead}, ${TOOL.designApply}, ${TOOL.designValidate}, ${TOOL.designScreenshot} and ${TOOL.editorContext} already show new ones.`,
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
				cursor: z
					.string()
					.min(1)
					.optional()
					.describe(
						"The nextCursor of a previous call with the same filters: the page after it.",
					),
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
			cursor,
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
				const requestedBranch =
					branch === undefined || branch === "current"
						? project.scope.branch
						: branch;
				const statuses = toStatuses(status);
				const fingerprint = fingerprintListFilters({
					container:
						container.kind === "design"
							? [container.designId]
							: [container.systemId, container.componentId],
					requestedBranch,
					status: statuses ? [...statuses].sort() : "all",
					boardId,
					elementId,
					nodePath,
				});
				const after =
					cursor === undefined ? null : decodeListCursor(cursor, fingerprint);
				if (cursor !== undefined && !after) {
					return createToolErrorResult(
						context,
						"INVALID_CURSOR",
						`cursor is not a nextCursor of this ${TOOL.annotationList} call's filters (or not a cursor at all). Call ${TOOL.annotationList} again without cursor to start over, with the same filters as the call that returned it.`,
					);
				}
				try {
					const listed = await listAnnotations(project.service, {
						container,
						scope: project.scope,
						// A send is seen whole: not before its round lists it.
						landedOnly: true,
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
					const boardOrder = createBoardOrder(read.design);
					const keyed = new Map(
						listed.annotations.map((view) => [
							view.id,
							listKeyOf(view, boardOrder),
						]),
					);
					const keyOf = (view: AnnotationView) =>
						keyed.get(view.id) ?? listKeyOf(view, boardOrder);
					const sorted = [...listed.annotations].sort((a, b) =>
						compareListKeys(keyOf(a), keyOf(b)),
					);
					const max = limit ?? DEFAULT_LIST_LIMIT;
					// The request's filters, applied again to the fresh state of
					// what is shown: another writer may have moved it to another
					// branch, closed it or removed it since it was listed.
					const matches = (view: Annotation) =>
						(requestedBranch === "all" || view.branch === requestedBranch) &&
						(statuses === undefined || statuses.includes(view.status)) &&
						(elementId === undefined ||
							(view.target.kind === "layer" &&
								view.target.elementId === elementId)) &&
						(nodePath === undefined ||
							(view.target.kind === "componentNode" &&
								view.target.nodePath === nodePath));
					// The page: the first `max` strictly after the cursor's position.
					const page = (
						after
							? sorted.filter((view) => compareListKeys(keyOf(view), after) > 0)
							: sorted
					).slice(0, max);
					const lastOfPage = page.at(-1);
					const nextKey = lastOfPage ? keyOf(lastOfPage) : null;
					const shown = await annotations.showInFull(project, page, matches, {
						branch: requestedBranch !== project.scope.branch,
					});
					// One set for the bodies, total, more and counts.
					const { bodies } = shown;
					const eligible = annotations.refreshListed(sorted, shown, matches);
					const counts = summarizeAnnotationCounts(
						eligible.filter((view) => view.branch === project.scope.branch),
						read.design,
						component?.template,
					);
					// What follows the page, as the annotations are now; the next
					// cursor is the page's last as listed, so ones the refresh
					// dropped are not retried.
					const more = nextKey
						? eligible.filter(
								(view) =>
									compareListKeys(listKeyOf(view, boardOrder), nextKey) > 0,
							).length
						: 0;
					const nextCursor =
						more > 0 && nextKey ? encodeListCursor(fingerprint, nextKey) : null;
					const hidden =
						eligible.length === 0
							? await describeHiddenAnnotations(project, container, {
									branch: requestedBranch,
									statuses,
								})
							: null;
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
						...(nextCursor
							? {
									more,
									nextCursor,
									next: `${TOOL.annotationList}({ ${[
										container.kind === "design"
											? `designFileId: ${JSON.stringify(container.designId)}`
											: `systemId: ${JSON.stringify(systemHandle)}, componentId: ${JSON.stringify(container.componentId)}`,
										...(boardId !== undefined
											? [`boardId: ${JSON.stringify(boardId)}`]
											: []),
										...(elementId !== undefined
											? [`elementId: ${JSON.stringify(elementId)}`]
											: []),
										...(nodePath !== undefined
											? [`nodePath: ${JSON.stringify(nodePath)}`]
											: []),
										...(status !== undefined
											? [`status: ${JSON.stringify(status)}`]
											: []),
										...(branch !== undefined
											? [`branch: ${JSON.stringify(branch)}`]
											: []),
										...(limit !== undefined ? [`limit: ${limit}`] : []),
										`cursor: ${JSON.stringify(nextCursor)}`,
									].join(", ")} })`,
								}
							: {}),
						counts: compactCounts(counts.total),
						...(hidden ? { next: hidden } : {}),
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
			description: `Answer a designer's annotation without a design write. body: a reply; question: ask the designer (status needs_input until they answer); dismiss: { reason } when you will not do it; propose: { summary } when the remark needs no change (already the case, conflicts with another remark, out of scope, or you recommend another approach): status proposed until the designer accepts (resolves) or replies; resolve: { summary? } only when the designer asked you to resolve it; reanchor: { elementId } or { boardId } moves it to another layer or board of the same design, for example after copySubtree or detachSystemComponent replaced the element it was on, and { nodePath } to another node of the same system component (a pin to a variant configuration stays; status unchanged; returns the new target and snapshot). At most one of question, propose, dismiss, resolve and reanchor; body may go with any. For a change you make, do not reply here: pass addresses: [{ annotationId, reply }] to the ${TOOL.designApply} (components: ${TOOL.componentDraftUpdate} or ${TOOL.componentPublish}) that makes it, which records the change and marks it addressed. Recorded as this agent session; needs read-write mode.`,
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
				propose: z
					.object({
						summary: z
							.string()
							.min(1)
							.describe("Why no change is needed, for the designer."),
					})
					.strict()
					.optional()
					.describe(
						"Ask the designer to close it without a change: proposed until they accept or reply.",
					),
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
			propose,
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
				const actions = [question, propose, dismiss, resolve, reanchor].filter(
					(value) => value !== undefined,
				);
				if (actions.length > 1) {
					return createToolErrorResult(
						context,
						"INVALID_INPUT",
						"Pass at most one of question, propose, dismiss, resolve and reanchor; body may go with any.",
					);
				}
				if (body === undefined && actions.length === 0) {
					return createToolErrorResult(
						context,
						"INVALID_INPUT",
						"Pass a body, a question, propose, dismiss, resolve or reanchor.",
					);
				}
				// Every text is checked before anything is written, so a call
				// either does all it asks or nothing.
				const blank = (
					[
						["body", body],
						["question", question],
						["propose.summary", propose?.summary],
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
					: propose
						? "propose"
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
									...(propose !== undefined ? { propose } : {}),
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
												...(view.snapshot.variants
													? { variants: view.snapshot.variants }
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

	registerAnnotationWatchTool(ctx, {
		openProject,
		isResult,
		withAnnotationErrors,
	});
};
