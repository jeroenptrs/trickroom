import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
	buildComponentGroupTree,
	collectGroupFolderPaths,
} from "../../utils/component-groups";
import { classifyCompoundWhenShape } from "../../utils/system-component-compound-shape";
import { compoundWhenSignature } from "../../utils/system-component-compound-signature";
import {
	isSystemComponentSlug,
	type SystemComponentVariantSchema,
} from "../../utils/system-components";
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
import { AuthoredCompoundsList } from "./AuthoredCompoundsList";
import { ComponentDraftProperties } from "./ComponentDraftProperties";
import type { ComponentPublicationState } from "./component-catalog";
import { getComponentPublicationState } from "./component-catalog";
import { pageTitleByTab, type SystemEditorPage } from "./types";

function InspectorField({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1.5">
			<span className="text-slate-500">{label}</span>
			<span
				className="min-w-0 truncate text-right text-slate-900"
				title={value}
			>
				{value}
			</span>
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
		throw new Error("Component slug is required.");
	}
	if (!isSystemComponentSlug(trimmedSlug)) {
		throw new Error(
			"Component slug must use lowercase alphanumeric segments separated by hyphens.",
		);
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
	schema: SystemComponentVariantSchema | undefined,
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
		const compoundLabel = `compound ${compoundIndex + 1}`;
		const seenAxes = new Map<string, number>();
		let resolvedConditions = 0;

		for (const condition of compound.conditions) {
			const axisKey = condition.axisKey.trim();
			const valueKey = condition.valueKey.trim();
			if (!axisKey) {
				diagnostics.push(
					`Variant ${compoundLabel} has a condition with no axis.`,
				);
				continue;
			}
			seenAxes.set(axisKey, (seenAxes.get(axisKey) ?? 0) + 1);
			const axisValues = valuesByAxis.get(axisKey);
			if (!axisValues) {
				diagnostics.push(
					`Variant ${compoundLabel} references unknown axis "${axisKey}".`,
				);
				continue;
			}
			if (!valueKey) {
				diagnostics.push(
					`Variant ${compoundLabel} must choose a value for axis "${axisKey}".`,
				);
				continue;
			}
			if (!axisValues.has(valueKey)) {
				diagnostics.push(
					`Variant ${compoundLabel} references value "${valueKey}" that does not exist on axis "${axisKey}".`,
				);
				continue;
			}
			resolvedConditions += 1;
		}

		for (const [axisKey, count] of [...seenAxes.entries()].sort()) {
			if (count > 1) {
				diagnostics.push(
					`Variant ${compoundLabel} uses axis "${axisKey}" more than once.`,
				);
			}
		}

		if (resolvedConditions < COMPOUND_MIN_AXES) {
			diagnostics.push(
				`Variant ${compoundLabel} must combine at least ${COMPOUND_MIN_AXES} axes.`,
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
		<section className="flex flex-col gap-2 border-b border-slate-200 pb-3">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					Variants
				</p>
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
					Axis
				</Button>
			</div>
			{drafts.length === 0 ? (
				<p className="text-[11px] text-slate-500">
					No variant axes defined for this draft.
				</p>
			) : null}
			{drafts.map((axis, axisIndex) => (
				<Card key={axis.id} edge="border" className="flex flex-col gap-2 p-2">
					<div className="grid grid-cols-[1fr_1fr_auto] gap-2">
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-key`}
						>
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Axis key
							</span>
							<Input
								id={`variant-axis-${axis.id}-key`}
								variant="formCompact"
								value={axis.key}
								placeholder={axisIndex === 0 ? "tone" : "size"}
								onChange={(event) =>
									updateAxis(axis.id, { key: event.target.value })
								}
							/>
						</label>
						<label
							className="flex flex-col gap-1"
							htmlFor={`variant-axis-${axis.id}-label`}
						>
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Label
							</span>
							<Input
								id={`variant-axis-${axis.id}-label`}
								variant="formCompact"
								value={axis.label}
								placeholder={axisIndex === 0 ? "Tone" : "Size"}
								onChange={(event) =>
									updateAxis(axis.id, { label: event.target.value })
								}
							/>
						</label>
						<Button
							type="button"
							variant="block"
							flavor="warning"
							className="mt-4 px-2 py-1"
							title="Remove axis"
							onClick={() =>
								emitAxes(drafts.filter((entry) => entry.id !== axis.id))
							}
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
						</Button>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<label className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Axis default
							</span>
							<select
								className="w-full border-none bg-white px-2 py-1.5 text-sm text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
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
							</select>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Schema default
							</span>
							<select
								className="w-full border-none bg-white px-2 py-1.5 text-sm text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
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
							</select>
						</label>
					</div>
					<div className="flex flex-col gap-1">
						<div className="flex items-center justify-between">
							<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
								Values
							</span>
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
								Value
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
									flavor="warning"
									className="px-2 py-1"
									title="Remove value"
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
							</div>
						))}
					</div>
				</Card>
			))}
			<AuthoredCompoundsList onMutate={onCompoundsMutate} />
			{diagnostics.length > 0 ? (
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

		const serverDraftTemplateHash = detailQuery.data.draftTemplateHash ?? null;
		const serverDraftVariantSchemaHash =
			detailQuery.data.draftVariantSchemaHash ?? null;
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

			setEditorDraftConflict(
				hasConflict
					? "Component draft changed on the server while local edits are unsaved. Save or reload before continuing."
					: null,
			);
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
				detailQuery.data.draftTemplateHash ?? null;
			const serverDraftVariantSchemaHash =
				detailQuery.data.draftVariantSchemaHash ?? null;
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

				setEditorDraftConflict(
					hasConflict
						? "Component draft changed on the server while local edits are unsaved. Save or reload before continuing."
						: null,
				);
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

	if (detailQuery.isPending || listQuery.isPending) {
		return <p className="text-slate-500">Loading component details...</p>;
	}

	if (detailQuery.isError) {
		return (
			<Alert variant="inline">{(detailQuery.error as Error).message}</Alert>
		);
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
		? "Checking..."
		: usageQuery.isError
			? "Unavailable"
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
		? "Checking attached instances"
		: usageQuery.isError
			? "Usage diagnostics unavailable"
			: hashMismatchCount > 0
				? `${usedByCount} total, ${hashMismatchCount} hash mismatch${hashMismatchCount === 1 ? "" : "es"}`
				: `${usedByCount} total across ${scannedDesignCount} scanned design${scannedDesignCount === 1 ? "" : "s"}`;
	const variantStatusLabel = draftConflict
		? "Server draft changed"
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
				<span className="text-[11px] text-slate-500">{variantStatusLabel}</span>
			</div>
			{draftConflict ? (
				<Card edge="border" tone="warning" className="px-2 py-1.5" role="alert">
					{draftConflict}
				</Card>
			) : null}
		</form>
	) : (
		<Card edge="border" className="px-2 py-1.5">
			<p className="text-[11px] font-medium text-slate-700">
				No draft variants to edit.
			</p>
			<p className="mt-1 text-[11px] text-slate-500">
				Create a draft before defining variant axes and compound variants.
			</p>
		</Card>
	);

	if (mode === "variants") {
		return (
			<div className="flex flex-col gap-3">
				<div>
					<p className="font-medium text-slate-900">{record.name}</p>
					<p className="font-mono text-[11px] text-slate-500">{record.slug}</p>
				</div>
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
				<InspectorField label="Usage status" value={usageStatusLabel} />
				<InspectorField label="Design usage" value={usageDetailLabel} />
				<div className="border-t border-slate-200 pt-3">
					<div className="mb-2 flex items-center justify-between gap-2">
						<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
							Publish
						</p>
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
							<p className="pt-1 text-[11px] text-slate-500">
								{hasUnsavedDraftChanges
									? "Save the draft before publishing."
									: errorDiagnostics.length > 0 || variantDiagnostics.length > 0
										? "Resolve validation diagnostics before publishing."
										: warningDiagnostics.length > 0
											? "Warnings are listed below. Review before publishing."
											: "Draft is ready to publish."}
							</p>
						</Card>
					) : (
						<Card edge="border" className="flex flex-col gap-1 px-2 py-1.5">
							<p className="text-[11px] font-medium text-slate-700">
								No draft available to publish.
							</p>
							<p className="text-[11px] text-slate-500">
								Create or edit a draft first, then save it before publishing a
								new version.
							</p>
						</Card>
					)}
				</div>
				{currentPublishedVersion ? (
					<div className="border-t border-slate-200 pt-3">
						<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
							Current published
						</p>
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
						<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
							Version history
						</p>
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
									<p className="mt-1 text-[11px] text-slate-500">
										{formatVersionTimestamp(version.publishedAt)}
									</p>
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
				{detailQuery.data.diagnostics.length > 0 ? (
					<div className="border-t border-slate-200 pt-2">
						<p className="text-[10px] uppercase tracking-wider text-slate-500">
							Diagnostics
						</p>
						<ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
							{detailQuery.data.diagnostics.slice(0, 8).map((diagnostic) => (
								<li
									key={`${diagnostic.code}-${diagnostic.componentId ?? ""}-${diagnostic.path ?? ""}-${diagnostic.message}`}
									className="text-[11px] text-amber-800"
								>
									{diagnostic.message}
								</li>
							))}
						</ul>
					</div>
				) : null}
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
						<span className="text-[10px] uppercase tracking-wider text-slate-500">
							Name
						</span>
						<Input
							id="system-component-draft-name"
							variant="formCompact"
							value={name}
							onChange={(event) => {
								setName(event.target.value);
							}}
						/>
					</label>
					<label
						className="flex flex-col gap-1"
						htmlFor="system-component-draft-slug"
					>
						<span className="text-[10px] uppercase tracking-wider text-slate-500">
							Slug
						</span>
						<Input
							id="system-component-draft-slug"
							variant="formCompact"
							value={slug}
							onChange={(event) => {
								setSlug(event.target.value);
							}}
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-wider text-slate-500">
							Description
						</span>
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
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Group
							</span>
							<AutocompleteRoot
								items={groupSuggestions}
								value={group}
								onValueChange={(value) => setGroup(value)}
								openOnInputClick
							>
								<AutocompleteInput
									id="system-component-draft-group"
									placeholder="e.g. atoms/typography"
								/>
								<AutocompletePortal>
									<AutocompletePositioner>
										<AutocompletePopup>
											<AutocompleteEmpty>
												No matching folders — your text becomes a new one.
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
							<span className="text-[10px] uppercase tracking-wider text-slate-500">
								Order
							</span>
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
								? "Server draft changed"
								: metadataChanged || templateDirty || variantsChanged
									? "Unsaved changes"
									: "Saved"}
						</span>
					</div>
					{draftConflict ? (
						<Card
							edge="border"
							tone="warning"
							className="px-2 py-1.5"
							role="alert"
						>
							{draftConflict}
						</Card>
					) : null}
				</form>
			) : null}
			<InspectorField label="Component id" value={record.componentId} />
			<InspectorField label="Usage status" value={usageStatusLabel} />
			<InspectorField label="Design usage" value={usageDetailLabel} />
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
					<p className="text-[10px] uppercase tracking-wider text-slate-500">
						Description
					</p>
					<p className="mt-1 text-slate-700">{record.description}</p>
				</div>
			) : null}
			<InspectorField
				label="Validation"
				value={detailQuery.data.valid ? "Valid" : "Needs attention"}
			/>
			{detailQuery.data.diagnostics.length > 0 ? (
				<div className="border-t border-slate-200 pt-2">
					<p className="text-[10px] uppercase tracking-wider text-slate-500">
						Diagnostics
					</p>
					<ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
						{detailQuery.data.diagnostics.slice(0, 8).map((diagnostic) => (
							<li
								key={`${diagnostic.code}-${diagnostic.componentId ?? ""}-${diagnostic.path ?? ""}-${diagnostic.message}`}
								className="text-[11px] text-amber-800"
							>
								{diagnostic.message}
							</li>
						))}
					</ul>
				</div>
			) : null}
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
		return <p className="text-slate-500">Loading asset details...</p>;
	}

	if (assetsQuery.isError) {
		return (
			<Alert variant="inline">{(assetsQuery.error as Error).message}</Alert>
		);
	}

	if (!asset) {
		return (
			<p className="text-slate-500">Asset not found in the current catalog.</p>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="aspect-square bg-slate-100">
				<img
					alt={asset.alt ?? asset.name}
					className="size-full object-contain"
					src={systemAssetFileUrl(systemId, asset.id)}
				/>
			</div>
			<InspectorField label="Name" value={asset.name} />
			<InspectorField label="Asset id" value={asset.id} />
			<InspectorField label="Path" value={asset.sourcePath} />
			<InspectorField label="MIME" value={asset.mimeType} />
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
		return <p className="text-slate-500">Loading icon details...</p>;
	}

	if (iconsQuery.isError) {
		return (
			<Alert variant="inline">{(iconsQuery.error as Error).message}</Alert>
		);
	}

	if (!icon) {
		return (
			<p className="text-slate-500">Icon not found in the current index.</p>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex h-24 items-center justify-center bg-slate-100">
				<img
					alt={`${icon.name} preview`}
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
			<ComponentDraftProperties
				systemId={systemId}
				projectScope={projectScope}
			/>
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
	} else if (page === "tokens") {
		body = (
			<p className="text-slate-600">
				Browse token domains in the workspace. Domain sections can be collapsed;
				filtering is available in the main pane.
			</p>
		);
	} else {
		body = (
			<div className="rounded border border-dashed border-slate-200 p-4 text-slate-500">
				Select an item on the {pageTitleByTab[page]} page to update this pane.
			</div>
		);
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
				<span>{isNodeInspector ? "Properties" : "Inspector"}</span>
				<Button
					type="button"
					variant="block"
					className="flex size-7 shrink-0 items-center justify-center p-0"
					onClick={onClose}
					title="Close inspector"
				>
					<X className="size-3.5 text-slate-500" aria-hidden="true" />
					<span className="sr-only">Close inspector</span>
				</Button>
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
