import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../../libraries/registry";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { systemAssetsQueryOptions } from "../../queries/system-assets";
import { systemIconsQueryOptions } from "../../queries/system-icons";
import type {
	ComponentDraftStyleTab,
	ComponentDraftStyleTarget,
} from "../../stores/component-draft-store";
import {
	addTemplateNodeOverrideTarget,
	componentDraftStore,
	markTemplateNodeAsSlotHost,
	removeTemplateNodeOverrideTarget,
	removeTemplateNodeSlotHost,
	selectTemplateNode,
	setComponentDraftStyleTarget,
	setDraftClassNameForStyleTab,
	setTemplateNodeDesignOnly,
	updateTemplateNodeOverrideTarget,
	updateTemplateNodeProps,
	updateTemplateNodeSlotMetadata,
	updateTemplateNodeText,
	useComponentDraftClassNameForStyleTab,
	useComponentDraftDesignOnlyState,
	useComponentDraftEntity,
	useComponentDraftSelectedEntity,
	useComponentDraftSelectedOverrideTarget,
	useComponentDraftSelectedSlot,
	useComponentDraftStyleTarget,
	useComponentDraftVariants,
} from "../../stores/component-draft-store";
import type { ControlDefinition, JsonPrimitive } from "../../types";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import {
	getOverrideableRegistryControls,
	normalizeOverrideTargetCapabilities,
} from "../../utils/system-component-override-targets";
import { ClassCompositionPanel } from "../chrome/classes/ClassCompositionPanel";
import { LayerBreadcrumb } from "../chrome/LayerBreadcrumb";
import {
	getPropertiesControlSurface,
	splitComponentControls,
} from "../chrome/Properties";
import { TextareaControl } from "../chrome/TextareaControl";
import {
	getStageLayerAncestry,
	isSameStageLayerAncestry,
} from "../stage/stage-interaction";
import { draftLayerTree } from "../stage/stage-selection-sources";
import { Button } from "../ui/button";
import Checkbox from "../ui/checkbox";
import { InputField } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import { Tooltip } from "../ui/tooltip";
import { toDraftInspectableEntity } from "./component-draft-inspector";
import { DisabledReason } from "./DisabledReason";

type DraftComponentControlProps = {
	path: string;
	control: ControlDefinition;
	value: JsonPrimitive | undefined;
};

function DraftComponentControl({
	path,
	control,
	value,
}: DraftComponentControlProps) {
	const updateValue = (nextValue: JsonPrimitive) => {
		updateTemplateNodeProps(path, {
			[control.prop]: nextValue,
		});
	};

	if (
		(control.input === "radio" || control.input === "select") &&
		control.options
	) {
		return (
			<div className="flex flex-col gap-1 text-xs">
				<div className="font-semibold">{control.label}</div>
				<div className="flex flex-row flex-wrap gap-1">
					{control.options.map((option) => (
						<Button
							key={String(option.value)}
							type="button"
							variant="block"
							className="px-2 py-1 text-xs"
							isSelected={value === option.value}
							aria-pressed={value === option.value}
							onClick={() => updateValue(option.value)}
							title={control.description ?? control.label}
						>
							{option.label}
						</Button>
					))}
				</div>
			</div>
		);
	}

	if (control.input === "textarea") {
		return (
			<TextareaControl control={control} value={value} onChange={updateValue} />
		);
	}

	if (control.input === "text") {
		return (
			<InputField
				type="text"
				label={control.label}
				value={typeof value === "string" ? value : ""}
				onChange={(event) => updateValue(event.currentTarget.value)}
			/>
		);
	}

	if (control.input === "number") {
		return (
			<InputField
				type="number"
				label={control.label}
				value={typeof value === "number" ? String(value) : ""}
				onChange={(event) => {
					const nextValue = event.currentTarget.valueAsNumber;
					if (Number.isFinite(nextValue)) {
						updateValue(nextValue);
					}
				}}
			/>
		);
	}

	if (control.input === "switch" || control.input === "checkbox") {
		return (
			// biome-ignore lint/a11y/noLabelWithoutControl: the primitive inside renders the control.
			<label className="flex flex-row items-center justify-between gap-2 text-xs">
				<span className="font-semibold">{control.label}</span>
				<Checkbox
					size="sm"
					checked={value === true}
					onCheckedChange={(checked) => updateValue(checked)}
					title={control.description ?? control.label}
				/>
			</label>
		);
	}

	return null;
}

