import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Box, Component, Type } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
	getControlDefinitions,
	getRenderableClassComposition,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { systemAssetsQueryOptions } from "../../queries/system-assets";
import { systemComponentQueryOptions } from "../../queries/system-components";
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
	setSystemComponentOverrideAssetId,
	setSystemComponentOverrideClassName,
	setSystemComponentOverrideIconId,
	setSystemComponentOverrideText,
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
	RecipeTemplateNode,
} from "../../types";
import type { ClassLayer } from "../../utils/class-layers";
import { useWindowKeyDown } from "../../utils/editor-shortcuts";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import type { SystemComponentInstanceOverrides } from "../../utils/system-component-markers";
import {
	findOverrideTargetForCapability,
	readSystemComponentOverrideValue,
} from "../../utils/system-component-override-targets";
import {
	resolveSystemComponentClassComposition,
	resolveSystemComponentVariantValues,
} from "../../utils/system-component-resolution";
import type {
	PublishedSystemComponentVersion,
	SystemComponentOverrideCapability,
} from "../../utils/system-components";
import { useProjectScope } from "../contexts";
import { Button } from "../ui/button";
import { InputField, TextareaField } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import {
	AttachedComponentProperties,
	useAttachedComponentInspection,
} from "./AttachedComponentProperties";
import {
	canFreelyEditElementInDesignInspector,
	getPublishedVersionForInstance,
} from "./attached-component-inspector";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { BackgroundProperties } from "./properties/BackgroundProperties";
import { BorderProperties } from "./properties/BorderProperties";
import { ClassInventoryPanel } from "./properties/ClassInventoryPanel";
import { DomainCustomUtilities } from "./properties/DomainCustomUtilities";
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

type PropertiesTab = "style" | "properties" | "classes";
const PROPERTIES_TABS: PropertiesTab[] = ["style", "properties", "classes"];

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

