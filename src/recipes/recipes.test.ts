import { describe, expect, it } from "vitest";
import baseUiRecipes from "../libraries/base-ui/recipes";
import {
	CORE_PROP_KEYS,
	getComponentIds,
	getControlProps,
	getDefaultProps,
	getRecipe,
	getRecipeIds,
	getRenderableClassComposition,
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
	resolveRegistryRecipe,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import {
	applyAddElement,
	applyUpdateElementProps,
	DesignTransformError,
} from "../services/design-transform-service";
import type {
	Node,
	RecipeDefinition,
	RecipeSlotDefinition,
	TrickroomDesign,
} from "../types";
import { assetIdProp } from "../utils/resource-props";
import { detachRecipeInstance } from "./detach";
import { expandRecipeDefinition, expandRegistryRecipe } from "./expansion";
import { installAvatarLegacyPreviousTemplate } from "./legacy-avatar-template";
import {
	getRecipeMarkerProps,
	getRecipeStructuralMetadata,
	omitRecipeMarkerProps,
	RECIPE_MARKER_PROP_KEYS,
	recipeIdProp,
	recipeInstanceProp,
	recipePathProp,
	recipeRootProp,
	recipeSlotProp,
} from "./markers";
import { RecipeMigrationError, updateStaleRecipeInstance } from "./migration";
import {
	canDeleteElementAcrossRecipeBoundary,
	canInsertIntoRecipeBoundary,
	canMoveElementAcrossRecipeBoundary,
	collectRecipeInstanceNodes,
	findRecipeRootNode,
	getContainingRecipeSlot,
	getRecipeInstanceMetadata,
	getRecipeOwnedStructuralIds,
	getRecipeSlotName,
	isRecipeOwnedStructuralNode,
	isRecipeRoot,
	isRecipeSlotContent,
	isRecipeSlotHost,
	type RecipeBoundaryEntityMap,
} from "./ownership";
import {
	describeRecipeSlotChildRef,
	isRecipeSlotChildAllowed,
} from "./slot-allowlist";
import { validateRecipeInstances } from "./validation";

const emptyDesign = {
	name: "Recipe Test",
	boards: [],
} satisfies TrickroomDesign;

const flatten = (
	node: Node,
	parentId: string | null,
	entities: RecipeBoundaryEntityMap,
) => {
	entities[node.id] = {
		id: node.id,
		props: node.props,
		parentId,
		childIds: Array.isArray(node.children)
			? node.children.map((child) => child.id)
			: [],
	};

	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			flatten(child, node.id, entities);
		}
	}

	return entities;
};

const recipeMarkerProps = [...RECIPE_MARKER_PROP_KEYS];

const baseContainerProps = {
	"data-trickroom-name": "Container",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
} satisfies Node["props"];

const separatorBaseClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

const expectNoRecipeMarkers = (node: Node) => {
	for (const key of recipeMarkerProps) {
		expect(node.props).not.toHaveProperty(key);
	}
};

const withAvatarLegacyPreviousTemplate = (fn: () => void) => {
	const restoreAvatarLegacyPreviousTemplate =
		installAvatarLegacyPreviousTemplate();
	try {
		fn();
	} finally {
		restoreAvatarLegacyPreviousTemplate();
	}
};

const expandAvatarRecipe = (instanceId = "recipe-instance-1") => {
	const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
	return expandRegistryRecipe("base-ui", "avatar.default", {
		createRecipeInstanceId: () => instanceId,
		createElementId: () => {
			const id = ids.shift();
			if (!id) throw new Error("missing test id");
			return id;
		},
	});
};

const expandSeparatorRecipe = (instanceId = "separator-recipe-instance") => {
	const ids = [
		"separator-recipe-root",
		"separator-recipe-separator",
		"separator-recipe-menu-separator",
	];
	const recipe: RecipeDefinition = {
		id: "test/separator-components",
		label: "Separator Components",
		version: 1,
		root: {
			path: "root",
			library: "trickroom",
			component: "container",
			children: [
				{
					path: "separator",
					library: "base-ui",
					component: "separator",
					props: { className: "authored-separator" },
				},
				{
					path: "menu-separator",
					library: "base-ui",
					component: "menu.separator",
					props: { className: "authored-menu-separator" },
				},
			],
		},
	};

	return expandRecipeDefinition(recipe, {
		createRecipeInstanceId: () => instanceId,
		createElementId: () => {
			const id = ids.shift();
			if (!id) {
				throw new Error("missing separator test id");
			}
			return id;
		},
	});
};

