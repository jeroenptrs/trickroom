import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	type ComponentAnchorTemplate,
	summarizeRound,
} from "../services/annotation-model";
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
	viewAnnotation,
} from "../services/annotation-service";
import {
	AnnotationStore,
	AnnotationStoreError,
	getAnnotationContainer,
} from "../services/annotation-store";
import {
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationActor,
	type AnnotationContainer,
	type AnnotationEntry,
	type AnnotationRound,
	type AnnotationScope,
	type AnnotationStatus,
	type AnnotationTarget,
	type AnnotationView,
	CLOSED_ANNOTATION_STATUSES,
} from "../services/annotations.types";
import { readCheckoutScope } from "../services/checkout-scope";
import { readComponentAnchor } from "../services/component-annotations";
import type { TrickroomDesign } from "../types";
import { getMcpPolicy } from "./governance";
import {
	findElementContext,
	readDesignFileForTool,
} from "./payloads/design-tree";
import type { TrickroomMcpServerContext } from "./server-types";
import { TOOL } from "./tool-names";

/**
 * Annotations as MCP sessions see them: the remarks a designer anchors to a
 * design, board or layer, or to a system component's node, delivered
 * between tool calls (the only boundary an MCP server has). Results of
 * design_read, design_apply, design_validate, design_screenshot and
 * editor_context carry an `annotations` block for the design they touched;
 * component_read (describe), component_draft_update and component_publish
 * one for the component; the annotation tools list, reply and wait.
 *
 * Per session, in memory: a cursor of what this session has seen (per
 * annotation, a key of its status and entries), so full bodies are shown
 * once and afterwards only counted. Showing a body in full acknowledges an
 * open annotation for this session (docs/proposals/agent-annotations.md).
 */

/** Full bodies per result; the rest are counted and named in `next`. */
export const MAX_SURFACED_ANNOTATIONS = 10;

/**
 * Why unrelated annotations go in separate writes: the designer's revert
 * undoes a whole write, for every annotation it addressed.
 */
export const ADDRESSING_ADVICE =
	"Give unrelated annotations separate writes, because a revert undoes a whole write.";

/** Ids listed in `openIds`; `counts` has the total. */
const MAX_OPEN_IDS = 50;

/**
 * Layer ids listed per change entry; `layerCount` has the total. A write
 * that adds a large subtree touches thousands of layers, and every body
 * that shows its change entry would carry them all.
 */
export const MAX_CHANGE_LAYER_IDS = 20;

/** The session clock (acknowledgement expiry) is written at most this often. */
const SESSION_CALL_INTERVAL_MS = 5_000;

const LIVE_STATUSES = ANNOTATION_STATUSES.filter(
	(status) => !CLOSED_ANNOTATION_STATUSES.has(status),
);

