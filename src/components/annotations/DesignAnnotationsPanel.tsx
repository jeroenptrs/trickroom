import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNow } from "../../hooks/useNow";
import type { AnnotationSnapshotHint } from "../../queries/annotations";
import { createMemoryNote, invalidateMemory } from "../../queries/memory";
import {
	type AnnotationTargetLocator,
	currentBoardOfWith,
} from "../../services/annotation-model";
import type {
	AnnotationTarget,
	AnnotationView,
} from "../../services/annotations.types";
import {
	type AnnotationDraft,
	useAnnotationDrafts,
} from "../../stores/annotation-draft-store";
import {
	type DesignEntity,
	designStore,
	selectElement,
} from "../../stores/design-store";
import {
	editorAnnotationsStore,
	getAnnotationStateWith,
} from "../../stores/editor-annotations-store";
import { stageViewStore } from "../../stores/stage-view-store";
import { buildAnnotationMemoryNote } from "../../utils/annotation-memory";
import {
	type AnnotationPresentationState,
	annotationTargetKey,
	isAnnotationShown,
} from "../../utils/annotation-presentation";
import {
	designStoreTargetLocator,
	getDesignTargetName,
	getSelectionAnnotationTarget,
} from "../../utils/design-annotation-targets";
import { useProjectScope } from "../contexts";
import { ScrollArea } from "../ui/scroll-area";
import { AnnotationComposer } from "./AnnotationComposer";
import {
	AnnotationBulkActions,
	AnnotationDraftRow,
	AnnotationSection,
} from "./AnnotationPanelParts";
import { AnnotationThread } from "./AnnotationThread";
import { reanchorAnnotation } from "./annotation-actions";
import { revealDesignLayers } from "./design-annotation-navigation";
import { OtherBranchesSection } from "./OtherBranchesSection";

type Listed = {
	annotation: AnnotationView;
	state: AnnotationPresentationState;
};

/** How the designer is looking at the design, sent with a new annotation. */
export function getDesignSnapshotHint(): AnnotationSnapshotHint {
	const { stageMode, responsiveWidth } = stageViewStore.get();
	return stageMode === "responsive"
		? { stageMode, responsiveWidth }
		: { stageMode };
}

const byCreated = (a: Listed, b: Listed) =>
	a.annotation.createdAt.localeCompare(b.annotation.createdAt);

const anchorOf = (target: AnnotationTarget) =>
	target.kind === "layer"
		? target.elementId
		: target.kind === "board"
			? target.boardId
			: null;

const selectableIdOf = (
	target: AnnotationTarget,
	entitiesById: Record<string, DesignEntity>,
) => {
	const id = anchorOf(target);
	return id && entitiesById[id] ? id : null;
};

/**
 * The design editor's Annotations tab: a composer for the selection, then
 * the threads on the selected layer, its board and the design, the board's
 * bulk actions and drafts, and the other branches' threads on request.
 */