describe("recipe system foundation", () => {
	it("keeps existing component registry behavior while adding Avatar parts", () => {
		expect(getComponentIds("trickroom")).toEqual([
			"asset",
			"container",
			"icon",
			"text",
		]);
		expect(getComponentIds("base-ui")).toEqual([
			"accordion.header",
			"accordion.item",
			"accordion.panel",
			"accordion.root",
			"accordion.trigger",
			"alert-dialog.backdrop",
			"alert-dialog.close",
			"alert-dialog.description",
			"alert-dialog.popup",
			"alert-dialog.portal",
			"alert-dialog.root",
			"alert-dialog.title",
			"alert-dialog.trigger",
			"alert-dialog.viewport",
			"avatar.fallback",
			"avatar.image",
			"avatar.root",
			"button",
			"checkbox-group",
			"checkbox.indicator",
			"checkbox.root",
			"collapsible.panel",
			"collapsible.root",
			"collapsible.trigger",
			"combobox.arrow",
			"combobox.backdrop",
			"combobox.chip",
			"combobox.chip-remove",
			"combobox.chips",
			"combobox.clear",
			"combobox.empty",
			"combobox.group",
			"combobox.group-label",
			"combobox.icon",
			"combobox.input",
			"combobox.input-group",
			"combobox.item",
			"combobox.item-indicator",
			"combobox.label",
			"combobox.list",
			"combobox.popup",
			"combobox.portal",
			"combobox.positioner",
			"combobox.root",
			"combobox.row",
			"combobox.separator",
			"combobox.status",
			"combobox.trigger",
			"combobox.value",
			"context-menu.item",
			"context-menu.popup",
			"context-menu.portal",
			"context-menu.positioner",
			"context-menu.root",
			"context-menu.separator",
			"context-menu.trigger",
			"dialog.backdrop",
			"dialog.close",
			"dialog.description",
			"dialog.popup",
			"dialog.portal",
			"dialog.root",
			"dialog.title",
			"dialog.trigger",
			"dialog.viewport",
			"drawer.backdrop",
			"drawer.close",
			"drawer.content",
			"drawer.description",
			"drawer.indent",
			"drawer.indent-background",
			"drawer.popup",
			"drawer.portal",
			"drawer.provider",
			"drawer.root",
			"drawer.swipe-area",
			"drawer.title",
			"drawer.trigger",
			"drawer.viewport",
			"field.control",
			"field.description",
			"field.error",
			"field.item",
			"field.label",
			"field.root",
			"fieldset.legend",
			"fieldset.root",
			"form",
			"input",
			"menu.item",
			"menu.popup",
			"menu.portal",
			"menu.positioner",
			"menu.root",
			"menu.separator",
			"menu.trigger",
			"menubar",
			"meter.indicator",
			"meter.label",
			"meter.root",
			"meter.track",
			"meter.value",
			"number-field.decrement",
			"number-field.group",
			"number-field.increment",
			"number-field.input",
			"number-field.root",
			"number-field.scrub-area",
			"number-field.scrub-area-cursor",
			"otp-field.input",
			"otp-field.root",
			"popover.arrow",
			"popover.backdrop",
			"popover.close",
			"popover.description",
			"popover.popup",
			"popover.portal",
			"popover.positioner",
			"popover.root",
			"popover.title",
			"popover.trigger",
			"popover.viewport",
			"preview-card.arrow",
			"preview-card.backdrop",
			"preview-card.popup",
			"preview-card.portal",
			"preview-card.positioner",
			"preview-card.root",
			"preview-card.trigger",
			"preview-card.viewport",
			"progress.indicator",
			"progress.label",
			"progress.root",
			"progress.track",
			"progress.value",
			"radio-group",
			"radio.indicator",
			"radio.root",
			"scroll-area.content",
			"scroll-area.corner",
			"scroll-area.root",
			"scroll-area.scrollbar",
			"scroll-area.thumb",
			"scroll-area.viewport",
			"select.arrow",
			"select.backdrop",
			"select.group",
			"select.group-label",
			"select.icon",
			"select.item",
			"select.item-indicator",
			"select.item-text",
			"select.label",
			"select.list",
			"select.popup",
			"select.portal",
			"select.positioner",
			"select.root",
			"select.scroll-down-arrow",
			"select.scroll-up-arrow",
			"select.separator",
			"select.trigger",
			"select.value",
			"separator",
			"slider.control",
			"slider.indicator",
			"slider.label",
			"slider.root",
			"slider.thumb",
			"slider.track",
			"slider.value",
			"switch.root",
			"switch.thumb",
			"tabs.indicator",
			"tabs.list",
			"tabs.panel",
			"tabs.root",
			"tabs.tab",
			"toggle",
			"toggle-group",
			"toolbar.button",
			"toolbar.group",
			"toolbar.input",
			"toolbar.link",
			"toolbar.root",
			"toolbar.separator",
			"tooltip.arrow",
			"tooltip.popup",
			"tooltip.portal",
			"tooltip.positioner",
			"tooltip.provider",
			"tooltip.root",
			"tooltip.trigger",
		]);

		const separator = resolveRegistryComponent("base-ui", "separator");
		const menuSeparator = resolveRegistryComponent("base-ui", "menu.separator");
		expect(separator).toMatchObject({
			status: "known",
			definition: {
				role: "leaf",
				label: "Separator",
				baseClassName: separatorBaseClassName,
				defaultProps: {
					orientation: "horizontal",
				},
			},
		});
		expect(separator.definition).not.toHaveProperty("className");
		expect(menuSeparator).toMatchObject({
			status: "known",
			definition: {
				role: "leaf",
				label: "Menu Separator",
				baseClassName: separatorBaseClassName,
				defaultProps: {
					orientation: "horizontal",
				},
			},
		});
		expect(menuSeparator.definition).not.toHaveProperty("className");
		expect(separator.definition).toHaveProperty("defaultProps");
		expect(menuSeparator.definition).toHaveProperty("defaultProps");
		expect(getControlProps(separator.definition).orientation).toBe(
			"horizontal",
		);
		expect(getControlProps(menuSeparator.definition).orientation).toBe(
			"horizontal",
		);
		expect(getControlProps(separator.definition)).not.toHaveProperty(
			"className",
		);
		expect(getControlProps(menuSeparator.definition)).not.toHaveProperty(
			"className",
		);
		expect(
			getDefaultProps("base-ui", "separator", separator.definition),
		).not.toHaveProperty("className");
		expect(
			getDefaultProps("base-ui", "menu.separator", menuSeparator.definition),
		).not.toHaveProperty("className");
		expect(
			getRenderableProps(
				getDefaultProps("base-ui", "separator", separator.definition),
				separator.definition,
			).className,
		).toBe(separatorBaseClassName);
		expect(
			getRenderableProps(
				getDefaultProps("base-ui", "menu.separator", menuSeparator.definition),
				menuSeparator.definition,
			).className,
		).toBe(separatorBaseClassName);

		const avatarRoot = resolveRegistryComponent("base-ui", "avatar.root");
		const avatarImage = resolveRegistryComponent("base-ui", "avatar.image");
		const avatarFallback = resolveRegistryComponent(
			"base-ui",
			"avatar.fallback",
		);
		expect(avatarRoot).toMatchObject({
			status: "known",
			definition: { role: "branch", label: "Avatar Root" },
		});
		expect(avatarImage).toMatchObject({
			status: "known",
			definition: {
				role: "leaf",
				label: "Avatar Image",
				defaultProps: { [assetIdProp]: "", alt: "" },
			},
		});
		expect(avatarFallback).toMatchObject({
			status: "known",
			definition: { role: "branch", label: "Avatar Fallback" },
		});
	});

	it("treats recipe markers as system props without making them render props", () => {
		for (const key of [
			recipeIdProp,
			recipeInstanceProp,
			recipeRootProp,
			recipePathProp,
			recipeSlotProp,
		]) {
			expect(SYSTEM_PROP_KEYS.has(key)).toBe(true);
			expect(CORE_PROP_KEYS.has(key)).toBe(false);
		}

		const resolution = resolveRegistryComponent("base-ui", "separator");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const renderableProps = getRenderableProps(
			{
				className: "h-px",
				"data-trickroom-name": "Separator",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "separator",
				"data-trickroom-role": "leaf",
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "instance-1",
				[recipePathProp]: "root",
			},
			resolution.definition,
		);

		expect(renderableProps).toMatchObject({
			className: `${separatorBaseClassName} h-px`,
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "separator",
		});
		expect(renderableProps).not.toHaveProperty(recipeIdProp);
		expect(renderableProps).not.toHaveProperty(recipeInstanceProp);
		expect(renderableProps).not.toHaveProperty(recipePathProp);
	});

	it("prepends baseClassName when component has no materialized-base marker", () => {
		const resolution = resolveRegistryComponent("trickroom", "container");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const renderableProps = getRenderableProps(
			{
				className: "h-px",
			},
			{
				...resolution.definition,
				baseClassName: "w-full",
			},
		);

		expect(renderableProps.className).toBe("w-full h-px");
	});

	it("skips baseClassName when materialized-base marker is present", () => {
		const resolution = resolveRegistryComponent("trickroom", "container");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const renderableProps = getRenderableProps(
			{
				className: "h-px",
				[MATERIALIZED_BASE_CLASS_PROP]: "true",
			},
			{
				...resolution.definition,
				baseClassName: "w-full",
			},
		);

		expect(renderableProps).toMatchObject({
			className: "h-px",
		});
		expect(renderableProps).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
	});

	it("preserves authored className even when suppressing baseClassName", () => {
		const resolution = resolveRegistryComponent("trickroom", "container");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const renderableProps = getRenderableProps(
			{
				className: "h-px",
				[MATERIALIZED_BASE_CLASS_PROP]: "true",
			},
			{
				...resolution.definition,
				baseClassName: "w-full",
			},
		);

		expect(renderableProps.className).toBe("h-px");
	});

	it("omits className when no base class and no authored className", () => {
		const resolution = resolveRegistryComponent("trickroom", "container");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const renderableProps = getRenderableProps(
			{
				"data-trickroom-name": "Container",
			},
			resolution.definition,
		);

		expect(renderableProps).not.toHaveProperty("className");
	});

	it("composes separator render classes through shared layers without changing output", () => {
		const resolution = resolveRegistryComponent("base-ui", "separator");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const props = {
			...getDefaultProps("base-ui", "separator", resolution.definition),
			className: "data-[orientation=horizontal]:h-2 unknown-separator-token",
		};
		const composition = getRenderableClassComposition(
			props,
			resolution.definition,
		);

		expect(composition.className).toBe(
			`${separatorBaseClassName} data-[orientation=horizontal]:h-2 unknown-separator-token`,
		);
		expect(getRenderableProps(props, resolution.definition).className).toBe(
			composition.className,
		);
		expect(composition.layers).toEqual([
			{
				source: "registry-base",
				className: separatorBaseClassName,
				metadata: { library: "base-ui", component: "separator" },
			},
			{
				source: "authored",
				className: "data-[orientation=horizontal]:h-2 unknown-separator-token",
				metadata: { library: "base-ui", component: "separator" },
			},
		]);
		expect(
			composition.resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				status: token.status,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "data-[orientation=vertical]:w-px",
				source: "registry-base",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=vertical]:self-stretch",
				source: "registry-base",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-px",
				source: "registry-base",
				status: "shadowed",
				shadowedBy: 4,
			},
			{
				classToken: "data-[orientation=horizontal]:w-full",
				source: "registry-base",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-2",
				source: "authored",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "unknown-separator-token",
				source: "authored",
				status: "unknown",
				shadowedBy: undefined,
			},
		]);
	});

	it("composes menu separator and materialized snapshots without reapplying base classes", () => {
		const resolution = resolveRegistryComponent("base-ui", "menu.separator");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") return;

		const liveProps = {
			...getDefaultProps("base-ui", "menu.separator", resolution.definition),
			className: "opacity-70",
		};
		const liveComposition = getRenderableClassComposition(
			liveProps,
			resolution.definition,
		);
		expect(liveComposition.className).toBe(
			`${separatorBaseClassName} opacity-70`,
		);
		expect(liveComposition.layers.map((layer) => layer.source)).toEqual([
			"registry-base",
			"authored",
		]);

		const snapshotProps = {
			...liveProps,
			className: `${separatorBaseClassName} opacity-70`,
			[MATERIALIZED_BASE_CLASS_PROP]: "true",
		};
		const snapshotComposition = getRenderableClassComposition(
			snapshotProps,
			resolution.definition,
		);

		expect(snapshotComposition.className).toBe(
			`${separatorBaseClassName} opacity-70`,
		);
		expect(
			getRenderableProps(snapshotProps, resolution.definition),
		).toMatchObject({
			className: `${separatorBaseClassName} opacity-70`,
		});
		expect(
			getRenderableProps(snapshotProps, resolution.definition),
		).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
		expect(snapshotComposition.layers).toEqual([
			{
				source: "materialized-snapshot",
				className: `${separatorBaseClassName} opacity-70`,
				metadata: { library: "base-ui", component: "menu.separator" },
			},
		]);
		expect(
			snapshotComposition.resolution.tokens.map((token) => token.status),
		).toEqual(["active", "active", "active", "active", "active"]);
	});

	it("rejects recipe marker writes through normal mutation props", () => {
		expect(() =>
			applyAddElement(emptyDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "container",
				props: {
					[recipeIdProp]: "base-ui/avatar.default",
				},
			}),
		).toThrowError(DesignTransformError);

		const result = applyAddElement(emptyDesign, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});
		expect(() =>
			applyUpdateElementProps(result.design, {
				elementId: result.changedElementId,
				props: {
					[recipeInstanceProp]: "instance-1",
				},
			}),
		).toThrowError(DesignTransformError);
	});

	it("omits optional recipe marker props and strips markers without mutating props", () => {
		const structuralProps = getRecipeMarkerProps({
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			path: "image",
		});
		expect(structuralProps).toEqual({
			[recipeIdProp]: "base-ui/avatar.default",
			[recipeInstanceProp]: "recipe-instance-1",
			[recipePathProp]: "image",
		});

		const blankSlotProps = getRecipeMarkerProps({
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			path: "fallback",
			slotName: "",
		});
		expect(blankSlotProps).not.toHaveProperty(recipeSlotProp);
		expect(blankSlotProps).not.toHaveProperty(recipeRootProp);

		const sourceProps = {
			...baseContainerProps,
			className: "rounded-full",
			[assetIdProp]: "asset_avatar",
			...getRecipeMarkerProps({
				recipeId: "base-ui/avatar.default",
				instanceId: "recipe-instance-1",
				path: "fallback",
				isRoot: true,
				slotName: "fallback",
			}),
		};

		const stripped = omitRecipeMarkerProps(sourceProps);
		expect(stripped).toEqual({
			...baseContainerProps,
			className: "rounded-full",
			[assetIdProp]: "asset_avatar",
		});
		for (const key of recipeMarkerProps) {
			expect(sourceProps).toHaveProperty(key);
			expect(stripped).not.toHaveProperty(key);
		}
	});

	it("returns null for nullish, blank, and partial recipe marker metadata", () => {
		const completeWithBooleanRoot = {
			...baseContainerProps,
			[recipeIdProp]: "base-ui/avatar.default",
			[recipeInstanceProp]: "recipe-instance-1",
			[recipePathProp]: "root",
			[recipeRootProp]: true,
		};
		expect(getRecipeStructuralMetadata(completeWithBooleanRoot)).toMatchObject({
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			path: "root",
			isRoot: true,
			slotName: null,
		});

		for (const props of [
			null,
			undefined,
			baseContainerProps,
			{
				...baseContainerProps,
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
			},
			{
				...baseContainerProps,
				[recipeIdProp]: " ",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipePathProp]: "root",
			},
			{
				...baseContainerProps,
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "",
				[recipePathProp]: "root",
			},
			{
				...baseContainerProps,
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipePathProp]: "  ",
			},
		]) {
			expect(getRecipeStructuralMetadata(props)).toBeNull();
		}
	});

	it("discovers and resolves the Base UI recipes", () => {
		expect(getRecipeIds("base-ui")).toEqual([
			"base-ui/accordion.default",
			"base-ui/accordion.item.default",
			"base-ui/alert-dialog.default",
			"base-ui/avatar.default",
			"base-ui/checkbox-group.default",
			"base-ui/checkbox.default",
			"base-ui/collapsible.default",
			"base-ui/combobox.default",
			"base-ui/context-menu.default",
			"base-ui/dialog.default",
			"base-ui/drawer.default",
			"base-ui/field.default",
			"base-ui/fieldset.default",
			"base-ui/form.default",
			"base-ui/menu.default",
			"base-ui/menubar.default",
			"base-ui/meter.default",
			"base-ui/number-field.default",
			"base-ui/otp-field.default",
			"base-ui/popover.default",
			"base-ui/preview-card.default",
			"base-ui/progress.default",
			"base-ui/radio-group.default",
			"base-ui/radio.default",
			"base-ui/scroll-area.default",
			"base-ui/select.default",
			"base-ui/slider.default",
			"base-ui/switch.default",
			"base-ui/tabs.default",
			"base-ui/toggle-group.default",
			"base-ui/toolbar.default",
			"base-ui/tooltip.default",
			"base-ui/tooltip.item.default",
		]);

		const recipe = getRecipe("base-ui", "avatar.default");
		expect(recipe).toMatchObject({
			id: "base-ui/avatar.default",
			label: "Avatar",
			version: 1,
			slots: {
				fallback: {
					name: "fallback",
					hostPath: "fallback",
				},
			},
		});
		expect(getRecipe("base-ui", "base-ui/avatar.default")).toBe(recipe);
		expect(resolveRegistryRecipe("base-ui", "avatar.default")).toMatchObject({
			status: "known",
			definition: { id: "base-ui/avatar.default" },
		});

		const menuRecipe = getRecipe("base-ui", "menu.default");
		expect(menuRecipe).toMatchObject({
			id: "base-ui/menu.default",
			label: "Menu",
			version: 1,
			slots: {
				trigger: {
					name: "trigger",
					hostPath: "trigger",
					allowedChildren: undefined,
				},
				items: {
					name: "items",
					hostPath: "popup",
					allowedChildren: [
						{ library: "base-ui", component: "menu.item" },
						{ library: "base-ui", component: "menu.separator" },
					],
				},
			},
			controls: {
				orientation: { path: "root", prop: "orientation" },
				openOnHover: { path: "trigger", prop: "openOnHover" },
				side: { path: "positioner", prop: "side" },
			},
		});
		expect(getRecipe("base-ui", "base-ui/menu.default")).toBe(menuRecipe);
		expect(resolveRegistryRecipe("base-ui", "menu.default")).toMatchObject({
			status: "known",
			definition: { id: "base-ui/menu.default" },
		});

		const tooltipRecipe = getRecipe("base-ui", "tooltip.default");
		expect(tooltipRecipe).toMatchObject({
			id: "base-ui/tooltip.default",
			label: "Tooltip Provider",
			version: 1,
			root: {
				component: "tooltip.provider",
			},
			slots: {
				content: {
					name: "content",
					hostPath: "root",
					allowedChildren: undefined,
				},
			},
			controls: {
				delay: { path: "root", prop: "delay" },
				closeDelay: { path: "root", prop: "closeDelay" },
				timeout: { path: "root", prop: "timeout" },
			},
		});
		expect(getRecipe("base-ui", "base-ui/tooltip.default")).toBe(tooltipRecipe);
		expect(resolveRegistryRecipe("base-ui", "tooltip.default")).toMatchObject({
			status: "known",
			definition: { id: "base-ui/tooltip.default" },
		});

		const tooltipItemRecipe = getRecipe("base-ui", "tooltip.item.default");
		expect(tooltipItemRecipe).toMatchObject({
			id: "base-ui/tooltip.item.default",
			label: "Tooltip Item",
			version: 1,
			root: {
				component: "tooltip.root",
				props: { defaultOpen: true },
			},
			slots: {
				trigger: {
					name: "trigger",
					hostPath: "trigger",
					allowedChildren: undefined,
				},
				popup: {
					name: "popup",
					hostPath: "popup",
					allowedChildren: undefined,
				},
			},
			controls: {
				defaultOpen: { path: "root", prop: "defaultOpen" },
				side: { path: "positioner", prop: "side" },
				sideOffset: { path: "positioner", prop: "sideOffset" },
			},
		});
		expect(getRecipe("base-ui", "base-ui/tooltip.item.default")).toBe(
			tooltipItemRecipe,
		);
		expect(
			resolveRegistryRecipe("base-ui", "tooltip.item.default"),
		).toMatchObject({
			status: "known",
			definition: { id: "base-ui/tooltip.item.default" },
		});
	});

	it("expands the Tooltip Provider recipe with general default content", () => {
		const ids = ["tooltip-provider", "tooltip-provider-content"];
		const expansion = expandRegistryRecipe("base-ui", "tooltip.default", {
			createRecipeInstanceId: () => "tooltip-provider-instance-1",
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing test id");
				return id;
			},
		});
		const content = (expansion.root.children as Node[])[0];

		expect(expansion.root.props["data-trickroom-component"]).toBe(
			"tooltip.provider",
		);
		expect(expansion.root.props[recipeSlotProp]).toBe("content");
		expect(content.props["data-trickroom-component"]).toBe("container");
	});

	it("expands the Tooltip Item recipe with default slot children", () => {
		const ids = [
			"tooltip-root",
			"tooltip-trigger",
			"tooltip-portal",
			"tooltip-positioner",
			"tooltip-popup",
			"tooltip-trigger-label",
			"tooltip-arrow",
			"tooltip-popup-content",
		];
		const expansion = expandRegistryRecipe("base-ui", "tooltip.item.default", {
			createRecipeInstanceId: () => "tooltip-instance-1",
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing test id");
				return id;
			},
		});
		const trigger = (expansion.root.children as Node[])[0];
		const portal = (expansion.root.children as Node[])[1];
		const positioner = (portal.children as Node[])[0];
		const popup = (positioner.children as Node[])[0];

		expect(expansion.root.props["data-trickroom-component"]).toBe(
			"tooltip.root",
		);
		expect(expansion.root.props.defaultOpen).toBe(true);
		expect(trigger.props[recipeSlotProp]).toBe("trigger");
		expect(popup.props[recipeSlotProp]).toBe("popup");
		expect(trigger.children).toHaveLength(1);
		expect(popup.children).toHaveLength(2);
		expect((popup.children as Node[])[0].props).toMatchObject({
			"data-trickroom-component": "tooltip.arrow",
		});
	});

	it("expands the Avatar recipe into plain design JSON with fresh markers", () => {
		const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createRecipeInstanceId: () => "recipe-instance-1",
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing test id");
				return id;
			},
		});
		const children = expansion.root.children as Node[];
		const [image, fallback] = children;

		expect(expansion).toMatchObject({
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			elementIdsByPath: {
				root: "avatar-root",
				image: "avatar-image",
				fallback: "avatar-fallback",
			},
		});
		expect(expansion.root).toMatchObject({
			id: "avatar-root",
			props: {
				"data-trickroom-name": "Avatar Root",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.root",
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipeRootProp]: "true",
				[recipePathProp]: "root",
			},
		});
		expect(image).toMatchObject({
			id: "avatar-image",
			props: {
				"data-trickroom-name": "Avatar Image",
				"data-trickroom-component": "avatar.image",
				"data-trickroom-role": "leaf",
				[assetIdProp]: "",
				alt: "",
				[recipePathProp]: "image",
			},
			children: [],
		});
		expect(image.props).not.toHaveProperty(recipeSlotProp);
		expect(fallback).toMatchObject({
			id: "avatar-fallback",
			props: {
				"data-trickroom-name": "Avatar Fallback",
				"data-trickroom-component": "avatar.fallback",
				"data-trickroom-role": "branch",
				[recipePathProp]: "fallback",
				[recipeSlotProp]: "fallback",
			},
			children: [],
		});
	});

	it("expands and validates the Menu recipe structure with empty slots", () => {
		const ids = [
			"menu-root",
			"menu-trigger",
			"menu-portal",
			"menu-positioner",
			"menu-popup",
		];
		const expansion = expandRegistryRecipe("base-ui", "menu.default", {
			createRecipeInstanceId: () => "menu-instance-1",
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing test id");
				return id;
			},
		});
		const [trigger, portal] = expansion.root.children as Node[];
		const [positioner] = portal.children as Node[];
		const [popup] = positioner.children as Node[];
		const validation = validateRecipeInstances([expansion.root]);

		expect(expansion).toMatchObject({
			recipeId: "base-ui/menu.default",
			instanceId: "menu-instance-1",
			elementIdsByPath: {
				root: "menu-root",
				trigger: "menu-trigger",
				portal: "menu-portal",
				positioner: "menu-positioner",
				popup: "menu-popup",
			},
		});
		expect(expansion.root).toMatchObject({
			id: "menu-root",
			props: {
				"data-trickroom-component": "menu.root",
				orientation: "vertical",
				loopFocus: true,
				highlightItemOnHover: true,
				disabled: false,
				[recipeIdProp]: "base-ui/menu.default",
				[recipeInstanceProp]: "menu-instance-1",
				[recipeRootProp]: "true",
				[recipePathProp]: "root",
			},
		});
		expect(trigger).toMatchObject({
			id: "menu-trigger",
			props: {
				"data-trickroom-component": "menu.trigger",
				type: "button",
				openOnHover: false,
				[recipePathProp]: "trigger",
				[recipeSlotProp]: "trigger",
			},
			children: [],
		});
		expect(portal).toMatchObject({
			id: "menu-portal",
			props: {
				"data-trickroom-component": "menu.portal",
				keepMounted: false,
				[recipePathProp]: "portal",
			},
		});
		expect(positioner).toMatchObject({
			id: "menu-positioner",
			props: {
				"data-trickroom-component": "menu.positioner",
				side: "bottom",
				align: "start",
				sideOffset: 4,
				[recipePathProp]: "positioner",
			},
		});
		expect(popup).toMatchObject({
			id: "menu-popup",
			props: {
				"data-trickroom-component": "menu.popup",
				[recipePathProp]: "popup",
				[recipeSlotProp]: "items",
			},
			children: [],
		});
		expect(validation.valid).toHaveLength(1);
		expect(validation.invalidKnown).toEqual([]);
		expect(validation.unknown).toEqual([]);
	});

	it("detaches every structural node in an attached recipe instance", () => {
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createRecipeInstanceId: () => "recipe-instance-1",
			createElementId: (() => {
				const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
				return () => ids.shift() ?? "unexpected";
			})(),
		});

		const result = detachRecipeInstance([expansion.root], "avatar-image");
		expect(result).not.toBeNull();
		if (!result) return;

		expect(result).toMatchObject({
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			targetElementId: "avatar-image",
			changedElementId: "avatar-image",
			selectionElementId: "avatar-image",
			rootElementId: "avatar-root",
			detachedElementIds: ["avatar-root", "avatar-image", "avatar-fallback"],
		});
		expect(
			collectRecipeInstanceNodes(result.roots, "recipe-instance-1"),
		).toEqual([]);
		expect(
			collectRecipeInstanceNodes([expansion.root], "recipe-instance-1"),
		).toHaveLength(3);

		const root = result.roots[0];
		const [image, fallback] = root.children as Node[];
		for (const node of [root, image, fallback]) {
			expectNoRecipeMarkers(node);
		}
	});

	it("preserves editable props and slot contents when detaching", () => {
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createRecipeInstanceId: () => "recipe-instance-1",
			createElementId: (() => {
				const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
				return () => ids.shift() ?? "unexpected";
			})(),
		});
		const children = expansion.root.children as Node[];
		const [image, fallback] = children;
		const slotChild: Node = {
			id: "slot-child",
			props: {
				"data-trickroom-name": "Fallback Content",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				className: "grid place-items-center",
				"data-custom-prop": "kept",
			},
			children: [
				{
					id: "slot-label",
					props: {
						"data-trickroom-name": "Fallback Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "JP",
				},
			],
		};

		expansion.root.props = {
			...expansion.root.props,
			"data-trickroom-name": "Profile Avatar",
			className: "inline-flex rounded-full",
		};
		image.props = {
			...image.props,
			"data-trickroom-name": "Profile Image",
			className: "size-10",
			[assetIdProp]: "asset_profile",
			alt: "Profile photo",
		};
		fallback.props = {
			...fallback.props,
			className: "bg-neutral-100 text-neutral-900",
		};
		fallback.children = [slotChild];

		const result = detachRecipeInstance([expansion.root], "avatar-root");
		expect(result).not.toBeNull();
		if (!result) return;

		const root = result.roots[0];
		const [detachedImage, detachedFallback] = root.children as Node[];
		expect(root.props).toMatchObject({
			"data-trickroom-name": "Profile Avatar",
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.root",
			className: "inline-flex rounded-full",
		});
		expect(detachedImage.props).toMatchObject({
			"data-trickroom-name": "Profile Image",
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.image",
			className: "size-10",
			[assetIdProp]: "asset_profile",
			alt: "Profile photo",
		});
		expect(detachedFallback.props).toMatchObject({
			"data-trickroom-name": "Avatar Fallback",
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.fallback",
			className: "bg-neutral-100 text-neutral-900",
		});
		expect(detachedFallback.children).toEqual([slotChild]);
	});

	it("resolves recipe ownership and slot placement boundaries", () => {
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createRecipeInstanceId: () => "recipe-instance-1",
			createElementId: (() => {
				const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
				return () => ids.shift() ?? "unexpected";
			})(),
		});
		const children = expansion.root.children as Node[];
		const fallback = children[1];
		fallback.children = [
			{
				id: "slot-child",
				props: {
					"data-trickroom-name": "Slot Child",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					"data-trickroom-role": "branch",
				},
				children: [],
			},
		];
		const roots = [expansion.root];
		const entities = flatten(expansion.root, null, {});

		expect(collectRecipeInstanceNodes(roots, "recipe-instance-1")).toHaveLength(
			3,
		);
		expect(findRecipeRootNode(roots, "recipe-instance-1")?.id).toBe(
			"avatar-root",
		);
		expect(isRecipeRoot(entities["avatar-root"])).toBe(true);
		expect(isRecipeOwnedStructuralNode(entities["avatar-image"])).toBe(true);
		expect(isRecipeSlotHost(entities["avatar-fallback"])).toBe(true);
		expect(isRecipeOwnedStructuralNode(entities["slot-child"])).toBe(false);
		expect(getRecipeInstanceMetadata(entities, "avatar-image")).toMatchObject({
			elementId: "avatar-image",
			rootId: "avatar-root",
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			path: "image",
		});
		expect(getContainingRecipeSlot(entities, "slot-child")).toMatchObject({
			hostId: "avatar-fallback",
			slotName: "fallback",
			instanceId: "recipe-instance-1",
		});
		expect(isRecipeSlotContent(entities, "slot-child")).toBe(true);
		expect(isRecipeSlotContent(entities, "avatar-fallback")).toBe(false);

		expect(canInsertIntoRecipeBoundary(entities, null)).toBe(true);
		expect(canInsertIntoRecipeBoundary(entities, "avatar-root")).toBe(false);
		expect(canInsertIntoRecipeBoundary(entities, "avatar-image")).toBe(false);
		expect(canInsertIntoRecipeBoundary(entities, "avatar-fallback")).toBe(true);
		expect(
			canMoveElementAcrossRecipeBoundary(
				entities,
				"avatar-image",
				"avatar-fallback",
			),
		).toBe(false);
		expect(
			canMoveElementAcrossRecipeBoundary(entities, "avatar-root", null),
		).toBe(true);
		expect(
			canMoveElementAcrossRecipeBoundary(entities, "slot-child", null),
		).toBe(true);
		expect(canDeleteElementAcrossRecipeBoundary(entities, "avatar-image")).toBe(
			false,
		);
		expect(canDeleteElementAcrossRecipeBoundary(entities, "avatar-root")).toBe(
			true,
		);
		expect(canDeleteElementAcrossRecipeBoundary(entities, "slot-child")).toBe(
			true,
		);
	});

	it("treats nullish and partial recipe markers as ordinary non-slot rows", () => {
		const ordinary = {
			id: "ordinary",
			parentId: null,
			childIds: [],
			props: baseContainerProps,
		};
		const slotOnly = {
			...ordinary,
			id: "slot-only",
			props: {
				...ordinary.props,
				[recipeSlotProp]: "fallback",
			},
		};
		const recipeRoot = {
			...ordinary,
			id: "recipe-root",
			props: {
				...ordinary.props,
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "root",
					isRoot: true,
				}),
			},
		};
		const slotHost = {
			...ordinary,
			id: "slot-host",
			props: {
				...ordinary.props,
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "fallback",
					slotName: "fallback",
				}),
			},
		};

		expect(isRecipeOwnedStructuralNode(null)).toBe(false);
		expect(isRecipeRoot(undefined)).toBe(false);
		expect(isRecipeSlotHost(null)).toBe(false);
		expect(getRecipeSlotName(undefined)).toBeNull();

		expect(isRecipeOwnedStructuralNode(ordinary)).toBe(false);
		expect(isRecipeRoot(ordinary)).toBe(false);
		expect(isRecipeSlotHost(ordinary)).toBe(false);
		expect(getRecipeSlotName(ordinary)).toBeNull();

		expect(isRecipeOwnedStructuralNode(slotOnly)).toBe(false);
		expect(isRecipeSlotHost(slotOnly)).toBe(false);
		expect(getRecipeSlotName(slotOnly)).toBeNull();

		expect(isRecipeOwnedStructuralNode(recipeRoot)).toBe(true);
		expect(isRecipeRoot(recipeRoot)).toBe(true);
		expect(isRecipeSlotHost(recipeRoot)).toBe(false);

		expect(isRecipeOwnedStructuralNode(slotHost)).toBe(true);
		expect(isRecipeRoot(slotHost)).toBe(false);
		expect(isRecipeSlotHost(slotHost)).toBe(true);
		expect(getRecipeSlotName(slotHost)).toBe("fallback");
	});

	it("keeps recipe ownership scoped across nested recipe instances in slots", () => {
		const createAvatarSubtree = (
			prefix: string,
			instanceId: string,
			fallbackChildren: Node[] = [],
		): Node => ({
			id: `${prefix}-root`,
			props: {
				...baseContainerProps,
				"data-trickroom-name": `${prefix} root`,
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.root",
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId,
					path: "root",
					isRoot: true,
				}),
			},
			children: [
				{
					id: `${prefix}-image`,
					props: {
						...baseContainerProps,
						"data-trickroom-name": `${prefix} image`,
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						...getRecipeMarkerProps({
							recipeId: "base-ui/avatar.default",
							instanceId,
							path: "image",
						}),
					},
					children: [],
				},
				{
					id: `${prefix}-fallback`,
					props: {
						...baseContainerProps,
						"data-trickroom-name": `${prefix} fallback`,
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.fallback",
						...getRecipeMarkerProps({
							recipeId: "base-ui/avatar.default",
							instanceId,
							path: "fallback",
							slotName: "fallback",
						}),
					},
					children: fallbackChildren,
				},
			],
		});
		const slotLeaf: Node = {
			id: "nested-slot-leaf",
			props: {
				...baseContainerProps,
				"data-trickroom-name": "Nested slot leaf",
			},
			children: [],
		};
		const nested = createAvatarSubtree("nested", "nested-instance", [slotLeaf]);
		const outer = createAvatarSubtree("outer", "outer-instance", [nested]);
		const entities = flatten(outer, null, {});

		expect(getRecipeOwnedStructuralIds(entities, "outer-instance")).toEqual([
			"outer-fallback",
			"outer-image",
			"outer-root",
		]);
		expect(getRecipeOwnedStructuralIds(entities, "nested-instance")).toEqual([
			"nested-fallback",
			"nested-image",
			"nested-root",
		]);
		expect(getRecipeOwnedStructuralIds(entities, "missing-instance")).toEqual(
			[],
		);
		expect(getContainingRecipeSlot(entities, "nested-root")).toMatchObject({
			hostId: "outer-fallback",
			instanceId: "outer-instance",
		});
		expect(getContainingRecipeSlot(entities, "nested-slot-leaf")).toMatchObject(
			{
				hostId: "nested-fallback",
				instanceId: "nested-instance",
			},
		);
		expect(canInsertIntoRecipeBoundary(entities, "outer-root")).toBe(false);
		expect(canInsertIntoRecipeBoundary(entities, "outer-fallback")).toBe(true);
		expect(canInsertIntoRecipeBoundary(entities, "nested-root")).toBe(false);
		expect(canInsertIntoRecipeBoundary(entities, "missing-parent")).toBe(false);
		expect(
			canMoveElementAcrossRecipeBoundary(
				entities,
				"nested-root",
				"outer-fallback",
			),
		).toBe(true);
		expect(
			canMoveElementAcrossRecipeBoundary(
				entities,
				"nested-image",
				"outer-fallback",
			),
		).toBe(false);
		expect(canMoveElementAcrossRecipeBoundary(entities, "missing", null)).toBe(
			false,
		);
		expect(canDeleteElementAcrossRecipeBoundary(entities, "nested-root")).toBe(
			true,
		);
		expect(canDeleteElementAcrossRecipeBoundary(entities, "nested-image")).toBe(
			false,
		);
	});

	it("does not materialize separator base styling during recipe expansion", () => {
		const expansion = expandSeparatorRecipe();
		const [separator, menuSeparator] = expansion.root.children as Node[];
		const separatorDefinition = resolveRegistryComponent(
			"base-ui",
			"separator",
		).definition;
		const menuSeparatorDefinition = resolveRegistryComponent(
			"base-ui",
			"menu.separator",
		).definition;

		expect(separator.props).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
		expect(menuSeparator.props).not.toHaveProperty(
			MATERIALIZED_BASE_CLASS_PROP,
		);
		expect(separator.props.className).toBe("authored-separator");
		expect(menuSeparator.props.className).toBe("authored-menu-separator");
		expect(
			getRenderableProps(separator.props, separatorDefinition),
		).toMatchObject({
			className: `${separatorBaseClassName} authored-separator`,
		});
		expect(
			getRenderableProps(menuSeparator.props, menuSeparatorDefinition),
		).toMatchObject({
			className: `${separatorBaseClassName} authored-menu-separator`,
		});

		const liveSeparatorComposition = getRenderableClassComposition(
			{
				...separator.props,
				className: "data-[orientation=horizontal]:h-2 authored-separator",
			},
			separatorDefinition,
		);
		expect(liveSeparatorComposition.className).toBe(
			`${separatorBaseClassName} data-[orientation=horizontal]:h-2 authored-separator`,
		);
		expect(liveSeparatorComposition.layers).toEqual([
			{
				source: "registry-base",
				className: separatorBaseClassName,
				metadata: {
					library: "base-ui",
					component: "separator",
					recipeId: "test/separator-components",
					instanceId: "separator-recipe-instance",
					path: "separator",
				},
			},
			{
				source: "authored",
				className: "data-[orientation=horizontal]:h-2 authored-separator",
				metadata: {
					library: "base-ui",
					component: "separator",
					recipeId: "test/separator-components",
					instanceId: "separator-recipe-instance",
					path: "separator",
				},
			},
		]);
		expect(
			liveSeparatorComposition.resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				metadata: token.layer.metadata,
				status: token.status,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "data-[orientation=vertical]:w-px",
				source: "registry-base",
				metadata: liveSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=vertical]:self-stretch",
				source: "registry-base",
				metadata: liveSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-px",
				source: "registry-base",
				metadata: liveSeparatorComposition.layers[0].metadata,
				status: "shadowed",
				shadowedBy: 4,
			},
			{
				classToken: "data-[orientation=horizontal]:w-full",
				source: "registry-base",
				metadata: liveSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-2",
				source: "authored",
				metadata: liveSeparatorComposition.layers[1].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "authored-separator",
				source: "authored",
				metadata: liveSeparatorComposition.layers[1].metadata,
				status: "unknown",
				shadowedBy: undefined,
			},
		]);
	});

	it("preserves authored recipe class order through expansion and detach", () => {
		const authoredClassName =
			"data-[orientation=horizontal]:h-2 unknown-recipe-token data-[orientation=horizontal]:h-4";
		const recipe: RecipeDefinition = {
			id: "test/persisted-class-order",
			label: "Persisted Class Order",
			version: 1,
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "separator",
						library: "base-ui",
						component: "separator",
						props: { className: authoredClassName },
					},
				],
			},
		};
		const ids = ["recipe-root", "recipe-separator"];
		const expansion = expandRecipeDefinition(recipe, {
			createRecipeInstanceId: () => "recipe-instance",
			createElementId: () => {
				const id = ids.shift();
				if (!id) throw new Error("missing recipe id");
				return id;
			},
		});
		const separator = expansion.root.children?.[0];
		const separatorDefinition = resolveRegistryComponent(
			"base-ui",
			"separator",
		).definition;

		expect(separator?.props.className).toBe(authoredClassName);

		const detachResult = detachRecipeInstance([expansion.root], "recipe-root");
		expect(detachResult).not.toBeNull();
		if (!detachResult) return;

		const detachedSeparator = detachResult.roots[0].children?.[0];
		const composition = getRenderableClassComposition(
			detachedSeparator?.props ?? {},
			separatorDefinition,
		);

		expect(detachedSeparator?.props.className).toBe(authoredClassName);
		expect(composition.className).toBe(
			`${separatorBaseClassName} ${authoredClassName}`,
		);
		expect(
			composition.resolution.tokens
				.filter((token) =>
					token.classToken.startsWith("data-[orientation=horizontal]:h-"),
				)
				.map((token) => ({
					classToken: token.classToken,
					status: token.status,
					shadowedBy: token.shadowedBy,
				})),
		).toEqual([
			{
				classToken: "data-[orientation=horizontal]:h-px",
				status: "shadowed",
				shadowedBy: 4,
			},
			{
				classToken: "data-[orientation=horizontal]:h-2",
				status: "shadowed",
				shadowedBy: 6,
			},
			{
				classToken: "data-[orientation=horizontal]:h-4",
				status: "active",
				shadowedBy: undefined,
			},
		]);
	});

	it("detaches separator recipes without materializing registry base classes or markers", () => {
		const expansion = expandSeparatorRecipe();
		const detachResult = detachRecipeInstance(
			[expansion.root],
			"separator-recipe-root",
		);
		expect(detachResult).not.toBeNull();
		if (!detachResult) return;

		const detachedRoot = detachResult.roots[0];
		const [separator, menuSeparator] = detachedRoot.children as Node[];
		const separatorDefinition = resolveRegistryComponent(
			"base-ui",
			"separator",
		).definition;
		const menuSeparatorDefinition = resolveRegistryComponent(
			"base-ui",
			"menu.separator",
		).definition;

		expectNoRecipeMarkers(detachedRoot);
		expectNoRecipeMarkers(separator);
		expectNoRecipeMarkers(menuSeparator);
		expect(separator.props.className).toBe("authored-separator");
		expect(menuSeparator.props.className).toBe("authored-menu-separator");
		expect(
			getRenderableProps(separator.props, separatorDefinition),
		).toMatchObject({
			className: `${separatorBaseClassName} authored-separator`,
		});
		expect(
			getRenderableProps(menuSeparator.props, menuSeparatorDefinition),
		).toMatchObject({
			className: `${separatorBaseClassName} authored-menu-separator`,
		});

		const detachedSeparatorComposition = getRenderableClassComposition(
			{
				...separator.props,
				className: "data-[orientation=horizontal]:h-2 authored-separator",
			},
			separatorDefinition,
		);
		expect(detachedSeparatorComposition.className).toBe(
			`${separatorBaseClassName} data-[orientation=horizontal]:h-2 authored-separator`,
		);
		expect(detachedSeparatorComposition.layers).toEqual([
			{
				source: "registry-base",
				className: separatorBaseClassName,
				metadata: {
					library: "base-ui",
					component: "separator",
				},
			},
			{
				source: "authored",
				className: "data-[orientation=horizontal]:h-2 authored-separator",
				metadata: {
					library: "base-ui",
					component: "separator",
				},
			},
		]);
		expect(
			detachedSeparatorComposition.resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				metadata: token.layer.metadata,
				status: token.status,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "data-[orientation=vertical]:w-px",
				source: "registry-base",
				metadata: detachedSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=vertical]:self-stretch",
				source: "registry-base",
				metadata: detachedSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-px",
				source: "registry-base",
				metadata: detachedSeparatorComposition.layers[0].metadata,
				status: "shadowed",
				shadowedBy: 4,
			},
			{
				classToken: "data-[orientation=horizontal]:w-full",
				source: "registry-base",
				metadata: detachedSeparatorComposition.layers[0].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-2",
				source: "authored",
				metadata: detachedSeparatorComposition.layers[1].metadata,
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "authored-separator",
				source: "authored",
				metadata: detachedSeparatorComposition.layers[1].metadata,
				status: "unknown",
				shadowedBy: undefined,
			},
		]);
	});

	it("validates an attached Avatar recipe instance", () => {
		const expansion = expandAvatarRecipe();

		const result = validateRecipeInstances([expansion.root]);

		expect(result.instances).toHaveLength(1);
		expect(result.valid).toHaveLength(1);
		expect(result.invalidKnown).toEqual([]);
		expect(result.unknown).toEqual([]);
		expect(result.valid[0]).toMatchObject({
			status: "attached-valid",
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			rootElementId: "avatar-root",
			structuralElementIds: ["avatar-root", "avatar-image", "avatar-fallback"],
			issues: [],
		});
	});

	it("reports invalid known recipe structure", () => {
		const expansion = expandAvatarRecipe();
		const [image, fallback] = expansion.root.children as Node[];
		image.props = {
			...image.props,
			"data-trickroom-component": "separator",
		};
		expansion.root.children = [fallback];

		const result = validateRecipeInstances([expansion.root]);

		expect(result.valid).toEqual([]);
		expect(result.invalidKnown).toHaveLength(1);
		expect(result.unknown).toEqual([]);
		expect(result.invalidKnown[0]).toMatchObject({
			status: "invalid-known",
			recipeId: "base-ui/avatar.default",
			instanceId: "recipe-instance-1",
			rootElementId: "avatar-root",
		});
		expect(result.invalidKnown[0].issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"MISSING_RECIPE_NODE",
				"RECIPE_NODE_CHILDREN_MISMATCH",
			]),
		);
	});

	it("reports previous-template recipe structure as stale without treating it as invalid-known", () => {
		withAvatarLegacyPreviousTemplate(() => {
			const expansion = expandAvatarRecipe();
			const fallback = (expansion.root.children as Node[])[1];
			fallback.props = {
				...fallback.props,
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "legacy-fallback",
					slotName: "fallback",
				}),
			};
			expansion.root.children = [fallback];

			const result = validateRecipeInstances([expansion.root]);

			expect(result.valid).toEqual([]);
			expect(result.stale).toHaveLength(1);
			expect(result.invalidKnown).toEqual([]);
			expect(result.unknown).toEqual([]);
			expect(result.stale[0]).toMatchObject({
				status: "attached-stale",
				recipeId: "base-ui/avatar.default",
				instanceId: "recipe-instance-1",
				rootElementId: "avatar-root",
				currentVersion: "1",
				matchedTemplateVersion: "0.9",
				issues: [expect.objectContaining({ code: "RECIPE_TEMPLATE_STALE" })],
			});
		});
	});

	it("keeps stale recipe instances attached when only slot policy diagnostics are present", () => {
		withAvatarLegacyPreviousTemplate(() => {
			const expansion = expandAvatarRecipe();
			const fallback = (expansion.root.children as Node[])[1];
			fallback.props = {
				...fallback.props,
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "legacy-fallback",
					slotName: "fallback",
				}),
			};
			fallback.children = [
				{
					id: "fallback-container",
					props: baseContainerProps,
					children: [],
				},
			];
			expansion.root.children = [fallback];

			const result = validateRecipeInstances([expansion.root]);

			expect(result.valid).toEqual([]);
			expect(result.stale).toHaveLength(1);
			expect(result.invalidKnown).toEqual([]);
			expect(result.stale[0]).toMatchObject({
				status: "attached-stale",
				matchedTemplateVersion: "0.9",
				issues: [expect.objectContaining({ code: "RECIPE_TEMPLATE_STALE" })],
			});
		});
	});

	it("updates stale recipe instances while preserving mutable props and slot contents", () => {
		withAvatarLegacyPreviousTemplate(() => {
			const expansion = expandAvatarRecipe();
			const fallback = (expansion.root.children as Node[])[1];
			expansion.root.props["data-trickroom-name"] = "Authored Avatar";
			expansion.root.props.className = "rounded-full";
			fallback.props = {
				...fallback.props,
				"data-trickroom-name": "Legacy Fallback",
				className: "bg-slate-100",
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "legacy-fallback",
					slotName: "fallback",
				}),
			};
			fallback.children = [
				{
					id: "fallback-text",
					props: {
						"data-trickroom-name": "Initials",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "JP",
				},
			];
			expansion.root.children = [fallback];

			const result = updateStaleRecipeInstance(
				{ name: "Recipe Migration", boards: [expansion.root] },
				"avatar-root",
				{ createElementId: () => "avatar-image-new" },
			);

			const migratedRoot = result.design.boards[0];
			const migratedChildren = migratedRoot.children as Node[];
			const migratedImage = migratedChildren[0];
			const migratedFallback = migratedChildren[1];
			expect(validateRecipeInstances(result.design.boards).valid).toHaveLength(
				1,
			);
			expect(migratedRoot.props).toMatchObject({
				"data-trickroom-name": "Authored Avatar",
				className: "rounded-full",
				[recipePathProp]: "root",
			});
			expect(migratedImage).toMatchObject({
				id: "avatar-image-new",
				props: expect.objectContaining({ [recipePathProp]: "image" }),
			});
			expect(migratedFallback).toMatchObject({
				id: "avatar-fallback",
				props: expect.objectContaining({
					"data-trickroom-name": "Legacy Fallback",
					className: "bg-slate-100",
					[recipePathProp]: "fallback",
					[recipeSlotProp]: "fallback",
				}),
			});
			expect(migratedFallback.children).toEqual([
				expect.objectContaining({
					id: "fallback-text",
					children: "JP",
				}),
			]);
			expect(result.metadata).toMatchObject({
				recipeId: "base-ui/avatar.default",
				instanceId: "recipe-instance-1",
				fromVersion: "0.9",
				toVersion: "1",
				preservedPaths: [
					expect.objectContaining({
						fromPath: "root",
						toPath: "root",
						elementId: "avatar-root",
					}),
				],
				remappedPaths: [
					expect.objectContaining({
						fromPath: "legacy-fallback",
						toPath: "fallback",
						elementId: "avatar-fallback",
					}),
				],
				addedPaths: [
					expect.objectContaining({
						toPath: "image",
						elementId: "avatar-image-new",
					}),
				],
				preservedSlots: [
					expect.objectContaining({
						slotName: "fallback",
						fromPath: "legacy-fallback",
						toPath: "fallback",
						preservedChildIds: ["fallback-text"],
					}),
				],
			});
			expect(result.metadata.fromTemplateHash).toMatch(/^trh1:/);
			expect(result.metadata.toTemplateHash).toMatch(/^trh1:/);
		});
	});

	it("refuses stale recipe migration when authored slot content would be dropped", () => {
		const avatarRecipe = baseUiRecipes["avatar.default"] as RecipeDefinition;
		const previousTemplates = avatarRecipe.previousTemplates ?? [];
		avatarRecipe.previousTemplates = [
			...previousTemplates,
			{
				version: "slot-drop-test",
				description: "Template with a removed authored-content slot.",
				root: {
					path: "root",
					library: "base-ui",
					component: "avatar.root",
					children: [
						{
							path: "removed-slot",
							library: "base-ui",
							component: "avatar.fallback",
							slot: "removed",
							children: [],
						},
					],
				},
				slots: {
					removed: {
						name: "removed",
						label: "Removed",
						hostPath: "removed-slot",
					},
				},
			},
		];
		try {
			const expansion = expandAvatarRecipe();
			const fallback = (expansion.root.children as Node[])[1];
			fallback.props = {
				...fallback.props,
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "removed-slot",
					slotName: "removed",
				}),
			};
			fallback.children = [
				{
					id: "authored-slot-content",
					props: {
						"data-trickroom-name": "Authored Content",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Keep me",
				},
			];
			expansion.root.children = [fallback];

			const validation = validateRecipeInstances([expansion.root]);
			expect(validation.stale).toHaveLength(1);
			expect(validation.stale[0]).toMatchObject({
				status: "attached-stale",
				matchedTemplateVersion: "slot-drop-test",
			});

			expect(() =>
				updateStaleRecipeInstance(
					{ name: "Unsafe Migration", boards: [expansion.root] },
					"avatar-root",
				),
			).toThrow(
				expect.objectContaining({
					code: "RECIPE_MIGRATION_UNSAFE",
					message: expect.stringContaining(
						"authored content that cannot be mapped",
					),
				}),
			);
		} finally {
			avatarRecipe.previousTemplates = previousTemplates;
		}
	});

	it("refuses current, invalid-known, and unknown recipe instances during update", () => {
		const valid = expandAvatarRecipe("valid-instance");
		expect(() =>
			updateStaleRecipeInstance(
				{ name: "Valid", boards: [valid.root] },
				"avatar-root",
			),
		).toThrow(RecipeMigrationError);

		const invalid = expandAvatarRecipe("invalid-instance");
		(invalid.root.children as Node[]).pop();
		expect(() =>
			updateStaleRecipeInstance(
				{ name: "Invalid", boards: [invalid.root] },
				"avatar-root",
			),
		).toThrow(/invalid-known/);

		const unknown = expandAvatarRecipe("unknown-instance");
		unknown.root.props[recipeIdProp] = "base-ui/missing.recipe";
		for (const child of unknown.root.children as Node[]) {
			child.props[recipeIdProp] = "base-ui/missing.recipe";
		}
		expect(() =>
			updateStaleRecipeInstance(
				{ name: "Unknown", boards: [unknown.root] },
				"avatar-root",
			),
		).toThrow(/unknown-recipe/);
	});

	it("reports unknown recipe ids without changing the tree", () => {
		const unknownRoot: Node = {
			id: "unknown-root",
			props: {
				"data-trickroom-name": "Unknown Recipe Root",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.root",
				"data-trickroom-role": "branch",
				...getRecipeMarkerProps({
					recipeId: "base-ui/unknown.default",
					instanceId: "unknown-instance-1",
					path: "root",
					isRoot: true,
				}),
			},
			children: [],
		};
		const before = structuredClone(unknownRoot);

		const result = validateRecipeInstances([unknownRoot]);

		expect(unknownRoot).toEqual(before);
		expect(result.valid).toEqual([]);
		expect(result.invalidKnown).toEqual([]);
		expect(result.unknown).toHaveLength(1);
		expect(result.unknown[0]).toMatchObject({
			status: "unknown-recipe",
			recipeId: "base-ui/unknown.default",
			instanceId: "unknown-instance-1",
			rootElementId: "unknown-root",
			structuralElementIds: ["unknown-root"],
		});
		expect(result.unknown[0].issues).toEqual([
			expect.objectContaining({ code: "UNKNOWN_RECIPE_ID" }),
		]);
	});

	it("ignores mutable names and class names when validating recipe structure", () => {
		const expansion = expandAvatarRecipe();
		const [image, fallback] = expansion.root.children as Node[];

		expansion.root.props = {
			...expansion.root.props,
			"data-trickroom-name": "Profile Avatar",
			className: "inline-flex size-12",
		};
		image.props = {
			...image.props,
			"data-trickroom-name": "Profile Image",
			className: "rounded-full object-cover",
		};
		fallback.props = {
			...fallback.props,
			"data-trickroom-name": "Initials Fallback",
			className: "bg-neutral-100 text-neutral-950",
		};

		const result = validateRecipeInstances([expansion.root]);

		expect(result.valid).toHaveLength(1);
		expect(result.invalidKnown).toEqual([]);
		expect(result.valid[0].issues).toEqual([]);
	});

	it("rejects Avatar Image asset props on non-image structural recipe nodes", () => {
		const cases: Array<{
			instanceId: string;
			path: "root" | "fallback";
			props: Node["props"];
		}> = [
			{
				instanceId: "recipe-instance-root-asset",
				path: "root",
				props: { [assetIdProp]: "asset_profile" },
			},
			{
				instanceId: "recipe-instance-root-alt",
				path: "root",
				props: { alt: "Profile photo" },
			},
			{
				instanceId: "recipe-instance-fallback-asset-alt",
				path: "fallback",
				props: {
					[assetIdProp]: "asset_profile",
					alt: "Profile photo",
				},
			},
		];

		for (const { instanceId, path, props } of cases) {
			const expansion = expandAvatarRecipe(instanceId);
			const target =
				path === "root"
					? expansion.root
					: (expansion.root.children as Node[])[1];
			target.props = {
				...target.props,
				...props,
			};

			const result = validateRecipeInstances([expansion.root]);

			expect(result.valid).toEqual([]);
			expect(result.invalidKnown).toHaveLength(1);
			expect(result.invalidKnown[0].issues).toEqual([
				expect.objectContaining({
					code: "RECIPE_NODE_PROPS_MISMATCH",
					elementId: target.id,
					path,
					actual: expect.objectContaining(props),
				}),
			]);
		}
	});

	it("ignores slot contents when validating recipe structure", () => {
		const expansion = expandAvatarRecipe();
		const fallback = (expansion.root.children as Node[])[1];
		fallback.children = [
			{
				id: "fallback-content",
				props: {
					"data-trickroom-name": "Fallback Content",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
				},
				children: "JP",
			},
		];

		const result = validateRecipeInstances([expansion.root]);

		expect(result.valid).toHaveLength(1);
		expect(result.invalidKnown).toEqual([]);
		expect(result.valid[0].issues).toEqual([]);
	});

	it("allows Avatar Image asset and alt controls when validating recipe structure", () => {
		for (const [assetId, alt] of [
			["", ""],
			["asset_profile", "Profile photo"],
		]) {
			const expansion = expandAvatarRecipe(
				`recipe-instance-${assetId || "blank"}`,
			);
			const image = (expansion.root.children as Node[])[0];
			image.props = {
				...image.props,
				[assetIdProp]: assetId,
				alt,
			};

			const result = validateRecipeInstances([expansion.root]);

			expect(result.valid).toHaveLength(1);
			expect(result.invalidKnown).toEqual([]);
			expect(result.valid[0].issues).toEqual([]);
		}
	});

	it("supports v1.1 slot allowlist and control metadata without affecting Avatar behavior", () => {
		const slotDefinition: RecipeSlotDefinition = {
			name: "content",
			label: "Content",
			hostPath: "slot-host",
			allowedChildren: [
				{ library: "base-ui", component: "avatar.image" },
				{ kind: "recipe", library: "base-ui", recipe: "avatar.default" },
			],
			defaultChildren: [
				{
					path: "default-content",
					library: "trickroom",
					component: "text",
					props: {
						"data-trickroom-name": "Default Content",
					},
				},
			],
			history: {
				previousTemplatePath: "avatar.fallback",
				previousTemplateVersion: "1.0",
			},
		};

		expect(
			isRecipeSlotChildAllowed(slotDefinition.allowedChildren, {
				library: "base-ui",
				component: "avatar.image",
			}),
		).toBe(true);
		expect(
			isRecipeSlotChildAllowed(slotDefinition.allowedChildren, {
				kind: "recipe",
				library: "base-ui",
				recipe: "avatar.default",
			}),
		).toBe(true);
		expect(
			isRecipeSlotChildAllowed(slotDefinition.allowedChildren, {
				library: "base-ui",
				component: "avatar.fallback",
			}),
		).toBe(false);
		expect(
			describeRecipeSlotChildRef(slotDefinition.allowedChildren[1]),
		).toMatchObject({
			kind: "recipe",
			library: "base-ui",
			recipe: "avatar.default",
			ref: "base-ui/avatar.default",
		});

		const recipe: RecipeDefinition = {
			id: "test/avatar-slot-defaults",
			label: "Avatar Slot Defaults",
			version: 1,
			root: {
				path: "root",
				library: "base-ui",
				component: "avatar.root",
				children: [
					{
						path: "slot-host",
						library: "base-ui",
						component: "avatar.fallback",
						slot: "content",
						children: [],
					},
				],
			},
			previousTemplates: [
				{
					version: "1.0",
					root: {
						path: "root",
						library: "base-ui",
						component: "avatar.root",
						children: [],
					},
					description: "Previous skeleton for stale detection tests.",
				},
			],
			slots: {
				content: slotDefinition,
			},
			controls: {
				contentPlaceholder: {
					label: "Slot placeholder",
					input: "text",
					prop: "placeholder",
					valueType: "string",
					defaultValue: "Fallback",
					path: "slot-host",
				},
			},
		};

		const expansion = expandRecipeDefinition(recipe, {
			createElementId: (() => {
				const ids = ["recipe-root", "recipe-slot-host", "default-content"];
				return () => ids.shift() ?? "unexpected-id";
			})(),
			createRecipeInstanceId: () => "recipe-instance-1",
		});

		const slotHost = expansion.root.children[0] as Node;
		const defaultContent = slotHost.children[0] as Node;
		slotHost.props = {
			...slotHost.props,
			placeholder: "Fallback content",
		};

		const validationResult = validateRecipeInstances([expansion.root]);
		const avatarExpansion = expandAvatarRecipe();
		const avatarValidation = validateRecipeInstances([avatarExpansion.root]);

		expect(expansion.root.children).toHaveLength(1);
		expect(slotHost.children).toHaveLength(1);
		expect(defaultContent).toMatchObject({
			id: "default-content",
			props: {
				"data-trickroom-name": "Default Content",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "text",
				"data-trickroom-role": "text",
			},
			children: "Text",
		});
		expectNoRecipeMarkers(defaultContent);
		expect(expansion.elementIdsByPath).toMatchObject({
			root: "recipe-root",
			"slot-host": "recipe-slot-host",
		});
		expect(expansion.elementIdsByPath).not.toHaveProperty("default-content");
		expect((expansion.root.children[0] as Node).props.placeholder).toBe(
			"Fallback content",
		);
		expect(recipe.previousTemplates?.[0].root.path).toBe("root");
		expect(validationResult.unknown).toHaveLength(1);
		expect(validationResult.unknown[0].issues[0].code).toBe(
			"UNKNOWN_RECIPE_ID",
		);
		expect(avatarValidation.valid).toHaveLength(1);
		expect(avatarValidation.invalidKnown).toEqual([]);
		expect(avatarValidation.unknown).toEqual([]);
	});

	it("reports persisted authored slot allowlist violations without detaching recipe structure", () => {
		const expansion = expandAvatarRecipe();
		const fallback = (expansion.root.children as Node[])[1];
		fallback.children = [
			{
				id: "fallback-container",
				props: baseContainerProps,
				children: [],
			},
		];

		const result = validateRecipeInstances([expansion.root]);

		expect(result.valid).toHaveLength(1);
		expect(result.stale).toEqual([]);
		expect(result.invalidKnown).toEqual([]);
		expect(result.valid[0]).toMatchObject({
			status: "attached-valid",
			matchedTemplateVersion: "1",
		});
		expect(result.valid[0].issues).toEqual([]);
		expect(getRecipeStructuralMetadata(fallback.props)).toMatchObject({
			slotName: "fallback",
			instanceId: "recipe-instance-1",
		});
	});
});
