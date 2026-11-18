import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Plus, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { StagePreviewDarkModeToggle } from "../../preview/stage-preview-dark-mode";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	systemAssetFileUrl,
	systemAssetsQueryOptions,
} from "../../queries/system-assets";
import { systemComponentUsageQueryOptions } from "../../queries/system-component-usage";
import {
	systemComponentQueryOptions,
	systemComponentsQueryOptions,
} from "../../queries/system-components";
import { systemIconsQueryOptions } from "../../queries/system-icons";
import {
	componentDraftStore,
	hydrateComponentDraft,
	isComponentDraftForComponent,
	replaceComponentDraftVariants,
	useComponentDraftComponentId,
	useComponentDraftSelectedPath,
	useComponentDraftTemplateDirty,
	useComponentDraftVariantsDirty,
} from "../../stores/component-draft-store";
import {
	setEditorDraftConflict,
	setEditorMetadataField,
	setEditorVariantsValid,
	setLoadedDraftHashes,
	syncEditorSessionMetadata,
	useEditorDraftConflict,
	useEditorMetadata,
	useEditorMetadataChanged,
	useLoadedDraftTemplateHash,
	useLoadedDraftVariantSchemaHash,
} from "../../stores/component-editor-session-store";
import {
	editorAnnotationsStore,
	type InspectorTab,
	setInspectorTab,
	useInspectorTab,
} from "../../stores/editor-annotations-store";
import {
	buildComponentGroupTree,
	collectGroupFolderPaths,
} from "../../utils/component-groups";
import { classifyCompoundWhenShape } from "../../utils/system-component-compound-shape";
import { compoundWhenSignature } from "../../utils/system-component-compound-signature";
import {
	isSystemComponentSlug,
	type SystemComponentVariantSchema,
} from "../../utils/system-components";
import { ComponentAnnotationsPanel } from "../annotations/ComponentAnnotationsPanel";
import { Alert } from "../ui/alert";
import {
	AutocompleteEmpty,
	AutocompleteInput,
	AutocompleteItem,
	AutocompleteList,
	AutocompletePopup,
	AutocompletePortal,
	AutocompletePositioner,
	AutocompleteRoot,
} from "../ui/autocomplete";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { AuthoredCompoundsList } from "./AuthoredCompoundsList";
import { ComponentDraftProperties } from "./ComponentDraftProperties";
import type { ComponentPublicationState } from "./component-catalog";
import { getComponentPublicationState } from "./component-catalog";
import { formatAssetMimeType } from "./SystemEditorAssetsPanel";
import { SystemEditorLintInspector } from "./SystemEditorLintPanel";
import { SystemPanelToggle } from "./SystemPanelToggle";
import type { SystemEditorPage } from "./types";

function InspectorField({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1.5">
			<span className="text-slate-500">{label}</span>
			<span
				className="min-w-0 truncate text-right text-slate-900"
				title={typeof value === "string" ? value : undefined}
			>
				{value}
			</span>
		</div>
	);
}

/** Field rows while an inspector's data loads. */
function InspectorSkeleton({ rows = 4 }: { rows?: number }) {
	return (
		<div className="flex flex-col gap-3" aria-busy="true">
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-4 w-40" />
				<Skeleton className="h-3 w-24" />
			</div>
			{Array.from({ length: rows }, (_, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
					key={index}
					className="flex items-center justify-between gap-3 py-1.5"
				>
					<Skeleton className="h-3 w-20" />
					<Skeleton className="h-3 w-28" />
				</div>
			))}
		</div>
	);
}

/** A failed inspector request: what failed, the reason, and a retry. */
function InspectorLoadError({
	title,
	error,
	isRetrying,
	onRetry,
}: {
	title: string;
	error: Error | null;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-col items-start gap-2">
			<Alert variant="panel" className="w-full">
				<span className="block font-medium">{title}</span>
				{error?.message ? <span className="block">{error.message}</span> : null}
			</Alert>
			<Button
				type="button"
				variant="outlined"
				className="px-2 py-1 text-xs"
				disabled={isRetrying}
				onClick={onRetry}
			>
				Retry
			</Button>
		</div>
	);
}

/** Every diagnostic, with the count next to the label. */
function ComponentDiagnosticsList({
	diagnostics,
}: {
	diagnostics: Array<{
		code: string;
		componentId?: string;
		path?: string;
		message: string;
	}>;
}) {
	if (diagnostics.length === 0) {
		return null;
	}
	return (
		<div className="border-t border-slate-200 pt-2">
			<Text
				variant="group-label"
				render={<p />}
				className="flex items-baseline justify-between gap-2"
			>
				<span>Diagnostics</span>
				<span className="text-slate-900">{diagnostics.length}</span>
			</Text>
			<ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
				{diagnostics.map((diagnostic, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: two diagnostics can share every field
						key={`${index}-${diagnostic.code}-${diagnostic.componentId ?? ""}-${diagnostic.path ?? ""}`}
						className="text-[11px] text-amber-800"
					>
						{diagnostic.message}
					</li>
				))}
			</ul>
		</div>
	);
}

export type VariantValueDraft = {
	id: string;
	key: string;
	originalKey?: string;
	label: string;
};
export type VariantAxisDraft = {
	id: string;
	key: string;
	originalKey?: string;
	label: string;
	defaultValue: string;
	schemaDefaultValue: string;
	values: VariantValueDraft[];
};

export type CompoundConditionDraft = {
	id: string;
	axisKey: string;
	valueKey: string;
};
export type CompoundVariantDraft = {
	id: string;
	conditions: CompoundConditionDraft[];
	// Signature of this compound's `when` the last time it was synced to the
	// schema. Lets condition edits keep their painted classesByPath even though
	// changing a condition changes the `when` map it would otherwise be keyed by.
	originalWhenSignature?: string;
	// Preserved manifest `when` for advanced/compat shapes the normal editor
	// cannot round-trip (arrays, empty when, one-axis, unknown refs, etc.).
	originalWhen?: Record<string, string | string[]>;
	isAdvancedCompat?: boolean;
};

const DRAFT_CONFLICT_MESSAGE =
	"This draft changed on disk while you were editing. Reload it to drop your edits.";

/** The draft conflict message. Reload draft lives in the component footer. */
function DraftConflictNotice({ message }: { message: string }) {
	return (
		<Card edge="border" tone="warning" className="px-2 py-1.5" role="alert">
			{message}
		</Card>
	);
}

const variantAxisKeyPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const variantValueKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const createDraftId = () => Math.random().toString(36).slice(2, 9);

// Compounds combine at least two axis conditions.
const COMPOUND_MIN_AXES = 2;

function compoundConditionsToWhen(
	conditions: CompoundConditionDraft[],
): Record<string, string> {
	const when: Record<string, string> = {};
	for (const condition of conditions) {
		const axisKey = condition.axisKey.trim();
		const valueKey = condition.valueKey.trim();
		if (axisKey && valueKey) {
			when[axisKey] = valueKey;
		}
	}
	return when;
}

export function validateSystemComponentMetadataSlug(slug: string) {
	const trimmedSlug = slug.trim();
	if (!trimmedSlug) {
		throw new Error("Enter a slug.");
	}
	if (!isSystemComponentSlug(trimmedSlug)) {
		throw new Error("Use lowercase letters, numbers, and hyphens in the slug.");
	}
	return trimmedSlug;
}

function schemaToVariantDrafts(
	schema: SystemComponentVariantSchema | undefined,
): VariantAxisDraft[] {
	return Object.entries(schema?.axes ?? {}).map(([axisKey, axis]) => ({
		id: createDraftId(),
		key: axisKey,
		originalKey: axisKey,
		label: axis.label,
		defaultValue: axis.defaultValue ?? "",
		schemaDefaultValue: schema?.defaultValues?.[axisKey] ?? "",
		values: Object.entries(axis.values).map(([valueKey, value]) => ({
			id: createDraftId(),
			key: valueKey,
			originalKey: valueKey,
			label: value.label ?? "",
		})),
	}));
}