export function splitComponentControls(controls: ControlDefinition[]) {
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
	onChange,
}: {
	elementId: string;
	label: string;
	value: string;
	onChange?: (assetId: string) => void;
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
					(
						onChange ??
						((assetId) =>
							updateElementProps(elementId, {
								[assetIdProp]: assetId,
							}))
					)(event.currentTarget.value)
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
	onChange,
}: {
	elementId: string;
	label: string;
	value: string;
	onChange?: (iconId: string) => void;
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
					(
						onChange ??
						((iconId) =>
							updateElementProps(elementId, {
								[iconIdProp]: iconId,
							}))
					)(event.currentTarget.value)
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

function ReadOnlyInspectorNotice({ message }: { message: string }) {
	return <div className="px-3 py-3 text-xs text-slate-500">{message}</div>;
}

type AttachedComponentOverrideBinding = {
	rootElementId: string;
	version: PublishedSystemComponentVersion;
	targetId: string;
	targetPath: string;
	capability: SystemComponentOverrideCapability;
	value: string;
};

function useAttachedComponentOverrideBindings(
	inspection: ReturnType<typeof useAttachedComponentInspection>,
) {
	const systemId = useDesignSystemId();
	const projectScope = useProjectScope();
	const componentId =
		inspection.kind === "root" || inspection.kind === "owned-internal"
			? inspection.instance.componentId
			: null;
	const componentQuery = useQuery({
		...systemComponentQueryOptions(
			systemId ?? "",
			componentId ?? "",
			projectScope,
		),
		enabled: Boolean(systemId && componentId),
	});

	return useMemo(() => {
		const empty = {
			className: null,
			text: null,
			icon: null,
			asset: null,
		} satisfies Record<
			SystemComponentOverrideCapability,
			AttachedComponentOverrideBinding | null
		>;

		if (inspection.kind !== "root" && inspection.kind !== "owned-internal") {
			return empty;
		}

		const version = getPublishedVersionForInstance(
			componentQuery.data?.record,
			inspection.instance.version,
		);
		if (!version) {
			return empty;
		}

		const templatePath =
			inspection.kind === "root" ? "root" : inspection.templatePath;
		const resolveBinding = (
			capability: SystemComponentOverrideCapability,
		): AttachedComponentOverrideBinding | null => {
			const target = findOverrideTargetForCapability(
				version,
				templatePath,
				capability,
			);
			if (!target) {
				return null;
			}
			return {
				rootElementId: inspection.rootElementId,
				version,
				targetId: target.targetId,
				targetPath: target.path,
				capability,
				value:
					readSystemComponentOverrideValue(
						inspection.instance.overrides,
						target.targetId,
						capability,
					) ?? "",
			};
		};

		return {
			className: resolveBinding("className"),
			text: resolveBinding("text"),
			icon: resolveBinding("icon"),
			asset: resolveBinding("asset"),
		};
	}, [componentQuery.data?.record, inspection]);
}

function getTemplateClassName(
	version: PublishedSystemComponentVersion,
	path: string,
): string | undefined {
	const visit = (node: RecipeTemplateNode): string | undefined => {
		if (node.path === path) {
			return node.className;
		}
		for (const child of node.children ?? []) {
			const className = visit(child);
			if (className !== undefined) {
				return className;
			}
		}
		return undefined;
	};

	return visit(version.root);
}

export function resolveAttachedComponentClassInventoryLayers({
	version,
	targetPath,
	variantValues,
	overrides,
	context,
}: {
	version: PublishedSystemComponentVersion;
	targetPath: string;
	variantValues: Record<string, string>;
	overrides?: SystemComponentInstanceOverrides;
	context?: {
		systemId?: string;
		componentId?: string;
		instanceId?: string;
	};
}): readonly ClassLayer[] {
	return resolveSystemComponentClassComposition(
		version,
		targetPath,
		getTemplateClassName(version, targetPath),
		resolveSystemComponentVariantValues(version.variants, variantValues),
		overrides ?? {},
		context,
	).layers;
}

function StyleClassControls({
	className,
	onChange,
	elementId,
}: {
	className: string;
	onChange: (next: string) => void;
	elementId: string;
}) {
	return (
		<div key={elementId} className="flex flex-col divide-y divide-slate-200">
			<LayoutProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="layout" />
			<SizeProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="size" />
			<StyleSection title="Spacing">
				<SpacingProperties className={className} onChange={onChange} />
			</StyleSection>
			<DomainCustomUtilities className={className} domain="spacing" />
			<TypographyProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="typography" />
			<BackgroundProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="background" />
			<BorderProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="border" />
			<EffectsProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="effects" />
			<FocusProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="focus" />
			<PositionProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="position" />
			<TransformProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="transform" />
			<MotionProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="motion" />
			<VectorProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="vector" />
			<StructureProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="structure" />
			<MaskProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="mask" />
			<InteractionProperties className={className} onChange={onChange} />
			<DomainCustomUtilities className={className} domain="interaction" />
		</div>
	);
}

export function Properties() {
	const selectedElement = useSelectedElement();
	const [activeTab, setActiveTab] = useState<PropertiesTab>("properties");
	const recipeControlTargets = useRecipeControlTargets();
	const attachedInspection = useAttachedComponentInspection();
	const overrideBindings =
		useAttachedComponentOverrideBindings(attachedInspection);
	const classOverride = overrideBindings.className;
	const canFreelyEdit = useSelector(designStore, (state) =>
		canFreelyEditElementInDesignInspector(state.entitiesById, selectedElement),
	);
	const handlePropertiesTabShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.key !== "Tab"
			) {
				return;
			}

			const currentIndex = PROPERTIES_TABS.indexOf(activeTab);
			const direction = event.shiftKey ? -1 : 1;
			const nextIndex =
				(currentIndex + direction + PROPERTIES_TABS.length) %
				PROPERTIES_TABS.length;
			setActiveTab(PROPERTIES_TABS[nextIndex] ?? "properties");
			event.preventDefault();
		},
		[activeTab],
	);

	useWindowKeyDown(handlePropertiesTabShortcut, {
		enabled: selectedElement !== null,
	});

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

	const className = classOverride
		? classOverride.value
		: (selectedElement.props.className ?? "");
	const canEditClassName = canFreelyEdit || classOverride !== null;
	const onChangeClassName = classOverride
		? (next: string) =>
				setSystemComponentOverrideClassName(
					classOverride.rootElementId,
					classOverride.version,
					classOverride.targetId,
					next,
				)
		: canFreelyEdit
			? (next: string) => updateElementClassName(selectedElement.id, next)
			: () => {};
	const textOverride = overrideBindings.text;
	const iconOverride = overrideBindings.icon;
	const assetOverride = overrideBindings.asset;
	const hasAttachedComponentContext = attachedInspection.kind !== "none";
	const registryResolution = resolveRegistryComponent(
		selectedElement.props["data-trickroom-library"],
		selectedElement.props["data-trickroom-component"],
	);
	const controls =
		registryResolution.status === "known"
			? getControlDefinitions(registryResolution.definition)
			: [];
	const classInventoryLayers: readonly ClassLayer[] | undefined = classOverride
		? resolveAttachedComponentClassInventoryLayers({
				version: classOverride.version,
				targetPath: classOverride.targetPath,
				variantValues:
					attachedInspection.kind === "root" ||
					attachedInspection.kind === "owned-internal"
						? attachedInspection.instance.variantValues
						: {},
				overrides:
					attachedInspection.kind === "root" ||
					attachedInspection.kind === "owned-internal"
						? attachedInspection.instance.overrides
						: {},
				context: {
					systemId:
						attachedInspection.kind === "root" ||
						attachedInspection.kind === "owned-internal"
							? attachedInspection.instance.systemId
							: undefined,
					componentId:
						attachedInspection.kind === "root" ||
						attachedInspection.kind === "owned-internal"
							? attachedInspection.instance.componentId
							: undefined,
					instanceId:
						attachedInspection.kind === "root" ||
						attachedInspection.kind === "owned-internal"
							? attachedInspection.instance.instanceId
							: undefined,
				},
			})
		: registryResolution.status === "known"
			? getRenderableClassComposition(
					selectedElement.props,
					registryResolution.definition,
				).layers
			: undefined;
	const { assetControl, iconControl, componentControls } =
		getPropertiesControlSurface(controls);
	const { contentControls, propertyControls } =
		splitComponentControls(componentControls);
	const hasContentControls =
		(canFreelyEdit &&
			(selectedElement.role === "text" ||
				Boolean(assetControl) ||
				Boolean(iconControl) ||
				contentControls.length > 0)) ||
		textOverride !== null ||
		iconOverride !== null ||
		assetOverride !== null;
	const hasPropertyControls =
		canFreelyEdit &&
		(propertyControls.length > 0 || recipeControlTargets.length > 0);
	const hasRegistryPropertyControls =
		canFreelyEdit && (hasContentControls || hasPropertyControls);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<InspectorHeader element={selectedElement} />
			<Tabs
				value={activeTab}
				onValueChange={(value) => setActiveTab(value as PropertiesTab)}
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
				<TabsPanel value="style" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						{!canFreelyEdit ? (
							!canEditClassName ? (
								<ReadOnlyInspectorNotice message="Component-owned layers are structurally locked. This layer has no published className override." />
							) : (
								<StyleClassControls
									className={className}
									onChange={onChangeClassName}
									elementId={selectedElement.id}
								/>
							)
						) : (
							<StyleClassControls
								className={className}
								onChange={onChangeClassName}
								elementId={selectedElement.id}
							/>
						)}
					</ScrollArea>
				</TabsPanel>
				<TabsPanel value="properties" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="flex flex-col divide-y divide-slate-200">
							{hasAttachedComponentContext ? (
								<AttachedComponentProperties inspection={attachedInspection} />
							) : null}
							{hasContentControls ? (
								<InspectorSection title="Content">
									{(canFreelyEdit && selectedElement.role === "text") ||
									textOverride ? (
										<InputField
											type="text"
											label="Content"
											value={
												textOverride ? textOverride.value : selectedElement.text
											}
											onChange={(event) => {
												const next = event.currentTarget.value;
												if (textOverride) {
													setSystemComponentOverrideText(
														textOverride.rootElementId,
														textOverride.version,
														textOverride.targetId,
														next,
													);
													return;
												}
												updateElementText(selectedElement.id, next);
											}}
										/>
									) : null}
									{(canFreelyEdit && assetControl) || assetOverride ? (
										<AssetPicker
											elementId={selectedElement.id}
											label={assetControl?.label ?? "Asset"}
											value={
												assetOverride
													? assetOverride.value
													: typeof selectedElement.props[assetIdProp] ===
															"string"
														? selectedElement.props[assetIdProp]
														: ""
											}
											onChange={
												assetOverride
													? (assetId) =>
															setSystemComponentOverrideAssetId(
																assetOverride.rootElementId,
																assetOverride.version,
																assetOverride.targetId,
																assetId,
															)
													: undefined
											}
										/>
									) : null}
									{(canFreelyEdit && iconControl) || iconOverride ? (
										<IconPicker
											elementId={selectedElement.id}
											label={iconControl?.label ?? "Icon"}
											value={
												iconOverride
													? iconOverride.value
													: typeof selectedElement.props[iconIdProp] ===
															"string"
														? selectedElement.props[iconIdProp]
														: ""
											}
											onChange={
												iconOverride
													? (iconId) =>
															setSystemComponentOverrideIconId(
																iconOverride.rootElementId,
																iconOverride.version,
																iconOverride.targetId,
																iconId,
															)
													: undefined
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
							{canFreelyEdit && propertyControls.length > 0 ? (
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
							{canFreelyEdit && recipeControlTargets.length > 0 ? (
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
							{!hasAttachedComponentContext && !hasRegistryPropertyControls ? (
								<div className="px-3 py-3 text-xs text-slate-500">
									No editable properties
								</div>
							) : null}
						</div>
					</ScrollArea>
				</TabsPanel>
				<TabsPanel value="classes" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						{!canFreelyEdit ? (
							!canEditClassName ? (
								<ReadOnlyInspectorNotice message="Direct class editing is locked for component-owned layers. This layer has no published className override." />
							) : (
								<div className="flex flex-col gap-3 p-3">
									<TextareaField
										label="Tailwind classnames"
										value={className}
										onChange={(event) =>
											onChangeClassName(event.currentTarget.value)
										}
									/>
									<ClassInventoryPanel
										className={className}
										layers={classInventoryLayers}
									/>
								</div>
							)
						) : (
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
								<ClassInventoryPanel
									className={className}
									layers={classInventoryLayers}
								/>
							</div>
						)}
					</ScrollArea>
				</TabsPanel>
			</Tabs>
		</div>
	);
}
