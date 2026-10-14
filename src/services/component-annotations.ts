import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { RecipeTemplateNode } from "../types";
import { findDesignSystem } from "../utils/design-system-store";
import {
	readSystemComponentManifest,
	type SystemComponentManifestRead,
	SystemComponentManifestServiceError,
} from "../utils/system-component-manifest-service";
import {
	SystemComponentOperationsError,
	updateSystemComponent,
} from "../utils/system-component-operations";
import type {
	SystemComponentDraftPayload,
	SystemComponentRecord,
	SystemComponentVariantSchema,
} from "../utils/system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import type { ComponentAnchorTemplate } from "./annotation-model";
import {
	type AnnotationAddress,
	type AnnotationComponentRead,
	type AnnotationServiceContext,
	AnnotationServiceError,
	type RecordChangeResult,
	recordChange,
	viewAnnotation,
	withEntry,
	withoutRevertState,
	withTransition,
} from "./annotation-service";
import {
	AnnotationStoreError,
	type StoredAnnotation,
} from "./annotation-store";
import type {
	Annotation,
	AnnotationActor,
	AnnotationChangeRecord,
	AnnotationContainer,
	AnnotationDraftState,
} from "./annotations.types";

/**
 * Annotations on system component nodes (WP5): what they anchor to, and
 * the change records of component writes that address them.
 *
 * - Anchor: the component's draft template, or its current published
 *   version when it has no draft. A node path is the template node's
 *   stable `path` (unique, never renumbered by inserts or moves), so an
 *   annotation follows its node; one whose path is gone is detached, and
 *   reattaches when the path returns.
 * - Revisions are the component manifest's.
 * - A draft write's change record can be reverted while the draft still
 *   has the hashes the write left it with: the draft's template parts and
 *   variant schema are restored as they were. A publish is recorded
 *   without revert state (a published version is never rewritten).
 *
 * Component writes are serialised per manifest (`aroundWrite` runs inside
 * that queue); the annotation is written under its own lock inside it, so
 * recording and reverting take the locks in the same order.
 */

/** A component read for its annotations. */
export type ComponentAnchorRead = AnnotationComponentRead & {
	systemId: string;
	componentId: string;
	name: string;
	/** Which template annotations anchor to: the draft, or the published version without one. */
	source: "draft" | "published";
};

const ownValue = <Value>(
	record: Readonly<Record<string, Value>> | undefined,
	key: string,
): Value | undefined =>
	record && Object.hasOwn(record, key) ? record[key] : undefined;

/** The template annotations anchor to: the draft's, else the current published one. */
export const getComponentAnchorTemplate = (
	record: SystemComponentRecord,
): {
	template: ComponentAnchorTemplate;
	source: "draft" | "published";
} | null => {
	if (record.draft) {
		return {
			template: { root: record.draft.root, variants: record.draft.variants },
			source: "draft",
		};
	}
	const published = record.published
		? ownValue(record.published.versions, record.published.currentVersion)
		: undefined;
	return published
		? {
				template: { root: published.root, variants: published.variants },
				source: "published",
			}
		: null;
};

/**
 * The canonical id of a design system named by id or name (annotation
 * folders use the manifest's `systemId`), or null when there is none.
 */
export const resolveAnnotationSystemId = async (
	projectRoot: string,
	systemHandle: string,
): Promise<string | null> =>
	(await findDesignSystem(projectRoot, systemHandle, { readOnly: true }))
		?.manifest.systemId ?? null;

/**
 * Reads a component for its annotations; null when the system or the
 * component does not exist (its annotations are still listed).
 */
export const readComponentAnchor = async (
	projectRoot: string,
	systemId: string,
	componentId: string,
): Promise<ComponentAnchorRead | null> => {
	const system = await findDesignSystem(projectRoot, systemId, {
		readOnly: true,
	});
	if (!system) return null;
	const read = await readSystemComponentManifest(
		projectRoot,
		system.manifest.systemId,
		{ readOnly: true },
	);
	const record = ownValue(read.manifest.components, componentId);
	const anchor = record ? getComponentAnchorTemplate(record) : null;
	if (!record || !anchor) return null;
	return {
		...anchor,
		revision: read.revision,
		systemId: system.manifest.systemId,
		componentId,
		name: record.name,
	};
};

// ---------------------------------------------------------------------------
// Change capture
// ---------------------------------------------------------------------------