// Decides whether the inspector's local variant/compound drafts should be
// seeded from the live store or the server record. The store wins whenever this
// component has unsaved variant edits, because the inspector unmounts while a
// layer is selected and remounts with its local draft state reset — reseeding
// from the server there would drop the in-progress variants.
export function resolveVariantDraftSeedSource({
	variantsDirty,
	draftMatchesComponent,
	storeVariants,
	serverVariants,
}: {
	variantsDirty: boolean;
	draftMatchesComponent: boolean;
	storeVariants: SystemComponentVariantSchema | null;
	serverVariants: SystemComponentVariantSchema | undefined;
}): SystemComponentVariantSchema | undefined {
	return variantsDirty && draftMatchesComponent
		? (storeVariants ?? undefined)
		: serverVariants;
}

export function schemaToCompoundDrafts(
	schema: SystemComponentVariantSchema | null | undefined,
): CompoundVariantDraft[] {
	const axes = schema?.axes ?? {};
	return (schema?.compoundVariants ?? []).map((compound) => {
		const classification = classifyCompoundWhenShape(compound.when, axes);
		return {
			id: createDraftId(),
			originalWhenSignature: compoundWhenSignature(compound.when),
			originalWhen: { ...compound.when },
			isAdvancedCompat: classification.kind === "advanced",
			conditions: Object.entries(compound.when).map(([axisKey, value]) => ({
				id: createDraftId(),
				axisKey,
				valueKey: Array.isArray(value) ? value.join("|") : value,
			})),
		};
	});
}

export function validateVariantDrafts(
	drafts: VariantAxisDraft[],
	compoundDrafts: CompoundVariantDraft[] = [],
) {
	const diagnostics: string[] = [];
	const axisKeys = new Map<string, number>();

	for (const [axisIndex, axis] of drafts.entries()) {
		const axisLabel = axis.key || axis.label || `axis ${axisIndex + 1}`;
		const axisKey = axis.key.trim();
		if (!axisKey) {
			diagnostics.push(`Variant ${axisLabel} must include an axis key.`);
		} else if (!variantAxisKeyPattern.test(axisKey)) {
			diagnostics.push(
				`Variant axis "${axisKey}" must start with a letter and use only letters, numbers, underscores, or hyphens.`,
			);
		}
		axisKeys.set(axisKey, (axisKeys.get(axisKey) ?? 0) + 1);

		if (!axis.label.trim()) {
			diagnostics.push(`Variant axis "${axisLabel}" must include a label.`);
		}
		if (axis.values.length === 0) {
			diagnostics.push(
				`Variant axis "${axisLabel}" must include at least one value.`,
			);
		}

		const valueKeys = new Map<string, number>();
		for (const [valueIndex, value] of axis.values.entries()) {
			const valueLabel = value.key || value.label || `value ${valueIndex + 1}`;
			const valueKey = value.key.trim();
			if (!valueKey) {
				diagnostics.push(
					`Variant value "${valueLabel}" on axis "${axisLabel}" must include a key.`,
				);
			} else if (!variantValueKeyPattern.test(valueKey)) {
				diagnostics.push(
					`Variant value "${valueKey}" on axis "${axisLabel}" must start with a letter or number and use only letters, numbers, underscores, or hyphens.`,
				);
			}
			valueKeys.set(valueKey, (valueKeys.get(valueKey) ?? 0) + 1);
		}
		for (const [valueKey, count] of [...valueKeys.entries()].sort()) {
			if (valueKey && count > 1) {
				diagnostics.push(
					`Variant axis "${axisLabel}" has duplicate value key "${valueKey}".`,
				);
			}
		}

		const availableValues = new Set(
			axis.values.map((value) => value.key.trim()).filter(Boolean),
		);
		if (
			axis.defaultValue.trim() &&
			!availableValues.has(axis.defaultValue.trim())
		) {
			diagnostics.push(
				`Variant axis "${axisLabel}" default "${axis.defaultValue.trim()}" does not match a value key.`,
			);
		}
		if (
			axis.schemaDefaultValue.trim() &&
			!availableValues.has(axis.schemaDefaultValue.trim())
		) {
			diagnostics.push(
				`Schema default for axis "${axisLabel}" uses missing value "${axis.schemaDefaultValue.trim()}".`,
			);
		}
	}

	for (const [axisKey, count] of [...axisKeys.entries()].sort()) {
		if (axisKey && count > 1) {
			diagnostics.push(`Duplicate variant axis key "${axisKey}".`);
		}
	}

	const valuesByAxis = new Map<string, Set<string>>();
	for (const axis of drafts) {
		const axisKey = axis.key.trim();
		if (!axisKey) {
			continue;
		}
		valuesByAxis.set(
			axisKey,
			new Set(axis.values.map((value) => value.key.trim()).filter(Boolean)),
		);
	}

	for (const [compoundIndex, compound] of compoundDrafts.entries()) {
		if (compound.isAdvancedCompat) {
			continue;
		}
		const compoundLabel = `Compound variant ${compoundIndex + 1}`;
		const seenAxes = new Map<string, number>();
		let resolvedConditions = 0;

		for (const condition of compound.conditions) {
			const axisKey = condition.axisKey.trim();
			const valueKey = condition.valueKey.trim();
			if (!axisKey) {
				diagnostics.push(`${compoundLabel} has a condition with no axis.`);
				continue;
			}
			seenAxes.set(axisKey, (seenAxes.get(axisKey) ?? 0) + 1);
			const axisValues = valuesByAxis.get(axisKey);
			if (!axisValues) {
				diagnostics.push(
					`${compoundLabel} references unknown axis "${axisKey}".`,
				);
				continue;
			}
			if (!valueKey) {
				diagnostics.push(
					`${compoundLabel} must choose a value for axis "${axisKey}".`,
				);
				continue;
			}
			if (!axisValues.has(valueKey)) {
				diagnostics.push(
					`${compoundLabel} references value "${valueKey}" that does not exist on axis "${axisKey}".`,
				);
				continue;
			}
			resolvedConditions += 1;
		}

		for (const [axisKey, count] of [...seenAxes.entries()].sort()) {
			if (count > 1) {
				diagnostics.push(
					`${compoundLabel} uses axis "${axisKey}" more than once.`,
				);
			}
		}

		if (resolvedConditions < COMPOUND_MIN_AXES) {
			diagnostics.push(
				`${compoundLabel} must combine at least ${COMPOUND_MIN_AXES} axes.`,
			);
		}
	}

	return diagnostics;
}

function publicationStateLabel(state: ComponentPublicationState) {
	switch (state) {
		case "draft-over-published":
			return "Published with draft";
		case "published-only":
			return "Published";
		case "draft-only":
			return "Draft only";
	}
}

function formatVersionTimestamp(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: date.toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			});
}

export function variantDraftsToSchema(
	drafts: VariantAxisDraft[],
	existing?: SystemComponentVariantSchema | null,
	compoundDrafts?: CompoundVariantDraft[],
) {
	if (drafts.length === 0) {
		return null;
	}

	const axes: SystemComponentVariantSchema["axes"] = {};
	const defaultValues: Record<string, string> = {};
	for (const axis of drafts) {
		const axisKey = axis.key.trim();
		const originalAxisKey = axis.originalKey?.trim();
		const values: SystemComponentVariantSchema["axes"][string]["values"] = {};
		for (const value of axis.values) {
			const valueKey = value.key.trim();
			const originalValueKey = value.originalKey?.trim();
			const label = value.label.trim();
			const existingValue =
				existing?.axes[axisKey]?.values[valueKey] ??
				(originalAxisKey && originalValueKey
					? existing?.axes[originalAxisKey]?.values[originalValueKey]
					: undefined);
			values[valueKey] = {
				...(existingValue?.classesByPath
					? { classesByPath: { ...existingValue.classesByPath } }
					: {}),
				...(label ? { label } : {}),
			};
		}
		const defaultValue = axis.defaultValue.trim();
		const schemaDefaultValue = axis.schemaDefaultValue.trim();
		axes[axisKey] = {
			label: axis.label.trim(),
			...(defaultValue ? { defaultValue } : {}),
			values,
		};
		if (schemaDefaultValue) {
			defaultValues[axisKey] = schemaDefaultValue;
		}
	}

	const compoundVariants = compoundDraftsToSchema(compoundDrafts, existing);

	return {
		axes,
		...(compoundVariants.length > 0 ? { compoundVariants } : {}),
		...(Object.keys(defaultValues).length > 0 ? { defaultValues } : {}),
	};
}

