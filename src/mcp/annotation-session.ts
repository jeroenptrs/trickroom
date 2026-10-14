import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	AGENT_WORK_STATUSES,
	type AnnotationCounts,
	type AnnotationServiceContext,
	acknowledgeAnnotation,
	countAnnotations,
	getAnnotationAnchorIndex,
	listAnnotations,
	recordSessionCall,
	summarizeAnnotationCounts,
} from "../services/annotation-service";
import { AnnotationStore } from "../services/annotation-store";
import {
	ANNOTATION_STATUSES,
	type AnnotationActor,
	type AnnotationContainer,
	type AnnotationEntry,
	type AnnotationScope,
	type AnnotationStatus,
	type AnnotationTarget,
	type AnnotationView,
	CLOSED_ANNOTATION_STATUSES,
} from "../services/annotations.types";
import { readCheckoutScope } from "../services/checkout-scope";
import type { TrickroomDesign } from "../types";
import { getMcpPolicy } from "./governance";
import { readDesignFileForTool } from "./payloads/design-tree";
import type { TrickroomMcpServerContext } from "./server-types";
import { TOOL } from "./tool-names";

/**
 * Annotations as MCP sessions see them: the remarks a designer anchors to a
 * design, board or layer, delivered between tool calls (the only boundary an
 * MCP server has). Results of design_read, design_apply, design_validate,
 * design_screenshot and editor_context carry an `annotations` block for the
 * design they touched; the annotation tools list, reply and wait.
 *
 * Per session, in memory: a cursor of what this session has seen (per
 * annotation, a key of its status and entries), so full bodies are shown
 * once and afterwards only counted. Showing a body in full acknowledges an
 * open annotation for this session (docs/proposals/agent-annotations.md).
 */

/** Full bodies per result; the rest are counted and named in `next`. */
export const MAX_SURFACED_ANNOTATIONS = 10;

/** Ids listed in `openIds`; `counts` has the total. */
const MAX_OPEN_IDS = 50;

/** The session clock (acknowledgement expiry) is written at most this often. */
const SESSION_CALL_INTERVAL_MS = 5_000;

const LIVE_STATUSES = ANNOTATION_STATUSES.filter(
	(status) => !CLOSED_ANNOTATION_STATUSES.has(status),
);

const isAgentWork = (status: AnnotationStatus) =>
	AGENT_WORK_STATUSES.includes(status);

/** What the agent sees of a target: the design id is the call's. */
const describeTarget = (target: AnnotationTarget) => {
	switch (target.kind) {
		case "design":
			return { kind: target.kind };
		case "board":
			return { kind: target.kind, boardId: target.boardId };
		case "layer":
			return {
				kind: target.kind,
				boardId: target.boardId,
				elementId: target.elementId,
			};
		case "componentNode":
			return target;
	}
};

const describeActor = (by: AnnotationActor, sessionId: string) =>
	by.role === "human"
		? "human"
		: by.sessionId === sessionId
			? "this session"
			: "agent";

const describeEntry = (entry: AnnotationEntry, sessionId: string) => {
	const base = {
		kind: entry.kind,
		by: describeActor(entry.by, sessionId),
		at: entry.at,
	};
	switch (entry.kind) {
		case "remark":
		case "reply":
		case "question":
			return { ...base, text: entry.body };
		case "dismissal":
			return { ...base, text: entry.reason };
		case "resolution":
			return entry.summary ? { ...base, text: entry.summary } : base;
		case "change":
			return {
				...base,
				...(entry.body ? { text: entry.body } : {}),
				change: {
					summary: entry.change.summary,
					revisionAfter: entry.change.revisionAfter,
					layerIds: entry.change.layerIds,
					...(entry.revertedBy ? { reverted: true } : {}),
				},
			};
		case "revert":
			return { ...base, entryId: entry.entryId };
		case "reanchor":
			return {
				...base,
				from: describeTarget(entry.from),
				to: describeTarget(entry.to),
			};
		case "move":
			return { ...base, from: entry.from.branch, to: entry.to.branch };
	}
};

/**
 * An annotation as tool results show it: ids and anchor (so every follow-up
 * call has what it needs), the names it had when it was made, its status,
 * who acknowledged it, and its entries without change records' revert
 * state.
 */