function DraftAssetPicker({
	systemId,
	path,
	label,
	value,
	projectScope,
}: {
	systemId: string;
	path: string;
	label: string;
	value: string;
	projectScope?: ProjectQueryScope;
}) {
	const assetsQuery = useQuery(
		systemAssetsQueryOptions(systemId, projectScope),
	);
	const assets = assetsQuery.data?.assets ?? [];

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${path}-asset`}>
				{label}
			</label>
			{assetsQuery.isPending ? (
				<Skeleton className="h-5 w-full" />
			) : (
				<Select
					id={`${path}-asset`}
					value={value}
					onChange={(event) =>
						updateTemplateNodeProps(path, {
							[assetIdProp]: event.currentTarget.value,
						})
					}
				>
					<option value="">No asset</option>
					{assets.map((asset) => (
						<option key={asset.id} value={asset.id}>
							{asset.name}
						</option>
					))}
				</Select>
			)}
		</div>
	);
}

function DraftIconPicker({
	systemId,
	path,
	label,
	value,
	projectScope,
}: {
	systemId: string;
	path: string;
	label: string;
	value: string;
	projectScope?: ProjectQueryScope;
}) {
	const iconsQuery = useQuery(systemIconsQueryOptions(systemId, projectScope));
	const icons = iconsQuery.data?.icons ?? [];

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${path}-icon`}>
				{label}
			</label>
			{iconsQuery.isPending ? (
				<Skeleton className="h-5 w-full" />
			) : (
				<Select
					id={`${path}-icon`}
					value={value}
					onChange={(event) =>
						updateTemplateNodeProps(path, {
							[iconIdProp]: event.currentTarget.value,
						})
					}
				>
					<option value="">No icon</option>
					{icons.map((icon) => (
						<option key={icon.id} value={icon.id}>
							{icon.id}
						</option>
					))}
				</Select>
			)}
		</div>
	);
}

function InspectorSection({
	children,
	title,
}: {
	children: ReactNode;
	title: string;
}) {
	return (
		<section className="flex flex-col">
			<div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-slate-700">
				{title}
			</div>
			<div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
		</section>
	);
}

type DraftVariants = ReturnType<typeof useComponentDraftVariants>;

type SelectedAxisEntry = {
	axisKey: string;
	axisLabel: string;
	valueKey: string;
	valueLabel: string;
};

type StyleTargetDescriptor = {
	id: string;
	label: string;
	tab: ComponentDraftStyleTab;
	title?: string;
};

function getSelectedAxisEntries(
	variants: DraftVariants,
	styleTarget: ComponentDraftStyleTarget,
): SelectedAxisEntry[] {
	return Object.entries(variants?.axes ?? {}).flatMap(([axisKey, axis]) => {
		const valueKey = styleTarget.axisValues[axisKey];
		const value = valueKey ? axis.values[valueKey] : undefined;
		if (!valueKey || !value) {
			return [];
		}

		return [
			{
				axisKey,
				axisLabel: axis.label || axisKey,
				valueKey,
				valueLabel: value.label || valueKey,
			},
		];
	});
}

function describeCompoundSelection(
	variants: DraftVariants,
	styleTarget: ComponentDraftStyleTarget,
) {
	const parts = styleTarget.compoundAxes.flatMap((axisKey) => {
		const valueKey = styleTarget.axisValues[axisKey];
		const axis = variants?.axes[axisKey];
		const value = valueKey ? axis?.values[valueKey] : undefined;
		if (!axis || !valueKey || !value) {
			return [];
		}

		return [`${axis.label || axisKey}: ${valueKey}`];
	});

	return parts.join(", ");
}