/** Each node by path: its own fields (no children) and its child paths. */
const indexTemplate = (root: RecipeTemplateNode | undefined) => {
	const nodes = new Map<
		string,
		{ own: unknown; parentPath: string | null; childPaths: string[] }
	>();
	const visit = (node: RecipeTemplateNode, parentPath: string | null) => {
		const { children, ...own } = node;
		nodes.set(node.path, {
			own,
			parentPath,
			childPaths: (children ?? []).map((child) => child.path),
		});
		for (const child of children ?? []) visit(child, node.path);
	};
	if (root) visit(root, null);
	return nodes;
};

/** Per path, every variant and compound class string set on it. */
const indexVariantClasses = (
	variants: SystemComponentVariantSchema | undefined,
) => {
	const classes = new Map<string, string[]>();
	const add = (byPath: Record<string, string> | undefined, label: string) => {
		for (const [path, className] of Object.entries(byPath ?? {})) {
			const list = classes.get(path) ?? [];
			list.push(`${label}=${className}`);
			classes.set(path, list);
		}
	};
	for (const [axis, entry] of Object.entries(variants?.axes ?? {})) {
		for (const [value, variant] of Object.entries(entry.values)) {
			add(variant.classesByPath, `${axis}:${value}`);
		}
	}
	(variants?.compoundVariants ?? []).forEach((compound, index) => {
		add(compound.classesByPath, `compound:${index}`);
	});
	return classes;
};

/**
 * Template paths a draft write changed: nodes added or changed (their own
 * fields, child order or variant classes), and the parent of each removed
 * one when it is still there. In template order, removed parents last.
 */
export const diffComponentDraftPaths = (
	before: Pick<SystemComponentDraftPayload, "root" | "variants"> | undefined,
	after: Pick<SystemComponentDraftPayload, "root" | "variants"> | undefined,
): string[] => {
	const beforeNodes = indexTemplate(before?.root);
	const afterNodes = indexTemplate(after?.root);
	const beforeClasses = indexVariantClasses(before?.variants);
	const afterClasses = indexVariantClasses(after?.variants);
	const changed: string[] = [];
	for (const [path, node] of afterNodes) {
		const previous = beforeNodes.get(path);
		if (
			!previous ||
			!isDeepStrictEqual(previous.own, node.own) ||
			!isDeepStrictEqual(previous.childPaths, node.childPaths) ||
			!isDeepStrictEqual(beforeClasses.get(path), afterClasses.get(path))
		) {
			changed.push(path);
		}
	}
	const seen = new Set(changed);
	for (const [path, node] of beforeNodes) {
		if (afterNodes.has(path)) continue;
		const parent = node.parentPath;
		if (parent !== null && afterNodes.has(parent) && !seen.has(parent)) {
			seen.add(parent);
			changed.push(parent);
		}
	}
	return changed;
};

const draftHashes = (draft: SystemComponentDraftPayload) => ({
	templateHash: hashSystemComponentTemplate(draft),
	variantSchemaHash: hashSystemComponentVariantSchema(draft.variants),
});

const restorableDraft = (
	draft: SystemComponentDraftPayload,
): AnnotationDraftState =>
	structuredClone({
		root: draft.root,
		...(draft.slots ? { slots: draft.slots } : {}),
		...(draft.variants ? { variants: draft.variants } : {}),
		...(draft.overrideTargets
			? { overrideTargets: draft.overrideTargets }
			: {}),
	});

/**
 * What a component write changed, for its change record: the template
 * paths, and (`revertible`, for draft writes that changed the draft) the
 * draft as it was with the hashes it was left with.
 */
export const captureComponentChange = (
	before: SystemComponentRecord | undefined,
	after: SystemComponentRecord | undefined,
	{ revertible }: { revertible: boolean },
): Pick<AnnotationChangeRecord, "layerIds" | "draftBefore" | "draftAfter"> => {
	const beforeDraft = before?.draft;
	const afterDraft = after?.draft;
	const layerIds = diffComponentDraftPaths(beforeDraft, afterDraft);
	if (!revertible || !beforeDraft || !afterDraft) return { layerIds };
	const beforeHashes = draftHashes(beforeDraft);
	const afterHashes = draftHashes(afterDraft);
	if (isDeepStrictEqual(beforeHashes, afterHashes)) return { layerIds };
	return {
		layerIds,
		draftBefore: restorableDraft(beforeDraft),
		draftAfter: afterHashes,
	};
};

