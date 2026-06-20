import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
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
	markTemplateNodeAsSlotHost,
	removeTemplateNodeOverrideTarget,
	removeTemplateNodeSlotHost,
	setComponentDraftStyleClassName,
	setComponentDraftStyleTarget,
	setDraftClassNameForStyleTab,
	updateTemplateNodeOverrideTarget,
	updateTemplateNodeProps,
	updateTemplateNodeSlotMetadata,
	updateTemplateNodeText,
	useComponentDraftClassNameForStyleTab,
	useComponentDraftEffectiveClassName,
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
import {
	getPropertiesControlSurface,
	splitComponentControls,
} from "../chrome/Properties";
import { BackgroundProperties } from "../chrome/properties/BackgroundProperties";
import { BorderProperties } from "../chrome/properties/BorderProperties";
import { ClassInventoryPanel } from "../chrome/properties/ClassInventoryPanel";
import { EffectsProperties } from "../chrome/properties/EffectsProperties";
import { FocusProperties } from "../chrome/properties/FocusProperties";
import { InteractionProperties } from "../chrome/properties/InteractionProperties";
import { LayoutProperties } from "../chrome/properties/LayoutProperties";
import { MaskProperties } from "../chrome/properties/MaskProperties";
import { MotionProperties } from "../chrome/properties/MotionProperties";
import { PositionProperties } from "../chrome/properties/PositionProperties";
import { SizeProperties } from "../chrome/properties/SizeProperties";
import { SpacingProperties } from "../chrome/properties/SpacingProperties";
import { StructureProperties } from "../chrome/properties/StructureProperties";
import { StyleSection } from "../chrome/properties/StyleSection";
import { TransformProperties } from "../chrome/properties/TransformProperties";
import { TypographyProperties } from "../chrome/properties/TypographyProperties";
import { VectorProperties } from "../chrome/properties/VectorProperties";
import { InputField, TextareaField } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { toDraftInspectableEntity } from "./component-draft-inspector";

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
						<button
							key={String(option.value)}
							type="button"
							className={`border px-2 py-1 text-xs ${
								value === option.value
									? "border-cyan-500 bg-cyan-50 text-cyan-900"
									: "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
							}`}
							onClick={() => updateValue(option.value)}
							title={control.description ?? control.label}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>
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
			<div className="flex flex-row items-center justify-between gap-2 text-xs">
				<label className="font-semibold" htmlFor={`${path}-${control.prop}`}>
					{control.label}
				</label>
				<input
					id={`${path}-${control.prop}`}
					type="checkbox"
					checked={value === true}
					onChange={(event) => updateValue(event.currentTarget.checked)}
					title={control.description ?? control.label}
				/>
			</div>
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
			<select
				id={`${path}-asset`}
				className="w-full border-none bg-slate-200/60 px-1 py-0.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:outline-none focus:inset-shadow-[0_0_0_1px_#67e8f9]"
				value={value}
				disabled={assetsQuery.isPending}
				onChange={(event) =>
					updateTemplateNodeProps(path, {
						[assetIdProp]: event.currentTarget.value,
					})
				}
			>
				<option value="">
					{assetsQuery.isPending ? "Loading assets" : "No asset"}
				</option>
				{assets.map((asset) => (
					<option key={asset.id} value={asset.id}>
						{asset.name}
					</option>
				))}
			</select>
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
			<select
				id={`${path}-icon`}
				className="w-full border-none bg-slate-200/60 px-1 py-0.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:outline-none focus:inset-shadow-[0_0_0_1px_#67e8f9]"
				value={value}
				disabled={iconsQuery.isPending}
				onChange={(event) =>
					updateTemplateNodeProps(path, {
						[iconIdProp]: event.currentTarget.value,
					})
				}
			>
				<option value="">
					{iconsQuery.isPending ? "Loading icons" : "No icon"}
				</option>
				{icons.map((icon) => (
					<option key={icon.id} value={icon.id}>
						{icon.id}
					</option>
				))}
			</select>
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

type MainInspectorTab = "style" | "properties" | "classes";

function isMainInspectorTab(value: string): value is MainInspectorTab {
	return value === "style" || value === "properties" || value === "classes";
}

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

	return parts.join(" · ");
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
			label: "Compound",
			tab: { kind: "compound" },
			title: compoundDescription || undefined,
		});
	}

	return descriptors;
}

function styleTabsEqual(
	left: ComponentDraftStyleTab,
	right: ComponentDraftStyleTab,
) {
	if (left.kind !== right.kind) {
		return false;
	}
	return left.kind !== "axis" || right.kind !== "axis"
		? true
		: left.axisKey === right.axisKey;
}