function compoundDraftsToSchema(
	compoundDrafts: CompoundVariantDraft[] | undefined,
	existing?: SystemComponentVariantSchema | null,
): NonNullable<SystemComponentVariantSchema["compoundVariants"]> {
	if (!compoundDrafts || compoundDrafts.length === 0) {
		return [];
	}

	// Painted classes live on the schema (set from the stage), keyed only by
	// position in the array. Re-associate them by `when` signature so editing a
	// condition — or removing a sibling compound — does not drop them. Falling
	// back to the draft's previous signature covers the in-flight edit where the
	// new `when` is not in the schema yet.
	const classesBySignature = new Map<string, Record<string, string>>();
	for (const compound of existing?.compoundVariants ?? []) {
		const signature = compoundWhenSignature(compound.when);
		if (!classesBySignature.has(signature)) {
			classesBySignature.set(signature, compound.classesByPath);
		}
	}

	return compoundDrafts.map((draft) => {
		const when =
			draft.isAdvancedCompat && draft.originalWhen
				? draft.originalWhen
				: compoundConditionsToWhen(draft.conditions);
		const signature = compoundWhenSignature(when);
		const classesByPath =
			classesBySignature.get(signature) ??
			(draft.originalWhenSignature
				? classesBySignature.get(draft.originalWhenSignature)
				: undefined) ??
			{};
		return { when, classesByPath: { ...classesByPath } };
	});
}

export function evaluateComponentDraftServerConflict({
	dirtyDraftMatchesComponent,
	templateDirty,
	variantsDirty,
	serverDraftTemplateHash,
	serverDraftVariantSchemaHash,
	loadedDraftTemplateHash,
	loadedDraftVariantSchemaHash,
}: {
	dirtyDraftMatchesComponent: boolean;
	templateDirty: boolean;
	variantsDirty: boolean;
	serverDraftTemplateHash: string | null;
	serverDraftVariantSchemaHash: string | null;
	loadedDraftTemplateHash: string | null;
	loadedDraftVariantSchemaHash: string | null;
}) {
	const templateDiverged = serverDraftTemplateHash !== loadedDraftTemplateHash;
	const variantSchemaDiverged =
		serverDraftVariantSchemaHash !== loadedDraftVariantSchemaHash;
	const serverDraftChanged = templateDiverged || variantSchemaDiverged;

	// A server-side divergence is only a conflict in a dimension we are actively
	// editing locally. A change to a dimension we have not touched is simply a
	// new baseline to adopt — e.g. a template-only save (from the workspace
	// actions) advancing the template hash while we hold unsaved variant edits.
	const templateConflict = templateDirty && templateDiverged;
	const variantSchemaConflict = variantsDirty && variantSchemaDiverged;
	const hasConflict =
		!dirtyDraftMatchesComponent || templateConflict || variantSchemaConflict;

	return {
		serverDraftChanged,
		hasConflict,
		adoptTemplateBaseline: !hasConflict && !templateDirty && templateDiverged,
		adoptVariantSchemaBaseline:
			!hasConflict && !variantsDirty && variantSchemaDiverged,
	};
}

export function advanceVariantDraftSchemaKeys(
	drafts: VariantAxisDraft[],
	schema: SystemComponentVariantSchema | null,
): VariantAxisDraft[] {
	return drafts.map((axis) => {
		const axisKey = axis.key.trim();
		const schemaAxis = axisKey ? schema?.axes[axisKey] : undefined;

		return {
			...axis,
			...(schemaAxis ? { originalKey: axisKey } : {}),
			values: axis.values.map((value) => {
				const valueKey = value.key.trim();
				return {
					...value,
					...(schemaAxis?.values[valueKey] ? { originalKey: valueKey } : {}),
				};
			}),
		};
	});
}

// Rebaselines each compound draft's `when` signature to the schema it was just
// serialized into (compounds keep their array order), so the next condition
// edit can still recover the painted classesByPath.
export function advanceCompoundDraftKeys(
	drafts: CompoundVariantDraft[],
	schema: SystemComponentVariantSchema | null,
): CompoundVariantDraft[] {
	const compounds = schema?.compoundVariants ?? [];
	return drafts.map((draft, index) => {
		const when = compounds[index]?.when;
		return when
			? { ...draft, originalWhenSignature: compoundWhenSignature(when) }
			: draft;
	});
}

/**
 * The error for each variant field the user types into, keyed by field id
 * (`axis-key:{axisId}`, `axis-label:{axisId}`, `value-key:{valueId}`). Errors
 * that span fields (defaults, compound variants) are only in the full list.
 */
export function variantFieldErrors(drafts: VariantAxisDraft[]) {
	const errors = new Map<string, string>();
	const axisKeyCounts = new Map<string, number>();
	for (const axis of drafts) {
		const axisKey = axis.key.trim();
		axisKeyCounts.set(axisKey, (axisKeyCounts.get(axisKey) ?? 0) + 1);
	}

	for (const axis of drafts) {
		const axisKey = axis.key.trim();
		if (!axisKey) {
			errors.set(`axis-key:${axis.id}`, "Enter an axis key.");
		} else if (!variantAxisKeyPattern.test(axisKey)) {
			errors.set(
				`axis-key:${axis.id}`,
				"Start with a letter. Use only letters, numbers, _ and -.",
			);
		} else if ((axisKeyCounts.get(axisKey) ?? 0) > 1) {
			errors.set(`axis-key:${axis.id}`, "Another axis uses this key.");
		}
		if (!axis.label.trim()) {
			errors.set(`axis-label:${axis.id}`, "Enter a label.");
		}

		const valueKeyCounts = new Map<string, number>();
		for (const value of axis.values) {
			const valueKey = value.key.trim();
			valueKeyCounts.set(valueKey, (valueKeyCounts.get(valueKey) ?? 0) + 1);
		}
		for (const value of axis.values) {
			const valueKey = value.key.trim();
			if (!valueKey) {
				errors.set(`value-key:${value.id}`, "Enter a value key.");
			} else if (!variantValueKeyPattern.test(valueKey)) {
				errors.set(
					`value-key:${value.id}`,
					"Start with a letter or number. Use only letters, numbers, _ and -.",
				);
			} else if ((valueKeyCounts.get(valueKey) ?? 0) > 1) {
				errors.set(
					`value-key:${value.id}`,
					"Another value on this axis uses this key.",
				);
			}
		}
	}
	return errors;
}

