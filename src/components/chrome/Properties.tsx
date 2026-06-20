import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Box, Component, Type } from "lucide-react";
import type { ReactNode } from "react";
import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { systemAssetsQueryOptions } from "../../queries/system-assets";
import { systemIconsQueryOptions } from "../../queries/system-icons";
import { getRecipeControlTargets } from "../../recipes/controls";
import { RECIPE_MARKER_PROP_KEYS } from "../../recipes/markers";
import {
	getElementRecipeMetadata,
	isRecipeRoot,
} from "../../recipes/ownership";
import {
	type DesignEntity,
	designStore,
	updateElementClassName,
	updateElementProps,
	updateElementText,
	updateRecipeControl,
	useDesignSystemId,
	useSelectedElement,
} from "../../stores/design-store";
import type {
	ControlDefinition,
	JsonPrimitive,
	RecipeControlDefinition,
} from "../../types";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { InputField, TextareaField } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { BackgroundProperties } from "./properties/BackgroundProperties";
import { BorderProperties } from "./properties/BorderProperties";
import { ClassInventoryPanel } from "./properties/ClassInventoryPanel";
import { EffectsProperties } from "./properties/EffectsProperties";
import { FocusProperties } from "./properties/FocusProperties";
import { InteractionProperties } from "./properties/InteractionProperties";
import { LayoutProperties } from "./properties/LayoutProperties";
import { MaskProperties } from "./properties/MaskProperties";
import { MotionProperties } from "./properties/MotionProperties";
import { PositionProperties } from "./properties/PositionProperties";
import { SizeProperties } from "./properties/SizeProperties";
import { SpacingProperties } from "./properties/SpacingProperties";
import { StructureProperties } from "./properties/StructureProperties";
import { StyleSection } from "./properties/StyleSection";
import { TransformProperties } from "./properties/TransformProperties";
import { TypographyProperties } from "./properties/TypographyProperties";
import { VectorProperties } from "./properties/VectorProperties";

type ComponentControlProps = {
	elementId: string;
	control: ControlDefinition;
	value: JsonPrimitive | undefined;
	onChange?: (value: JsonPrimitive) => void;
};

export type PropertiesControlSurface = {
	assetControl: ControlDefinition | null;
	iconControl: ControlDefinition | null;
	componentControls: ControlDefinition[];
};

export function getPropertiesControlSurface(
	controls: ControlDefinition[],
): PropertiesControlSurface {
	let assetControl: ControlDefinition | null = null;
	let iconControl: ControlDefinition | null = null;
	const componentControls: ControlDefinition[] = [];

	for (const control of controls) {
		if (
			control.visibility === "hidden" ||
			control.visibility === "deprecated"
		) {
			continue;
		}

		if (RECIPE_MARKER_PROP_KEYS.has(control.prop)) {
			continue;
		}

		if (control.prop === assetIdProp) {
			assetControl ??= control;
			continue;
		}

		if (control.prop === iconIdProp) {
			iconControl ??= control;
			continue;
		}

		componentControls.push(control);
	}

	return {
		assetControl,
		iconControl,
		componentControls,
	};
}

const CONTENT_CONTROL_PROPS = new Set(["alt", "aria-label", "label", "title"]);

function splitComponentControls(controls: ControlDefinition[]) {
	const contentControls: ControlDefinition[] = [];
	const propertyControls: ControlDefinition[] = [];

	for (const control of controls) {
		if (CONTENT_CONTROL_PROPS.has(control.prop)) {
			contentControls.push(control);
		} else {
			propertyControls.push(control);
		}
	}

	return { contentControls, propertyControls };
}

function getElementTitle(element: DesignEntity) {
	const name = element.props["data-trickroom-name"];
	return (
		(typeof name === "string" ? name.trim() : "") ||
		element.props["data-trickroom-component"]
	);
}

