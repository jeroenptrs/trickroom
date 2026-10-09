import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Box, Component, Type } from "lucide-react";
import { Fragment, type ReactNode, useMemo } from "react";
import {
	getControlDefinitions,
	getRenderableClassComposition,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { StagePreviewDarkModeToggle } from "../../preview/stage-preview-dark-mode";
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
	setSystemComponentOverrideProp,
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
import { type ClassLayer, createClassLayer } from "../../utils/class-layers";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import type { SystemComponentInstanceOverrides } from "../../utils/system-component-markers";
import {
	findOverrideTargetForCapability,
	readSystemComponentOverrideValue,
	readSystemComponentPropOverrideValue,
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
import { InputField } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { ScrollArea } from "../ui/scroll-area";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import {
	AttachedComponentProperties,
	useAttachedComponentInspection,
} from "./AttachedComponentProperties";
import {
	canFreelyEditElementInDesignInspector,
	getPublishedVersionForInstance,
} from "./attached-component-inspector";
import { ClassCompositionPanel } from "./classes/ClassCompositionPanel";
import {
	DesignLintFindingList,
	DesignLintSummary,
	useElementLintFindings,
} from "./DesignLintFindings";
import { DesignSystemPicker } from "./DesignSystemPicker";

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
				<Switch
					id={`${elementId}-${control.prop}`}
					checked={value === true}
					onCheckedChange={(checked) => updateValue(checked)}
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
	const selectedAsset = assets.find((a) => a.id === value);

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${elementId}-asset`}>
				{label}
			</label>
			{systemId && value ? (
				<img
					src={`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(value)}/file`}
					alt={selectedAsset?.name ?? value}
					className="h-16 w-full bg-slate-100 object-contain object-left"
				/>
			) : null}
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
	const selectedIcon = icons.find((i) => i.id === value);

	return (
		<div className="flex flex-col gap-1 text-xs">
			<label className="font-semibold" htmlFor={`${elementId}-icon`}>
				{label}
			</label>
			{systemId && value ? (
				<div className="flex items-center gap-2">
					<img
						src={`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(value)}/svg`}
						alt={selectedIcon?.name ?? value}
						className="size-5 shrink-0 object-contain"
					/>
					<span className="truncate text-slate-600">
						{selectedIcon?.name ?? value}
					</span>
				</div>
			) : null}
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

type AttachedComponentOverrideBinding = {
	rootElementId: string;
	version: PublishedSystemComponentVersion;
	targetId: string;
	targetPath: string;
	capability: SystemComponentOverrideCapability;
	value: string;
};

type AttachedComponentPropOverrideBinding = {
	rootElementId: string;
	version: PublishedSystemComponentVersion;
	targetId: string;
	prop: string;
	value: JsonPrimitive | undefined;
	isOverridden: boolean;
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
			props: {},
		} satisfies Record<
			SystemComponentOverrideCapability,
			AttachedComponentOverrideBinding | null
		> & { props: Record<string, AttachedComponentPropOverrideBinding> };

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

		const props: Record<string, AttachedComponentPropOverrideBinding> = {};
		for (const target of Object.values(version.overrideTargets ?? {})
			.filter((entry) => entry.path === templatePath)
			.sort((left, right) => left.targetId.localeCompare(right.targetId))) {
			for (const prop of target.props ?? []) {
				if (props[prop]) {
					continue;
				}
				const value = readSystemComponentPropOverrideValue(
					inspection.instance.overrides,
					target.targetId,
					prop,
				);
				props[prop] = {
					rootElementId: inspection.rootElementId,
					version,
					targetId: target.targetId,
					prop,
					value,
					isOverridden: value !== undefined,
				};
			}
		}

		return {
			className: resolveBinding("className"),
			text: resolveBinding("text"),
			icon: resolveBinding("icon"),
			asset: resolveBinding("asset"),
			props,
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
	baseClassName,
	context,
}: {
	version: PublishedSystemComponentVersion;
	targetPath: string;
	variantValues: Record<string, string>;
	overrides?: SystemComponentInstanceOverrides;
	/**
	 * The registry Element's base classes: the lowest layer, which the
	 * component classes and the override merge over.
	 */
	baseClassName?: string;
	context?: {
		systemId?: string;
		componentId?: string;
		instanceId?: string;
	};
}): readonly ClassLayer[] {
	// An instance can record a value its version does not have (the design
	// lint rule design.unknown-variant-value reports it); resolve the classes
	// as if that axis were unset rather than failing the whole inspector.
	const axes = version.variants?.axes ?? {};
	const knownValues = Object.fromEntries(
		Object.entries(variantValues).filter(
			([axis, value]) =>
				Object.hasOwn(axes, axis) && Object.hasOwn(axes[axis].values, value),
		),
	);
	const { layers } = resolveSystemComponentClassComposition(
		version,
		targetPath,
		getTemplateClassName(version, targetPath),
		resolveSystemComponentVariantValues(version.variants, knownValues),
		overrides ?? {},
		context,
	);
	const base = createClassLayer("registry-base", baseClassName, context);
	return base ? [base, ...layers] : layers;
}

const KBD_MAP = [
	{ key: "F", label: "Add frame" },
	{ key: "T", label: "Add text" },
	{ key: "A", label: "Add element" },
	{ key: ".", label: "Repeat last" },
	{ key: "R", label: "Rename layer" },
	{ key: "Del", label: "Delete layer" },
	{ key: "J / ↓", label: "Next layer" },
	{ key: "K / ↑", label: "Prev layer" },
	{ key: "L / →", label: "Enter layer" },
	{ key: "H / ←", label: "Exit layer" },
	{ key: "⌥ [", label: "Toggle layers" },
	{ key: "⌥ ]", label: "Toggle properties" },
] as const;

function EmptyStateKbdMap() {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[11px] font-semibold text-slate-700">
				Shortcuts
			</span>
			<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{KBD_MAP.map(({ key, label }) => (
					<Fragment key={key}>
						<Kbd>{key}</Kbd>
						<span className="text-[11px] text-slate-500">{label}</span>
					</Fragment>
				))}
			</div>
		</div>
	);
}

export function Properties({ designId }: { designId?: string } = {}) {
	const selectedElement = useSelectedElement();
	const lintFindings = useElementLintFindings(
		designId,
		selectedElement?.id ?? null,
	);
	const systemId = useDesignSystemId() ?? null;
	const recipeControlTargets = useRecipeControlTargets();
	const attachedInspection = useAttachedComponentInspection();
	const overrideBindings =
		useAttachedComponentOverrideBindings(attachedInspection);
	const classOverride = overrideBindings.className;
	const canFreelyEdit = useSelector(designStore, (state) =>
		canFreelyEditElementInDesignInspector(state.entitiesById, selectedElement),
	);
	if (!selectedElement) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-3">
					<Text variant="label" className="text-[13px] text-slate-950">
						Design
					</Text>
				</header>
				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col gap-4 p-3">
						<StagePreviewDarkModeToggle />
						<DesignSystemPicker />
						{designId ? <DesignLintSummary designId={designId} /> : null}
						<EmptyStateKbdMap />
					</div>
				</ScrollArea>
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
	const propOverrideBindings = overrideBindings.props;
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
				baseClassName:
					registryResolution.status === "known"
						? registryResolution.definition.baseClassName
						: undefined,
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
	const visibleContentControls = canFreelyEdit
		? contentControls
		: contentControls.filter((control) => propOverrideBindings[control.prop]);
	const visiblePropertyControls = canFreelyEdit
		? propertyControls
		: propertyControls.filter((control) => propOverrideBindings[control.prop]);
	const hasContentControls =
		(canFreelyEdit &&
			(selectedElement.role === "text" ||
				Boolean(assetControl) ||
				Boolean(iconControl) ||
				contentControls.length > 0)) ||
		textOverride !== null ||
		iconOverride !== null ||
		assetOverride !== null ||
		visibleContentControls.length > 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<InspectorHeader element={selectedElement} />
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col divide-y divide-slate-200">
					{lintFindings.length > 0 ? (
						<InspectorSection title="Lint">
							<DesignLintFindingList findings={lintFindings} />
						</InspectorSection>
					) : null}
					<InspectorSection
						title={classOverride ? "Instance classes" : "Classes"}
					>
						{canEditClassName ? (
							<ClassCompositionPanel
								// Keyed per layer so an open draft never carries across selections.
								key={selectedElement.id}
								className={className}
								layers={classInventoryLayers}
								systemId={systemId}
								label={classOverride ? "Instance" : "Classes"}
								onChangeClassName={onChangeClassName}
							/>
						) : (
							<p className="text-xs text-slate-500">
								Class editing is locked for component-owned layers. This layer
								has no published className override.
							</p>
						)}
					</InspectorSection>
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
											: typeof selectedElement.props[assetIdProp] === "string"
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
											: typeof selectedElement.props[iconIdProp] === "string"
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
							{visibleContentControls.map((control) => {
								const binding = propOverrideBindings[control.prop];
								return (
									<div key={control.prop} className="flex flex-col gap-1">
										<ComponentControl
											elementId={selectedElement.id}
											control={control}
											value={
												binding?.isOverridden
													? binding.value
													: selectedElement.props[control.prop]
											}
											onChange={
												binding
													? (value) =>
															setSystemComponentOverrideProp(
																binding.rootElementId,
																binding.version,
																binding.targetId,
																binding.prop,
																value,
															)
													: undefined
											}
										/>
										{binding?.isOverridden ? (
											<button
												type="button"
												className="self-end text-[11px] text-slate-500 hover:text-slate-900"
												onClick={() =>
													setSystemComponentOverrideProp(
														binding.rootElementId,
														binding.version,
														binding.targetId,
														binding.prop,
														undefined,
													)
												}
											>
												Reset
											</button>
										) : null}
									</div>
								);
							})}
						</InspectorSection>
					) : null}
					{visiblePropertyControls.length > 0 ? (
						<InspectorSection title="Component">
							{visiblePropertyControls.map((control) => {
								const binding = propOverrideBindings[control.prop];
								return (
									<div key={control.prop} className="flex flex-col gap-1">
										<ComponentControl
											elementId={selectedElement.id}
											control={control}
											value={
												binding?.isOverridden
													? binding.value
													: selectedElement.props[control.prop]
											}
											onChange={
												binding
													? (value) =>
															setSystemComponentOverrideProp(
																binding.rootElementId,
																binding.version,
																binding.targetId,
																binding.prop,
																value,
															)
													: undefined
											}
										/>
										{binding?.isOverridden ? (
											<button
												type="button"
												className="self-end text-[11px] text-slate-500 hover:text-slate-900"
												onClick={() =>
													setSystemComponentOverrideProp(
														binding.rootElementId,
														binding.version,
														binding.targetId,
														binding.prop,
														undefined,
													)
												}
											>
												Reset
											</button>
										) : null}
									</div>
								);
							})}
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
											selectedElement.props["data-trickroom-recipe-instance"];
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
				</div>
			</ScrollArea>
		</div>
	);
}