function VariantSchemaEditor({
	diagnostics,
	drafts,
	onChange,
	onCompoundsMutate,
}: {
	diagnostics: string[];
	drafts: VariantAxisDraft[];
	onChange: (drafts: VariantAxisDraft[]) => void;
	onCompoundsMutate?: () => void;
}) {
	const emitAxes = (nextDrafts: VariantAxisDraft[]) => onChange(nextDrafts);
	// Validate on blur: a field shows its error once it loses focus, and the
	// full list shows once focus leaves the editor (for example to Save).
	const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [showAllDiagnostics, setShowAllDiagnostics] = useState(false);
	const hasDiagnostics = diagnostics.length > 0;
	useEffect(() => {
		if (!hasDiagnostics) {
			setShowAllDiagnostics(false);
		}
	}, [hasDiagnostics]);
	const fieldErrors = useMemo(() => variantFieldErrors(drafts), [drafts]);
	const touch = (fieldId: string) =>
		setTouchedFields((current) =>
			current.has(fieldId) ? current : new Set(current).add(fieldId),
		);
	const fieldError = (fieldId: string) =>
		touchedFields.has(fieldId) ? fieldErrors.get(fieldId) : undefined;
	const fieldErrorProps = (fieldId: string) => {
		const error = fieldError(fieldId);
		return {
			onBlur: () => touch(fieldId),
			"aria-invalid": error ? true : undefined,
			"aria-describedby": error ? `variant-error-${fieldId}` : undefined,
		};
	};
	const renderFieldError = (fieldId: string) => {
		const error = fieldError(fieldId);
		return error ? (
			<Alert
				variant="inline"
				className="items-start [&_svg]:mt-px [&_svg]:size-3"
				id={`variant-error-${fieldId}`}
			>
				{error}
			</Alert>
		) : null;
	};
	const updateAxis = (
		axisId: string,
		patch: Partial<Omit<VariantAxisDraft, "id" | "values">>,
	) => {
		emitAxes(
			drafts.map((axis) => (axis.id === axisId ? { ...axis, ...patch } : axis)),
		);
	};
	const updateValue = (
		axisId: string,
		valueId: string,
		patch: Partial<Omit<VariantValueDraft, "id">>,
	) => {
		emitAxes(
			drafts.map((axis) =>
				axis.id === axisId
					? {
							...axis,
							values: axis.values.map((value) =>
								value.id === valueId ? { ...value, ...patch } : value,
							),
						}
					: axis,
			),
		);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: focusout delegation from the fields inside, not an interaction of its own
		<section
			className="flex flex-col gap-2 border-b border-slate-200 pb-3"
			onBlur={(event) => {
				if (
					hasDiagnostics &&
					!event.currentTarget.contains(event.relatedTarget as Node | null)
				) {
					setShowAllDiagnostics(true);
				}
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<Text variant="group-label" render={<p />}>
					Variants
				</Text>
				<Button
					type="button"
					variant="outlined"
					className="flex items-center gap-1 px-2 py-1 text-xs"
					onClick={() =>
						emitAxes([
							...drafts,
							{
								id: createDraftId(),
								key: "",
								label: "",
								defaultValue: "",
								schemaDefaultValue: "",
								values: [{ id: createDraftId(), key: "", label: "" }],
							},
						])
					}
				>
					<Plus className="size-3" aria-hidden="true" />
					Add axis
				</Button>
			</div>
			{drafts.length === 0 ? (
				<Text variant="meta" render={<p />}>
					No variant axes yet.
				</Text>
			) : null}
			{drafts.map((axis, axisIndex) => (
				<Card key={axis.id} edge="border" className="flex flex-col gap-2 p-2">
					<div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-key`}
						>
							<Text variant="group-label">Axis key</Text>
							<Input
								id={`variant-axis-${axis.id}-key`}
								variant="formCompact"
								value={axis.key}
								placeholder={axisIndex === 0 ? "tone" : "size"}
								onChange={(event) =>
									updateAxis(axis.id, { key: event.target.value })
								}
								{...fieldErrorProps(`axis-key:${axis.id}`)}
							/>
							{renderFieldError(`axis-key:${axis.id}`)}
						</label>
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-label`}
						>
							<Text variant="group-label">Label</Text>
							<Input
								id={`variant-axis-${axis.id}-label`}
								variant="formCompact"
								value={axis.label}
								placeholder={axisIndex === 0 ? "Tone" : "Size"}
								onChange={(event) =>
									updateAxis(axis.id, { label: event.target.value })
								}
								{...fieldErrorProps(`axis-label:${axis.id}`)}
							/>
							{renderFieldError(`axis-label:${axis.id}`)}
						</label>
						<Button
							type="button"
							variant="block"
							flavor="danger"
							className="mt-4 px-2 py-1"
							title="Remove axis"
							aria-label={`Remove axis ${axis.key || axis.label || axisIndex + 1}`}
							onClick={() =>
								emitAxes(drafts.filter((entry) => entry.id !== axis.id))
							}
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-default`}
						>
							<Text variant="group-label">Axis default</Text>
							<Select
								id={`variant-axis-${axis.id}-default`}
								variant="outlined"
								value={axis.defaultValue}
								onChange={(event) =>
									updateAxis(axis.id, { defaultValue: event.target.value })
								}
							>
								<option value="">None</option>
								{axis.values.map((value) => (
									<option key={value.id} value={value.key}>
										{value.key || "Untitled value"}
									</option>
								))}
							</Select>
						</label>
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-schema-default`}
						>
							<Text variant="group-label">Schema default</Text>
							<Select
								id={`variant-axis-${axis.id}-schema-default`}
								variant="outlined"
								value={axis.schemaDefaultValue}
								onChange={(event) =>
									updateAxis(axis.id, {
										schemaDefaultValue: event.target.value,
									})
								}
							>
								<option value="">None</option>
								{axis.values.map((value) => (
									<option key={value.id} value={value.key}>
										{value.key || "Untitled value"}
									</option>
								))}
							</Select>
						</label>
					</div>
					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between">
							<Text variant="group-label">Values</Text>
							<Button
								type="button"
								variant="block"
								className="flex items-center gap-1 px-2 py-1 text-xs"
								onClick={() =>
									emitAxes(
										drafts.map((entry) =>
											entry.id === axis.id
												? {
														...entry,
														values: [
															...entry.values,
															{
																id: createDraftId(),
																key: "",
																label: "",
															},
														],
													}
												: entry,
										),
									)
								}
							>
								<Plus className="size-3" aria-hidden="true" />
								Add value
							</Button>
						</div>
						{axis.values.map((value, valueIndex) => (
							<div
								key={value.id}
								className="grid grid-cols-[1fr_1fr_auto] gap-2"
							>
								<Input
									aria-label="Variant value key"
									variant="formCompact"
									value={value.key}
									placeholder={valueIndex === 0 ? "primary" : "secondary"}
									onChange={(event) =>
										updateValue(axis.id, value.id, {
											key: event.target.value,
										})
									}
									{...fieldErrorProps(`value-key:${value.id}`)}
								/>
								<Input
									aria-label="Variant value label"
									variant="formCompact"
									value={value.label}
									placeholder={valueIndex === 0 ? "Primary" : "Secondary"}
									onChange={(event) =>
										updateValue(axis.id, value.id, {
											label: event.target.value,
										})
									}
								/>
								<Button
									type="button"
									variant="block"
									flavor="danger"
									className="px-2 py-1"
									title="Remove value"
									aria-label={`Remove value ${value.key || value.label || valueIndex + 1}`}
									onClick={() =>
										emitAxes(
											drafts.map((entry) =>
												entry.id === axis.id
													? {
															...entry,
															values: entry.values.filter(
																(item) => item.id !== value.id,
															),
														}
													: entry,
											),
										)
									}
								>
									<Trash2 className="size-3.5" aria-hidden="true" />
								</Button>
								{fieldError(`value-key:${value.id}`) ? (
									<div className="col-span-3">
										{renderFieldError(`value-key:${value.id}`)}
									</div>
								) : null}
							</div>
						))}
					</div>
				</Card>
			))}
			<AuthoredCompoundsList onMutate={onCompoundsMutate} />
			{showAllDiagnostics && hasDiagnostics ? (
				<Card
					edge="border"
					tone="danger"
					className="flex flex-col gap-1 px-2 py-1.5"
					role="alert"
				>
					<ul className="flex flex-col gap-1">
						{diagnostics.map((diagnostic) => (
							<li key={diagnostic} className="text-[11px]">
								{diagnostic}
							</li>
						))}
					</ul>
				</Card>
			) : null}
		</section>
	);
}

export type SystemEditorComponentContextPanelMode =
	| "settings"
	| "variants"
	| "publish";