export function DesignAnnotationsPanel({ designId }: { designId: string }) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const now = useNow();
	const selectedId = useSelector(designStore, (state) => state.selectedId);
	const entitiesById = useSelector(designStore, (state) => state.entitiesById);
	const designName = useSelector(designStore, (state) => state.name);
	const {
		byId,
		showResolved,
		activeAnnotationId,
		composerFocusRequest,
		scope,
		status,
	} = useSelector(editorAnnotationsStore, (state) => state, {
		compare: (a, b) =>
			a.byId === b.byId &&
			a.showResolved === b.showResolved &&
			a.activeAnnotationId === b.activeAnnotationId &&
			a.composerFocusRequest === b.composerFocusRequest &&
			a.scope === b.scope &&
			a.status === b.status,
	});
	const locator: AnnotationTargetLocator = useMemo(
		() => designStoreTargetLocator(entitiesById),
		[entitiesById],
	);
	const target = useMemo(
		() => getSelectionAnnotationTarget(designId, entitiesById, selectedId),
		[designId, entitiesById, selectedId],
	);
	const boardId =
		target.kind === "board" || target.kind === "layer" ? target.boardId : null;

	// Threads open in the list; the one a pin or the command menu asked for
	// opens by itself.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		if (activeAnnotationId) {
			setExpanded((current) => new Set(current).add(activeAnnotationId));
		}
	}, [activeAnnotationId]);
	const setThreadExpanded = useCallback((id: string, open: boolean) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (open) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	const nameOf = useCallback(
		(annotation: Pick<AnnotationView, "target" | "snapshot">) =>
			getDesignTargetName(
				annotation.target,
				entitiesById,
				annotation.snapshot.layerName,
				designName,
			),
		[designName, entitiesById],
	);
	const nameOfLayer = useCallback(
		(layerId: string) => {
			const entity = entitiesById[layerId];
			return entity
				? getDesignTargetName(
						{ kind: "layer", designId, boardId: "", elementId: layerId },
						entitiesById,
					)
				: null;
		},
		[designId, entitiesById],
	);
	const targetName = getDesignTargetName(
		target,
		entitiesById,
		undefined,
		designName,
	);

	const listed: Listed[] = useMemo(
		() =>
			Object.values(byId)
				.map((annotation) => ({
					annotation,
					state: getAnnotationStateWith(annotation, locator),
				}))
				.filter(
					({ annotation, state }) =>
						isAnnotationShown(annotation, showResolved) ||
						state === "agent_resolved" ||
						annotation.id === activeAnnotationId,
				)
				.sort(byCreated),
		[activeAnnotationId, byId, locator, showResolved],
	);

	const onLayer =
		target.kind === "layer"
			? listed.filter(
					({ annotation }) =>
						annotation.target.kind === "layer" &&
						annotation.target.elementId === target.elementId,
				)
			: [];
	const onBoard = boardId
		? listed.filter(
				({ annotation }) =>
					annotation.target.kind === "board" &&
					annotation.target.boardId === boardId,
			)
		: [];
	const elsewhereOnBoard = boardId
		? listed.filter(
				({ annotation }) =>
					annotation.target.kind === "layer" &&
					annotation.target.elementId !== selectedId &&
					currentBoardOfWith(annotation.target, locator) === boardId,
			)
		: [];
	const onDesign = listed.filter(
		({ annotation }) => annotation.target.kind === "design",
	);
	const onBoards = boardId
		? []
		: listed.filter(({ annotation }) => annotation.target.kind !== "design");

	// Bulk actions cover the board in view, or the whole design.
	const inScope = boardId
		? [...onBoard, ...onLayer, ...elsewhereOnBoard]
		: [...onDesign, ...onBoards];
	const addressed = inScope
		.filter(({ state }) => state === "addressed")
		.map(({ annotation }) => annotation);
	const agentResolved = inScope
		.filter(({ state }) => state === "agent_resolved")
		.map(({ annotation }) => annotation);
	const scopeLabel = boardId ? "on this board" : "in this design";

	const targetKey = annotationTargetKey(target);
	const drafts = useAnnotationDrafts(
		useCallback(
			(draft: AnnotationDraft) =>
				draft.target.kind !== "componentNode" &&
				draft.target.designId === designId &&
				(boardId === null ||
					(draft.target.kind === "board" && draft.target.boardId === boardId) ||
					(draft.target.kind === "layer" &&
						(locator.boardOfLayer(draft.target.elementId) ??
							draft.target.boardId) === boardId)),
			[boardId, designId, locator],
		),
	);
	const otherDrafts = drafts.filter((draft) => draft.key !== targetKey);

	const container = useMemo(
		() => ({ kind: "design" as const, designId }),
		[designId],
	);

	const saveMemory = useCallback(
		async (annotation: AnnotationView) => {
			const note = buildAnnotationMemoryNote(annotation, nameOf(annotation));
			try {
				await createMemoryNote(
					{ kind: "design", designId },
					{ ...note, category: "decision" },
				);
				await invalidateMemory(
					queryClient,
					{ kind: "design", designId },
					projectScope,
				);
				toast.success("Saved as a memory note", {
					id: `annotation-memory-${annotation.id}`,
				});
				return true;
			} catch (error) {
				toast.error("Memory note not saved", {
					description: error instanceof Error ? error.message : String(error),
				});
				return false;
			}
		},
		[designId, nameOf, projectScope, queryClient],
	);

	const renderThread = ({ annotation, state }: Listed) => {
		const live =
			annotation.status !== "resolved" && annotation.status !== "dismissed";
		const reanchorTarget =
			live &&
			target.kind !== "design" &&
			annotationTargetKey(annotation.target) !== annotationTargetKey(target)
				? target
				: null;
		return (
			<AnnotationThread
				key={annotation.id}
				annotation={annotation}
				state={state}
				targetName={nameOf(annotation)}
				expanded={expanded.has(annotation.id)}
				onExpandedChange={(open) => setThreadExpanded(annotation.id, open)}
				focused={annotation.id === activeAnnotationId}
				now={now}
				onRevealLayers={revealDesignLayers}
				nameOfLayer={nameOfLayer}
				reanchor={
					reanchorTarget
						? {
								label: targetName,
								run: () =>
									reanchorAnnotation(
										annotation,
										reanchorTarget,
										getDesignSnapshotHint(),
									),
							}
						: null
				}
				onSaveMemory={saveMemory}
			/>
		);
	};

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="flex flex-col pb-3" data-annotations-panel="">
				<div className="flex flex-col gap-2 border-b border-slate-200 p-3">
					<AnnotationComposer
						target={target}
						targetLabel={targetName}
						getSnapshot={getDesignSnapshotHint}
						focusRequest={composerFocusRequest}
					/>
				</div>
				<AnnotationBulkActions
					container={container}
					drafts={drafts}
					addressed={addressed}
					agentResolved={agentResolved}
					scopeLabel={scopeLabel}
					getSnapshot={getDesignSnapshotHint}
				/>
				{otherDrafts.length > 0 ? (
					<AnnotationSection title="Drafts" count={otherDrafts.length}>
						{otherDrafts.map((draft) => (
							<AnnotationDraftRow
								key={draft.key}
								draft={draft}
								getSnapshot={getDesignSnapshotHint}
								name={getDesignTargetName(draft.target, entitiesById)}
								onSelect={() =>
									selectElement(selectableIdOf(draft.target, entitiesById))
								}
							/>
						))}
					</AnnotationSection>
				) : null}
				{status === "error" ? (
					<p className="px-3 pt-3 text-xs text-red-900">
						Annotations could not be loaded.
					</p>
				) : null}
				{target.kind === "layer" ? (
					<AnnotationSection title="This layer" count={onLayer.length}>
						{onLayer.length > 0 ? (
							onLayer.map(renderThread)
						) : (
							<p className="px-3 py-2 text-xs text-slate-500">
								No annotations on {targetName}.
							</p>
						)}
					</AnnotationSection>
				) : null}
				{onBoard.length > 0 ? (
					<AnnotationSection title="This board" count={onBoard.length}>
						{onBoard.map(renderThread)}
					</AnnotationSection>
				) : null}
				{elsewhereOnBoard.length > 0 ? (
					<AnnotationSection
						title={
							target.kind === "board"
								? "Layers on this board"
								: "Elsewhere on this board"
						}
						count={elsewhereOnBoard.length}
					>
						{elsewhereOnBoard.map(renderThread)}
					</AnnotationSection>
				) : null}
				{onDesign.length > 0 ? (
					<AnnotationSection title="This design" count={onDesign.length}>
						{onDesign.map(renderThread)}
					</AnnotationSection>
				) : null}
				{onBoards.length > 0 ? (
					<AnnotationSection title="On boards" count={onBoards.length}>
						{onBoards.map(renderThread)}
					</AnnotationSection>
				) : null}
				<OtherBranchesSection
					container={container}
					scope={scope}
					now={now}
					getTargetName={nameOf}
				/>
			</div>
		</ScrollArea>
	);
}
