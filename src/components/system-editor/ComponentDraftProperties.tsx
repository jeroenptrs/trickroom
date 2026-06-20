import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../../libraries/registry";
import type { ProjectQueryScope } from "../../queries/project-scope";
import { systemAssetsQueryOptions } from "../../queries/system-assets";
import { systemIconsQueryOptions } from "../../queries/system-icons";
import {
	addTemplateNodeOverrideTarget,
	markTemplateNodeAsSlotHost,
	removeTemplateNodeOverrideTarget,
	removeTemplateNodeSlotHost,
	setComponentDraftStyleClassName,
	setComponentDraftStyleTarget,
	updateTemplateNodeOverrideTarget,
	updateTemplateNodeProps,
	updateTemplateNodeSlotMetadata,
	updateTemplateNodeText,
	useComponentDraftEffectiveClassName,
	useComponentDraftSelectedEntity,
	useComponentDraftSelectedOverrideTarget,
	useComponentDraftSelectedSlot,
	useComponentDraftStyleTarget,
	useComponentDraftVariants,
} from "../../stores/component-draft-store";
import type { ControlDefinition, JsonPrimitive } from "../../types";
import { normalizeOverrideTargetCapabilities } from "../../utils/system-component-override-targets";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
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

function describeCompoundWhen(
	variants: ReturnType<typeof useComponentDraftVariants>,
	when: Record<string, string | string[]>,
	index: number,
) {
	const parts = Object.entries(when).map(([axisKey, value]) => {
		const axis = variants?.axes[axisKey];
		const valueKey = Array.isArray(value) ? (value[0] ?? "") : value;
		const axisLabel = axis?.label || axisKey;
		const valueLabel = axis?.values[valueKey]?.label || valueKey;
		return `${axisLabel}=${valueLabel}`;
	});
	return parts.length > 0 ? parts.join(" · ") : `Compound ${index + 1}`;
}