function getStyleControlsRemountKey(styleTarget: ComponentDraftStyleTarget) {
	const activeTab = styleTarget.activeTab;
	if (activeTab.kind === "axis") {
		return `axis:${activeTab.axisKey}:${
			styleTarget.axisValues[activeTab.axisKey] ?? ""
		}`;
	}

	if (activeTab.kind === "compound") {
		return `compound:${styleTarget.compoundAxes
			.map((axisKey) => `${axisKey}:${styleTarget.axisValues[axisKey] ?? ""}`)
			.join("|")}`;
	}

	return "base";
}

function styleTargetButtonClass(selected: boolean) {
	return `border px-2 py-1 text-xs ${
		selected
			? "border-cyan-500 bg-cyan-50 text-cyan-900"
			: "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
	} disabled:pointer-events-none disabled:opacity-50`;
}

function StyleTargetSection() {
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();
	const axes = Object.entries(variants?.axes ?? {});
	const selectedAxisEntries = getSelectedAxisEntries(variants, styleTarget);
	const styleTabs = getStyleTargetDescriptors(variants, styleTarget);
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
	const setActiveStyleTab = (tab: ComponentDraftStyleTab) =>
		setComponentDraftStyleTarget({
			...styleTarget,
			activeTab: tab,
		});
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
			<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
				Style target
			</p>
			<div className="mt-1 flex flex-col gap-2">
				<div className="flex flex-row flex-wrap items-center gap-1">
					<button
						type="button"
						className={styleTargetButtonClass(styleTarget.base)}
						aria-pressed={styleTarget.base}
						disabled={styleTarget.base && !canDisableBase}
						onClick={toggleBase}
					>
						Base
					</button>
				</div>

				{axes.length > 0 ? (
					<div className="grid grid-cols-1 gap-2">
						{axes.map(([axisKey, axis]) => (
							<label key={axisKey} className="flex flex-col gap-1 text-xs">
								<span className="font-semibold text-slate-600">
									{axis.label || axisKey}
								</span>
								<select
									className="w-full border-none bg-white px-2 py-1 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
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
								</select>
							</label>
						))}
					</div>
				) : null}

				{selectedAxisEntries.length >= 2 ? (
					<div className="flex flex-col gap-1 text-xs">
						<span className="font-semibold text-slate-600">Compound</span>
						<div className="flex flex-row flex-wrap gap-1">
							{selectedAxisEntries.map((selected) => {
								const isCompoundAxis = styleTarget.compoundAxes.includes(
									selected.axisKey,
								);
								return (
									<button
										key={selected.axisKey}
										type="button"
										className={styleTargetButtonClass(isCompoundAxis)}
										aria-pressed={isCompoundAxis}
										onClick={() => toggleCompoundAxis(selected.axisKey)}
									>
										{selected.axisLabel}
									</button>
								);
							})}
						</div>
					</div>
				) : null}

				<div className="flex flex-row flex-wrap gap-1 border-t border-slate-200 pt-2">
					{styleTabs.map((target) => (
						<button
							key={target.id}
							type="button"
							className={styleTargetButtonClass(
								styleTabsEqual(styleTarget.activeTab, target.tab),
							)}
							title={target.title}
							onClick={() => setActiveStyleTab(target.tab)}
						>
							{target.label}
						</button>
					))}
				</div>
			</div>
		</section>
	);
}

