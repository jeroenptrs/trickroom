import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNow } from "../../hooks/useNow";
import type { AnnotationSnapshotHint } from "../../queries/annotations";
import { createMemoryNote, invalidateMemory } from "../../queries/memory";
import { findAnnotationsSharingChange } from "../../services/annotation-model";
import type { AnnotationView } from "../../services/annotations.types";
import {
	type AnnotationDraft,
	useAnnotationDrafts,
} from "../../stores/annotation-draft-store";
import {
	componentDraftStore,
	selectTemplateNode,
} from "../../stores/component-draft-store";
import {
	editorAnnotationsStore,
	getAnnotationStateWith,
} from "../../stores/editor-annotations-store";
import { buildAnnotationMemoryNote } from "../../utils/annotation-memory";
import {
	type AnnotationPresentationState,
	isAnnotationShown,
} from "../../utils/annotation-presentation";
import {
	componentDraftTargetLocator,
	getComponentSelectionTarget,
	getComponentTargetName,
	getVariantsInView,
} from "../../utils/component-annotation-targets";
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
import {
	revealComponentNodes,
	showVariantConfiguration,
} from "./component-annotation-pins";
import { OtherBranchesSection } from "./OtherBranchesSection";
import { VariantPinChip } from "./VariantPinChip";

type Listed = {
	annotation: AnnotationView;
	state: AnnotationPresentationState;
};

const byCreated = (a: Listed, b: Listed) =>
	a.annotation.createdAt.localeCompare(b.annotation.createdAt);

/** The variant values in view, sent with a new annotation. */
export function getComponentSnapshotHint(): AnnotationSnapshotHint {
	const variants = getVariantsInView(
		componentDraftStore.get().styleTarget.axisValues,
	);
	return variants ? { variants } : {};
}

const nodePathOf = (annotation: Pick<AnnotationView, "target">) =>
	annotation.target.kind === "componentNode"
		? annotation.target.nodePath
		: null;

/**
 * The component editor's Annotations tab: a composer for the selected node
 * (with "Pin to current configuration"), then the threads on that node and
 * elsewhere in the component, the component's bulk actions and drafts, and
 * the other branches' threads on request. The thread UI is the design
 * editor's; a pinned thread carries a chip of its configuration that
 * switches the configuration in view to it.
 */