export const describeAnnotation = (
	view: AnnotationView,
	sessionId: string,
	options: { now?: Date; branch?: boolean } = {},
) => {
	const { snapshot } = view;
	const acknowledgement = view.acknowledgement;
	const now = options.now ?? new Date();
	return {
		annotationId: view.id,
		status: view.status,
		target: describeTarget(view.target),
		...(snapshot.layerName ? { name: snapshot.layerName } : {}),
		...(snapshot.ancestorNames && snapshot.ancestorNames.length > 0
			? { path: snapshot.ancestorNames }
			: {}),
		...(snapshot.component ? { component: snapshot.component } : {}),
		...(view.detached ? { detached: true } : {}),
		...(acknowledgement
			? {
					acknowledged: {
						by:
							acknowledgement.sessionId === sessionId
								? "this session"
								: "another session",
						minutesAgo: Math.max(
							0,
							Math.floor(
								(now.getTime() - new Date(acknowledgement.at).getTime()) /
									60_000,
							),
						),
						active: acknowledgement.active,
					},
				}
			: {}),
		...(options.branch ? { branch: view.branch } : {}),
		entries: view.entries.map((entry) => describeEntry(entry, sessionId)),
		updatedAt: view.updatedAt,
	};
};

export type DescribedAnnotation = ReturnType<typeof describeAnnotation>;

/**
 * What the cursor compares: status (acknowledged counts as open, so another
 * session acknowledging does not resurface it), entries and target. A new
 * entry, a reopen or a re-anchor is a change; an acknowledgement is not.
 */
const surfaceKey = (annotation: AnnotationView) =>
	JSON.stringify([
		annotation.status === "acknowledged" ? "open" : annotation.status,
		annotation.entries.map((entry) => entry.id),
		annotation.target,
	]);