function getElementSubtitle(element: DesignEntity) {
	return [
		`${element.props["data-trickroom-library"]}/${element.props["data-trickroom-component"]}`,
		element.role,
	]
		.filter(Boolean)
		.join(" / ");
}

function InspectorGlyph({ element }: { element: DesignEntity }) {
	const Icon =
		element.role === "text"
			? Type
			: element.role === "branch"
				? Box
				: Component;
	return (
		<span className="flex size-6 shrink-0 items-center justify-center bg-cyan-100 text-cyan-900">
			<Icon className="size-3.5" />
		</span>
	);
}

function InspectorHeader({ element }: { element: DesignEntity }) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
			<InspectorGlyph element={element} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[13px] font-medium text-slate-950">
					{getElementTitle(element)}
				</span>
				<span className="truncate text-[10px] text-slate-400">
					{getElementSubtitle(element)}
				</span>
			</div>
		</header>
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

function ComponentControl({
	elementId,
	control,
	value,
	onChange,
}: ComponentControlProps) {
	const updateValue =
		onChange ??
		((nextValue: JsonPrimitive) =>
			updateElementProps(elementId, {
				[control.prop]: nextValue,
			}));

	if (
		(control.input === "radio" || control.input === "select") &&
		control.options
	) {
		return (
			<div className="flex flex-col gap-1 text-xs">
				<div className="font-semibold">{control.label}</div>
				<div className="flex flex-row">
					{control.options.map((option) => (
						<Button
							key={String(option.value)}
							variant="block"
							isSelected={value === option.value}
							className="px-2 py-1 text-xs"
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
				<label
					className="font-semibold"
					htmlFor={`${elementId}-${control.prop}`}
				>
					{control.label}
				</label>
				<input
					id={`${elementId}-${control.prop}`}
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

type RecipeControlTarget = {
	control: RecipeControlDefinition;
	elementId: string;
	value: JsonPrimitive | undefined;
};

function useRecipeControlTargets(): RecipeControlTarget[] {
	const selectedElement = useSelectedElement();
	const entitiesById = useSelector(designStore, (state) => state.entitiesById);

	if (!selectedElement || !isRecipeRoot(selectedElement)) {
		return [];
	}

	const metadata = getElementRecipeMetadata(selectedElement);
	if (!metadata) {
		return [];
	}

	return getRecipeControlTargets(
		entitiesById,
		metadata.instanceId,
		metadata.recipeId,
	).map(({ control, elementId }) => ({
		control,
		elementId,
		value: entitiesById[elementId]?.props[control.prop],
	}));
}

function AssetPicker({
	elementId,
	label,
	value,
}: {
	elementId: string;
	label: string;
	value: string;
}) {
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const assetsQuery = useQuery({
		...systemAssetsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
	const assets = assetsQuery.data?.assets ?? [];

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${elementId}-asset`}>
				{label}
			</label>
			<select
				id={`${elementId}-asset`}
				className="w-full border-none bg-slate-200/60 px-1 py-0.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:outline-none focus:inset-shadow-[0_0_0_1px_#67e8f9]"
				value={value}
				disabled={!systemId || assetsQuery.isPending}
				onChange={(event) =>
					updateElementProps(elementId, {
						[assetIdProp]: event.currentTarget.value,
					})
				}
			>
				<option value="">
					{!systemId
						? "No linked system"
						: assetsQuery.isPending
							? "Loading assets"
							: "No asset"}
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

function IconPicker({
	elementId,
	label,
	value,
}: {
	elementId: string;
	label: string;
	value: string;
}) {
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const iconsQuery = useQuery({
		...systemIconsQueryOptions(systemId ?? "", projectScope),
		enabled: Boolean(systemId),
	});
	const icons = iconsQuery.data?.icons ?? [];

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${elementId}-icon`}>
				{label}
			</label>
			<select
				id={`${elementId}-icon`}
				className="w-full border-none bg-slate-200/60 px-1 py-0.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_transparent] focus:outline-none focus:inset-shadow-[0_0_0_1px_#67e8f9]"
				value={value}
				disabled={!systemId || iconsQuery.isPending}
				onChange={(event) =>
					updateElementProps(elementId, {
						[iconIdProp]: event.currentTarget.value,
					})
				}
			>
				<option value="">
					{!systemId
						? "No linked system"
						: iconsQuery.isPending
							? "Loading icons"
							: "No icon"}
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

export function Properties() {
	const selectedElement = useSelectedElement();
	const recipeControlTargets = useRecipeControlTargets();

	if (!selectedElement) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-3">
					<Text variant="label" className="text-[13px] text-slate-950">
						Design
					</Text>
				</header>
				<div className="p-3">
					<DesignSystemPicker />
				</div>
			</div>
		);
	}

	const className = selectedElement.props.className ?? "";
	const onChangeClassName = (next: string) =>
		updateElementClassName(selectedElement.id, next);
	const registryResolution = resolveRegistryComponent(
		selectedElement.props["data-trickroom-library"],
		selectedElement.props["data-trickroom-component"],
	);
	const controls =
		registryResolution.status === "known"
			? getControlDefinitions(registryResolution.definition)
			: [];
	const { assetControl, iconControl, componentControls } =
		getPropertiesControlSurface(controls);
	const { contentControls, propertyControls } =
		splitComponentControls(componentControls);
	const hasContentControls =
		selectedElement.role === "text" ||
		Boolean(assetControl) ||
		Boolean(iconControl) ||
		contentControls.length > 0;
	const hasPropertyControls =
		propertyControls.length > 0 || recipeControlTargets.length > 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<InspectorHeader element={selectedElement} />
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
							key={selectedElement.id}
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
							{hasContentControls ? (
								<InspectorSection title="Content">
									{selectedElement.role === "text" ? (
										<InputField
											type="text"
											label="Content"
											value={selectedElement.text}
											onChange={(event) =>
												updateElementText(
													selectedElement.id,
													event.currentTarget.value,
												)
											}
										/>
									) : null}
									{assetControl ? (
										<AssetPicker
											elementId={selectedElement.id}
											label={assetControl.label}
											value={
												typeof selectedElement.props[assetIdProp] === "string"
													? selectedElement.props[assetIdProp]
													: ""
											}
										/>
									) : null}
									{iconControl ? (
										<IconPicker
											elementId={selectedElement.id}
											label={iconControl.label}
											value={
												typeof selectedElement.props[iconIdProp] === "string"
													? selectedElement.props[iconIdProp]
													: ""
											}
										/>
									) : null}
									{contentControls.map((control) => (
										<ComponentControl
											key={control.prop}
											elementId={selectedElement.id}
											control={control}
											value={selectedElement.props[control.prop]}
										/>
									))}
								</InspectorSection>
							) : null}
							{propertyControls.length > 0 ? (
								<InspectorSection title="Component">
									{propertyControls.map((control) => (
										<ComponentControl
											key={control.prop}
											elementId={selectedElement.id}
											control={control}
											value={selectedElement.props[control.prop]}
										/>
									))}
								</InspectorSection>
							) : null}
							{recipeControlTargets.length > 0 ? (
								<InspectorSection title="Recipe">
									{recipeControlTargets.map(({ control, elementId, value }) => (
										<ComponentControl
											key={`${control.path}:${control.prop}`}
											elementId={elementId}
											control={control}
											value={value}
											onChange={(nextValue) => {
												const instanceId =
													selectedElement.props[
														"data-trickroom-recipe-instance"
													];
												if (typeof instanceId === "string") {
													updateRecipeControl(
														instanceId,
														control.path,
														control.prop,
														nextValue,
													);
												}
											}}
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
							{/* TODO: this should become somewhat of a combobox situation, but with tailwind intellisense */}
							<TextareaField
								label="Tailwind classnames"
								value={className}
								onChange={(event) =>
									updateElementClassName(
										selectedElement.id,
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