function StyleTargetClassEditor({
	path,
	target,
}: {
	path: string;
	target: StyleTargetDescriptor;
}) {
	const className = useComponentDraftClassNameForStyleTab(target.tab, path);

	return (
		<section className="flex flex-col gap-2 border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
			<TextareaField
				label={`${target.label} classnames`}
				value={className}
				onChange={(event) =>
					setDraftClassNameForStyleTab(
						target.tab,
						path,
						event.currentTarget.value,
					)
				}
			/>
			<ClassInventoryPanel className={className} />
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
				<span className="truncate text-[10px] text-slate-400">{subtitle}</span>
			</div>
		</header>
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
					<div className="flex items-center justify-between gap-2 text-xs">
						<span
							className="min-w-0 truncate text-slate-500"
							title={slot.hostPath}
						>
							Host path: {slot.hostPath}
						</span>
						<button
							type="button"
							className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-100"
							onClick={() => removeTemplateNodeSlotHost(path)}
						>
							Remove
						</button>
					</div>
				</>
			) : (
				<div className="flex items-center justify-between gap-2 text-xs">
					<span className="text-slate-500">This node is not a slot host.</span>
					<button
						type="button"
						className="border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-100"
						onClick={() => markTemplateNodeAsSlotHost(path)}
					>
						Make slot
					</button>
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
								Registry props
							</span>
							{controls.map((control) => {
								const checked = target.props?.includes(control.prop) ?? false;
								return (
									<label
										key={control.prop}
										className="flex items-center justify-between gap-2"
									>
										<span>{control.label}</span>
										<input
											type="checkbox"
											checked={checked}
											onChange={(event) => {
												const props = new Set(target.props ?? []);
												if (event.currentTarget.checked) {
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
						<button
							type="button"
							className="inline-flex size-6 shrink-0 items-center justify-center text-slate-500 hover:text-red-700 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-red-500"
							onClick={() => removeTemplateNodeOverrideTarget(target.targetId)}
							title="Remove override target"
							aria-label="Remove override target"
						>
							<Trash2 className="size-3.5" aria-hidden="true" />
						</button>
					</div>
				</>
			) : (
				<div className="flex items-center justify-between gap-2 text-xs">
					<span className="text-slate-500">
						This node is not an override target.
					</span>
					<button
						type="button"
						className="inline-flex items-center gap-1 border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-100"
						onClick={() => addTemplateNodeOverrideTarget(path)}
					>
						<Plus className="size-3" aria-hidden="true" />
						<span>Make target</span>
					</button>
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
	const [activeMainTab, setActiveMainTab] =
		useState<MainInspectorTab>("properties");
	const selectedEntity = useComponentDraftSelectedEntity();
	const selectedPath = selectedEntity?.path ?? "";
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();
	const className = useComponentDraftEffectiveClassName(selectedPath);

	if (!selectedEntity) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-3">
					<Text variant="label" className="text-[13px] text-slate-950">
						Node
					</Text>
				</header>
				<p className="p-3 text-slate-500">
					Select a layer or stage node to edit its properties.
				</p>
			</div>
		);
	}

	const inspectable = toDraftInspectableEntity(selectedEntity);
	const path = selectedEntity.path;
	const onChangeClassName = (next: string) =>
		setComponentDraftStyleClassName(path, next);
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
	const hasPropertyControls = propertyControls.length > 0;
	const title =
		selectedEntity.name?.trim() || selectedEntity.component || "Untitled";
	const subtitle = `${selectedEntity.library}/${selectedEntity.component} · ${selectedEntity.role}`;
	const styleTargetClassEditors = getStyleTargetDescriptors(
		variants,
		styleTarget,
	);
	const showStyleTargetSection =
		activeMainTab === "style" || activeMainTab === "classes";

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<DraftInspectorHeader title={title} subtitle={subtitle} />
			<Tabs
				value={activeMainTab}
				onValueChange={(value) => {
					if (isMainInspectorTab(value)) {
						setActiveMainTab(value);
					}
				}}
				className="min-h-0 flex-1 gap-0"
			>
				<TabsList
					variant="block"
					className="border-b border-slate-200 px-1 py-1"
				>
					<TabsTab variant="block" value="style">
						Style
					</TabsTab>
					<TabsTab variant="block" value="properties">
						Properties
					</TabsTab>
					<TabsTab variant="block" value="classes">
						Classes
					</TabsTab>
				</TabsList>
				{showStyleTargetSection ? <StyleTargetSection /> : null}
				<TabsPanel value="style" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div
							key={`${path}:${getStyleControlsRemountKey(styleTarget)}`}
							className="flex flex-col divide-y divide-slate-200"
						>
							<LayoutProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<SizeProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<StyleSection title="Spacing">
								<SpacingProperties
									className={className}
									onChange={onChangeClassName}
								/>
							</StyleSection>
							<TypographyProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<BackgroundProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<BorderProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<EffectsProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<FocusProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<PositionProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<TransformProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<MotionProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<VectorProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<StructureProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<MaskProperties
								className={className}
								onChange={onChangeClassName}
							/>
							<InteractionProperties
								className={className}
								onChange={onChangeClassName}
							/>
						</div>
					</ScrollArea>
				</TabsPanel>
				<TabsPanel value="properties" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="flex flex-col divide-y divide-slate-200">
							<SlotMetadataSection path={path} />
							<OverrideTargetSection path={path} />
							{hasContentControls ? (
								<InspectorSection title="Content">
									{selectedEntity.role === "text" ? (
										<InputField
											type="text"
											label="Content"
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
								<InspectorSection title="Component">
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
							{!hasContentControls && !hasPropertyControls ? (
								<div className="px-3 py-3 text-xs text-slate-500">
									No editable properties
								</div>
							) : null}
						</div>
					</ScrollArea>
				</TabsPanel>
				<TabsPanel value="classes" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="flex flex-col gap-3 p-3">
							{styleTargetClassEditors.map((target) => (
								<StyleTargetClassEditor
									key={target.id}
									path={path}
									target={target}
								/>
							))}
						</div>
					</ScrollArea>
				</TabsPanel>
			</Tabs>
		</div>
	);
}