export function SystemEditorComponentContextSync({
	systemId,
	componentId,
	projectScope,
}: {
	systemId: string;
	componentId: string;
	projectScope?: ProjectQueryScope;
}) {
	const detailQuery = useQuery(
		systemComponentQueryOptions(systemId, componentId, projectScope),
	);
	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const loadedDraftTemplateHash = useLoadedDraftTemplateHash();
	const loadedDraftVariantSchemaHash = useLoadedDraftVariantSchemaHash();
	const record = detailQuery.data?.record;

	useEffect(() => {
		if (!record) {
			return;
		}

		syncEditorSessionMetadata({
			componentId: record.componentId,
			metadata: {
				name: record.name,
				slug: record.slug,
				description: record.description ?? "",
				group: record.group ?? "",
				order: record.order === undefined ? "" : String(record.order),
			},
		});

		if (!record.draft) {
			setLoadedDraftHashes({ templateHash: null, variantSchemaHash: null });
			setEditorDraftConflict(null);
			return;
		}

		const serverDraftTemplateHash = detailQuery.data?.draftTemplateHash ?? null;
		const serverDraftVariantSchemaHash =
			detailQuery.data?.draftVariantSchemaHash ?? null;
		const hydrateResult = hydrateComponentDraft({
			componentId: record.componentId,
			root: record.draft.root,
			baseVersion: record.draft.baseVersion,
			slots: record.draft.slots,
			overrideTargets: record.draft.overrideTargets,
			variants: record.draft.variants ?? null,
		});

		if (hydrateResult === "dirty-skipped") {
			const { hasConflict, adoptTemplateBaseline, adoptVariantSchemaBaseline } =
				evaluateComponentDraftServerConflict({
					dirtyDraftMatchesComponent: isComponentDraftForComponent(
						record.componentId,
					),
					templateDirty,
					variantsDirty,
					serverDraftTemplateHash,
					serverDraftVariantSchemaHash,
					loadedDraftTemplateHash,
					loadedDraftVariantSchemaHash,
				});

			if (adoptTemplateBaseline) {
				setLoadedDraftHashes({ templateHash: serverDraftTemplateHash });
			}
			if (adoptVariantSchemaBaseline) {
				setLoadedDraftHashes({
					variantSchemaHash: serverDraftVariantSchemaHash,
				});
			}

			setEditorDraftConflict(hasConflict ? DRAFT_CONFLICT_MESSAGE : null);
			return;
		}

		setLoadedDraftHashes({
			templateHash: serverDraftTemplateHash,
			variantSchemaHash: serverDraftVariantSchemaHash,
		});
		setEditorDraftConflict(null);
	}, [
		detailQuery.data?.draftTemplateHash,
		detailQuery.data?.draftVariantSchemaHash,
		loadedDraftTemplateHash,
		loadedDraftVariantSchemaHash,
		record,
		templateDirty,
		variantsDirty,
	]);

	return null;
}