function getStyleTargetDescriptors(
	variants: DraftVariants,
	styleTarget: ComponentDraftStyleTarget,
): StyleTargetDescriptor[] {
	const descriptors: StyleTargetDescriptor[] = [];

	if (styleTarget.base) {
		descriptors.push({
			id: "base",
			label: "Base",
			tab: { kind: "base" },
		});
	}

	for (const selected of getSelectedAxisEntries(variants, styleTarget)) {
		descriptors.push({
			id: `axis:${selected.axisKey}:${selected.valueKey}`,
			label: `${selected.axisLabel}: ${selected.valueKey}`,
			tab: { kind: "axis", axisKey: selected.axisKey },
			title:
				selected.valueLabel === selected.valueKey
					? undefined
					: `${selected.axisLabel}: ${selected.valueLabel}`,
		});
	}

	if (styleTarget.compoundAxes.length >= 2) {
		const compoundDescription = describeCompoundSelection(
			variants,
			styleTarget,
		);
		descriptors.push({
			id: `compound:${styleTarget.compoundAxes
				.map((axisKey) => `${axisKey}:${styleTarget.axisValues[axisKey] ?? ""}`)
				.join("|")}`,
			label: "Compound variant",
			tab: { kind: "compound" },
			title: compoundDescription || undefined,
		});
	}

	return descriptors;
}