export function ComponentAnnotationsPanel({
	systemId,
	componentId,
}: {
	/** The design system's manifest id. */
	systemId: string;
	componentId: string;
}) {
	const queryClient = useQueryClient();
	const projectScope = useProjectScope();
	const now = useNow();
	const draft = useSelector(
		componentDraftStore,
		(state) => ({
			entitiesByPath: state.entitiesByPath,
			rootPath: state.rootPath,
			selectedPath: state.selectedPath,
			variants: state.variants,
			axisValues: state.styleTarget.axisValues,
		}),
		{
			compare: (a, b) =>
				a.entitiesByPath === b.entitiesByPath &&
				a.rootPath === b.rootPath &&
				a.selectedPath === b.selectedPath &&
				a.variants === b.variants &&
				a.axisValues === b.axisValues,
		},
	);
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
	const { entitiesByPath, axisValues } = draft;
	const locator = useMemo(
		() =>
			componentDraftTargetLocator({
				entitiesByPath: draft.entitiesByPath,
				rootPath: draft.rootPath,
				variants: draft.variants,
			}),
		[draft.entitiesByPath, draft.rootPath, draft.variants],
	);
	const target = useMemo(
		() =>
			getComponentSelectionTarget(systemId, componentId, {
				entitiesByPath: draft.entitiesByPath,
				rootPath: draft.rootPath,
				selectedPath: draft.selectedPath,
			}),
		[
			componentId,
			draft.entitiesByPath,
			draft.rootPath,
			draft.selectedPath,
			systemId,
		],
	);
	const selectedPath =
		target?.kind === "componentNode" ? target.nodePath : null;
	const inView = useMemo(() => getVariantsInView(axisValues), [axisValues]);

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
			getComponentTargetName(
				annotation.target,
				entitiesByPath,
				annotation.snapshot.layerName,
			),
		[entitiesByPath],
	);
	const nameOfLayer = useCallback(
		(path: string) => {
			const entity = Object.hasOwn(entitiesByPath, path)
				? entitiesByPath[path]
				: undefined;
			return entity ? entity.name?.trim() || entity.component : null;
		},
		[entitiesByPath],
	);
	const targetName = target
		? getComponentTargetName(target, entitiesByPath)
		: "Component";

	const listed: Listed[] = useMemo(
		() =>
			Object.values(byId)
				.filter((annotation) => annotation.target.kind === "componentNode")
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
	const onNode = listed.filter(
		({ annotation }) => nodePathOf(annotation) === selectedPath,
	);
	const elsewhere = listed.filter(
		({ annotation }) => nodePathOf(annotation) !== selectedPath,
	);
	const addressed = listed
		.filter(({ state }) => state === "addressed")
		.map(({ annotation }) => annotation);
	const agentResolved = listed
		.filter(({ state }) => state === "agent_resolved")
		.map(({ annotation }) => annotation);

	const drafts = useAnnotationDrafts(
		useCallback(
			(entry: AnnotationDraft) =>
				entry.target.kind === "componentNode" &&
				entry.target.systemId === systemId &&
				entry.target.componentId === componentId,
			[componentId, systemId],
		),
	);
	const selectedDraftPath = selectedPath;
	const otherDrafts = drafts.filter(
		(entry) =>
			entry.target.kind !== "componentNode" ||
			entry.target.nodePath !== selectedDraftPath,
	);

	const container = useMemo(
		() => ({ kind: "component" as const, systemId, componentId }),
		[componentId, systemId],
	);

	const saveMemory = useCallback(
		async (annotation: AnnotationView) => {
			const note = buildAnnotationMemoryNote(annotation, nameOf(annotation));
			try {
				await createMemoryNote(
					{ kind: "system", systemId },
					{ ...note, category: "decision" },
				);
				await invalidateMemory(
					queryClient,
					{ kind: "system", systemId },
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
		[nameOf, projectScope, queryClient, systemId],
	);

	const renderPin = (variants: Readonly<Record<string, string>>) => (
		<VariantPinChip
			variants={variants}
			inView={axisValues}
			onShow={showVariantConfiguration}
		/>
	);

	const renderThread = ({ annotation, state }: Listed) => {
		const live =
			annotation.status !== "resolved" && annotation.status !== "dismissed";
		const pinned =
			annotation.target.kind === "componentNode"
				? annotation.target.variants
				: undefined;
		const reanchorTo =
			live && target && nodePathOf(annotation) !== selectedPath
				? {
						...target,
						...(pinned ? { variants: pinned } : {}),
					}
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
				onRevealLayers={revealComponentNodes}
				nameOfLayer={nameOfLayer}
				sharedChangeNames={(change) =>
					findAnnotationsSharingChange(
						Object.values(byId),
						annotation.id,
						change,
					).map((shared) => nameOf(shared.annotation))
				}
				headerExtra={pinned ? renderPin(pinned) : null}
				reanchor={
					reanchorTo
						? {
								label: targetName,
								run: () =>
									reanchorAnnotation(
										annotation,
										reanchorTo,
										getComponentSnapshotHint(),
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
			<div className="flex flex-col pb-3" data-annotations-panel="component">
				<div className="flex flex-col gap-2 border-b border-slate-200 p-3">
					{target ? (
						<AnnotationComposer
							target={target}
							targetLabel={targetName}
							getSnapshot={getComponentSnapshotHint}
							focusRequest={composerFocusRequest}
							pin={{ inView, renderPinned: renderPin }}
						/>
					) : (
						<p className="text-xs text-slate-500">
							Add a root layer to annotate this component.
						</p>
					)}
				</div>
				<AnnotationBulkActions
					container={container}
					drafts={drafts}
					addressed={addressed}
					agentResolved={agentResolved}
					scopeLabel="in this component"
					getSnapshot={getComponentSnapshotHint}
				/>
				{otherDrafts.length > 0 ? (
					<AnnotationSection title="Drafts" count={otherDrafts.length}>
						{otherDrafts.map((entry) => (
							<AnnotationDraftRow
								key={entry.key}
								draft={entry}
								getSnapshot={getComponentSnapshotHint}
								name={getComponentTargetName(entry.target, entitiesByPath)}
								onSelect={() => {
									const path = nodePathOf(entry);
									if (path && Object.hasOwn(entitiesByPath, path)) {
										selectTemplateNode(path);
									}
								}}
							/>
						))}
					</AnnotationSection>
				) : null}
				{status === "error" ? (
					<p className="px-3 pt-3 text-xs text-red-900">
						Annotations could not be loaded.
					</p>
				) : null}
				{target ? (
					<AnnotationSection title="This layer" count={onNode.length}>
						{onNode.length > 0 ? (
							onNode.map(renderThread)
						) : (
							<p className="px-3 py-2 text-xs text-slate-500">
								No annotations on {targetName}.
							</p>
						)}
					</AnnotationSection>
				) : null}
				{elsewhere.length > 0 ? (
					<AnnotationSection
						title="Elsewhere in this component"
						count={elsewhere.length}
					>
						{elsewhere.map(renderThread)}
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