/**
 * The write hook for a component write that addresses annotations
 * (`component_draft_update` or `component_publish` with `addresses`): pass
 * `aroundWrite` in the mutation options. Inside the manifest's write queue,
 * once the manifest is stored, it captures what the write changed against
 * the manifest before it and records it on every addressed annotation (each
 * under its lock). A write that is refused never runs it, so nothing is
 * recorded. `results()` reports per annotation afterwards (empty when the
 * write did not happen).
 */
export const createComponentAddressesRecorder = (
	context: AnnotationServiceContext,
	{
		container,
		addresses,
		by,
		operation,
		summary,
		revertible,
		branch,
	}: {
		container: AnnotationContainer & { kind: "component" };
		addresses: readonly AnnotationAddress[];
		by: AnnotationActor;
		/** The tool that wrote, e.g. `component_draft_update`. */
		operation: string;
		/** What the write did, from the component as written. */
		summary: (after: SystemComponentRecord | undefined) => string;
		/** Draft writes: keep what revert needs. Publishes: never. */
		revertible: boolean;
		/** See `recordChange`. */
		branch?: string;
	},
) => {
	let results: RecordChangeResult[] = [];
	return {
		aroundWrite: async (
			write: () => Promise<SystemComponentManifestRead>,
			current: SystemComponentManifestRead,
		) => {
			const written = await write();
			const after = ownValue(
				written.manifest.components,
				container.componentId,
			);
			const text = summary(after);
			const change: AnnotationChangeRecord = {
				revisionBefore: current.revision,
				revisionAfter: written.revision,
				boards: [],
				operations: [{ operation, summary: text }],
				summary: text,
				...captureComponentChange(
					ownValue(current.manifest.components, container.componentId),
					after,
					{ revertible },
				),
			};
			results = await recordChange(context, {
				container,
				addresses,
				change,
				by,
				...(branch !== undefined ? { branch } : {}),
			});
		},
		results: () => results,
	};
};

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

const maxRevertAttempts = 3;

/**
 * Undoes a component draft change record: restores the draft's template
 * parts and variant schema as they were before the write, while the draft
 * still has the hashes the write left it with (nothing changed it since),
 * else fails with `CHANGED_SINCE`. The draft write is revision- and
 * hash-checked; inside the manifest's write queue it takes the
 * annotation's lock, checks the change is still revertible (and the
 * annotation still at `expectedRevision`), writes the manifest and then the
 * annotation: the change loses its revert state, a `revert` entry is added
 * and an addressed annotation is open again. When the manifest was written
 * but the annotation could not be, it fails with `REVERT_NOT_RECORDED`.
 */
