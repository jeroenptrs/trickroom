import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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
import { getSystemComponentMarkerProps } from "../../utils/system-component-markers";
import {
	createFixturePublishedRecord,
	FIXTURE_COMPONENT_ID,
} from "../../utils/system-component-test-fixtures";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../../utils/system-components-validation";
import {
	getPropertiesControlSurface,
	Properties,
	resolveAttachedComponentClassInventoryLayers,
} from "./Properties";

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
	options?: {
		systemId?: string;
		componentQueryData?: ReturnType<typeof createFixturePublishedRecord>;
	},
) {
	designStore.setState({
		...normalizeDesign(design),
		selectedId,
		systemId: options?.systemId ?? null,
	});
	const queryClient = new QueryClient();
	if (options?.systemId && options.componentQueryData) {
		queryClient.setQueryData(
			["trickroom-system-component", options.systemId, FIXTURE_COMPONENT_ID],
			{
				systemId: options.systemId,
				systemName: options.systemId,
				revision: { version: 1, hash: "sha256:test" },
				updatedAt: "2026-05-26T14:00:00.000Z",
				componentId: FIXTURE_COMPONENT_ID,
				record: options.componentQueryData,
				diagnostics: [],
				valid: true,
			},
		);
	}

	return renderToStaticMarkup(
		React.createElement(
			MemoryRouter,
			null,
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(Properties),
			),
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

describe("resolveAttachedComponentClassInventoryLayers", () => {
	it("resolves attached override layers without matching compounds for absent optional axes", () => {
		const version = {
			version: "1",
			publishedAt: "2026-05-26T14:00:00.000Z",
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				className: "base",
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
						},
					},
					size: {
						label: "Size",
						values: {
							lg: { classesByPath: { root: "text-lg" } },
						},
					},
				},
				compoundVariants: [
					{
						when: { tone: "brand", size: "lg" },
						classesByPath: { root: "ring-2" },
					},
				],
			},
			overrideTargets: {
				rootTarget: {
					targetId: "rootTarget",
					label: "Root",
					path: "root",
				},
			},
		};

		const layers = resolveAttachedComponentClassInventoryLayers({
			version,
			targetPath: "root",
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "p-6" } },
			context: {
				systemId: "sys-core",
				componentId: FIXTURE_COMPONENT_ID,
				instanceId: "instance-1",
			},
		});

		expect(layers.map((layer) => layer.className)).toEqual([
			"base",
			"text-blue-600",
			"p-6",
		]);
		expect(layers.map((layer) => layer.source)).toEqual([
			"system-template",
			"system-variant",
			"instance-override",
		]);
		expect(layers.map((layer) => layer.metadata)).toEqual([
			expect.objectContaining({ path: "root" }),
			expect.objectContaining({ axis: "tone", value: "brand" }),
			expect.objectContaining({ prop: "className" }),
		]);
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

	it("shows attached component controls on the instance root and hides registry mutation controls", () => {
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: "cmp_11111111-1111-4111-8111-111111111111",
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					variantValues: { tone: "brand" },
					overrides: { rootTarget: { className: "rounded-md" } },
				}),
			},
			children: [],
		};

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			rootNode.id,
			{
				systemId: "sys-core",
				componentQueryData: createFixturePublishedRecord(),
			},
		);

		expect(html).toContain("Detach component");
		expect(html).toContain("Variants");
		expect(html).toContain("Tone");
		expect(html).toContain("brand");
		expect(html).not.toContain("Label class");
	});

	it("does not show className overrides as a dedicated properties section", () => {
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
				}),
			},
			children: [],
		};
		const record = createFixturePublishedRecord();
		const version = record.published?.versions["1"];
		if (!version) {
			throw new Error("Missing fixture version");
		}

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			rootNode.id,
			{
				systemId: "sys-core",
				componentQueryData: {
					...record,
					published: {
						...record.published,
						currentVersion: "1",
						versions: {
							"1": {
								...version,
								overrideTargets: {
									rootTarget: {
										targetId: "rootTarget",
										label: "Root class",
										path: "root",
									},
									labelTarget: {
										targetId: "labelTarget",
										label: "Label class",
										path: "label",
									},
								},
							},
						},
					},
				},
			},
		);

		expect(html).not.toContain("Overrides");
		expect(html).not.toContain("Root class");
		expect(html).not.toContain("Label class");
	});

	it("enables update for a current-version instance missing hash markers", () => {
		const v1Draft = {
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [],
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
							neutral: { classesByPath: { root: "text-zinc-700" } },
						},
					},
				},
			},
		};
		const v1Hash = hashSystemComponentTemplate(v1Draft);
		const v1VariantHash = hashSystemComponentVariantSchema(v1Draft.variants);
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					variantValues: { tone: "brand" },
				}),
			},
			children: [],
		};

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			rootNode.id,
			{
				systemId: "sys-core",
				componentQueryData: createFixturePublishedRecord({
					published: {
						currentVersion: "1",
						versions: {
							"1": {
								...v1Draft,
								version: "1",
								publishedAt: "2026-05-26T14:00:00.000Z",
								templateHash: v1Hash,
								variantSchemaHash: v1VariantHash,
							},
						},
					},
				}),
			},
		);

		expect(html).toContain("Update component");
		expect(html).toContain("Template and variants changed");
		expect(html).not.toMatch(/Update component[^<]*disabled/);
	});

	it("shows stale component migration review and update controls on the instance root", () => {
		const v1Draft = {
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [],
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
							neutral: { classesByPath: { root: "text-zinc-700" } },
						},
					},
				},
			},
		};
		const v1Hash = hashSystemComponentTemplate(v1Draft);
		const v1VariantHash = hashSystemComponentVariantSchema(v1Draft.variants);
		const v2Draft = {
			...v1Draft,
			root: {
				...v1Draft.root,
				className: "card-v2",
			},
		};
		const v2Hash = hashSystemComponentTemplate(v2Draft);
		const v2VariantHash = hashSystemComponentVariantSchema(v2Draft.variants);
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					variantValues: { tone: "brand" },
					templateHash: "sha256:stale",
					variantSchemaHash: "sha256:stale",
				}),
			},
			children: [],
		};

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			rootNode.id,
			{
				systemId: "sys-core",
				componentQueryData: createFixturePublishedRecord({
					published: {
						currentVersion: "2",
						versions: {
							"1": {
								...v1Draft,
								version: "1",
								publishedAt: "2026-05-26T14:00:00.000Z",
								templateHash: v1Hash,
								variantSchemaHash: v1VariantHash,
							},
							"2": {
								...v2Draft,
								version: "2",
								previousVersion: "1",
								publishedAt: "2026-05-26T15:00:00.000Z",
								templateHash: v2Hash,
								variantSchemaHash: v2VariantHash,
							},
						},
					},
				}),
			},
		);

		expect(html).toContain("Update component");
		expect(html).toMatch(/Template and variants changed|Update available/);
		expect(html).not.toContain("Manual updates are coming in a later wave");
	});

	it("shows read-only attached component context for owned internal nodes", () => {
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: "cmp_11111111-1111-4111-8111-111111111111",
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
				}),
			},
			children: [
				{
					id: "component-label",
					props: {
						"data-trickroom-name": "Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...getSystemComponentMarkerProps({
							systemId: "sys-core",
							componentId: "cmp_11111111-1111-4111-8111-111111111111",
							instanceId: "component-instance-1",
							version: "1",
							path: "label",
						}),
					},
					children: "Label",
				},
			],
		};

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			"component-label",
			{
				systemId: "sys-core",
				componentQueryData: createFixturePublishedRecord(),
			},
		);

		expect(html).toContain("Attached component");
		expect(html).toContain("Template path");
		expect(html).toContain("label");
		expect(html).not.toContain("Detach component");
	});

	it("keeps path-scoped className overrides out of the properties tab on owned internal component nodes", () => {
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					overrides: { labelTarget: { className: "text-lg" } },
				}),
			},
			children: [
				{
					id: "component-label",
					props: {
						"data-trickroom-name": "Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...getSystemComponentMarkerProps({
							systemId: "sys-core",
							componentId: FIXTURE_COMPONENT_ID,
							instanceId: "component-instance-1",
							version: "1",
							path: "label",
							overrides: { labelTarget: { className: "text-lg" } },
						}),
					},
					children: "Label",
				},
			],
		};
		const record = createFixturePublishedRecord();
		const version = record.published?.versions["1"];
		if (!version) {
			throw new Error("Missing fixture version");
		}

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			"component-label",
			{
				systemId: "sys-core",
				componentQueryData: {
					...record,
					published: {
						...record.published,
						currentVersion: "1",
						versions: {
							"1": {
								...version,
								overrideTargets: {
									rootTarget: {
										targetId: "rootTarget",
										label: "Root class",
										path: "root",
									},
									labelTarget: {
										targetId: "labelTarget",
										label: "Label class",
										path: "label",
									},
								},
							},
						},
					},
				},
			},
		);

		expect(html).toContain("Template path");
		expect(html).toContain("label");
		expect(html).not.toContain("Overrides");
		expect(html).not.toContain("Label class");
		expect(html).not.toContain("Root class");
		expect(html).not.toContain("Variants");
		expect(html).not.toContain("Detach component");
	});

	it("routes text overrides into the normal content field on owned internal nodes", () => {
		const rootNode: Node = {
			id: "component-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "component-instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					overrides: { labelTarget: { text: "Save changes" } },
				}),
			},
			children: [
				{
					id: "component-label",
					props: {
						"data-trickroom-name": "Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...getSystemComponentMarkerProps({
							systemId: "sys-core",
							componentId: FIXTURE_COMPONENT_ID,
							instanceId: "component-instance-1",
							version: "1",
							path: "label",
							overrides: { labelTarget: { text: "Save changes" } },
						}),
					},
					children: "Label",
				},
			],
		};
		const record = createFixturePublishedRecord();
		const version = record.published?.versions["1"];
		if (!version) {
			throw new Error("Missing fixture version");
		}

		const html = renderPropertiesForSelection(
			{ name: "Component design", boards: [rootNode] },
			"component-label",
			{
				systemId: "sys-core",
				componentQueryData: {
					...record,
					published: {
						...record.published,
						currentVersion: "1",
						versions: {
							"1": {
								...version,
								overrideTargets: {
									labelTarget: {
										targetId: "labelTarget",
										label: "Label text",
										path: "label",
										capabilities: ["className", "text"],
									},
								},
							},
						},
					},
				},
			},
		);

		expect(html).toContain("Content");
		expect(html).toContain('value="Save changes"');
		expect(html).not.toContain("Overrides");
		expect(html).not.toContain("Label text");
	});
});
