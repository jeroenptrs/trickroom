import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Box, Component, Type } from "lucide-react";
import { type ReactNode, useMemo } from "react";
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
import { isLiveAnnotationStatus } from "../../services/annotation-model";
import {
	type DesignEntity,
	designStore,
	selectElement,
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
import {
	editorAnnotationsStore,
	type InspectorTab,
	setInspectorTab,
	useInspectorTab,
} from "../../stores/editor-annotations-store";
import type {
	ControlDefinition,
	JsonPrimitive,
	RecipeControlDefinition,
	RecipeTemplateNode,
} from "../../types";
import { type ClassLayer, createClassLayer } from "../../utils/class-layers";
import { formatShortcut } from "../../utils/editor-shortcuts";
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
import { withTabLocation } from "../../utils/tab-location";
import { DesignAnnotationsPanel } from "../annotations/DesignAnnotationsPanel";
import { useProjectScope } from "../contexts";
import {
	getStageLayerAncestry,
	isSameStageLayerAncestry,
} from "../stage/stage-interaction";
import {
	designLayerTree,
	getDesignLayerName,
} from "../stage/stage-selection-sources";
import { Button } from "../ui/button";
import { InputField } from "../ui/input";
import { KbdHint } from "../ui/kbd-hint";
import { ScrollArea } from "../ui/scroll-area";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
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
import { ClassCompositionPanel } from "./classes/ClassCompositionPanel";
import {
	DesignLintFindingList,
	DesignLintSummary,
	useElementLintFindings,
} from "./DesignLintFindings";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { LayerBreadcrumb } from "./LayerBreadcrumb";
import { errorReason, RetryError } from "./RetryError";
import { TextareaControl } from "./TextareaControl";

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

function getElementSubtitle(element: DesignEntity) {
	return `${element.props["data-trickroom-library"]}/${element.props["data-trickroom-component"]}`;
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
					{getDesignLayerName(element)}
				</span>
				<Text variant="meta" className="truncate text-[10px]">
					{getElementSubtitle(element)}
				</Text>
			</div>
		</header>
	);
}

function DesignLayerBreadcrumb() {
	const crumbs = useSelector(
		designStore,
		(state) => getStageLayerAncestry(designLayerTree(state), state.selectedId),
		{ compare: isSameStageLayerAncestry },
	);
	return <LayerBreadcrumb crumbs={crumbs} onSelect={selectElement} />;
}

/**
 * Annotations on the selection as the rail counts them (a board counts its
 * layers'), or every live one in the design with nothing selected.
 */
function useSelectionAnnotationCount() {
	const selection = useSelector(designStore, (state) => {
		const id = state.selectedId;
		if (!id) return null;
		return state.entitiesById[id]?.parentId === null ? `board:${id}` : id;
	});
	return useSelector(editorAnnotationsStore, (state) => {
		if (selection === null) {
			return Object.values(state.byId).filter((annotation) =>
				isLiveAnnotationStatus(annotation.status),
			).length;
		}
		return selection.startsWith("board:")
			? (state.markers.boards[selection.slice(6)]?.count ?? 0)
			: (state.markers.layers[selection]?.count ?? 0);
	});
}

/**
 * The inspector's two tabs: the layer's (or design's) properties, and its
 * annotations. Pins, rail markers and the command menu switch to the
 * Annotations tab through `editorAnnotationsStore`.
 */