export function SystemEditorComponentContextPanel({
	systemId,
	componentId,
	projectScope,
	mode,
}: {
	systemId: string;
	componentId: string;
	projectScope?: ProjectQueryScope;
	mode: SystemEditorComponentContextPanelMode;
}) {
	const listQuery = useQuery(
		systemComponentsQueryOptions(systemId, projectScope),
	);
	const detailQuery = useQuery(
		systemComponentQueryOptions(systemId, componentId, projectScope),
	);
	const usageQuery = useQuery(
		systemComponentUsageQueryOptions(systemId, componentId, projectScope),
	);
	const templateDirty = useComponentDraftTemplateDirty();
	const variantsDirty = useComponentDraftVariantsDirty();
	const metadata = useEditorMetadata();
	const { name, slug, description, group, order } = metadata;
	const setName = (value: string) => setEditorMetadataField("name", value);
	const setSlug = (value: string) => setEditorMetadataField("slug", value);
	const setDescription = (value: string) =>
		setEditorMetadataField("description", value);
	const setGroup = (value: string) => setEditorMetadataField("group", value);
	const setOrder = (value: string) => setEditorMetadataField("order", value);
	const metadataChanged = useEditorMetadataChanged();
	const loadedDraftTemplateHash = useLoadedDraftTemplateHash();
	const loadedDraftVariantSchemaHash = useLoadedDraftVariantSchemaHash();
	const draftConflict = useEditorDraftConflict();
	// Name and slug errors show after the field blurs, per component.
	const [touchedMetadata, setTouchedMetadata] = useState<{
		componentId: string;
		fields: ReadonlySet<"name" | "slug">;
	}>({ componentId, fields: new Set() });
	const isMetadataTouched = (field: "name" | "slug") =>
		touchedMetadata.componentId === componentId &&
		touchedMetadata.fields.has(field);
	const touchMetadata = (field: "name" | "slug") =>
		setTouchedMetadata((current) => ({
			componentId,
			fields: new Set(
				current.componentId === componentId ? current.fields : [],
			).add(field),
		}));
	const nameError =
		isMetadataTouched("name") && !name.trim()
			? "Enter a component name."
			: undefined;
	const slugError = !isMetadataTouched("slug")
		? undefined
		: !slug.trim()
			? "Enter a slug."
			: !isSystemComponentSlug(slug.trim())
				? "Use lowercase letters, numbers, and hyphens in the slug."
				: undefined;
	const [variantDrafts, setVariantDrafts] = useState<VariantAxisDraft[]>([]);
	const [compoundDrafts, setCompoundDrafts] = useState<CompoundVariantDraft[]>(
		[],
	);
	const [loadedRecordIdentity, setLoadedRecordIdentity] = useState("");
	const summary =
		listQuery.data?.components.find(
			(component) => component.componentId === componentId,
		) ?? null;
	const groupSuggestions = useMemo(
		() =>
			collectGroupFolderPaths(
				buildComponentGroupTree(listQuery.data?.components ?? []),
			).sort((left, right) => left.localeCompare(right)),
		[listQuery.data?.components],
	);
	const record = detailQuery.data?.record;
	const canEditDraft = Boolean(record?.draft);

	useEffect(() => {
		if (!record) {
			return;
		}

		const recordChanged = loadedRecordIdentity !== record.componentId;
		if (recordChanged) {
			setLoadedRecordIdentity(record.componentId);
		}

		syncEditorSessionMetadata({
			componentId: record.componentId,
			metadata: {
				name: record.name,
				slug: record.slug,
				description: record.description ?? "",
				group: record.group ?? "",
				order: record.order === undefined ? "" : String(record.order),
			},
		});

		if (record.draft) {
			const variantSource = resolveVariantDraftSeedSource({
				variantsDirty,
				draftMatchesComponent: isComponentDraftForComponent(record.componentId),
				storeVariants: componentDraftStore.get().variants,
				serverVariants: record.draft.variants,
			});
			if (recordChanged || !variantsDirty) {
				setVariantDrafts(schemaToVariantDrafts(variantSource));
				setCompoundDrafts(schemaToCompoundDrafts(variantSource));
			}

			const serverDraftTemplateHash =
				detailQuery.data?.draftTemplateHash ?? null;
			const serverDraftVariantSchemaHash =
				detailQuery.data?.draftVariantSchemaHash ?? null;
			const hydrateResult = hydrateComponentDraft({
				componentId: record.componentId,
				root: record.draft.root,
				baseVersion: record.draft.baseVersion,
				slots: record.draft.slots,
				overrideTargets: record.draft.overrideTargets,
				variants: record.draft.variants ?? null,
			});
			if (hydrateResult === "dirty-skipped") {
				const {
					hasConflict,
					adoptTemplateBaseline,
					adoptVariantSchemaBaseline,
				} = evaluateComponentDraftServerConflict({
					dirtyDraftMatchesComponent: isComponentDraftForComponent(
						record.componentId,
					),
					templateDirty,
					variantsDirty,
					serverDraftTemplateHash,
					serverDraftVariantSchemaHash,
					loadedDraftTemplateHash,
					loadedDraftVariantSchemaHash,
				});

				// Re-baseline a dimension that changed on the server but is not
				// locally dirty, so a sibling template-only save does not keep
				// looking like an external change while variant edits stay open.
				if (adoptTemplateBaseline) {
					setLoadedDraftHashes({ templateHash: serverDraftTemplateHash });
				}
				if (adoptVariantSchemaBaseline) {
					setLoadedDraftHashes({
						variantSchemaHash: serverDraftVariantSchemaHash,
					});
				}

				setEditorDraftConflict(hasConflict ? DRAFT_CONFLICT_MESSAGE : null);
			} else {
				setLoadedDraftHashes({
					templateHash: serverDraftTemplateHash,
					variantSchemaHash: serverDraftVariantSchemaHash,
				});
				setEditorDraftConflict(null);
			}
		} else {
			if (recordChanged || !variantsDirty) {
				setVariantDrafts([]);
				setCompoundDrafts([]);
			}
			setLoadedDraftHashes({ templateHash: null, variantSchemaHash: null });
			setEditorDraftConflict(null);
		}
	}, [
		detailQuery.data?.draftTemplateHash,
		detailQuery.data?.draftVariantSchemaHash,
		loadedDraftTemplateHash,
		loadedDraftVariantSchemaHash,
		loadedRecordIdentity,
		record,
		templateDirty,
		variantsDirty,
	]);

	const currentVariantDrafts =
		variantsDirty || !record?.draft
			? variantDrafts
			: schemaToVariantDrafts(record.draft.variants);
	const currentCompoundDrafts =
		variantsDirty || !record?.draft
			? compoundDrafts
			: schemaToCompoundDrafts(record.draft.variants);
	const variantDiagnostics = useMemo(
		() => validateVariantDrafts(currentVariantDrafts, currentCompoundDrafts),
		[currentVariantDrafts, currentCompoundDrafts],
	);
	useEffect(() => {
		setEditorVariantsValid(variantDiagnostics.length === 0);
	}, [variantDiagnostics]);
	const variantsChanged = variantsDirty;
	const hasUnsavedDraftChanges =
		metadataChanged ||
		templateDirty ||
		variantsChanged ||
		Boolean(draftConflict);
	const componentDiagnostics = (detailQuery.data?.diagnostics ?? []).filter(
		(diagnostic) =>
			!diagnostic.componentId || diagnostic.componentId === componentId,
	);
	const errorDiagnostics = componentDiagnostics.filter(
		(diagnostic) => diagnostic.severity === "error",
	);
	const warningDiagnostics = componentDiagnostics.filter(
		(diagnostic) => diagnostic.severity === "warning",
	);
	const currentPublishedVersion = record?.published?.currentVersion
		? record.published.versions[record.published.currentVersion]
		: undefined;
	const versionHistory = Object.values(record?.published?.versions ?? {}).sort(
		(left, right) => Number(right.version) - Number(left.version),
	);
	const nextPublishedVersion = String(
		Math.max(0, ...versionHistory.map((entry) => Number(entry.version))) + 1,
	);

	if (detailQuery.isError) {
		return (
			<InspectorLoadError
				title="Could not load this component"
				error={detailQuery.error}
				isRetrying={detailQuery.isFetching}
				onRetry={() => detailQuery.refetch()}
			/>
		);
	}

	if (detailQuery.isPending || listQuery.isPending) {
		return <InspectorSkeleton />;
	}

	// A settled detail query always carries the record; this narrows it.
	if (!record) {
		return null;
	}

	const publicationState = summary
		? getComponentPublicationState(summary)
		: record.published
			? record.draft
				? "draft-over-published"
				: "published-only"
			: "draft-only";
	const usageData = usageQuery.data;
	const usedByCount = usageData?.usedByCount ?? 0;
	const staleUsageCount = usageData?.statusCounts.stale ?? 0;
	const currentUsageCount = usageData?.statusCounts.current ?? 0;
	const hashMismatchCount = usageData?.statusCounts["hash-mismatch"] ?? 0;
	const attentionDiagnosticCount =
		usageData?.diagnostics.filter((diagnostic) =>
			[
				"UNKNOWN_COMPONENT",
				"UNKNOWN_VERSION",
				"MALFORMED_INSTANCE_MARKER",
				"DESIGN_READ_FAILED",
				"INVALID_DESIGN_PAYLOAD",
				"SYSTEM_MISMATCH",
			].includes(diagnostic.code),
		).length ?? 0;
	const needsReviewUsageCount = staleUsageCount + hashMismatchCount;
	const scannedDesignCount = usageData?.scannedDesignCount ?? 0;
	const usageStatusLabel = usageQuery.isPending
		? null
		: needsReviewUsageCount > 0
			? hashMismatchCount > 0 && staleUsageCount === 0
				? `${hashMismatchCount} hash mismatch${hashMismatchCount === 1 ? "" : "es"}`
				: `${needsReviewUsageCount} need${needsReviewUsageCount === 1 ? "s" : ""} review, ${currentUsageCount} current`
			: attentionDiagnosticCount > 0
				? `${attentionDiagnosticCount} diagnostic${attentionDiagnosticCount === 1 ? "" : "s"} need attention`
				: usedByCount > 0
					? `${usedByCount} current`
					: "No usages";
	const usageDetailLabel = usageQuery.isPending
		? null
		: hashMismatchCount > 0
			? `${usedByCount} total, ${hashMismatchCount} hash mismatch${hashMismatchCount === 1 ? "" : "es"}`
			: `${usedByCount} total across ${scannedDesignCount} scanned design${scannedDesignCount === 1 ? "" : "s"}`;
	const usageRows = usageQuery.isError ? (
		<InspectorLoadError
			title="Could not check design usage"
			error={usageQuery.error}
			isRetrying={usageQuery.isFetching}
			onRetry={() => usageQuery.refetch()}
		/>
	) : (
		<>
			<InspectorField
				label="Usage status"
				value={usageStatusLabel ?? <Skeleton className="h-3 w-24" />}
			/>
			<InspectorField
				label="Design usage"
				value={usageDetailLabel ?? <Skeleton className="h-3 w-32" />}
			/>
		</>
	);
	const variantStatusLabel = draftConflict
		? "Draft changed on disk"
		: variantDiagnostics.length > 0
			? "Variant definitions need attention"
			: metadataChanged || templateDirty || variantsChanged
				? "Unsaved changes"
				: "Saved";
	const variantEditor = canEditDraft ? (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
			}}
		>
			<VariantSchemaEditor
				diagnostics={variantDiagnostics}
				drafts={currentVariantDrafts}
				onChange={(nextDrafts) => {
					const storeVariants = componentDraftStore.get().variants;
					const syncedCompoundDrafts = schemaToCompoundDrafts(storeVariants);
					const nextVariants = variantDraftsToSchema(
						nextDrafts,
						storeVariants,
						syncedCompoundDrafts,
					);
					replaceComponentDraftVariants(nextVariants);
					setVariantDrafts(
						advanceVariantDraftSchemaKeys(nextDrafts, nextVariants),
					);
					setCompoundDrafts(
						advanceCompoundDraftKeys(syncedCompoundDrafts, nextVariants),
					);
				}}
				onCompoundsMutate={() => {
					setCompoundDrafts(
						schemaToCompoundDrafts(componentDraftStore.get().variants),
					);
				}}
			/>
			<div className="flex items-center justify-between gap-2 pt-1">
				<Text variant="meta">{variantStatusLabel}</Text>
			</div>
			{draftConflict ? <DraftConflictNotice message={draftConflict} /> : null}
		</form>
	) : (
		<Text variant="meta" render={<p />}>
			Create a draft to edit variants.
		</Text>
	);

	if (mode === "variants") {
		return (
			<div className="flex flex-col gap-3">
				<div>
					<p className="font-medium text-slate-900">{record.name}</p>
					<p className="font-mono text-[11px] text-slate-500">{record.slug}</p>
				</div>
				<StagePreviewDarkModeToggle />
				{variantEditor}
			</div>
		);
	}

	if (mode === "publish") {
		return (
			<div className="flex flex-col gap-3">
				<div>
					<p className="font-medium text-slate-900">{record.name}</p>
					<p className="font-mono text-[11px] text-slate-500">{record.slug}</p>
				</div>
				<InspectorField
					label="Status"
					value={publicationStateLabel(publicationState)}
				/>
				{usageRows}
				<div className="border-t border-slate-200 pt-3">
					<div className="mb-2 flex items-center justify-between gap-2">
						<Text variant="group-label" render={<p />}>
							Publish
						</Text>
					</div>
					{record.draft ? (
						<Card edge="border" className="flex flex-col gap-1 px-2 py-1.5">
							<InspectorField
								label="Generated version"
								value={nextPublishedVersion}
							/>
							{detailQuery.data.draftTemplateHash ? (
								<InspectorField
									label="Template hash"
									value={detailQuery.data.draftTemplateHash}
								/>
							) : null}
							{detailQuery.data.draftVariantSchemaHash ? (
								<InspectorField
									label="Variant schema hash"
									value={detailQuery.data.draftVariantSchemaHash}
								/>
							) : null}
							<Text variant="meta" render={<p />} className="pt-1">
								{hasUnsavedDraftChanges
									? "Save the draft before publishing."
									: errorDiagnostics.length > 0 || variantDiagnostics.length > 0
										? "Fix the draft's errors before publishing."
										: warningDiagnostics.length > 0
											? "Warnings are listed below. Review before publishing."
											: "Ready to publish."}
							</Text>
						</Card>
					) : (
						<Text variant="meta" render={<p />}>
							Create a draft to publish a new version.
						</Text>
					)}
				</div>
				{currentPublishedVersion ? (
					<div className="border-t border-slate-200 pt-3">
						<Text variant="group-label" render={<p />}>
							Current published
						</Text>
						<Card
							edge="border"
							className="mt-1 flex flex-col gap-1 px-2 py-1.5"
						>
							<InspectorField
								label="Version"
								value={currentPublishedVersion.version}
							/>
							<InspectorField
								label="Published"
								value={formatVersionTimestamp(
									currentPublishedVersion.publishedAt,
								)}
							/>
							<InspectorField
								label="Template hash"
								value={currentPublishedVersion.templateHash}
							/>
							<InspectorField
								label="Variant schema hash"
								value={currentPublishedVersion.variantSchemaHash}
							/>
						</Card>
					</div>
				) : null}
				{versionHistory.length > 0 ? (
					<div className="border-t border-slate-200 pt-3">
						<Text variant="group-label" render={<p />}>
							Version history
						</Text>
						<ul className="mt-1 flex max-h-52 flex-col gap-1 overflow-y-auto">
							{versionHistory.map((version) => (
								<li
									key={version.version}
									className="border border-slate-200 bg-white px-2 py-1.5"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium text-slate-900">
											Version {version.version}
										</span>
										<span className="text-[11px] text-slate-500">
											{version.version === record.published?.currentVersion
												? "Current"
												: version.previousVersion
													? `After ${version.previousVersion}`
													: "Initial"}
										</span>
									</div>
									<Text variant="meta" render={<p />} className="mt-1">
										{formatVersionTimestamp(version.publishedAt)}
									</Text>
									<p className="mt-1 truncate font-mono text-[10px] text-slate-500">
										{version.templateHash}
									</p>
								</li>
							))}
						</ul>
					</div>
				) : null}
				<InspectorField
					label="Validation"
					value={detailQuery.data.valid ? "Valid" : "Needs attention"}
				/>
				<ComponentDiagnosticsList diagnostics={detailQuery.data.diagnostics} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div>
				<p className="font-medium text-slate-900">{record.name}</p>
				<p className="font-mono text-[11px] text-slate-500">{record.slug}</p>
			</div>
			{canEditDraft ? (
				<form
					className="flex flex-col gap-2 border-b border-slate-200 pb-3"
					onSubmit={(event) => {
						event.preventDefault();
					}}
				>
					<label
						className="flex flex-col gap-1"
						htmlFor="system-component-draft-name"
					>
						<Text variant="group-label">Name</Text>
						<Input
							id="system-component-draft-name"
							variant="formCompact"
							value={name}
							onChange={(event) => {
								setName(event.target.value);
							}}
							onBlur={() => touchMetadata("name")}
							aria-invalid={nameError ? true : undefined}
							aria-describedby={
								nameError ? "system-component-draft-name-error" : undefined
							}
						/>
						{nameError ? (
							<Alert
								variant="inline"
								className="items-start [&_svg]:mt-px [&_svg]:size-3"
								id="system-component-draft-name-error"
							>
								{nameError}
							</Alert>
						) : null}
					</label>
					<label
						className="flex flex-col gap-1"
						htmlFor="system-component-draft-slug"
					>
						<Text variant="group-label">Slug</Text>
						<Input
							id="system-component-draft-slug"
							variant="formCompact"
							value={slug}
							onChange={(event) => {
								setSlug(event.target.value);
							}}
							onBlur={() => touchMetadata("slug")}
							aria-invalid={slugError ? true : undefined}
							aria-describedby={
								slugError ? "system-component-draft-slug-error" : undefined
							}
						/>
						{slugError ? (
							<Alert
								variant="inline"
								className="items-start [&_svg]:mt-px [&_svg]:size-3"
								id="system-component-draft-slug-error"
							>
								{slugError}
							</Alert>
						) : null}
					</label>
					<label className="flex flex-col gap-1">
						<Text variant="group-label">Description</Text>
						<textarea
							className="min-h-16 resize-y border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-slate-500"
							value={description}
							onChange={(event) => {
								setDescription(event.target.value);
							}}
						/>
					</label>
					<div className="grid grid-cols-[1fr_5rem] gap-2">
						<label
							className="flex flex-col gap-1"
							htmlFor="system-component-draft-group"
						>
							<Text variant="group-label">Group</Text>
							<AutocompleteRoot
								items={groupSuggestions}
								value={group}
								onValueChange={(value) => setGroup(value)}
								openOnInputClick
							>
								<AutocompleteInput
									id="system-component-draft-group"
									placeholder="atoms/typography"
								/>
								<AutocompletePortal>
									<AutocompletePositioner>
										<AutocompletePopup>
											<AutocompleteEmpty>
												No matching group. Your text creates a new one.
											</AutocompleteEmpty>
											<AutocompleteList>
												{(item: string) => (
													<AutocompleteItem key={item} value={item}>
														{item}
													</AutocompleteItem>
												)}
											</AutocompleteList>
										</AutocompletePopup>
									</AutocompletePositioner>
								</AutocompletePortal>
							</AutocompleteRoot>
						</label>
						<label
							className="flex flex-col gap-1"
							htmlFor="system-component-draft-order"
						>
							<Text variant="group-label">Order</Text>
							<Input
								id="system-component-draft-order"
								variant="formCompact"
								type="number"
								value={order}
								onChange={(event) => {
									setOrder(event.target.value);
								}}
							/>
						</label>
					</div>
					<div className="flex items-center justify-between gap-2 pt-1">
						<span className="text-[11px] text-slate-500">
							{draftConflict
								? "Draft changed on disk"
								: metadataChanged || templateDirty || variantsChanged
									? "Unsaved changes"
									: "Saved"}
						</span>
					</div>
					{draftConflict ? (
						<DraftConflictNotice message={draftConflict} />
					) : null}
				</form>
			) : null}
			<InspectorField label="Component id" value={record.componentId} />
			{usageRows}
			<InspectorField
				label="Status"
				value={publicationStateLabel(publicationState)}
			/>
			{record.published?.currentVersion ? (
				<InspectorField
					label="Current version"
					value={record.published.currentVersion}
				/>
			) : null}
			{record.group ? (
				<InspectorField label="Group" value={record.group} />
			) : null}
			{record.description ? (
				<div className="border-t border-slate-200 pt-2">
					<Text variant="group-label" render={<p />}>
						Description
					</Text>
					<p className="mt-1 text-slate-700">{record.description}</p>
				</div>
			) : null}
			<InspectorField
				label="Validation"
				value={detailQuery.data.valid ? "Valid" : "Needs attention"}
			/>
			<ComponentDiagnosticsList diagnostics={detailQuery.data.diagnostics} />
		</div>
	);
}