/** `counts` in results: work per side, and the non-zero statuses. */
export const compactCounts = (counts: AnnotationCounts) => ({
	agentWork: counts.agentWork,
	humanWork: counts.humanWork,
	byStatus: Object.fromEntries(
		Object.entries(counts.byStatus).filter(([, count]) => count > 0),
	),
	...(counts.detached > 0 ? { detached: counts.detached } : {}),
});

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? "" : "s"}`;

export const boardIdOf = (target: AnnotationTarget) =>
	target.kind === "board" || target.kind === "layer" ? target.boardId : null;

const boardNameOf = (
	view: AnnotationView,
	design: TrickroomDesign | null | undefined,
) => {
	const boardId = boardIdOf(view.target);
	if (!boardId) return null;
	const board = design?.boards.find((entry) => entry.id === boardId);
	const name = board?.props["data-trickroom-name"];
	if (typeof name === "string") return name;
	return view.target.kind === "board"
		? (view.snapshot.layerName ?? boardId)
		: (view.snapshot.ancestorNames?.[0] ?? boardId);
};

/** "board \"Checkout\"", "2 boards", or "the design". */
const describeWhere = (
	views: readonly AnnotationView[],
	design: TrickroomDesign | null | undefined,
) => {
	const boards = new Set(
		views
			.map((view) => boardNameOf(view, design))
			.filter((name): name is string => name !== null),
	);
	if (boards.size === 0) return "the design";
	if (boards.size === 1) return `board "${[...boards][0]}"`;
	return `${boards.size} boards`;
};

/** Design-level first, then by board order, then oldest first. */
export const sortForSurfacing = (
	views: AnnotationView[],
	design: TrickroomDesign | null | undefined,
) => {
	const boardOrder = new Map(
		(design?.boards ?? []).map((board, index) => [board.id, index]),
	);
	const rank = (view: AnnotationView) => {
		const boardId = boardIdOf(view.target);
		if (boardId === null) return -1;
		return boardOrder.get(boardId) ?? boardOrder.size;
	};
	return views.sort(
		(a, b) =>
			rank(a) - rank(b) ||
			a.createdAt.localeCompare(b.createdAt) ||
			a.id.localeCompare(b.id),
	);
};

/** The annotation store of a project and the checkout reading it. */
export type AnnotationProject = {
	projectId: string;
	service: AnnotationServiceContext;
	scope: AnnotationScope;
	/** The agent this session writes as. */
	by: AnnotationActor;
};

export type AnnotationsBlockOptions = {
	designId: string;
	/**
	 * The design read alongside: detached and moved layers, board names.
	 * Read when left out and the design has annotations; null skips it.
	 */
	design?: TrickroomDesign | null;
	/** editor_context: counts and ids of the selected layer. */
	selectedElementId?: string | null;
	/** Include the block whenever the design has live annotations (editor_context). */
	includeCounts?: boolean;
};

export const createMcpAnnotationSession = ({
	sessionId,
	defaultHome,
	now = () => new Date(),
}: {
	sessionId: string;
	/** The Trickroom home when a project context does not name one. */
	defaultHome: string;
	now?: () => Date;
}) => {
	const by: AnnotationActor = { role: "agent", sessionId };
	/** `<projectId>\0<annotationId>` → the surface key this session saw. */
	const seen = new Map<string, string>();
	/**
	 * Projects in which this session acknowledged or wrote an annotation:
	 * only there does its last-call time matter (acknowledgement expiry), so
	 * only there is it written.
	 */
	const clocks = new Map<
		string,
		{ service: AnnotationServiceContext; recordedAt: number }
	>();
	const seenKey = (projectId: string, annotationId: string) =>
		`${projectId}\0${annotationId}`;

	const createServiceContext = (
		context: TrickroomMcpServerContext,
	): { projectId: string; service: AnnotationServiceContext } | null => {
		const projectId = context.config.projectId;
		if (!projectId) return null;
		try {
			return {
				projectId,
				service: {
					store: new AnnotationStore({
						projectId,
						trickroomHome: context.trickroomHome ?? defaultHome,
					}),
					now,
				},
			};
		} catch {
			// A project id that cannot name a folder has no annotations.
			return null;
		}
	};

	/** The project's store and checkout, or null when it has no project id. */
	const openProject = async (
		context: TrickroomMcpServerContext,
	): Promise<AnnotationProject | null> => {
		const opened = createServiceContext(context);
		if (!opened) return null;
		return {
			...opened,
			scope: await readCheckoutScope(context.projectRoot),
			by,
		};
	};

	/** Marks the project as one whose session clock matters, and writes it now. */
	const startClock = (project: AnnotationProject) => {
		if (clocks.has(project.projectId)) return;
		clocks.set(project.projectId, { service: project.service, recordedAt: 0 });
		noteCall();
	};

	/**
	 * Every tool call: writes the session's last-call time (at most every few
	 * seconds) in each project where it acknowledged or wrote annotations.
	 * Never fails a call.
	 */
	const noteCall = () => {
		const time = now().getTime();
		for (const clock of clocks.values()) {
			if (time - clock.recordedAt < SESSION_CALL_INTERVAL_MS) continue;
			clock.recordedAt = time;
			void recordSessionCall(clock.service, sessionId).catch(() => undefined);
		}
	};

	/** Records what this session has now seen of an annotation (its own writes included). */
	const markSeen = (project: AnnotationProject, view: AnnotationView) => {
		seen.set(seenKey(project.projectId, view.id), surfaceKey(view));
	};

	const isUnseen = (project: AnnotationProject, view: AnnotationView) =>
		seen.get(seenKey(project.projectId, view.id)) !== surfaceKey(view);

	/**
	 * Open, or acknowledged by a session that has gone quiet: this session
	 * takes it. An active acknowledgement by another session is left alone
	 * (it is advisory; the body says who has it).
	 */
	const shouldAcknowledge = (view: AnnotationView) =>
		view.status === "open" ||
		(view.status === "acknowledged" &&
			view.acknowledgement?.sessionId !== sessionId &&
			view.acknowledgement?.active === false);

	/**
	 * Acknowledges the open ones among annotations about to be shown in full
	 * for this session, and moves the cursor past them. Acknowledging is
	 * advisory, so a failure leaves the annotation as read. Returns the
	 * annotations as they are now.
	 */
	const acknowledgeShown = async (
		project: AnnotationProject,
		views: readonly AnnotationView[],
	): Promise<AnnotationView[]> => {
		const shown: AnnotationView[] = [];
		for (const view of views) {
			let current = view;
			if (view.branch === project.scope.branch && shouldAcknowledge(view)) {
				try {
					const acknowledged = await acknowledgeAnnotation(project.service, {
						annotationId: view.id,
						sessionId,
					});
					current = {
						...acknowledged.annotation,
						...(view.detached !== undefined ? { detached: view.detached } : {}),
					};
					startClock(project);
				} catch {
					// Advisory: the agent still gets the body.
				}
			}
			if (view.branch === project.scope.branch) markSeen(project, current);
			shown.push(current);
		}
		return shown;
	};

	/** Annotations in full, acknowledged for this session (see `acknowledgeShown`). */
	const showInFull = async (
		project: AnnotationProject,
		views: readonly AnnotationView[],
		options: { branch?: boolean } = {},
	): Promise<DescribedAnnotation[]> =>
		(await acknowledgeShown(project, views)).map((view) =>
			describeAnnotation(view, sessionId, { now: now(), ...options }),
		);

	/** Agent work on the checkout's branch that this session has not seen as it is now. */
	const takeUnseen = (
		project: AnnotationProject,
		views: readonly AnnotationView[],
		design: TrickroomDesign | null | undefined,
	) =>
		sortForSurfacing(
			views.filter(
				(view) =>
					view.branch === project.scope.branch &&
					isAgentWork(view.status) &&
					isUnseen(project, view),
			),
			design,
		);

	const listLive = (
		project: AnnotationProject,
		designId: string,
		design: TrickroomDesign | null | undefined,
	) =>
		listAnnotations(project.service, {
			container: { kind: "design", designId },
			scope: project.scope,
			statuses: LIVE_STATUSES,
			...(design ? { design } : {}),
		});

	/**
	 * The `annotations` block for a result about one design: new or changed
	 * agent work in full (at most `MAX_SURFACED_ANNOTATIONS`, acknowledged),
	 * the ids of all agent work, counts, and `next`, the exact follow-up
	 * call. Null when the design has no agent work on the checkout's branch
	 * (and, with `includeCounts`, no live annotations at all).
	 */
	const buildBlock = async (
		context: TrickroomMcpServerContext,
		options: AnnotationsBlockOptions,
	) => {
		const { designId } = options;
		const policy = getMcpPolicy(context.config);
		if (
			policy.allowedDesignFileIds !== null &&
			!policy.allowedDesignFileIds.has(designId)
		) {
			return null;
		}
		const project = await openProject(context);
		if (!project) return null;
		let design = options.design;
		let { annotations } = await listLive(project, designId, design);
		if (annotations.length === 0) return null;
		if (design === undefined) {
			// Only now, when there is something to show: detached targets,
			// layers that moved boards, board names.
			design = await readDesignFileForTool(context, designId)
				.then((read) => read.design)
				.catch(() => null);
			if (design) ({ annotations } = await listLive(project, designId, design));
		}
		if (
			!options.includeCounts &&
			!annotations.some((view) => isAgentWork(view.status))
		) {
			return null;
		}

		const unseen = takeUnseen(project, annotations, design);
		const shown = await acknowledgeShown(
			project,
			unseen.slice(0, MAX_SURFACED_ANNOTATIONS),
		);
		const bodies = shown.map((view) =>
			describeAnnotation(view, sessionId, { now: now() }),
		);
		const more = unseen.length - shown.length;
		// Counted as they are now, acknowledgements included.
		const current = new Map(shown.map((view) => [view.id, view]));
		const counts = summarizeAnnotationCounts(
			annotations.map((view) => current.get(view.id) ?? view),
			design,
		);
		const openIds = annotations
			.filter((view) => isAgentWork(view.status))
			.map((view) => view.id);
		const selected = options.selectedElementId
			? counts.layers[options.selectedElementId]
			: undefined;
		return {
			new: bodies,
			...(more > 0 ? { more } : {}),
			openIds: openIds.slice(0, MAX_OPEN_IDS),
			counts: compactCounts(counts.total),
			...(options.selectedElementId
				? {
						selectedLayer: {
							elementId: options.selectedElementId,
							...(selected
								? compactCounts(selected)
								: { agentWork: 0, humanWork: 0, byStatus: {} }),
							annotationIds: annotations
								.filter(
									(view) =>
										view.target.kind === "layer" &&
										view.target.elementId === options.selectedElementId,
								)
								.map((view) => view.id),
						},
					}
				: {}),
			next: describeNext(designId, shown, more, openIds.length, design, [
				...new Set(
					annotations
						.filter(
							(view) =>
								view.branch === project.scope.branch && view.detached === true,
						)
						.map((view) => view.id),
				),
			]),
		};
	};

	return {
		sessionId,
		by,
		openProject,
		noteCall,
		markSeen,
		startClock,
		acknowledgeShown,
		showInFull,
		takeUnseen,
		listLive,
		buildBlock,

		/**
		 * Appends the `annotations` block to a result about one design. Error
		 * results, and designs without agent work, are returned unchanged; a
		 * failure reading annotations never fails the tool.
		 */
		withAnnotations: async (
			result: CallToolResult,
			context: TrickroomMcpServerContext,
			options: AnnotationsBlockOptions,
		): Promise<CallToolResult> => {
			if (result.isError) return result;
			try {
				const block = await buildBlock(context, options);
				return block ? appendToResult(result, "annotations", block) : result;
			} catch {
				return result;
			}
		},

		/**
		 * Counts per design on the checkout's branch (agent and human work),
		 * for design_list and project_list. Designs without live annotations
		 * are left out.
		 */
		countDesigns: async (
			context: TrickroomMcpServerContext,
			designIds?: readonly string[],
		): Promise<Map<string, AnnotationCounts>> => {
			const result = new Map<string, AnnotationCounts>();
			const project = await openProject(context);
			if (!project) return result;
			const policy = getMcpPolicy(context.config);
			const ids =
				designIds ??
				(await project.service.store.listContainers())
					.filter(
						(
							container,
						): container is AnnotationContainer & { kind: "design" } =>
							container.kind === "design",
					)
					.map((container) => container.designId);
			await Promise.all(
				ids
					.filter(
						(designId) =>
							policy.allowedDesignFileIds === null ||
							policy.allowedDesignFileIds.has(designId),
					)
					.map(async (designId) => {
						const counts = await countAnnotations(project.service, {
							container: { kind: "design", designId },
							scope: project.scope,
						});
						if (counts.total.live > 0) result.set(designId, counts.total);
					}),
			);
			return result;
		},

		/**
		 * Live annotations of the checkout's branch by anchored element, for
		 * the warnings of deleteElement steps; undefined when no step deletes
		 * (or the store cannot be read: warnings are advisory).
		 */
		getDeleteAnchors: async (
			context: TrickroomMcpServerContext,
			designId: string,
			operations: readonly { operation: string }[],
		) => {
			if (!operations.some((step) => step.operation === "deleteElement")) {
				return undefined;
			}
			try {
				const project = await openProject(context);
				if (!project) return undefined;
				return await getAnnotationAnchorIndex(project.service, {
					designId,
					scope: project.scope,
				});
			} catch {
				return undefined;
			}
		},
	};
};

export type McpAnnotationSession = ReturnType<
	typeof createMcpAnnotationSession
>;

/** The follow-up call a block names: address or ask, or list the rest. */
const describeNext = (
	designId: string,
	shown: readonly AnnotationView[],
	more: number,
	openCount: number,
	design: TrickroomDesign | null | undefined,
	detachedIds: readonly string[] = [],
) => {
	const list = `${TOOL.annotationList}({ designFileId: "${designId}" })`;
	// Live annotations whose element is gone: re-anchor them (after a copy
	// or detach replaced the element) or ask the designer.
	const detached =
		detachedIds.length > 0
			? [
					`Detached (their element no longer exists): ${detachedIds.slice(0, MAX_SURFACED_ANNOTATIONS).join(", ")}${detachedIds.length > MAX_SURFACED_ANNOTATIONS ? ` and ${detachedIds.length - MAX_SURFACED_ANNOTATIONS} more` : ""}. When an element replaced theirs, re-anchor with ${TOOL.annotationReply}({ annotationId: "${detachedIds[0]}", reanchor: { elementId: "<new element id>" } }); otherwise ask the designer.`,
				]
			: [];
	if (shown.length === 0) {
		return [
			openCount > 0
				? `${plural(openCount, "open annotation")} on this design, already shown to you (openIds). ${list} shows them in full.`
				: `No annotations wait on you here; the counts wait on the designer. ${list} shows them.`,
			...detached,
		].join(" ");
	}
	const id = shown[0]?.id ?? "<annotationId>";
	return [
		`${plural(shown.length, "new annotation")} on ${describeWhere(shown, design)}.`,
		`Address each with your next ${TOOL.designApply}({ designFileId: "${designId}", expectedRevision, operations, addresses: [{ annotationId: "${id}", reply: "<what you changed>" }] }),`,
		`or ask the designer with ${TOOL.annotationReply}({ annotationId: "${id}", question: "<your question>" }).`,
		...(more > 0 ? [`${more} more: ${list}.`] : []),
		...detached,
	].join(" ");
};

/**
 * Adds `key: value` to a result: to its JSON payload, or, for results whose
 * text is not JSON (screenshots), as a text block after the first one.
 */
export const appendToResult = (
	result: CallToolResult,
	key: string,
	value: unknown,
): CallToolResult => {
	const index = result.content.findIndex((entry) => entry.type === "text");
	const block = result.content[index];
	if (block?.type === "text") {
		try {
			const payload = JSON.parse(block.text) as unknown;
			if (
				typeof payload === "object" &&
				payload !== null &&
				!Array.isArray(payload)
			) {
				const content = [...result.content];
				content[index] = {
					...block,
					text: JSON.stringify({ ...payload, [key]: value }),
				};
				return { ...result, content };
			}
		} catch {
			// Not JSON: append a block below.
		}
	}
	const content = [...result.content];
	content.splice(index + 1, 0, {
		type: "text",
		text: `${key}: ${JSON.stringify(value)}`,
	});
	return { ...result, content };
};
