import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
	getControlDefinitions,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { expandRegistryRecipe } from "../../recipes/expansion";
import {
	recipeIdProp,
	recipeInstanceProp,
	recipePathProp,
	recipeRootProp,
	recipeSlotProp,
} from "../../recipes/markers";
import { designStore, normalizeDesign } from "../../stores/design-store";
import type { ControlDefinition, Node, TrickroomDesign } from "../../types";
import { assetIdProp, iconIdProp } from "../../utils/resource-props";
import { getPropertiesControlSurface, Properties } from "./Properties";

function controlsFor(library: string, component: string) {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		throw new Error(`Unknown registry component ${library}/${component}`);
	}

	return getControlDefinitions(resolution.definition);
}

function renderPropertiesForSelection(
	design: TrickroomDesign,
	selectedId: string,
) {
	designStore.setState({
		...normalizeDesign(design),
		selectedId,
	});
	const queryClient = new QueryClient();

	return renderToStaticMarkup(
		React.createElement(
			QueryClientProvider,
			{ client: queryClient },
			React.createElement(Properties),
		),
	);
}

afterEach(() => {
	designStore.setState(normalizeDesign({ name: "Empty", boards: [] }));
});

describe("getPropertiesControlSurface", () => {
	it("routes Avatar Image asset selection through the linked asset picker and keeps alt text local", () => {
		const surface = getPropertiesControlSurface(
			controlsFor("base-ui", "avatar.image"),
		);

		expect(surface.assetControl).toMatchObject({
			label: "Asset",
			prop: assetIdProp,
		});
		expect(surface.iconControl).toBeNull();
		expect(surface.componentControls.map((control) => control.prop)).toEqual([
			"alt",
		]);
		expect(surface.componentControls.map((control) => control.label)).toEqual([
			"Alt text",
		]);
	});

	it("does not surface Avatar Image controls on the recipe root component", () => {
		const surface = getPropertiesControlSurface(
			controlsFor("base-ui", "avatar.root"),
		);

		expect(surface.assetControl).toBeNull();
		expect(surface.iconControl).toBeNull();
		expect(surface.componentControls).toEqual([]);
	});

	it("preserves existing trickroom asset and icon picker behavior", () => {
		const assetSurface = getPropertiesControlSurface(
			controlsFor("trickroom", "asset"),
		);
		const iconSurface = getPropertiesControlSurface(
			controlsFor("trickroom", "icon"),
		);

		expect(assetSurface.assetControl).toMatchObject({
			label: "Asset",
			prop: assetIdProp,
		});
		expect(
			assetSurface.componentControls.map((control) => control.prop),
		).toEqual(["alt"]);
		expect(iconSurface.iconControl).toMatchObject({
			label: "Icon",
			prop: iconIdProp,
		});
		expect(
			iconSurface.componentControls.map((control) => control.prop),
		).toEqual(["aria-label"]);
	});

	it("hides recipe marker props even if registry control metadata includes them", () => {
		const visibleControl: ControlDefinition = {
			label: "Visible",
			input: "text",
			prop: "aria-label",
			valueType: "string",
		};
		const markerControls: ControlDefinition[] = [
			recipeIdProp,
			recipeInstanceProp,
			recipeRootProp,
			recipePathProp,
			recipeSlotProp,
		].map((prop) => ({
			label: prop,
			input: "text",
			prop,
			valueType: "string",
		}));

		const surface = getPropertiesControlSurface([
			...markerControls,
			visibleControl,
		]);

		expect(surface.assetControl).toBeNull();
		expect(surface.iconControl).toBeNull();
		expect(surface.componentControls).toEqual([visibleControl]);
	});
});

describe("Properties", () => {
	const avatarImageNode: Node = {
		id: "avatar-image",
		props: {
			"data-trickroom-name": "Avatar Image",
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.image",
			"data-trickroom-role": "leaf",
			[assetIdProp]: "",
			alt: "Profile photo",
			[recipeIdProp]: "base-ui/avatar.default",
			[recipeInstanceProp]: "recipe-instance-1",
			[recipePathProp]: "image",
		},
		children: [],
	};

	const avatarRootNode: Node = {
		id: "avatar-root",
		props: {
			"data-trickroom-name": "Avatar",
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.root",
			"data-trickroom-role": "branch",
			[recipeIdProp]: "base-ui/avatar.default",
			[recipeInstanceProp]: "recipe-instance-1",
			[recipeRootProp]: "true",
			[recipePathProp]: "root",
		},
		children: [avatarImageNode],
	};

	const trickroomAssetNode: Node = {
		id: "trickroom-asset",
		props: {
			"data-trickroom-name": "Asset",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "asset",
			"data-trickroom-role": "leaf",
			[assetIdProp]: "",
			alt: "Hero image",
		},
		children: [],
	};

	it("shows asset picker and alt text controls when Avatar Image is selected", () => {
		const html = renderPropertiesForSelection(
			{ name: "Avatar recipe", boards: [avatarRootNode] },
			avatarImageNode.id,
		);

		expect(html).toContain("Asset");
		expect(html).toContain("No linked system");
		expect(html).toContain("Alt text");
		expect(html).not.toContain(recipeIdProp);
		expect(html).not.toContain(recipeInstanceProp);
		expect(html).not.toContain(recipePathProp);
	});

	it("does not duplicate Avatar Image controls on the recipe root", () => {
		const html = renderPropertiesForSelection(
			{ name: "Avatar recipe", boards: [avatarRootNode] },
			avatarRootNode.id,
		);

		expect(html).not.toContain("No linked system");
		expect(html).not.toContain("Alt text");
		expect(html).not.toContain(recipeIdProp);
		expect(html).not.toContain(recipeRootProp);
	});

	it("surfaces Menu recipe controls from nested structural paths on the recipe root", () => {
		const expansion = expandRegistryRecipe("base-ui", "menu.default", {
			createElementId: () => crypto.randomUUID(),
			createRecipeInstanceId: () => "menu-instance-1",
		});
		const html = renderPropertiesForSelection(
			{ name: "Menu recipe", boards: [expansion.root] },
			expansion.root.id,
		);

		expect(html).toContain("Modal");
		expect(html).toContain("Align");
		expect(html).toContain("Side");
		expect(html).toContain("Side offset");
		expect(html).not.toContain(recipeIdProp);
		expect(html).not.toContain(recipeRootProp);
	});

	it("describes trickroom/asset with asset picker and alt text only", () => {
		const html = renderPropertiesForSelection(
			{ name: "Asset file", boards: [trickroomAssetNode] },
			trickroomAssetNode.id,
		);

		expect(html).toContain("Asset");
		expect(html).toContain("No linked system");
		expect(html).toContain("Alt text");
		expect(html).not.toContain("Object fit");
		expect(html).not.toContain("Object position");
		expect(html).not.toContain("Loading");
		expect(html).not.toContain("Decoding");
	});
});