function AssetInspector({
	systemId,
	assetId,
	projectScope,
}: {
	systemId: string;
	assetId: string;
	projectScope?: ProjectQueryScope;
}) {
	const assetsQuery = useQuery(
		systemAssetsQueryOptions(systemId, projectScope),
	);
	const asset = assetsQuery.data?.assets.find((entry) => entry.id === assetId);

	if (assetsQuery.isPending) {
		return (
			<div className="flex flex-col gap-3" aria-busy="true">
				<Skeleton className="aspect-square w-full" />
				<InspectorSkeleton />
			</div>
		);
	}

	if (assetsQuery.isError) {
		return (
			<InspectorLoadError
				title="Could not load this asset"
				error={assetsQuery.error}
				isRetrying={assetsQuery.isFetching}
				onRetry={() => assetsQuery.refetch()}
			/>
		);
	}

	if (!asset) {
		return (
			<Text variant="meta" render={<p />}>
				This asset no longer exists.
			</Text>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="aspect-square bg-slate-100">
				<img
					alt={asset.alt ?? ""}
					className="size-full object-contain"
					src={systemAssetFileUrl(systemId, asset.id)}
				/>
			</div>
			<InspectorField label="Name" value={asset.name} />
			<InspectorField label="Asset id" value={asset.id} />
			<InspectorField label="Path" value={asset.sourcePath} />
			<InspectorField
				label="Type"
				value={formatAssetMimeType(asset.mimeType)}
			/>
			{asset.width && asset.height ? (
				<InspectorField
					label="Size"
					value={`${asset.width} x ${asset.height}`}
				/>
			) : null}
			{asset.alt ? <InspectorField label="Alt" value={asset.alt} /> : null}
		</div>
	);
}

function IconInspector({
	systemId,
	iconId,
	projectScope,
}: {
	systemId: string;
	iconId: string;
	projectScope?: ProjectQueryScope;
}) {
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const icon = iconsQuery.data?.icons.find((entry) => entry.id === iconId);

	if (iconsQuery.isPending) {
		return (
			<div className="flex flex-col gap-3" aria-busy="true">
				<Skeleton className="h-24 w-full" />
				<InspectorSkeleton />
			</div>
		);
	}

	if (iconsQuery.isError) {
		return (
			<InspectorLoadError
				title="Could not load this icon"
				error={iconsQuery.error}
				isRetrying={iconsQuery.isFetching}
				onRetry={() => iconsQuery.refetch()}
			/>
		);
	}

	if (!icon) {
		return (
			<Text variant="meta" render={<p />}>
				This icon no longer exists.
			</Text>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex h-24 items-center justify-center bg-slate-100">
				<img
					alt=""
					className="size-10 object-contain"
					src={`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(iconId)}/svg`}
				/>
			</div>
			<InspectorField label="Name" value={icon.name} />
			<InspectorField label="Icon id" value={icon.id} />
			<InspectorField label="Path" value={icon.sourcePath} />
			<InspectorField label="Paint" value={icon.paint} />
			{icon.viewBox ? (
				<InspectorField label="View box" value={icon.viewBox} />
			) : null}
		</div>
	);
}

/**
 * The selected node's live annotations as its rail row counts them (the
 * root's counts the whole component).
 */
function useSelectedNodeAnnotationCount(path: string | null) {
	return useSelector(editorAnnotationsStore, (state) =>
		path === null
			? 0
			: (state.markers.boards[path]?.count ??
				state.markers.layers[path]?.count ??
				0),
	);
}

/**
 * The component draft inspector's two tabs: the selected node's properties
 * and the component's annotations (the design editor's thread UI). Stage
 * pins and rail markers switch to the Annotations tab through
 * `editorAnnotationsStore`.
 */
function ComponentInspectorTabs({
	systemId,
	componentId,
	selectedPath,
	children,
}: {
	systemId: string;
	componentId: string;
	selectedPath: string | null;
	children: ReactNode;
}) {
	const tab = useInspectorTab();
	const count = useSelectedNodeAnnotationCount(selectedPath);
	return (
		<Tabs
			value={tab}
			onValueChange={(value) => setInspectorTab(value as InspectorTab)}
			className="min-h-0 flex-1 gap-0"
		>
			<TabsList className="shrink-0 px-2">
				<TabsTab value="properties">Properties</TabsTab>
				<TabsTab value="annotations" className="flex items-center gap-1.5">
					Annotations
					{count > 0 ? (
						<span className="font-mono text-xs text-slate-500">{count}</span>
					) : null}
				</TabsTab>
			</TabsList>
			<TabsPanel value="properties" className="flex min-h-0 flex-1 flex-col">
				{children}
			</TabsPanel>
			<TabsPanel value="annotations" className="flex min-h-0 flex-1 flex-col">
				<ComponentAnnotationsPanel
					systemId={systemId}
					componentId={componentId}
				/>
			</TabsPanel>
		</Tabs>
	);
}

export function SystemEditorInspector({
	page,
	systemId,
	projectScope,
	selectedComponentId,
	selectedAssetId,
	selectedIconId,
	onClose,
}: {
	page: SystemEditorPage;
	systemId: string;
	projectScope?: ProjectQueryScope;
	selectedComponentId: string | null;
	selectedAssetId: string | null;
	selectedIconId: string | null;
	onClose: () => void;
}) {
	const selectedTemplatePath = useComponentDraftSelectedPath();
	const draftComponentId = useComponentDraftComponentId();
	const selectedTemplateMatchesComponent =
		selectedComponentId !== null &&
		draftComponentId === selectedComponentId &&
		selectedTemplatePath !== null;
	let body: ReactNode;

	if (page === "components" && selectedTemplateMatchesComponent) {
		body = (
			<ComponentInspectorTabs
				systemId={systemId}
				componentId={selectedComponentId}
				selectedPath={selectedTemplatePath}
			>
				<ComponentDraftProperties
					systemId={systemId}
					projectScope={projectScope}
				/>
			</ComponentInspectorTabs>
		);
	} else if (page === "assets" && selectedAssetId) {
		body = (
			<AssetInspector
				systemId={systemId}
				assetId={selectedAssetId}
				projectScope={projectScope}
			/>
		);
	} else if (page === "icons" && selectedIconId) {
		body = (
			<IconInspector
				systemId={systemId}
				iconId={selectedIconId}
				projectScope={projectScope}
			/>
		);
	} else if (page === "lint") {
		body = (
			<SystemEditorLintInspector
				systemId={systemId}
				projectScope={projectScope}
			/>
		);
	} else {
		// The shell mounts the inspector only with a selection on these pages.
		body = null;
	}

	const isNodeInspector =
		page === "components" &&
		selectedComponentId !== null &&
		selectedTemplateMatchesComponent;

	return (
		<aside
			data-editor-region="inspector"
			tabIndex={-1}
			className="flex min-h-0 w-[336px] shrink-0 flex-col border-l border-slate-200 bg-white text-xs focus-visible:outline-none"
		>
			<header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 text-xs font-medium">
				<span>Inspector</span>
				<div className="flex shrink-0 items-center gap-1">
					<SystemPanelToggle panel="inspector" />
					<Button
						type="button"
						variant="block"
						className="flex size-7 shrink-0 items-center justify-center p-0"
						onClick={onClose}
						title="Clear selection"
						aria-label="Clear selection"
					>
						<X className="size-3.5 text-slate-900" aria-hidden="true" />
					</Button>
				</div>
			</header>
			<div
				className={
					isNodeInspector
						? "flex min-h-0 flex-1 flex-col overflow-hidden"
						: "min-h-0 flex-1 overflow-y-auto p-4"
				}
			>
				{body}
			</div>
		</aside>
	);
}