function DraftStyleTargetBanner() {
	const variants = useComponentDraftVariants();
	const styleTarget = useComponentDraftStyleTarget();
	const axes = Object.entries(variants?.axes ?? {});
	const compoundVariants = variants?.compoundVariants ?? [];

	if (axes.length === 0) {
		return null;
	}

	const selectedAxisKey =
		styleTarget.mode === "variant" ? styleTarget.axisKey : (axes[0]?.[0] ?? "");
	const selectedAxis = selectedAxisKey
		? variants?.axes[selectedAxisKey]
		: undefined;
	const valueEntries = Object.entries(selectedAxis?.values ?? {});
	const selectedValueKey =
		styleTarget.mode === "variant"
			? styleTarget.valueKey
			: (valueEntries[0]?.[0] ?? "");
	const selectedCompoundIndex =
		styleTarget.mode === "compound" ? styleTarget.compoundIndex : 0;

	return (
		<section className="border-b border-slate-200 bg-slate-100/80 px-3 py-2">
			<p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
				Style target
			</p>
			<div className="mt-1 flex flex-col gap-2">
				<div className="flex flex-row flex-wrap gap-1">
					<button
						type="button"
						className={`border px-2 py-1 text-xs ${
							styleTarget.mode === "base"
								? "border-cyan-500 bg-cyan-50 text-cyan-900"
								: "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
						}`}
						onClick={() => setComponentDraftStyleTarget({ mode: "base" })}
					>
						Base styles
					</button>
					<button
						type="button"
						className={`border px-2 py-1 text-xs ${
							styleTarget.mode === "variant"
								? "border-cyan-500 bg-cyan-50 text-cyan-900"
								: "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
						}`}
						disabled={valueEntries.length === 0}
						onClick={() => {
							if (!selectedAxisKey || !selectedValueKey) {
								return;
							}
							setComponentDraftStyleTarget({
								mode: "variant",
								axisKey: selectedAxisKey,
								valueKey: selectedValueKey,
							});
						}}
					>
						Variant styles
					</button>
					{compoundVariants.length > 0 ? (
						<button
							type="button"
							className={`border px-2 py-1 text-xs ${
								styleTarget.mode === "compound"
									? "border-cyan-500 bg-cyan-50 text-cyan-900"
									: "border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
							}`}
							onClick={() =>
								setComponentDraftStyleTarget({
									mode: "compound",
									compoundIndex: selectedCompoundIndex,
								})
							}
						>
							Compound styles
						</button>
					) : null}
				</div>
				{styleTarget.mode === "compound" ? (
					<label className="flex flex-col gap-1 text-xs">
						<span className="font-semibold text-slate-600">Compound</span>
						<select
							className="w-full border-none bg-white px-2 py-1 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
							value={styleTarget.compoundIndex}
							onChange={(event) =>
								setComponentDraftStyleTarget({
									mode: "compound",
									compoundIndex: Number(event.currentTarget.value),
								})
							}
						>
							{compoundVariants.map((compound, index) => (
								<option
									// biome-ignore lint/suspicious/noArrayIndexKey: compounds are an ordered list with no stable id
									key={index}
									value={index}
								>
									{describeCompoundWhen(variants, compound.when, index)}
								</option>
							))}
						</select>
					</label>
				) : null}
				{styleTarget.mode === "variant" ? (
					<div className="grid grid-cols-2 gap-2">
						<label className="flex flex-col gap-1 text-xs">
							<span className="font-semibold text-slate-600">Axis</span>
							<select
								className="w-full border-none bg-white px-2 py-1 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
								value={styleTarget.axisKey}
								onChange={(event) => {
									const axisKey = event.currentTarget.value;
									const firstValueKey = Object.keys(
										variants?.axes[axisKey]?.values ?? {},
									)[0];
									if (!firstValueKey) {
										return;
									}
									setComponentDraftStyleTarget({
										mode: "variant",
										axisKey,
										valueKey: firstValueKey,
									});
								}}
							>
								{axes.map(([axisKey, axis]) => (
									<option key={axisKey} value={axisKey}>
										{axis.label || axisKey}
									</option>
								))}
							</select>
						</label>
						<label className="flex flex-col gap-1 text-xs">
							<span className="font-semibold text-slate-600">Value</span>
							<select
								className="w-full border-none bg-white px-2 py-1 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#cbd5e1] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]"
								value={styleTarget.valueKey}
								onChange={(event) =>
									setComponentDraftStyleTarget({
										mode: "variant",
										axisKey: styleTarget.axisKey,
										valueKey: event.currentTarget.value,
									})
								}
							>
								{Object.entries(
									variants?.axes[styleTarget.axisKey]?.values ?? {},
								).map(([valueKey, value]) => (
									<option key={valueKey} value={valueKey}>
										{value.label || valueKey}
									</option>
								))}
							</select>
						</label>
					</div>
				) : null}
				<p className="text-[11px] text-slate-600">
					{styleTarget.mode === "base"
						? "Editing base template classes for the selected node."
						: styleTarget.mode === "variant"
							? `Editing variant classes for ${styleTarget.axisKey}/${styleTarget.valueKey}. Base classes are not changed.`
							: `Editing compound classes for ${describeCompoundWhen(variants, compoundVariants[styleTarget.compoundIndex]?.when ?? {}, styleTarget.compoundIndex)}. Base classes are not changed.`}
				</p>
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
	const selectedEntity = useComponentDraftSelectedEntity();
	const selectedPath = selectedEntity?.path ?? "";
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

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<DraftInspectorHeader title={title} subtitle={subtitle} />
			<Tabs defaultValue="properties" className="min-h-0 flex-1 gap-0">
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
				<TabsPanel value="style" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div
							key={`${path}:${
								styleTarget.mode === "variant"
									? `${styleTarget.axisKey}/${styleTarget.valueKey}`
									: styleTarget.mode === "compound"
										? `compound:${styleTarget.compoundIndex}`
										: "base"
							}`}
							className="flex flex-col divide-y divide-slate-200"
						>
							<DraftStyleTargetBanner />
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
							<TextareaField
								label="Tailwind classnames"
								value={className}
								onChange={(event) =>
									setComponentDraftStyleClassName(
										path,
										event.currentTarget.value,
									)
								}
							/>
							<ClassInventoryPanel className={className} />
						</div>
					</ScrollArea>
				</TabsPanel>
			</Tabs>
		</div>
	);
}