function StyleTargetSection() {
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();
	const axes = Object.entries(variants?.axes ?? {});
	const selectedAxisEntries = getSelectedAxisEntries(variants, styleTarget);
	const canDisableBase = selectedAxisEntries.length > 0;
	const setAxisValue = (axisKey: string, valueKey: string) => {
		const axisValues = { ...styleTarget.axisValues };
		if (valueKey) {
			axisValues[axisKey] = valueKey;
		} else {
			delete axisValues[axisKey];
		}

		setComponentDraftStyleTarget({
			...styleTarget,
			axisValues,
			compoundAxes: styleTarget.compoundAxes.filter(
				(compoundAxisKey) => axisValues[compoundAxisKey] !== undefined,
			),
		});
	};
	const toggleCompoundAxis = (axisKey: string) => {
		const hasAxis = styleTarget.compoundAxes.includes(axisKey);
		setComponentDraftStyleTarget({
			...styleTarget,
			compoundAxes: (hasAxis
				? styleTarget.compoundAxes.filter(
						(compoundAxisKey) => compoundAxisKey !== axisKey,
					)
				: [...styleTarget.compoundAxes, axisKey]
			).sort((left, right) => left.localeCompare(right)),
		});
	};
	const toggleBase = () => {
		if (styleTarget.base && !canDisableBase) {
			return;
		}

		setComponentDraftStyleTarget({
			...styleTarget,
			base: !styleTarget.base,
		});
	};

	return (
		<section className="border-b border-slate-200 bg-slate-100/80 px-3 py-2">
			<Text variant="group-label" render={<p />}>
				Style target
			</Text>
			<div className="mt-1 flex flex-col gap-2">
				<div className="flex flex-row flex-wrap items-center gap-1">
					<DisabledReason
						reason={
							styleTarget.base && !canDisableBase
								? "Select a variant value to turn Base off."
								: null
						}
					>
						<Button
							type="button"
							variant="block"
							className="px-2 py-1 text-xs"
							isSelected={styleTarget.base}
							aria-pressed={styleTarget.base}
							disabled={styleTarget.base && !canDisableBase}
							onClick={toggleBase}
						>
							Base
						</Button>
					</DisabledReason>
				</div>

				{axes.length > 0 ? (
					<div className="flex flex-col gap-2">
						{axes.map(([axisKey, axis]) => (
							// biome-ignore lint/a11y/noLabelWithoutControl: the primitive inside renders the control.
							<label key={axisKey} className="flex flex-col gap-1 text-xs">
								<span className="font-semibold text-slate-600">
									{axis.label || axisKey}
								</span>
								<Select
									variant="outlined"
									value={styleTarget.axisValues[axisKey] ?? ""}
									onChange={(event) =>
										setAxisValue(axisKey, event.currentTarget.value)
									}
								>
									<option value="">Unselected</option>
									{Object.entries(axis.values).map(([valueKey, value]) => (
										<option key={valueKey} value={valueKey}>
											{value.label || valueKey}
										</option>
									))}
								</Select>
							</label>
						))}
					</div>
				) : null}

				{selectedAxisEntries.length >= 2 ? (
					<div className="flex flex-col gap-1 text-xs">
						<span className="font-semibold text-slate-600">
							Compound variant
						</span>
						<div className="flex flex-row flex-wrap gap-1">
							{selectedAxisEntries.map((selected) => {
								const isCompoundAxis = styleTarget.compoundAxes.includes(
									selected.axisKey,
								);
								return (
									<Button
										key={selected.axisKey}
										type="button"
										variant="block"
										className="px-2 py-1 text-xs"
										isSelected={isCompoundAxis}
										aria-pressed={isCompoundAxis}
										onClick={() => toggleCompoundAxis(selected.axisKey)}
									>
										{selected.axisLabel}
									</Button>
								);
							})}
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}

function StyleTargetClassEditor({
	path,
	target,
	systemId,
}: {
	path: string;
	target: StyleTargetDescriptor;
	systemId: string;
}) {
	const className = useComponentDraftClassNameForStyleTab(target.tab, path);

	// Same class field as the design inspector, one per active style target.
	return (
		<section className="flex flex-col border-b border-slate-200 last:border-b-0">
			<Text variant="group-label" className="px-3 pt-2.5" title={target.title}>
				{target.label}
			</Text>
			<div className="px-3 pt-1 pb-3">
				<ClassCompositionPanel
					className={className}
					systemId={systemId}
					label={`${target.label} classes`}
					onChangeClassName={(next) =>
						setDraftClassNameForStyleTab(target.tab, path, next)
					}
				/>
			</div>
		</section>
	);
}

function DraftInspectorHeader({
	title,
	subtitle,
}: {
	title: string;
	subtitle: string;
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[13px] font-medium text-slate-950">
					{title}
				</span>
				<span className="truncate font-mono text-[10px] text-slate-500">
					{subtitle}
				</span>
			</div>
		</header>
	);
}

function DraftLayerBreadcrumb() {
	const crumbs = useSelector(
		componentDraftStore,
		(state) => getStageLayerAncestry(draftLayerTree(state), state.selectedPath),
		{ compare: isSameStageLayerAncestry },
	);
	return <LayerBreadcrumb crumbs={crumbs} onSelect={selectTemplateNode} />;
}

function DesignOnlySection({ path }: { path: string }) {
	const state = useComponentDraftDesignOnlyState(path);
	const ancestor = useComponentDraftEntity(state.inheritedFromPath ?? "");
	const inherited = state.inheritedFromPath !== null;
	const switchId = `${path}-design-only`;
	const ancestorName =
		ancestor?.name?.trim() || ancestor?.component || state.inheritedFromPath;

	return (
		<InspectorSection title="Code">
			<div className="flex flex-row items-center justify-between gap-2 text-xs">
				<label className="font-semibold" htmlFor={switchId}>
					Design only
				</label>
				<Switch
					id={switchId}
					checked={state.designOnly}
					disabled={inherited}
					onCheckedChange={(checked) =>
						setTemplateNodeDesignOnly(path, checked)
					}
				/>
			</div>
			{inherited ? (
				<Text variant="meta" render={<p />}>
					Inherited from <span className="text-slate-700">{ancestorName}</span>:
					this layer and its children stay out of generated code. Change it on
					that layer.
				</Text>
			) : (
				<Text variant="meta" render={<p />}>
					{state.designOnly
						? "Shown in designs. Left out of generated code, with its children."
						: "Turn on for layers that exist only in designs."}
				</Text>
			)}
			{inherited && state.own ? (
				<div className="flex items-center justify-between gap-2 text-xs">
					<Text variant="meta">Also set on this layer.</Text>
					<Button
						type="button"
						variant="outlined"
						className="shrink-0 px-2 py-1 text-xs"
						onClick={() => setTemplateNodeDesignOnly(path, false)}
					>
						Turn off here
					</Button>
				</div>
			) : null}
		</InspectorSection>
	);
}

function SlotMetadataSection({ path }: { path: string }) {
	const slot = useComponentDraftSelectedSlot();

	return (
		<InspectorSection title="Slot">
			{slot ? (
				<>
					<InputField
						type="text"
						label="Name"
						value={slot.name}
						onChange={(event) =>
							updateTemplateNodeSlotMetadata(path, {
								name: event.currentTarget.value,
							})
						}
					/>
					<InputField
						type="text"
						label="Label"
						value={slot.label ?? ""}
						onChange={(event) =>
							updateTemplateNodeSlotMetadata(path, {
								label: event.currentTarget.value,
							})
						}
					/>
					<div className="flex items-center justify-end gap-2 text-xs">
						<Button
							type="button"
							variant="outlined"
							className="shrink-0 px-2 py-1 text-xs"
							onClick={() => removeTemplateNodeSlotHost(path)}
						>
							Remove slot
						</Button>
					</div>
				</>
			) : (
				<div className="flex items-center justify-between gap-2 text-xs">
					<Text variant="meta">Not a slot.</Text>
					<Button
						type="button"
						variant="outlined"
						className="shrink-0 px-2 py-1 text-xs"
						onClick={() => markTemplateNodeAsSlotHost(path)}
					>
						Make slot
					</Button>
				</div>
			)}
		</InspectorSection>
	);
}

function OverrideTargetSection({ path }: { path: string }) {
	const target = useComponentDraftSelectedOverrideTarget();
	const entity = useComponentDraftSelectedEntity();
	const controls = entity ? getOverrideableRegistryControls(entity) : [];

	return (
		<InspectorSection title="Override target">
			{target ? (
				<>
					<InputField
						type="text"
						label="Target id"
						value={target.targetId}
						onChange={(event) =>
							updateTemplateNodeOverrideTarget(target.targetId, {
								targetId: event.currentTarget.value,
							})
						}
					/>
					<InputField
						type="text"
						label="Label"
						value={target.label}
						onChange={(event) =>
							updateTemplateNodeOverrideTarget(target.targetId, {
								label: event.currentTarget.value,
							})
						}
					/>
					<div className="text-xs text-slate-600">
						<span className="font-semibold text-slate-700">Capabilities</span>
						<div className="mt-1 font-mono text-[11px] text-slate-500">
							{normalizeOverrideTargetCapabilities(target).join(", ")}
						</div>
					</div>
					{controls.length > 0 ? (
						<div className="flex flex-col gap-1 text-xs text-slate-600">
							<span className="font-semibold text-slate-700">
								Overridable props
							</span>
							{controls.map((control) => {
								const checked = target.props?.includes(control.prop) ?? false;
								return (
									// biome-ignore lint/a11y/noLabelWithoutControl: the primitive inside renders the control.
									<label
										key={control.prop}
										className="flex items-center justify-between gap-2"
									>
										<span>{control.label}</span>
										<Checkbox
											size="sm"
											checked={checked}
											onCheckedChange={(nextChecked) => {
												const props = new Set(target.props ?? []);
												if (nextChecked) {
													props.add(control.prop);
												} else {
													props.delete(control.prop);
												}
												updateTemplateNodeOverrideTarget(target.targetId, {
													props: [...props],
												});
											}}
										/>
									</label>
								);
							})}
						</div>
					) : null}
					<div className="flex items-center justify-between gap-2 text-xs">
						<span
							className="min-w-0 truncate font-mono text-slate-500"
							title={target.path}
						>
							{target.path}
						</span>
						<Tooltip content="Remove override target">
							<Button
								type="button"
								variant="ghost"
								flavor="danger"
								className="inline-flex size-6 shrink-0 items-center justify-center p-0"
								onClick={() =>
									removeTemplateNodeOverrideTarget(target.targetId)
								}
								aria-label="Remove override target"
							>
								<Trash2 className="size-3.5" aria-hidden="true" />
							</Button>
						</Tooltip>
					</div>
				</>
			) : (
				<div className="flex items-center justify-between gap-2 text-xs">
					<Text variant="meta">Not an override target.</Text>
					<Button
						type="button"
						variant="outlined"
						className="inline-flex shrink-0 items-center gap-1 px-2 py-1 text-xs"
						onClick={() => addTemplateNodeOverrideTarget(path)}
					>
						<Plus className="size-3" aria-hidden="true" />
						<span>Make override target</span>
					</Button>
				</div>
			)}
		</InspectorSection>
	);
}

export function ComponentDraftProperties({
	systemId,
	projectScope,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const selectedEntity = useComponentDraftSelectedEntity();
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();

	if (!selectedEntity) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-3">
					<Text variant="label" className="text-[13px] text-slate-950">
						Layer
					</Text>
				</header>
				<Text variant="meta" render={<p />} className="p-3">
					Select a layer to edit it.
				</Text>
			</div>
		);
	}

	const inspectable = toDraftInspectableEntity(selectedEntity);
	const path = selectedEntity.path;
	const registryResolution = resolveRegistryComponent(
		selectedEntity.library,
		selectedEntity.component,
	);
	const controls =
		registryResolution.status === "known"
			? getControlDefinitions(registryResolution.definition)
			: [];
	const { assetControl, iconControl, componentControls } =
		getPropertiesControlSurface(controls);
	const { contentControls, propertyControls } =
		splitComponentControls(componentControls);
	const props = inspectable.props;
	const hasContentControls =
		selectedEntity.role === "text" ||
		Boolean(assetControl) ||
		Boolean(iconControl) ||
		contentControls.length > 0;
	const title =
		selectedEntity.name?.trim() || selectedEntity.component || "Untitled";
	const subtitle = `${selectedEntity.library}/${selectedEntity.component}`;
	const styleTargetClassEditors = getStyleTargetDescriptors(
		variants,
		styleTarget,
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<DraftInspectorHeader title={title} subtitle={subtitle} />
			<DraftLayerBreadcrumb />
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col divide-y divide-slate-200">
					<section className="flex flex-col">
						<StyleTargetSection />
						{styleTargetClassEditors.map((target) => (
							<StyleTargetClassEditor
								key={`${path}:${target.id}`}
								path={path}
								target={target}
								systemId={systemId}
							/>
						))}
					</section>
					<DesignOnlySection path={path} />
					<SlotMetadataSection path={path} />
					<OverrideTargetSection path={path} />
					{hasContentControls ? (
						<InspectorSection title="Content">
							{selectedEntity.role === "text" ? (
								<InputField
									type="text"
									label="Text"
									value={selectedEntity.text ?? ""}
									onChange={(event) =>
										updateTemplateNodeText(path, event.currentTarget.value)
									}
								/>
							) : null}
							{assetControl ? (
								<DraftAssetPicker
									systemId={systemId}
									path={path}
									label={assetControl.label}
									value={
										typeof props[assetIdProp] === "string"
											? props[assetIdProp]
											: ""
									}
									projectScope={projectScope}
								/>
							) : null}
							{iconControl ? (
								<DraftIconPicker
									systemId={systemId}
									path={path}
									label={iconControl.label}
									value={
										typeof props[iconIdProp] === "string"
											? props[iconIdProp]
											: ""
									}
									projectScope={projectScope}
								/>
							) : null}
							{contentControls.map((control) => (
								<DraftComponentControl
									key={control.prop}
									path={path}
									control={control}
									value={props[control.prop]}
								/>
							))}
						</InspectorSection>
					) : null}
					{propertyControls.length > 0 ? (
						<InspectorSection title="Props">
							{propertyControls.map((control) => (
								<DraftComponentControl
									key={control.prop}
									path={path}
									control={control}
									value={props[control.prop]}
								/>
							))}
						</InspectorSection>
					) : null}
				</div>
			</ScrollArea>
		</div>
	);
}