const isLive = (status: AnnotationStatus) =>
	!CLOSED_ANNOTATION_STATUSES.has(status);

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
		case "proposal":
			return { ...base, text: entry.summary };
		case "change":
			return {
				...base,
				...(entry.body ? { text: entry.body } : {}),
				change: {
					summary: entry.change.summary,
					revisionAfter: entry.change.revisionAfter,
					layerIds: entry.change.layerIds.slice(0, MAX_CHANGE_LAYER_IDS),
					layerCount: entry.change.layerIds.length,
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
 * What the designer was looking at when the annotation was made (or last
 * re-anchored): the target's name, ancestor names and component, the design
 * (or component) revision, the stage mode and responsive width, the variant
 * values in view for a component node, and the branch when the annotation
 * has moved since.
 */
const describeSnapshot = (view: AnnotationView) => {
	const { snapshot } = view;
	const described = {
		...(snapshot.layerName ? { name: snapshot.layerName } : {}),
		...(snapshot.ancestorNames && snapshot.ancestorNames.length > 0
			? { path: snapshot.ancestorNames }
			: {}),
		...(snapshot.component ? { component: snapshot.component } : {}),
		...(snapshot.designRevision
			? { designRevision: snapshot.designRevision }
			: {}),
		...(snapshot.stageMode ? { stageMode: snapshot.stageMode } : {}),
		...(snapshot.responsiveWidth !== undefined
			? { responsiveWidth: snapshot.responsiveWidth }
			: {}),
		// Component nodes: the variant configuration in view when the remark
		// was made (pinned or not; a pin is `target.variants`).
		...(snapshot.variants && Object.keys(snapshot.variants).length > 0
			? { variants: snapshot.variants }
			: {}),
		...(snapshot.branch !== view.branch ? { branch: snapshot.branch } : {}),
	};
	return Object.keys(described).length > 0 ? described : undefined;
};

/**
 * An annotation as tool results show it: ids and anchor (so every follow-up
 * call has what it needs), what the designer was looking at (`snapshot`),
 * its status, who acknowledged it, and its entries without change records'
 * revert state.
 */
export const describeAnnotation = (
	view: AnnotationView,
	sessionId: string,
	options: { now?: Date; branch?: boolean } = {},
) => {
	const snapshot = describeSnapshot(view);
	const acknowledgement = view.acknowledgement;
	const now = options.now ?? new Date();
	return {
		annotationId: view.id,
		status: view.status,
		target: describeTarget(view.target),
		...(snapshot ? { snapshot } : {}),
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
const surfaceKey = (
	annotation: AnnotationView,
	entryIds: readonly string[] = annotation.entries.map((entry) => entry.id),
) =>
	JSON.stringify([
		annotation.status === "acknowledged" ? "open" : annotation.status,
		entryIds,
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

export const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? "" : "s"}`;

export const boardIdOf = (target: AnnotationTarget) =>
	target.kind === "board" || target.kind === "layer" ? target.boardId : null;

const boardNameOf = (
	view: AnnotationView,
	design: TrickroomDesign | null | undefined,
) => {
	// A layer that moved boards is where it is now.
	const boardId =
		(design && view.target.kind === "layer"
			? findElementContext(design, view.target.elementId)?.board.id
			: undefined) ?? boardIdOf(view.target);
	if (!boardId) return null;
	const board = design?.boards.find((entry) => entry.id === boardId);
	const name = board?.props["data-trickroom-name"];
	if (typeof name === "string") return name;
	return view.target.kind === "board"
		? (view.snapshot.layerName ?? boardId)
		: (view.snapshot.ancestorNames?.[0] ?? boardId);
};

/** Annotations shown in a response, as they are now. */
type Refreshed = {
	/** Current state per annotation passed in; null when it no longer exists. */
	fresh: ReadonlyMap<string, AnnotationView | null>;
	/**
	 * Those this call acknowledged (from `open`, or by taking over an expired
	 * acknowledgement), with the status stored before its write.
	 */
	acknowledgedHere: ReadonlyMap<string, AnnotationStatus>;
};

/**
 * What a response's filters compare: the annotation as it is now, except
 * that this call's own acknowledgement is undone in the status: it keeps
 * the status stored before the write (`open`, or `acknowledged` for a
 * takeover of an expired acknowledgement). Only changes by other writers
 * (moved, closed, removed, re-anchored) make it stop matching.
 */
const asListed = (
	annotation: AnnotationView,
	acknowledgedHere: ReadonlyMap<string, AnnotationStatus>,
): AnnotationView => {
	const before = acknowledgedHere.get(annotation.id);
	return before !== undefined && annotation.status === "acknowledged"
		? { ...annotation, status: before }
		: annotation;
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

/** The `annotations` block of a result about one system component. */
export type ComponentAnnotationsBlockOptions = {
	/** The manifest's system id (annotation folders use it). */
	systemId: string;
	componentId: string;
	/**
	 * The template annotations anchor to (draft, else published): detached
	 * node paths. Read when left out and the component has annotations;
	 * null skips it.
	 */
	template?: ComponentAnchorTemplate | null;
	/** The component's name, for `next`. */
	name?: string;
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
	const seen = new Map<string, { key: string; entryIds: readonly string[] }>();
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
	/**
	 * Rounds this session has seen open (in `annotation_watch`, or through
	 * an annotation of the round it was shown), by `<projectId>\0<roundId>`:
	 * whether their closing has been reported to it. A round closed while
	 * the session worked still comes back as `"closed"` once.
	 */
	const roundsSeen = new Map<string, { reported: boolean }>();
	const roundKey = (projectId: string, roundId: string) =>
		`${projectId}\0${roundId}`;

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

	/**
	 * Records what this session has now seen of an annotation (its own
	 * writes included). `entryIds` limits it to those entries: a remark the
	 * session has not been shown stays news.
	 */
	const markSeen = (
		project: AnnotationProject,
		view: AnnotationView,
		entryIds?: readonly string[],
	) => {
		seen.set(seenKey(project.projectId, view.id), {
			key: surfaceKey(view, entryIds),
			entryIds: entryIds ?? view.entries.map((entry) => entry.id),
		});
	};

	const isUnseen = (project: AnnotationProject, view: AnnotationView) =>
		seen.get(seenKey(project.projectId, view.id))?.key !== surfaceKey(view);

	/** The entries of an annotation this session has seen, or undefined when it never saw it in full. */
	const seenEntryIds = (project: AnnotationProject, annotationId: string) =>
		seen.get(seenKey(project.projectId, annotationId))?.entryIds;

	/**
	 * Annotations about to be shown in full, as they are now: agent work on
	 * the checkout's branch is acknowledged for this session, the rest is
	 * read again. The service decides under the annotation's lock: only on
	 * the checkout's branch, `open`, or acknowledged by a session that has
	 * gone quiet (an active acknowledgement by another session is left alone;
	 * the body says who has it). Another writer may have moved, answered,
	 * cleared or removed an annotation since it was listed, so `keep` decides
	 * on the fresh state what is shown; only that moves the cursor.
	 *
	 * Returns what is shown, and `fresh`: the current state of every
	 * annotation passed in (null when it no longer exists), so a result can
	 * derive its ids, counts and follow-ups from the same state as its
	 * bodies (`refreshListed`). Acknowledging is advisory: when it fails for
	 * another reason, the annotation is shown as listed.
	 */
	const acknowledgeShown = async (
		project: AnnotationProject,
		views: readonly AnnotationView[],
		keep: (annotation: Annotation) => boolean,
	): Promise<Refreshed & { shown: AnnotationView[] }> => {
		const shown: AnnotationView[] = [];
		const fresh = new Map<string, AnnotationView | null>();
		const acknowledgedHere = new Map<string, AnnotationStatus>();
		for (const view of views) {
			let current: AnnotationView | null = view;
			const container = getAnnotationContainer(view.target);
			const keepDetached = (next: AnnotationView): AnnotationView => ({
				...next,
				...(view.detached !== undefined ? { detached: view.detached } : {}),
			});
			try {
				if (view.branch === project.scope.branch && isAgentWork(view.status)) {
					// Only what this call will show: `keep` on the annotation as
					// stored, before this acknowledgement, under the lock.
					const acknowledged = await acknowledgeAnnotation(project.service, {
						annotationId: view.id,
						container,
						sessionId,
						branch: project.scope.branch,
						keepActive: true,
						onlyIf: keep,
					});
					current = keepDetached(acknowledged.annotation);
					if (acknowledged.written) {
						acknowledgedHere.set(view.id, acknowledged.previousStatus);
						startClock(project);
					}
				} else {
					const stored = await project.service.store.read(container, view.id);
					current = stored
						? keepDetached(await viewAnnotation(project.service, stored))
						: null;
				}
			} catch (error) {
				if (
					error instanceof AnnotationStoreError &&
					error.code === "ANNOTATION_NOT_FOUND"
				) {
					current = null;
				}
				// Otherwise advisory: shown as listed.
			}
			fresh.set(view.id, current);
			if (!current || !keep(asListed(current, acknowledgedHere))) continue;
			if (current.branch === project.scope.branch) markSeen(project, current);
			shown.push(current);
		}
		return { shown, fresh, acknowledgedHere };
	};

	/** Notes rounds seen open; a round seen before keeps its state. */
	const noteRoundsOpen = (
		project: AnnotationProject,
		rounds: readonly AnnotationRound[],
	) => {
		for (const round of rounds) {
			if (round.status !== "open" || round.branch !== project.scope.branch) {
				continue;
			}
			const key = roundKey(project.projectId, round.id);
			if (!roundsSeen.has(key)) roundsSeen.set(key, { reported: false });
		}
	};

	/**
	 * Notes the open rounds of annotations about to be shown, so a session
	 * that got its work from a result's block still hears when the round
	 * closes. Reads the container's rounds only when a shown one has a round.
	 */
	const noteRoundsOf = async (
		project: AnnotationProject,
		container: AnnotationContainer,
		views: readonly AnnotationView[],
	) => {
		const ids = new Set(
			views.flatMap((view) =>
				view.roundId &&
				!roundsSeen.has(roundKey(project.projectId, view.roundId))
					? [view.roundId]
					: [],
			),
		);
		if (ids.size === 0) return;
		try {
			const { rounds } = await project.service.store.listRounds(container);
			noteRoundsOpen(
				project,
				rounds.filter((round) => ids.has(round.id)),
			);
		} catch {
			// Advisory: a round that cannot be read is not reported closed.
		}
	};

	/** Rounds this session saw open that are closed now and not yet reported. */
	const takeClosedRounds = (
		project: AnnotationProject,
		rounds: readonly AnnotationRound[],
	) =>
		rounds.filter(
			(round) =>
				round.status === "closed" &&
				roundsSeen.get(roundKey(project.projectId, round.id))?.reported ===
					false,
		);

	const markRoundReported = (
		project: AnnotationProject,
		round: AnnotationRound,
	) => {
		roundsSeen.set(roundKey(project.projectId, round.id), { reported: true });
	};

	/**
	 * The designer's verdicts on this session's work: closed annotations on
	 * the checkout's branch that this session addressed or proposed, changed
	 * since it last saw them (accepted, or dismissed). A reopen or a revert
	 * is agent work, which `takeUnseen` returns instead.
	 */
	const takeVerdicts = (
		project: AnnotationProject,
		views: readonly AnnotationView[],
	) =>
		views.filter(
			(view) =>
				view.branch === project.scope.branch &&
				!isLive(view.status) &&
				seen.has(seenKey(project.projectId, view.id)) &&
				isUnseen(project, view) &&
				view.entries.some(
					(entry) =>
						(entry.kind === "change" || entry.kind === "proposal") &&
						entry.by.role === "agent" &&
						entry.by.sessionId === sessionId,
				),
		);

	/** On the checkout's branch and agent work: what surfacing and watch show. */
	const isCurrentWork =
		(project: AnnotationProject) => (annotation: Annotation) =>
			annotation.branch === project.scope.branch &&
			isAgentWork(annotation.status);

	/**
	 * `listed` as it is now: refreshed ones replaced by their fresh state,
	 * and dropped when they no longer exist or no longer match `matches`
	 * (this call's own acknowledgement still matches `open`; see `asListed`).
	 */
	const refreshListed = (
		listed: readonly AnnotationView[],
		{ fresh, acknowledgedHere }: Refreshed,
		matches: (annotation: Annotation) => boolean,
	) =>
		listed.flatMap((view) => {
			if (!fresh.has(view.id)) return [view];
			const current = fresh.get(view.id);
			return current && matches(asListed(current, acknowledgedHere))
				? [current]
				: [];
		});

	/** Annotations in full (see `acknowledgeShown`), with the fresh state. */
	const showInFull = async (
		project: AnnotationProject,
		views: readonly AnnotationView[],
		keep: (annotation: Annotation) => boolean,
		options: { branch?: boolean } = {},
	) => {
		const refreshed = await acknowledgeShown(project, views, keep);
		return {
			...refreshed,
			bodies: refreshed.shown.map((view) =>
				describeAnnotation(view, sessionId, { now: now(), ...options }),
			),
		};
	};

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

	/** A container's files, as `listLive` takes them back: listed once per block. */
	type StoredListing = Awaited<
		ReturnType<AnnotationProject["service"]["store"]["list"]>
	>;

	const listLive = (
		project: AnnotationProject,
		designId: string,
		design: TrickroomDesign | null | undefined,
		stored?: StoredListing,
	) =>
		listAnnotations(project.service, {
			container: { kind: "design", designId },
			scope: project.scope,
			statuses: LIVE_STATUSES,
			// A send is seen whole: not before its round lists it.
			landedOnly: true,
			...(design ? { design } : {}),
			...(stored ? { stored } : {}),
		});

	const listLiveComponent = (
		project: AnnotationProject,
		container: AnnotationContainer & { kind: "component" },
		template: ComponentAnchorTemplate | null | undefined,
		stored?: StoredListing,
	) =>
		listAnnotations(project.service, {
			container,
			scope: project.scope,
			statuses: LIVE_STATUSES,
			// A send is seen whole: not before its round lists it.
			landedOnly: true,
			...(template ? { component: template } : {}),
			...(stored ? { stored } : {}),
		});

	/**
	 * The `annotations` block for a result about one system component: the
	 * same rules as a design's (`buildBlock`). Bodies of pinned annotations
	 * carry `target.variants`: the configuration to render.
	 */
	const buildComponentBlock = async (
		context: TrickroomMcpServerContext,
		options: ComponentAnnotationsBlockOptions,
	) => {
		const project = await openProject(context);
		if (!project) return null;
		const container = {
			kind: "component" as const,
			systemId: options.systemId,
			componentId: options.componentId,
		};
		let { template, name } = options;
		const stored = await project.service.store.list(container);
		let { annotations } = await listLiveComponent(
			project,
			container,
			template,
			stored,
		);
		if (annotations.length === 0) return null;
		if (template === undefined) {
			const anchor = await readComponentAnchor(
				context.projectRoot,
				options.systemId,
				options.componentId,
			).catch(() => null);
			template = anchor?.template ?? null;
			name ??= anchor?.name;
			if (template) {
				({ annotations } = await listLiveComponent(
					project,
					container,
					template,
					stored,
				));
			}
		}
		if (!annotations.some((view) => isAgentWork(view.status))) return null;
		const unseen = takeUnseen(project, annotations, null);
		const refreshed = await acknowledgeShown(
			project,
			unseen.slice(0, MAX_SURFACED_ANNOTATIONS),
			isCurrentWork(project),
		);
		const { shown } = refreshed;
		await noteRoundsOf(project, container, shown);
		const bodies = shown.map((view) =>
			describeAnnotation(view, sessionId, { now: now() }),
		);
		const eligible = refreshListed(
			annotations,
			refreshed,
			(view) => view.branch === project.scope.branch && isLive(view.status),
		);
		if (!eligible.some((view) => isAgentWork(view.status))) return null;
		const more = takeUnseen(project, eligible, null).length;
		const counts = summarizeAnnotationCounts(eligible, null, template);
		const openIds = eligible
			.filter((view) => isAgentWork(view.status))
			.map((view) => view.id);
		return {
			new: bodies,
			...(more > 0 ? { more } : {}),
			openIds: openIds.slice(0, MAX_OPEN_IDS),
			counts: compactCounts(counts.total),
			next: describeComponentNext(options, name, shown, more, openIds.length, [
				...new Set(
					eligible
						.filter((view) => view.detached === true)
						.map((view) => view.id),
				),
			]),
		};
	};

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
		// The folder is listed once; a design read below only views it again.
		const stored = await project.service.store.list({
			kind: "design",
			designId,
		});
		let { annotations } = await listLive(project, designId, design, stored);
		if (annotations.length === 0) return null;
		if (design === undefined) {
			// Only now, when there is something to show: detached targets,
			// layers that moved boards, board names.
			design = await readDesignFileForTool(context, designId)
				.then((read) => read.design)
				.catch(() => null);
			if (design) {
				({ annotations } = await listLive(project, designId, design, stored));
			}
		}
		if (
			!options.includeCounts &&
			!annotations.some((view) => isAgentWork(view.status))
		) {
			return null;
		}

		const unseen = takeUnseen(project, annotations, design);
		const refreshed = await acknowledgeShown(
			project,
			unseen.slice(0, MAX_SURFACED_ANNOTATIONS),
			isCurrentWork(project),
		);
		const { shown } = refreshed;
		await noteRoundsOf(project, { kind: "design", designId }, shown);
		const bodies = shown.map((view) =>
			describeAnnotation(view, sessionId, { now: now() }),
		);
		// One set for everything below: the live annotations of this branch
		// as they are now (acknowledgements included; moved, closed or
		// removed ones out).
		const eligible = refreshListed(
			annotations,
			refreshed,
			(view) => view.branch === project.scope.branch && isLive(view.status),
		);
		if (
			!options.includeCounts &&
			!eligible.some((view) => isAgentWork(view.status))
		) {
			return null;
		}
		if (eligible.length === 0) return null;
		// Shown ones are seen now; what is left unseen is `more`.
		const more = takeUnseen(project, eligible, design).length;
		const counts = summarizeAnnotationCounts(eligible, design);
		const openIds = eligible
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
							annotationIds: eligible
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
					eligible
						.filter((view) => view.detached === true)
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
		seenEntryIds,
		startClock,
		acknowledgeShown,
		isCurrentWork,
		refreshListed,
		showInFull,
		takeUnseen,
		takeVerdicts,
		noteRoundsOpen,
		noteRoundsOf,
		takeClosedRounds,
		markRoundReported,
		listLive,
		listLiveComponent,
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
		 * The same for a result about one system component (component_read
		 * describe, component_draft_update, component_publish).
		 */
		withComponentAnnotations: async (
			result: CallToolResult,
			context: TrickroomMcpServerContext,
			options: ComponentAnnotationsBlockOptions,
		): Promise<CallToolResult> => {
			if (result.isError) return result;
			try {
				const block = await buildComponentBlock(context, options);
				return block ? appendToResult(result, "annotations", block) : result;
			} catch {
				return result;
			}
		},

		/**
		 * Counts per component of a system on the checkout's branch, for
		 * component_read's index. Components without live annotations are
		 * left out.
		 */
		countComponents: async (
			context: TrickroomMcpServerContext,
			systemId: string,
		): Promise<Map<string, AnnotationCounts>> => {
			const result = new Map<string, AnnotationCounts>();
			const project = await openProject(context);
			if (!project) return result;
			const containers = (await project.service.store.listContainers()).filter(
				(container): container is AnnotationContainer & { kind: "component" } =>
					container.kind === "component" && container.systemId === systemId,
			);
			await Promise.all(
				containers.map(async (container) => {
					const counts = await countAnnotations(project.service, {
						container,
						scope: project.scope,
					});
					if (counts.total.live > 0) {
						result.set(container.componentId, counts.total);
					}
				}),
			);
			return result;
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
		 * The open round of each design on the checkout's branch: `sent`
		 * annotations, of which `closed` are resolved or dismissed. Designs
		 * without an open round are left out.
		 */
		openRounds: async (
			context: TrickroomMcpServerContext,
			designIds?: readonly string[],
		): Promise<
			Map<string, { id: string; open: true; sent: number; closed: number }>
		> => {
			const result = new Map<
				string,
				{ id: string; open: true; sent: number; closed: number }
			>();
			const project = await openProject(context);
			if (!project) return result;
			const policy = getMcpPolicy(context.config);
			const ids =
				designIds ??
				(await project.service.store.listContainers()).flatMap((container) =>
					container.kind === "design" ? [container.designId] : [],
				);
			await Promise.all(
				ids
					.filter(
						(designId) =>
							policy.allowedDesignFileIds === null ||
							policy.allowedDesignFileIds.has(designId),
					)
					.map(async (designId) => {
						const container = { kind: "design" as const, designId };
						const { rounds } =
							await project.service.store.listRounds(container);
						const open = rounds
							.filter(
								(round) =>
									round.status === "open" &&
									round.branch === project.scope.branch,
							)
							.at(-1);
						if (!open) return;
						const { annotations } = await project.service.store.list(container);
						const counts = summarizeRound(
							open,
							annotations.map(({ annotation }) => annotation),
						);
						result.set(designId, {
							id: open.id,
							open: true,
							sent: counts.total,
							closed: counts.closed,
						});
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
		`Address each in the ${TOOL.designApply} that makes its change: ${TOOL.designApply}({ designFileId: "${designId}", expectedRevision, operations, addresses: [{ annotationId: "${id}", reply: "<what you changed>" }] }).`,
		ADDRESSING_ADVICE,
		`If a remark is ambiguous, ask with ${TOOL.annotationReply}({ annotationId: "${id}", question: "<your question>" }). Resolve only when the designer asks.`,
		...(more > 0 ? [`${more} more: ${list}.`] : []),
		...detached,
	].join(" ");
};

/** The follow-up call of a component's block: address in the next draft write, or ask. */
const describeComponentNext = (
	component: { systemId: string; componentId: string },
	name: string | undefined,
	shown: readonly AnnotationView[],
	more: number,
	openCount: number,
	detachedIds: readonly string[] = [],
) => {
	const ids = `systemName: "${component.systemId}", componentId: "${component.componentId}"`;
	const list = `${TOOL.annotationList}({ systemId: "${component.systemId}", componentId: "${component.componentId}" })`;
	const detached =
		detachedIds.length > 0
			? [
					`Detached (their node path or pinned variant value no longer exists): ${detachedIds.slice(0, MAX_SURFACED_ANNOTATIONS).join(", ")}${detachedIds.length > MAX_SURFACED_ANNOTATIONS ? ` and ${detachedIds.length - MAX_SURFACED_ANNOTATIONS} more` : ""}. When a node replaced theirs, re-anchor with ${TOOL.annotationReply}({ annotationId: "${detachedIds[0]}", reanchor: { nodePath: "<template path>" } }); otherwise ask the designer.`,
				]
			: [];
	if (shown.length === 0) {
		return [
			openCount > 0
				? `${plural(openCount, "open annotation")} on this component, already shown to you (openIds). ${list} shows them in full.`
				: `No annotations wait on you here; the counts wait on the designer. ${list} shows them.`,
			...detached,
		].join(" ");
	}
	const id = shown[0]?.id ?? "<annotationId>";
	const pinned = shown.some(
		(view) => view.target.kind === "componentNode" && view.target.variants,
	);
	return [
		`${plural(shown.length, "new annotation")} on component ${name ? `"${name}"` : component.componentId} (target.nodePath is the template path).`,
		...(pinned
			? [
					"Pinned ones (target.variants) are about that variant configuration only.",
				]
			: []),
		`Address each in the ${TOOL.componentDraftUpdate} that makes its change: ${TOOL.componentDraftUpdate}({ ${ids}, expectedRevision, root, addresses: [{ annotationId: "${id}", reply: "<what you changed>" }] }).`,
		ADDRESSING_ADVICE,
		`If a remark is ambiguous, ask with ${TOOL.annotationReply}({ annotationId: "${id}", question: "<your question>" }). Resolve only when the designer asks.`,
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