export const revertComponentChange = async (
	context: AnnotationServiceContext,
	input: {
		annotationId: string;
		entryId: string;
		by: AnnotationActor;
		projectRoot: string;
		container: AnnotationContainer & { kind: "component" };
		expectedRevision?: string;
		now?: () => Date;
	},
) => {
	const { by, container } = input;
	if (by.role === "agent" ? !by.sessionId : by.role !== "human") {
		throw new AnnotationServiceError(
			"INVALID_INPUT",
			"by must be the human, or an agent with a session id.",
		);
	}
	const findChange = (annotation: Annotation) => {
		const entry = annotation.entries.find(
			(candidate) => candidate.id === input.entryId,
		);
		if (!entry || entry.kind !== "change") {
			throw new AnnotationServiceError(
				"NOT_REVERTIBLE",
				`Entry ${input.entryId} is not a change record of annotation ${input.annotationId}.`,
			);
		}
		const { draftBefore, draftAfter } = entry.change;
		if (!draftBefore || !draftAfter) {
			throw new AnnotationServiceError(
				"NOT_REVERTIBLE",
				entry.revertedBy
					? "This change has already been reverted."
					: "This change cannot be reverted: it was a publish, its annotation was resolved or dismissed, or it did not change the draft.",
			);
		}
		return { draftBefore, draftAfter, layerIds: entry.change.layerIds };
	};
	const stored = await context.store.read(container, input.annotationId);
	if (!stored) {
		throw new AnnotationStoreError(
			"ANNOTATION_NOT_FOUND",
			`Annotation ${input.annotationId} does not exist.`,
			{ annotationId: input.annotationId },
		);
	}
	if (
		input.expectedRevision !== undefined &&
		input.expectedRevision !== stored.revision
	) {
		throw new AnnotationStoreError(
			"ANNOTATION_REVISION_MISMATCH",
			`Annotation ${input.annotationId} changed since revision ${input.expectedRevision}.`,
			{ annotationId: input.annotationId, currentRevision: stored.revision },
		);
	}
	const { draftBefore, draftAfter, layerIds } = findChange(stored.annotation);
	const changedSince = (revision: string) =>
		new AnnotationServiceError(
			"CHANGED_SINCE",
			"The component draft has changed since this change; revert only applies while the draft is as the change left it.",
			{ layers: [], currentRevision: revision },
		);

	for (let attempt = 0; attempt < maxRevertAttempts; attempt += 1) {
		const read = await readSystemComponentManifest(
			input.projectRoot,
			container.systemId,
		);
		const draft = ownValue(
			read.manifest.components,
			container.componentId,
		)?.draft;
		if (!draft || !isDeepStrictEqual(draftHashes(draft), draftAfter)) {
			throw changedSince(read.revision);
		}
		let recorded: StoredAnnotation | null = null;
		let manifestRevision: string | null = null;
		const revertEntryId = randomUUID();
		try {
			await updateSystemComponent(
				input.projectRoot,
				container.systemId,
				container.componentId,
				{
					draft: {
						root: draftBefore.root,
						slots: draftBefore.slots ?? null,
						variants: draftBefore.variants ?? null,
						overrideTargets: draftBefore.overrideTargets ?? null,
					},
				},
				{
					expectedRevision: read.revision,
					expectedDraftTemplateHash: draftAfter.templateHash,
					expectedDraftVariantSchemaHash: draftAfter.variantSchemaHash,
					aroundWrite: async (write, current) => {
						const result = await context.store.update(
							container,
							input.annotationId,
							async ({ annotation }) => {
								// Annotation lock held: refuse before the draft changes
								// when the change stopped being revertible meanwhile.
								const locked = findChange(annotation);
								if (
									!isDeepStrictEqual(locked.draftBefore, draftBefore) ||
									!isDeepStrictEqual(locked.draftAfter, draftAfter)
								) {
									throw new AnnotationServiceError(
										"NOT_REVERTIBLE",
										"The change record changed while reverting; try again.",
									);
								}
								const written = await write();
								manifestRevision = written.revision;
								const at = (input.now?.() ?? new Date()).toISOString();
								const next = withEntry(
									{
										...annotation,
										entries: annotation.entries.map((entry) =>
											entry.id === input.entryId && entry.kind === "change"
												? {
														...entry,
														change: withoutRevertState(entry.change),
														revertedBy: revertEntryId,
													}
												: entry,
										),
									},
									{
										id: revertEntryId,
										kind: "revert",
										at,
										by,
										entryId: input.entryId,
										revisionBefore: current.revision,
										revisionAfter: written.revision,
									},
								);
								return {
									annotation:
										next.status === "addressed"
											? withTransition(next, "open", by, at)
											: next,
									result: undefined,
								};
							},
							{ expectedRevision: input.expectedRevision },
						);
						recorded = result.stored;
					},
				},
			);
		} catch (error) {
			if (manifestRevision !== null) {
				throw new AnnotationServiceError(
					"REVERT_NOT_RECORDED",
					`The component draft was reverted (revision ${manifestRevision}), but annotation ${input.annotationId} could not record it: ${error instanceof Error ? error.message : String(error)}`,
					{ revision: manifestRevision, annotationId: input.annotationId },
				);
			}
			if (
				(error instanceof SystemComponentOperationsError ||
					error instanceof SystemComponentManifestServiceError) &&
				error.code === "STALE_WRITE"
			) {
				continue;
			}
			if (
				error instanceof SystemComponentOperationsError &&
				(error.code === "DRAFT_HASH_MISMATCH" || error.code === "NO_DRAFT")
			) {
				throw changedSince(read.revision);
			}
			throw error;
		}
		if (!recorded || manifestRevision === null) break;
		const anchor = await readComponentAnchor(
			input.projectRoot,
			container.systemId,
			container.componentId,
		).catch(() => null);
		return {
			annotation: await viewAnnotation(context, recorded, {
				component: anchor?.template ?? null,
			}),
			revision: manifestRevision as string,
			restoredLayerIds: layerIds,
		};
	}
	throw new AnnotationServiceError(
		"COMPONENT_BUSY",
		"The component kept changing while reverting; try again.",
	);
};