function InspectorTabs({
	designId,
	children,
}: {
	designId?: string;
	children: ReactNode;
}) {
	const tab = useInspectorTab();
	const count = useSelectionAnnotationCount();
	if (!designId) {
		return children;
	}
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
					{count > 0 ? <span className="text-xs">{count}</span> : null}
				</TabsTab>
			</TabsList>
			<TabsPanel value="properties" className="flex min-h-0 flex-1 flex-col">
				{children}
			</TabsPanel>
			<TabsPanel value="annotations" className="flex min-h-0 flex-1 flex-col">
				<DesignAnnotationsPanel designId={designId} />
			</TabsPanel>
		</Tabs>
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
					src={withTabLocation(
						`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(value)}/file`,
					)}
					alt={selectedAsset?.name ?? value}
					className="h-16 w-full bg-slate-100 object-contain object-left"
				/>
			) : null}
			{systemId && assetsQuery.isLoading ? (
				<Skeleton className="h-5 w-full" />
			) : systemId && assetsQuery.isError ? (
				<RetryError
					message="Assets not loaded"
					reason={errorReason(assetsQuery.error)}
					retrying={assetsQuery.isFetching}
					onRetry={() => void assetsQuery.refetch()}
				/>
			) : (
				<Select
					id={`${elementId}-asset`}
					value={value}
					disabled={!systemId}
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
					<option value="">{!systemId ? "No system" : "No asset"}</option>
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
						src={withTabLocation(
							`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(value)}/svg`,
						)}
						alt={selectedIcon?.name ?? value}
						className="size-5 shrink-0 object-contain"
					/>
					<span className="truncate text-slate-600">
						{selectedIcon?.name ?? value}
					</span>
				</div>
			) : null}
			{systemId && iconsQuery.isLoading ? (
				<Skeleton className="h-5 w-full" />
			) : systemId && iconsQuery.isError ? (
				<RetryError
					message="Icons not loaded"
					reason={errorReason(iconsQuery.error)}
					retrying={iconsQuery.isFetching}
					onRetry={() => void iconsQuery.refetch()}
				/>
			) : (
				<Select
					id={`${elementId}-icon`}
					value={value}
					disabled={!systemId}
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
					<option value="">{!systemId ? "No system" : "No icon"}</option>
					{icons.map((icon) => (
						<option key={icon.id} value={icon.id}>
							{icon.name}
						</option>
					))}
				</Select>
			)}
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

const KBD_MAP: readonly { key: string; label: string }[] = [
	{ key: "F", label: "Add container" },
	{ key: "T", label: "Add text" },
	{ key: "A", label: "Add layer" },
	{ key: ".", label: "Repeat last layer" },
	{ key: `${formatShortcut(["Alt"])} + add`, label: "Insert inside" },
	{ key: `${formatShortcut(["Shift"])} + add`, label: "Insert before" },
	{ key: "R", label: "Rename layer" },
	{ key: "Delete", label: "Delete layer" },
	{ key: "J / ↓", label: "Next layer" },
	{ key: "K / ↑", label: "Previous layer" },
	{ key: "L / →", label: "Expand or enter layer" },
	{ key: "H / ←", label: "Collapse or exit layer" },
	{ key: "Enter", label: "Select first child" },
	{ key: formatShortcut(["Shift", "Enter"]), label: "Select parent" },
	{ key: "Home / End", label: "First or last layer" },
	{ key: formatShortcut(["Mod", "Shift", "↑ / ↓"]), label: "Move layer" },
	{ key: formatShortcut(["Mod", "K"]), label: "Command menu" },
	{ key: formatShortcut(["Mod", "S"]), label: "Save" },
	{ key: formatShortcut(["Alt", "1 / 2 / 3"]), label: "Focus panel" },
	{ key: formatShortcut(["Alt", "["]), label: "Toggle layers panel" },
	{ key: formatShortcut(["Alt", "]"]), label: "Toggle inspector" },
	{ key: formatShortcut(["Alt", "C"]), label: "Toggle annotation mode" },
	{ key: formatShortcut(["Mod", "["]), label: "Back to project" },
];

function EmptyStateKbdMap() {
	return (
		<div className="flex flex-col gap-1.5">
			<Text variant="group-label" render={<div />}>
				Shortcuts
			</Text>
			<ul className="flex flex-col gap-1">
				{KBD_MAP.map(({ key, label }) => (
					<li key={key}>
						<KbdHint keys={key} label={label} />
					</li>
				))}
			</ul>
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
				<InspectorTabs designId={designId}>
					<ScrollArea className="min-h-0 flex-1">
						<div className="flex flex-col gap-4 p-3">
							<StagePreviewDarkModeToggle />
							<DesignSystemPicker />
							{designId ? <DesignLintSummary designId={designId} /> : null}
							<Text variant="meta" render={<p />}>
								Turn on Select to select layers on the canvas.
							</Text>
							<EmptyStateKbdMap />
						</div>
					</ScrollArea>
				</InspectorTabs>
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
			<DesignLayerBreadcrumb />
			<InspectorTabs designId={designId}>
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
									label={classOverride ? "This instance" : "This layer"}
									onChangeClassName={onChangeClassName}
								/>
							) : (
								<Text variant="meta" render={<p />}>
									This layer belongs to a component. Its classes can't be
									changed on an instance.
								</Text>
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
										label="Text"
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
							<InspectorSection title="Element">
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
			</InspectorTabs>
		</div>
	);
}
