import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	type RegistryId,
	type RegistryResolution,
	resolveRegistryComponent,
} from "../libraries/registry";
import {
	getRecipeMarkerProps,
	RECIPE_MARKER_PROP_KEYS,
	recipeInstanceProp,
} from "../recipes/markers";
import type { TrickroomDesign } from "../types";
import { createDesignSystemStorage } from "../utils/design-system-store";
import { assetIdProp } from "../utils/resource-props";
import type { SystemComponentManifestRevision } from "../utils/system-component-manifest-service";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	SYSTEM_COMPONENT_MARKER_PROP_KEYS,
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentPathProp,
	systemComponentRootProp,
	systemComponentVariantValuesProp,
} from "../utils/system-component-markers";
import {
	createSystemComponentDraft,
	publishSystemComponentDraft,
	updateSystemComponentDraftOverrideTargets,
	updateSystemComponentDraftTemplate,
	updateSystemComponentDraftVariants,
} from "../utils/system-component-operations";
import {
	applyAddElement,
	applyAddSubtree,
	applyAddSystemComponent,
	applyCopySubtree,
	applyDeleteElement,
	applyDetachSystemComponent,
	applyExtractSubtree,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	applyUpdateSystemComponentInstance,
	cloneBoardForMigrationTrial,
	DesignTransformError,
	normalizeDesignForMutation,
	serializeFlatDesign,
	validateProposedSubtreeForInsertion,
} from "./design-transform-service";

const separatorBaseClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

const getKnownRegistryDefinition = (
	library: RegistryId,
	component: string,
): Extract<RegistryResolution, { status: "known" }>["definition"] => {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		throw new Error(`${library}/${component} must resolve for this test`);
	}

	return resolution.definition;
};

const containerElement = (
	id: string,
	children: TrickroomDesign["boards"] = [],
	name = id,
) => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom" as const,
		"data-trickroom-component": "container" as const,
	},
	children,
});

const textElement = (id: string, text = "Hello", name = id) => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom" as const,
		"data-trickroom-component": "text" as const,
		"data-trickroom-role": "text" as const,
	},
	children: text,
});

const simpleDesign: TrickroomDesign = {
	name: "Test Design",
	boards: [
		containerElement("root", [
			textElement("title", "Hello"),
			containerElement("inner", [textElement("inner-text", "World")]),
		]),
	],
};

const findNode = (
	nodes: TrickroomDesign["boards"],
	id: string,
): TrickroomDesign["boards"][number] | null => {
	for (const node of nodes) {
		if (node.id === id) {
			return node;
		}
		if (Array.isArray(node.children)) {
			const match = findNode(node.children, id);
			if (match) {
				return match;
			}
		}
	}
	return null;
};

const avatarRecipeDesign = (): TrickroomDesign => ({
	name: "Recipe Design",
	boards: [
		{
			id: "avatar-root",
			props: {
				"data-trickroom-name": "Avatar Root",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.root",
				"data-trickroom-role": "branch",
				...getRecipeMarkerProps({
					recipeId: "base-ui/avatar.default",
					instanceId: "recipe-instance-1",
					path: "root",
					isRoot: true,
				}),
			},
			children: [
				{
					id: "avatar-image",
					props: {
						"data-trickroom-name": "Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "",
						alt: "",
						...getRecipeMarkerProps({
							recipeId: "base-ui/avatar.default",
							instanceId: "recipe-instance-1",
							path: "image",
						}),
					},
					children: [],
				},
				{
					id: "avatar-fallback",
					props: {
						"data-trickroom-name": "Avatar Fallback",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.fallback",
						"data-trickroom-role": "branch",
						...getRecipeMarkerProps({
							recipeId: "base-ui/avatar.default",
							instanceId: "recipe-instance-1",
							path: "fallback",
							slotName: "fallback",
						}),
					},
					children: [
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
					],
				},
			],
		},
	],
});

const menuRecipeDesign = (): TrickroomDesign => ({
	name: "Menu Recipe Design",
	boards: [
		{
			id: "menu-root",
			props: {
				"data-trickroom-name": "Menu Root",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "menu.root",
				"data-trickroom-role": "branch",
				...getRecipeMarkerProps({
					recipeId: "base-ui/menu.default",
					instanceId: "recipe-instance-1",
					path: "root",
					isRoot: true,
				}),
			},
			children: [
				{
					id: "menu-trigger",
					props: {
						"data-trickroom-name": "Menu Trigger",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "menu.trigger",
						"data-trickroom-role": "branch",
						...getRecipeMarkerProps({
							recipeId: "base-ui/menu.default",
							instanceId: "recipe-instance-1",
							path: "trigger",
							slotName: "trigger",
						}),
					},
					children: [],
				},
				{
					id: "menu-portal",
					props: {
						"data-trickroom-name": "Menu Portal",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "menu.portal",
						"data-trickroom-role": "branch",
						...getRecipeMarkerProps({
							recipeId: "base-ui/menu.default",
							instanceId: "recipe-instance-1",
							path: "portal",
						}),
					},
					children: [
						{
							id: "menu-positioner",
							props: {
								"data-trickroom-name": "Menu Positioner",
								"data-trickroom-library": "base-ui",
								"data-trickroom-component": "menu.positioner",
								"data-trickroom-role": "branch",
								...getRecipeMarkerProps({
									recipeId: "base-ui/menu.default",
									instanceId: "recipe-instance-1",
									path: "positioner",
								}),
							},
							children: [
								{
									id: "menu-popup",
									props: {
										"data-trickroom-name": "Menu Popup",
										"data-trickroom-library": "base-ui",
										"data-trickroom-component": "menu.popup",
										"data-trickroom-role": "branch",
										...getRecipeMarkerProps({
											recipeId: "base-ui/menu.default",
											instanceId: "recipe-instance-1",
											path: "popup",
											slotName: "items",
										}),
									},
									children: [],
								},
							],
						},
					],
				},
			],
		},
	],
});

const systemComponentSubtree = (
	rootId: string,
	systemId: string,
	componentId: string,
	instanceId: string,
): TrickroomDesign["boards"][number] => ({
	id: rootId,
	props: {
		"data-trickroom-name": `${rootId} Root`,
		"data-trickroom-library": "trickroom" as const,
		"data-trickroom-component": "container" as const,
		"data-trickroom-role": "branch" as const,
		...getSystemComponentMarkerProps({
			systemId,
			componentId,
			instanceId,
			version: "1",
			path: "root",
			isRoot: true,
			variantValues: { tone: "brand" },
			overrides: {},
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		}),
	},
	children: [
		{
			id: `${rootId}-label`,
			props: {
				"data-trickroom-name": `${rootId} Label`,
				"data-trickroom-library": "trickroom" as const,
				"data-trickroom-component": "text" as const,
				"data-trickroom-role": "text" as const,
				...getSystemComponentMarkerProps({
					systemId,
					componentId,
					instanceId,
					version: "1",
					path: "label",
				}),
			},
			children: "Locked",
		},
	],
});

const multiSystemComponentDesign = (): TrickroomDesign => ({
	name: "Multi System Components",
	systemId: "sys-core",
	boards: [
		containerElement(
			"wrapper",
			[
				systemComponentSubtree(
					"component-a",
					"sys-core",
					"cmp_11111111-1111-4111-8111-111111111111",
					"component-instance-a",
				),
				systemComponentSubtree(
					"component-b",
					"sys-alt",
					"cmp_22222222-2222-4222-8222-222222222222",
					"component-instance-b",
				),
			],
			"Wrapper",
		),
	],
});

const systemComponentDesign = (): TrickroomDesign => ({
	name: "Component Design",
	systemId: "sys-core",
	boards: [
		{
			id: "component-root",
			props: {
				"data-trickroom-name": "Component Root",
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
					overrides: {},
					templateHash: "sha256:template",
					variantSchemaHash: "sha256:variants",
				}),
			},
			children: [
				{
					id: "component-label",
					props: {
						"data-trickroom-name": "Component Label",
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
					children: "Locked",
				},
				{
					id: "component-slot",
					props: {
						"data-trickroom-name": "Component Slot",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						...getSystemComponentMarkerProps({
							systemId: "sys-core",
							componentId: "cmp_11111111-1111-4111-8111-111111111111",
							instanceId: "component-instance-1",
							version: "1",
							path: "slot",
							slotName: "default",
						}),
					},
					children: [
						{
							id: "component-slot-child",
							props: {
								"data-trickroom-name": "Slot Child",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Editable",
						},
					],
				},
			],
		},
	],
});

describe("applyAddElement", () => {
	it("adds a container element to the root", () => {
		const design: TrickroomDesign = { name: "D", boards: [] };
		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});

		expect(result.boards).toHaveLength(1);
		expect(result.boards[0].id).toBe(changedElementId);
		expect(result.boards[0].props["data-trickroom-name"]).toBe("Container");
		expect(result.boards[0].props["data-trickroom-library"]).toBe("trickroom");
		expect(result.boards[0].props["data-trickroom-component"]).toBe(
			"container",
		);
		expect(result.boards[0].props["data-trickroom-role"]).toBe("branch");
		expect(result.boards[0].children).toEqual([]);
	});

	it("adds a text element with initial text", () => {
		const { design: result } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "text",
			name: "Heading",
			text: "Initial content",
		});

		const root = result.boards[0];
		expect(Array.isArray(root.children)).toBe(true);
		const children = root.children as TrickroomDesign["boards"];
		const heading = children.find(
			(c) => c.props["data-trickroom-name"] === "Heading",
		);
		expect(heading).toBeDefined();
		expect(heading?.props["data-trickroom-role"]).toBe("text");
		expect(heading?.children).toBe("Initial content");
	});

	it("uses default text 'Text' for text elements without text param", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "text",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const newEl = children.find((c) => c.id === changedElementId);
		expect(newEl?.children).toBe("Text");
	});

	it("inserts at specified index", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				containerElement("a"),
				containerElement("b"),
				containerElement("c"),
			],
		};

		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: null,
			index: 1,
			library: "trickroom",
			component: "container",
		});

		const ids = result.boards.map((b) => b.id);
		expect(ids[1]).toBe(changedElementId);
		expect(ids).toEqual(["a", changedElementId, "b", "c"]);
	});

	it("applies className when provided", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "trickroom",
			component: "container",
			className: "flex gap-4",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const newEl = children.find((c) => c.id === changedElementId);
		expect(newEl?.props.className).toBe("flex gap-4");
	});

	it("throws UNKNOWN_REGISTRY_LIBRARY for unknown library", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "nonexistent",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "UNKNOWN_REGISTRY_LIBRARY",
			}),
		);
	});

	it("throws UNKNOWN_REGISTRY_COMPONENT for unknown component", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: null,
				index: 0,
				library: "trickroom",
				component: "unknown-component",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "UNKNOWN_REGISTRY_COMPONENT",
			}),
		);
	});

	it("throws PARENT_NOT_FOUND when parent does not exist", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: "nonexistent",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_NOT_FOUND",
			}),
		);
	});

	it("throws PARENT_CANNOT_HAVE_CHILDREN when parent is a text element", () => {
		expect(() =>
			applyAddElement(simpleDesign, {
				parentId: "title",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_CANNOT_HAVE_CHILDREN",
			}),
		);
	});

	it("adds Base UI Separator as a leaf with orientation defaults", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 1,
			library: "base-ui",
			component: "separator",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const separator = children.find((child) => child.id === changedElementId);
		expect(separator).toMatchObject({
			props: {
				"data-trickroom-name": "Separator",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "separator",
				"data-trickroom-role": "leaf",
				orientation: "horizontal",
			},
			children: [],
		});
		expect(separator?.props).not.toHaveProperty("className");
		expect(
			getRenderableProps(
				separator?.props ?? {},
				getKnownRegistryDefinition("base-ui", "separator"),
			).className,
		).toBe(separatorBaseClassName);
	});

	it("adds Base UI Menu Separator without persisting base className", () => {
		const { design: result, changedElementId } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 1,
			library: "base-ui",
			component: "menu.separator",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const separator = children.find((child) => child.id === changedElementId);
		expect(separator).toMatchObject({
			props: {
				"data-trickroom-name": "Menu Separator",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "menu.separator",
				"data-trickroom-role": "leaf",
				orientation: "horizontal",
			},
			children: [],
		});
		expect(separator?.props).not.toHaveProperty("className");
		expect(
			getRenderableProps(
				separator?.props ?? {},
				getKnownRegistryDefinition("base-ui", "menu.separator"),
			).className,
		).toBe(separatorBaseClassName);
	});

	describe("props parameter", () => {
		it("applies data-trickroom-name from props when name shortcut is absent", () => {
			const { design: result, changedElementId } = applyAddElement(
				simpleDesign,
				{
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-trickroom-name": "From Props" },
				},
			);

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props["data-trickroom-name"]).toBe("From Props");
		});

		it("applies className from props when className shortcut is absent", () => {
			const { design: result, changedElementId } = applyAddElement(
				simpleDesign,
				{
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { className: "p-4 bg-white" },
				},
			);

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props.className).toBe("p-4 bg-white");
		});

		it("name shortcut overrides props[data-trickroom-name]", () => {
			const { design: result, changedElementId } = applyAddElement(
				simpleDesign,
				{
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					name: "Shortcut Name",
					props: { "data-trickroom-name": "Props Name" },
				},
			);

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props["data-trickroom-name"]).toBe("Shortcut Name");
		});

		it("className shortcut overrides props.className", () => {
			const { design: result, changedElementId } = applyAddElement(
				simpleDesign,
				{
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					className: "shortcut-class",
					props: { className: "props-class" },
				},
			);

			const board = result.boards.find((b) => b.id === changedElementId);
			expect(board?.props.className).toBe("shortcut-class");
		});

		it("applies registry-backed control props", () => {
			const { design: result, changedElementId } = applyAddElement(
				simpleDesign,
				{
					parentId: "root",
					index: 0,
					library: "base-ui",
					component: "separator",
					props: { orientation: "vertical" },
				},
			);

			const root = result.boards[0];
			const separator = (root.children as TrickroomDesign["boards"]).find(
				(child) => child.id === changedElementId,
			);
			expect(separator?.props.orientation).toBe("vertical");
		});

		it("throws INVALID_PROP_VALUE for invalid control values", () => {
			expect(() =>
				applyAddElement(simpleDesign, {
					parentId: "root",
					index: 0,
					library: "base-ui",
					component: "separator",
					props: { orientation: "diagonal" },
				}),
			).toThrow(
				expect.objectContaining({
					name: "DesignTransformError",
					code: "INVALID_PROP_VALUE",
				}),
			);
		});

		it("throws INVALID_PROP_KEY for registry-reference keys in props", () => {
			for (const key of [
				"data-trickroom-library",
				"data-trickroom-component",
				"data-trickroom-role",
			]) {
				expect(() =>
					applyAddElement(simpleDesign, {
						parentId: null,
						index: 0,
						library: "trickroom",
						component: "container",
						props: { [key]: "anything" },
					}),
				).toThrow(
					expect.objectContaining({
						name: "DesignTransformError",
						code: "INVALID_PROP_KEY",
					}),
				);
			}
		});

		it("throws INVALID_PROP_KEY for unknown prop keys", () => {
			expect(() =>
				applyAddElement(simpleDesign, {
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-custom": "value" },
				}),
			).toThrow(
				expect.objectContaining({
					name: "DesignTransformError",
					code: "INVALID_PROP_KEY",
				}),
			);
		});

		it("does not mutate the design when props are invalid (no persistence)", () => {
			const inputJson = JSON.stringify(simpleDesign);

			expect(() =>
				applyAddElement(simpleDesign, {
					parentId: null,
					index: 0,
					library: "trickroom",
					component: "container",
					props: { "data-trickroom-library": "trickroom" },
				}),
			).toThrow();

			expect(JSON.stringify(simpleDesign)).toBe(inputJson);
		});
	});

	it("rejects inserting into recipe-owned non-slot structure but allows declared slots", () => {
		const design = avatarRecipeDesign();

		expect(() =>
			applyAddElement(design, {
				parentId: "avatar-root",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_STRUCTURE_LOCKED",
			}),
		);

		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: "avatar-fallback",
			index: 0,
			library: "trickroom",
			component: "text",
			text: "JP",
		});

		const fallback = findNode(result.boards, "avatar-fallback");
		expect(
			(fallback?.children as TrickroomDesign["boards"]).map(
				(child) => child.id,
			),
		).toContain(changedElementId);
	});

	it("rejects inserting into component-owned non-slot structure but allows component slots", () => {
		const design = systemComponentDesign();

		expect(() =>
			applyAddElement(design, {
				parentId: "component-root",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURE_LOCKED",
			}),
		);

		const { design: result, changedElementId } = applyAddElement(design, {
			parentId: "component-slot",
			index: 0,
			library: "trickroom",
			component: "text",
			text: "Allowed",
		});

		const slot = findNode(result.boards, "component-slot");
		expect(
			(slot?.children as TrickroomDesign["boards"]).map((child) => child.id),
		).toContain(changedElementId);
	});

	it("rejects disallowed component insertions into allowlisted recipe slots", () => {
		expect(() =>
			applyAddElement(menuRecipeDesign(), {
				parentId: "menu-popup",
				index: 0,
				library: "trickroom",
				component: "container",
			}),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_SLOT_DISALLOWED_CHILD",
			}),
		);
	});

	it("generates a unique UUID for each new element", () => {
		const { changedElementId: id1 } = applyAddElement(simpleDesign, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});
		const { changedElementId: id2 } = applyAddElement(simpleDesign, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "container",
		});
		expect(id1).not.toBe(id2);
		expect(id1).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});
});

describe("validateProposedSubtreeForInsertion", () => {
	it("normalizes a nested element subtree and builds an in-memory candidate", () => {
		const result = validateProposedSubtreeForInsertion(simpleDesign, {
			parentId: "root",
			index: 1,
			subtree: {
				tempId: "outer",
				library: "trickroom",
				component: "container",
				name: "Outer",
				children: [
					{
						tempId: "copy",
						library: "trickroom",
						component: "text",
						text: "Inserted",
					},
				],
			},
			options: { includeNormalizedTree: true },
		});

		expect(result.valid).toBe(true);
		expect(result.diagnostics).toEqual([]);
		expect(result.stats).toEqual({
			nodeCount: 2,
			maxDepth: 2,
			recipeCount: 0,
		});
		expect(result.candidateDesign).not.toBeNull();
		expect(result.normalizedSubtree).toMatchObject({
			kind: "element",
			tempId: "outer",
			library: "trickroom",
			component: "container",
			role: "branch",
			children: [
				{
					kind: "element",
					tempId: "copy",
					component: "text",
					text: "Inserted",
				},
			],
		});

		const root = findNode(result.candidateDesign?.boards ?? [], "root");
		const childNames = (root?.children as TrickroomDesign["boards"]).map(
			(child) => child.props["data-trickroom-name"],
		);
		expect(childNames).toEqual(["title", "Outer", "inner"]);
	});

	it("validates insertion indexes strictly without clamping", () => {
		const result = validateProposedSubtreeForInsertion(simpleDesign, {
			parentId: "root",
			index: 99,
			subtree: {
				library: "trickroom",
				component: "container",
			},
		});

		expect(result.valid).toBe(false);
		expect(result.candidateDesign).toBeNull();
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "INDEX_OUT_OF_BOUNDS",
				path: "/index",
				details: expect.objectContaining({ max: 2 }),
			}),
		);
	});

	it("does not descend into invalid children under text nodes during validation", () => {
		const result = validateProposedSubtreeForInsertion(simpleDesign, {
			parentId: "root",
			index: 0,
			subtree: {
				tempId: "same",
				library: "trickroom",
				component: "text",
				children: [
					{
						tempId: "same",
						library: "trickroom",
						component: "container",
					},
				],
			},
		});

		expect(result.valid).toBe(false);
		expect(result.stats).toEqual({
			nodeCount: 1,
			maxDepth: 1,
			recipeCount: 0,
		});
		expect(result.candidateDesign).toBeNull();
		expect(result.candidateElementIds).toEqual([]);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PARENT_CANNOT_HAVE_CHILDREN",
				path: "/subtree/children",
				tempId: "same",
			}),
		);
		expect(result.diagnostics).not.toContainEqual(
			expect.objectContaining({
				code: "DUPLICATE_TEMP_ID",
				path: "/subtree/children/0/tempId",
			}),
		);
	});

	it("reuses instance prop validation for proposed element props", () => {
		const result = validateProposedSubtreeForInsertion(simpleDesign, {
			parentId: null,
			index: 1,
			subtree: {
				library: "trickroom",
				component: "container",
				props: {
					"data-trickroom-library": "trickroom",
				},
			},
		});

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "INVALID_PROP_KEY",
				path: "/subtree/props",
			}),
		);
	});

	it("expands recipe nodes for stats and candidate validation", () => {
		const result = validateProposedSubtreeForInsertion(simpleDesign, {
			parentId: "root",
			index: 1,
			subtree: {
				kind: "recipe",
				tempId: "avatar",
				library: "base-ui",
				recipe: "avatar.default",
			},
			options: { includeNormalizedTree: true },
		});

		expect(result.valid).toBe(true);
		expect(result.stats).toEqual({
			nodeCount: 3,
			maxDepth: 2,
			recipeCount: 1,
		});
		expect(result.recipeExpansions).toEqual([
			expect.objectContaining({
				tempId: "avatar",
				recipeId: "base-ui/avatar.default",
				nodeCount: 3,
				maxDepth: 2,
			}),
		]);
		expect(result.normalizedSubtree).toMatchObject({
			kind: "recipe",
			tempId: "avatar",
			expansion: {
				recipeId: "base-ui/avatar.default",
			},
		});

		const root = findNode(result.candidateDesign?.boards ?? [], "root");
		const inserted = (root?.children as TrickroomDesign["boards"])[1];
		expect(inserted.props).toMatchObject({
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "avatar.root",
		});
	});

	it("reuses recipe boundary validation for insertion targets", () => {
		const result = validateProposedSubtreeForInsertion(avatarRecipeDesign(), {
			parentId: "avatar-root",
			index: 0,
			subtree: {
				library: "trickroom",
				component: "container",
			},
		});

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "RECIPE_STRUCTURE_LOCKED",
				path: "/parentId",
			}),
		);
	});

	it("validates subtree roots against recipe slot allowlists", () => {
		const result = validateProposedSubtreeForInsertion(menuRecipeDesign(), {
			parentId: "menu-popup",
			index: 0,
			subtree: {
				library: "trickroom",
				component: "container",
			},
		});

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "RECIPE_SLOT_DISALLOWED_CHILD",
				path: "/parentId",
			}),
		);
		expect(result.candidateDesign).toBeNull();
	});
});

describe("applyAddSubtree", () => {
	it("adds a nested element subtree with generated IDs and tempId mapping", () => {
		const {
			design: result,
			rootElementId,
			idMap,
			inserted,
		} = applyAddSubtree(simpleDesign, {
			parentId: "root",
			index: 1,
			subtree: {
				tempId: "outer",
				library: "trickroom",
				component: "container",
				name: "Outer",
				children: [
					{
						tempId: "label",
						library: "trickroom",
						component: "text",
						text: "Inserted",
					},
				],
			},
		});

		expect(rootElementId).toBe(idMap.outer);
		expect(idMap).toEqual({
			outer: rootElementId,
			label: inserted.elementIds[1],
		});
		expect(inserted).toEqual({
			nodeCount: 2,
			rootElementId,
			elementIds: [rootElementId, idMap.label],
		});

		const root = findNode(result.boards, "root");
		const children = root?.children as TrickroomDesign["boards"];
		expect(children.map((child) => child.id)).toEqual([
			"title",
			rootElementId,
			"inner",
		]);
		const outer = children[1];
		expect(outer.props["data-trickroom-name"]).toBe("Outer");
		expect((outer.children as TrickroomDesign["boards"])[0]).toMatchObject({
			id: idMap.label,
			children: "Inserted",
		});
	});

	it("maps only supplied tempIds and reports inserted IDs in pre-order", () => {
		const {
			design: result,
			rootElementId,
			idMap,
			inserted,
		} = applyAddSubtree(simpleDesign, {
			parentId: "root",
			index: 2,
			subtree: {
				tempId: "outer",
				library: "trickroom",
				component: "container",
				children: [
					{
						library: "trickroom",
						component: "container",
						children: [
							{
								tempId: "deep-label",
								library: "trickroom",
								component: "text",
								text: "Deep",
							},
						],
					},
				],
			},
		});

		expect(Object.keys(idMap).sort()).toEqual(["deep-label", "outer"]);
		expect(rootElementId).toBe(idMap.outer);
		expect(inserted.nodeCount).toBe(3);
		expect(inserted.elementIds[0]).toBe(rootElementId);
		expect(inserted.elementIds[2]).toBe(idMap["deep-label"]);

		const outer = findNode(result.boards, rootElementId);
		const middle = (outer?.children as TrickroomDesign["boards"])[0];
		const deepLabel = (middle.children as TrickroomDesign["boards"])[0];
		expect(inserted.elementIds).toEqual([
			rootElementId,
			middle.id,
			idMap["deep-label"],
		]);
		expect(deepLabel.id).toBe(idMap["deep-label"]);
	});

	it("adds recipe nodes and reports recipe internals in pre-order", () => {
		const result = applyAddSubtree(simpleDesign, {
			parentId: "root",
			index: 1,
			subtree: {
				kind: "recipe",
				tempId: "avatar",
				library: "base-ui",
				recipe: "avatar.default",
			},
		});

		expect(result.idMap).toEqual({ avatar: result.rootElementId });
		expect(result.inserted.elementIds).toHaveLength(3);
		expect(result.inserted.elementIds[0]).toBe(result.rootElementId);
		expect(result.recipeExpansions).toEqual([
			expect.objectContaining({
				tempId: "avatar",
				recipeId: "base-ui/avatar.default",
				rootElementId: result.rootElementId,
				elementIdsByPath: expect.objectContaining({
					root: result.rootElementId,
				}),
			}),
		]);
		expect(result.recipeExpansions[0].instanceId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(Object.values(result.recipeExpansions[0].elementIdsByPath)).toEqual(
			result.inserted.elementIds,
		);
	});

	it("rejects out-of-bounds indexes without clamping", () => {
		expect(() =>
			applyAddSubtree(simpleDesign, {
				parentId: "root",
				index: 99,
				subtree: {
					library: "trickroom",
					component: "container",
				},
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "INDEX_OUT_OF_BOUNDS",
			}),
		);
	});

	it("validates the full subtree before allocating persistent IDs", () => {
		let generatedCount = 0;
		const randomUUIDSpy = vi.spyOn(globalThis.crypto, "randomUUID");
		randomUUIDSpy.mockImplementation(() => {
			generatedCount += 1;
			return "00000000-0000-4000-8000-000000000000";
		});

		try {
			expect(() =>
				applyAddSubtree(simpleDesign, {
					parentId: "root",
					index: 0,
					subtree: {
						library: "trickroom",
						component: "text",
						children: [
							{
								library: "trickroom",
								component: "container",
							},
						],
					},
				}),
			).toThrow(
				expect.objectContaining({
					code: "PARENT_CANNOT_HAVE_CHILDREN",
				}),
			);
			expect(generatedCount).toBe(0);
		} finally {
			randomUUIDSpy.mockRestore();
		}
	});

	it("rejects children under leaf elements", () => {
		expect(() =>
			applyAddSubtree(simpleDesign, {
				parentId: "root",
				index: 0,
				subtree: {
					library: "base-ui",
					component: "separator",
					children: [
						{
							library: "trickroom",
							component: "container",
						},
					],
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "PARENT_CANNOT_HAVE_CHILDREN",
			}),
		);
	});
});

describe("applyUpdateElementProps", () => {
	it("updates the element name", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "title",
			name: "New Title",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.props["data-trickroom-name"]).toBe("New Title");
		expect(title?.children).toBe("Hello");
	});

	it("updates className", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "root",
			className: "p-4 bg-white",
		});

		expect(result.boards[0].props.className).toBe("p-4 bg-white");
	});

	it("preserves existing props when only patching some", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				{
					id: "el",
					props: {
						"data-trickroom-name": "Original",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						className: "existing-class",
					},
					children: [],
				},
			],
		};

		const { design: result } = applyUpdateElementProps(design, {
			elementId: "el",
			name: "Renamed",
		});

		expect(result.boards[0].props["data-trickroom-name"]).toBe("Renamed");
		expect(result.boards[0].props.className).toBe("existing-class");
	});

	it("updates registry-backed control props", () => {
		const { design } = applyAddElement(simpleDesign, {
			parentId: "root",
			index: 0,
			library: "base-ui",
			component: "separator",
			name: "Divider",
		});
		const separator = (
			design.boards[0].children as TrickroomDesign["boards"]
		).find((child) => child.props["data-trickroom-name"] === "Divider");
		expect(separator).toBeDefined();

		const { design: result } = applyUpdateElementProps(design, {
			elementId: separator?.id ?? "",
			props: { orientation: "vertical" },
		});

		const updated = (
			result.boards[0].children as TrickroomDesign["boards"]
		).find((child) => child.id === separator?.id);
		expect(updated?.props.orientation).toBe("vertical");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyUpdateElementProps(simpleDesign, {
				elementId: "nonexistent",
				name: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("does not modify other elements", () => {
		const { design: result } = applyUpdateElementProps(simpleDesign, {
			elementId: "title",
			name: "Updated",
		});

		const root = result.boards[0];
		expect(root.props["data-trickroom-name"]).toBe("root");
		const inner = (root.children as TrickroomDesign["boards"]).find(
			(c) => c.id === "inner",
		);
		expect(inner?.props["data-trickroom-name"]).toBe("inner");
	});

	it("allows recipe structural style and declared control updates but rejects marker prop updates", () => {
		const design = avatarRecipeDesign();

		const { design: renamed } = applyUpdateElementProps(design, {
			elementId: "avatar-image",
			name: "Profile Image",
			className: "size-10 rounded-full",
			props: {
				[assetIdProp]: "asset_profile",
				alt: "Profile photo",
			},
		});
		const image = findNode(renamed.boards, "avatar-image");
		expect(image?.props["data-trickroom-name"]).toBe("Profile Image");
		expect(image?.props.className).toBe("size-10 rounded-full");
		expect(image?.props[assetIdProp]).toBe("asset_profile");
		expect(image?.props.alt).toBe("Profile photo");

		expect(() =>
			applyUpdateElementProps(design, {
				elementId: "avatar-image",
				props: { [recipeInstanceProp]: "other-instance" },
			}),
		).toThrow(
			expect.objectContaining({
				code: "INVALID_PROP_KEY",
			}),
		);
	});

	it("rejects component marker props and generic component-owned prop edits", () => {
		expect(() =>
			applyUpdateElementProps(simpleDesign, {
				elementId: "root",
				props: {
					[systemComponentIdProp]: "cmp_11111111-1111-4111-8111-111111111111",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "INVALID_PROP_KEY",
			}),
		);

		expect(() =>
			applyUpdateElementProps(systemComponentDesign(), {
				elementId: "component-label",
				name: "Changed",
			}),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURAL_NODE_LOCKED",
			}),
		);
	});
});

describe("componentMigrationPolicy preservation", () => {
	it("preserves manual policy through normalize and serialize", () => {
		const design = {
			...simpleDesign,
			componentMigrationPolicy: "manual" as const,
		};
		const flat = normalizeDesignForMutation(design);
		expect(flat.componentMigrationPolicy).toBe("manual");
		expect(serializeFlatDesign(flat).componentMigrationPolicy).toBe("manual");
	});

	it("preserves manual policy through applyUpdateElementText", () => {
		const design = {
			...simpleDesign,
			componentMigrationPolicy: "manual" as const,
		};
		const { design: result } = applyUpdateElementText(design, {
			elementId: "title",
			text: "Updated text",
		});
		expect(result.componentMigrationPolicy).toBe("manual");
	});

	it("preserves manual policy through applyExtractSubtree", async () => {
		const design = {
			...simpleDesign,
			componentMigrationPolicy: "manual" as const,
		};
		const { newDesign } = await applyExtractSubtree(design, {
			elementId: "inner",
		});
		expect(newDesign.componentMigrationPolicy).toBe("manual");
	});
});

describe("persisted registry base class migration", () => {
	it("moves legacy seeded separator classes back to registry-owned base styling", () => {
		const design = {
			name: "Legacy separators",
			boards: [
				containerElement("root", [
					{
						id: "separator",
						props: {
							"data-trickroom-name": "Separator",
							"data-trickroom-library": "base-ui",
							"data-trickroom-component": "separator",
							"data-trickroom-role": "leaf",
							orientation: "horizontal",
							className: `${separatorBaseClassName} bg-slate-200`,
						},
						children: [],
					},
					{
						id: "menu-separator",
						props: {
							"data-trickroom-name": "Menu Separator",
							"data-trickroom-library": "base-ui",
							"data-trickroom-component": "menu.separator",
							"data-trickroom-role": "leaf",
							orientation: "horizontal",
							className: separatorBaseClassName,
						},
						children: [],
					},
				]),
			],
		} satisfies TrickroomDesign;

		const serialized = serializeFlatDesign(normalizeDesignForMutation(design));
		const separator = findNode(serialized.boards, "separator");
		const menuSeparator = findNode(serialized.boards, "menu-separator");

		expect(separator?.props.className).toBe("bg-slate-200");
		expect(separator?.props).not.toHaveProperty(MATERIALIZED_BASE_CLASS_PROP);
		expect(menuSeparator?.props).not.toHaveProperty("className");
		expect(menuSeparator?.props).not.toHaveProperty(
			MATERIALIZED_BASE_CLASS_PROP,
		);
		expect(
			getRenderableProps(
				separator?.props ?? {},
				getKnownRegistryDefinition("base-ui", "separator"),
			).className,
		).toBe(`${separatorBaseClassName} bg-slate-200`);
		expect(
			getRenderableProps(
				menuSeparator?.props ?? {},
				getKnownRegistryDefinition("base-ui", "menu.separator"),
			).className,
		).toBe(separatorBaseClassName);
	});

	it("materializes legacy seeded separator classes on attached system component snapshots", () => {
		const design = {
			name: "Legacy attached separator",
			systemId: "sys_11111111-1111-4111-8111-111111111111",
			boards: [
				{
					id: "separator",
					props: {
						"data-trickroom-name": "Separator",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "separator",
						"data-trickroom-role": "leaf",
						orientation: "horizontal",
						className: `${separatorBaseClassName} bg-slate-200`,
						...getSystemComponentMarkerProps({
							systemId: "sys_11111111-1111-4111-8111-111111111111",
							componentId: "cmp_11111111-1111-4111-8111-111111111111",
							instanceId: "instance-1",
							version: "1",
							path: "root",
							isRoot: true,
							templateHash: "sha256:template",
							variantSchemaHash: "sha256:variants",
						}),
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign;

		const serialized = serializeFlatDesign(normalizeDesignForMutation(design));
		const separator = serialized.boards[0];

		expect(separator.props.className).toBe(
			`${separatorBaseClassName} bg-slate-200`,
		);
		expect(separator.props[MATERIALIZED_BASE_CLASS_PROP]).toBe("true");
		expect(
			getRenderableProps(
				separator.props,
				getKnownRegistryDefinition("base-ui", "separator"),
			).className,
		).toBe(`${separatorBaseClassName} bg-slate-200`);
	});
});

describe("applyUpdateElementText", () => {
	it("updates text content of a text role element", () => {
		const { design: result } = applyUpdateElementText(simpleDesign, {
			elementId: "title",
			text: "Updated text",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.children).toBe("Updated text");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyUpdateElementText(simpleDesign, {
				elementId: "nonexistent",
				text: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("throws INVALID_TEXT_UPDATE for non-text elements", () => {
		expect(() =>
			applyUpdateElementText(simpleDesign, {
				elementId: "root",
				text: "x",
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "INVALID_TEXT_UPDATE",
			}),
		);
	});

	it("allows setting empty text", () => {
		const { design: result } = applyUpdateElementText(simpleDesign, {
			elementId: "title",
			text: "",
		});

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		const title = children.find((c) => c.id === "title");
		expect(title?.children).toBe("");
	});

	it("rejects text updates on recipe-owned structural text nodes", () => {
		const design: TrickroomDesign = {
			name: "Recipe Text",
			boards: [
				{
					id: "recipe-label",
					props: {
						"data-trickroom-name": "Recipe Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...getRecipeMarkerProps({
							recipeId: "example/text.recipe",
							instanceId: "recipe-instance-1",
							path: "label",
						}),
					},
					children: "Locked",
				},
			],
		};

		expect(() =>
			applyUpdateElementText(design, {
				elementId: "recipe-label",
				text: "Changed",
			}),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_STRUCTURAL_NODE_LOCKED",
			}),
		);
	});

	it("rejects text updates on component-owned structural text nodes but allows slot content", () => {
		const design = systemComponentDesign();

		expect(() =>
			applyUpdateElementText(design, {
				elementId: "component-label",
				text: "Changed",
			}),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURAL_NODE_LOCKED",
			}),
		);

		const { design: result } = applyUpdateElementText(design, {
			elementId: "component-slot-child",
			text: "Changed",
		});
		const child = findNode(result.boards, "component-slot-child");
		expect(child?.children).toBe("Changed");
	});
});

describe("applyMoveElement", () => {
	it("reorders within the same parent", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [
				containerElement("parent", [
					containerElement("a"),
					containerElement("b"),
					containerElement("c"),
				]),
			],
		};

		const { design: result } = applyMoveElement(design, {
			elementId: "c",
			targetParentId: "parent",
			index: 0,
		});

		const parent = result.boards[0];
		const childIds = (parent.children as TrickroomDesign["boards"]).map(
			(c) => c.id,
		);
		expect(childIds).toEqual(["c", "a", "b"]);
	});

	it("reparents to a different container", () => {
		const { design: result } = applyMoveElement(simpleDesign, {
			elementId: "title",
			targetParentId: "inner",
			index: 0,
		});

		const root = result.boards[0];
		const rootChildren = root.children as TrickroomDesign["boards"];
		const inner = rootChildren.find((c) => c.id === "inner");
		const innerChildren = inner?.children as TrickroomDesign["boards"];
		expect(innerChildren.map((c) => c.id)).toContain("title");
		expect(rootChildren.map((c) => c.id)).not.toContain("title");
	});

	it("moves element to the root", () => {
		const { design: result } = applyMoveElement(simpleDesign, {
			elementId: "inner",
			targetParentId: null,
			index: 0,
		});

		expect(result.boards.map((b) => b.id)).toContain("inner");
		const root = result.boards.find((b) => b.id === "root");
		const rootChildren = root?.children as TrickroomDesign["boards"];
		expect(rootChildren.map((c) => c.id)).not.toContain("inner");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "nonexistent",
				targetParentId: null,
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("throws CYCLE_DETECTED when moving element into itself", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "root",
				targetParentId: "root",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "CYCLE_DETECTED",
			}),
		);
	});

	it("throws CYCLE_DETECTED when moving element into its descendant", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "root",
				targetParentId: "inner",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "CYCLE_DETECTED",
			}),
		);
	});

	it("throws PARENT_CANNOT_HAVE_CHILDREN when target parent is a text element", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "inner",
				targetParentId: "title",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_CANNOT_HAVE_CHILDREN",
			}),
		);
	});

	it("throws PARENT_NOT_FOUND when target parent does not exist", () => {
		expect(() =>
			applyMoveElement(simpleDesign, {
				elementId: "inner",
				targetParentId: "nonexistent",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "PARENT_NOT_FOUND",
			}),
		);
	});

	it("rejects moving recipe-owned structure and moving content into non-slot structure", () => {
		const design = avatarRecipeDesign();

		expect(() =>
			applyMoveElement(design, {
				elementId: "avatar-image",
				targetParentId: null,
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_STRUCTURAL_NODE_LOCKED",
			}),
		);

		expect(() =>
			applyMoveElement(design, {
				elementId: "slot-child",
				targetParentId: "avatar-root",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_STRUCTURE_LOCKED",
			}),
		);
	});

	it("rejects moving component-owned internals and moving slot content into non-slot structure", () => {
		const design = systemComponentDesign();

		expect(() =>
			applyMoveElement(design, {
				elementId: "component-label",
				targetParentId: null,
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURAL_NODE_LOCKED",
			}),
		);

		expect(() =>
			applyMoveElement(design, {
				elementId: "component-slot-child",
				targetParentId: "component-root",
				index: 0,
			}),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURE_LOCKED",
			}),
		);

		const { design: result } = applyMoveElement(design, {
			elementId: "component-root",
			targetParentId: null,
			index: 0,
		});
		expect(result.boards[0].id).toBe("component-root");
	});
});

describe("applyDeleteElement", () => {
	it("deletes a leaf text element", () => {
		const { design: result, deletedIds } = applyDeleteElement(simpleDesign, {
			elementId: "title",
		});

		expect(deletedIds).toEqual(["title"]);
		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		expect(children.map((c) => c.id)).not.toContain("title");
	});

	it("deletes a subtree including all descendants", () => {
		const { design: result, deletedIds } = applyDeleteElement(simpleDesign, {
			elementId: "inner",
		});

		expect(deletedIds).toContain("inner");
		expect(deletedIds).toContain("inner-text");
		expect(deletedIds).toHaveLength(2);

		const root = result.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		expect(children.map((c) => c.id)).not.toContain("inner");
	});

	it("deletes a root board element", () => {
		const design: TrickroomDesign = {
			name: "D",
			boards: [containerElement("board1"), containerElement("board2")],
		};

		const { design: result } = applyDeleteElement(design, {
			elementId: "board1",
		});

		expect(result.boards.map((b) => b.id)).toEqual(["board2"]);
	});

	it("returns changedElementId matching the deleted element", () => {
		const { changedElementId } = applyDeleteElement(simpleDesign, {
			elementId: "title",
		});
		expect(changedElementId).toBe("title");
	});

	it("throws ELEMENT_NOT_FOUND when element does not exist", () => {
		expect(() =>
			applyDeleteElement(simpleDesign, { elementId: "nonexistent" }),
		).toThrow(
			expect.objectContaining({
				name: "DesignTransformError",
				code: "ELEMENT_NOT_FOUND",
			}),
		);
	});

	it("does not modify the input design object", () => {
		const inputJson = JSON.stringify(simpleDesign);
		applyDeleteElement(simpleDesign, { elementId: "title" });
		expect(JSON.stringify(simpleDesign)).toBe(inputJson);
	});

	it("rejects deleting recipe-owned non-root structure but allows deleting the recipe root", () => {
		const design = avatarRecipeDesign();

		expect(() =>
			applyDeleteElement(design, { elementId: "avatar-image" }),
		).toThrow(
			expect.objectContaining({
				code: "RECIPE_STRUCTURAL_NODE_LOCKED",
			}),
		);

		const { design: result, deletedIds } = applyDeleteElement(design, {
			elementId: "avatar-root",
		});
		expect(result.boards).toEqual([]);
		expect(deletedIds).toEqual([
			"avatar-root",
			"avatar-image",
			"avatar-fallback",
			"slot-child",
		]);
	});

	it("rejects deleting component-owned internals but allows deleting the component root", () => {
		const design = systemComponentDesign();

		expect(() =>
			applyDeleteElement(design, { elementId: "component-label" }),
		).toThrow(
			expect.objectContaining({
				code: "COMPONENT_STRUCTURAL_NODE_LOCKED",
			}),
		);

		const { design: result, deletedIds } = applyDeleteElement(design, {
			elementId: "component-root",
		});
		expect(result.boards).toEqual([]);
		expect(deletedIds).toEqual([
			"component-root",
			"component-label",
			"component-slot",
			"component-slot-child",
		]);
	});
});

describe("applyExtractSubtree", () => {
	it("copies a subtree into a new design with regenerated ids and inherited system", async () => {
		const design: TrickroomDesign = {
			...simpleDesign,
			systemName: "Core",
		};

		const { newDesign, changedElementId, idMap } = await applyExtractSubtree(
			design,
			{
				elementId: "inner",
			},
		);

		expect(newDesign.name).toBe("inner");
		expect(newDesign.systemName).toBe("Core");
		expect(newDesign.boards).toHaveLength(1);
		const root = newDesign.boards[0];
		expect(root.id).toBe(changedElementId);
		expect(root.id).not.toBe("inner");
		expect(root.props["data-trickroom-name"]).toBe("inner");
		expect(root.props["data-trickroom-role"]).toBe("branch");
		const children = root.children as TrickroomDesign["boards"];
		expect(children).toHaveLength(1);
		expect(children[0].id).not.toBe("inner-text");
		expect(children[0].children).toBe("World");
		expect(idMap).toEqual({
			inner: root.id,
			"inner-text": children[0].id,
		});
	});

	it("uses the requested name and supports an explicit system override", async () => {
		const { newDesign } = await applyExtractSubtree(simpleDesign, {
			elementId: "title",
			name: "Heading Copy",
			systemId: null,
		});

		expect(newDesign.name).toBe("Heading Copy");
		expect(newDesign.systemId).toBeNull();
		expect(newDesign.boards[0].props["data-trickroom-name"]).toBe("title");
		expect(newDesign.boards[0].children).toBe("Hello");
	});

	it("falls back to Untitled when the source layer name is blank", async () => {
		const blankText = textElement("blank", "Hello", "");
		const design: TrickroomDesign = {
			name: "Blank Name",
			boards: [containerElement("root", [blankText])],
		};

		const { newDesign } = await applyExtractSubtree(design, {
			elementId: "blank",
		});

		expect(newDesign.name).toBe("Untitled");
	});

	it("throws for missing elements and blank requested names", async () => {
		await expect(
			applyExtractSubtree(simpleDesign, { elementId: "missing" }),
		).rejects.toThrow(DesignTransformError);
		await expect(
			applyExtractSubtree(simpleDesign, { elementId: "title", name: " " }),
		).rejects.toThrow(DesignTransformError);
		await expect(
			applyExtractSubtree(simpleDesign, {
				elementId: "title",
				systemName: " ",
			}),
		).rejects.toThrow(DesignTransformError);
	});

	it("rejects duplicate element ids before extracting", async () => {
		const duplicateDesign: TrickroomDesign = {
			name: "Duplicate IDs",
			boards: [
				containerElement("duplicate"),
				textElement("duplicate", "Later duplicate"),
			],
		};

		await expect(
			applyExtractSubtree(duplicateDesign, { elementId: "duplicate" }),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DUPLICATE_ELEMENT_ID",
		});
	});

	it("does not treat inherited object property names as duplicate ids", async () => {
		const design: TrickroomDesign = {
			name: "Inherited Property ID",
			boards: [textElement("toString", "Still valid", "Layer")],
		};

		const { newDesign } = await applyExtractSubtree(design, {
			elementId: "toString",
		});

		expect(newDesign.name).toBe("Layer");
		expect(newDesign.boards[0].children).toBe("Still valid");
	});

	it("preserves full recipe root attachment with a fresh instance id", async () => {
		const { newDesign } = await applyExtractSubtree(avatarRecipeDesign(), {
			elementId: "avatar-root",
		});

		const root = newDesign.boards[0];
		const image = (root.children as TrickroomDesign["boards"])[0];
		const fallback = (root.children as TrickroomDesign["boards"])[1];
		const instanceId = root.props[recipeInstanceProp];

		expect(newDesign.name).toBe("Avatar Root");
		expect(instanceId).toEqual(expect.any(String));
		expect(instanceId).not.toBe("recipe-instance-1");
		expect(image.props[recipeInstanceProp]).toBe(instanceId);
		expect(fallback.props[recipeInstanceProp]).toBe(instanceId);
		expect(root.props["data-trickroom-recipe-id"]).toBe(
			"base-ui/avatar.default",
		);
		expect(root.props["data-trickroom-recipe-root"]).toBe("true");
		expect(root.props["data-trickroom-recipe-path"]).toBe("root");
		expect(fallback.props["data-trickroom-recipe-slot"]).toBe("fallback");
		expect(
			(fallback.children as TrickroomDesign["boards"])[0].props[
				"data-trickroom-name"
			],
		).toBe("Slot Child");
	});

	it("strips markers when extracting a partial recipe structural node", async () => {
		const design = avatarRecipeDesign();
		const image = design.boards[0].children[0];
		image.props[assetIdProp] = "asset-avatar";
		image.props.alt = "Ada avatar";
		image.props.className = "rounded-full";

		const { newDesign } = await applyExtractSubtree(design, {
			elementId: "avatar-image",
		});

		const root = newDesign.boards[0];
		expect(newDesign.name).toBe("Avatar Image");
		expect(root.props[assetIdProp]).toBe("asset-avatar");
		expect(root.props.alt).toBe("Ada avatar");
		expect(root.props.className).toBe("rounded-full");
		expect(root.props["data-trickroom-name"]).toBe("Avatar Image");
		for (const markerProp of RECIPE_MARKER_PROP_KEYS) {
			expect(root.props).not.toHaveProperty(markerProp);
		}
	});

	it("preserves full system component root attachment with a fresh instance id", async () => {
		const { newDesign } = await applyExtractSubtree(systemComponentDesign(), {
			elementId: "component-root",
		});

		const root = newDesign.boards[0];
		const label = (root.children as TrickroomDesign["boards"])[0];
		const slot = (root.children as TrickroomDesign["boards"])[1];
		const instanceId = root.props[systemComponentInstanceProp];

		expect(instanceId).toEqual(expect.any(String));
		expect(instanceId).not.toBe("component-instance-1");
		expect(label.props[systemComponentInstanceProp]).toBe(instanceId);
		expect(slot.props[systemComponentInstanceProp]).toBe(instanceId);
		expect(root.props[systemComponentRootProp]).toBe("true");
	});

	it("strips markers when extracting a partial system component structural node", async () => {
		const { newDesign } = await applyExtractSubtree(systemComponentDesign(), {
			elementId: "component-label",
		});

		const root = newDesign.boards[0];
		expect(root.props["data-trickroom-name"]).toBe("Component Label");
		expect(root.children).toBe("Locked");
		for (const markerProp of SYSTEM_COMPONENT_MARKER_PROP_KEYS) {
			expect(root.props).not.toHaveProperty(markerProp);
		}
	});

	it("rejects extracting a complete attached system component root into an unlinked design", async () => {
		await expect(
			applyExtractSubtree(systemComponentDesign(), {
				elementId: "component-root",
				systemId: null,
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects extract when preserving complete roots from multiple systems into a single-system target", async () => {
		await expect(
			applyExtractSubtree(multiSystemComponentDesign(), {
				elementId: "wrapper",
				systemId: "sys-core",
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});
});

describe("applyExtractSubtree projectRoot linkage", () => {
	let projectRoot: string;
	let systemId: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-extract-project-root-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("validates preserved component linkage using the projectRoot path string", async () => {
		const sourceDesign: TrickroomDesign = {
			name: "Component Design",
			systemName: "Core",
			boards: [
				systemComponentSubtree(
					"component-root",
					systemId,
					"cmp_11111111-1111-4111-8111-111111111111",
					"component-instance-1",
				),
			],
		};

		await expect(
			applyExtractSubtree(sourceDesign, {
				elementId: "component-root",
				systemName: "Core",
				projectRoot: { projectRoot } as unknown as string,
			}),
		).rejects.toThrow();

		const { newDesign } = await applyExtractSubtree(sourceDesign, {
			elementId: "component-root",
			systemName: "Core",
			projectRoot,
		});

		expect(newDesign.systemName).toBe("Core");
		expect(newDesign.boards[0].props[systemComponentRootProp]).toBe("true");
	});
});

describe("applyCopySubtree", () => {
	it("copies a same-file subtree with fresh ids and renames only the copied root", async () => {
		const { design, rootElementId, idMap, inserted } = await applyCopySubtree(
			simpleDesign,
			simpleDesign,
			{
				sourceElementId: "inner",
				parentId: "root",
				index: 1,
				sameDesign: true,
			},
		);

		expect(rootElementId).toBe(idMap.inner);
		expect(rootElementId).not.toBe("inner");
		expect(inserted).toEqual({
			nodeCount: 2,
			rootElementId,
			elementIds: [idMap.inner, idMap["inner-text"]],
		});

		const root = design.boards[0];
		const children = root.children as TrickroomDesign["boards"];
		expect(children.map((child) => child.id)).toEqual([
			"title",
			rootElementId,
			"inner",
		]);
		const copy = children[1];
		const copyChildren = copy.children as TrickroomDesign["boards"];
		expect(copy.props["data-trickroom-name"]).toBe("inner Copy");
		expect(copyChildren[0].id).toBe(idMap["inner-text"]);
		expect(copyChildren[0].props["data-trickroom-name"]).toBe("inner-text");
		expect(copyChildren[0].children).toBe("World");
	});

	it("copies across designs without renaming and preserves the target design metadata", async () => {
		const targetDesign: TrickroomDesign = {
			name: "Target Design",
			systemName: "Target System",
			boards: [containerElement("target-root")],
		};

		const { design, rootElementId } = await applyCopySubtree(
			simpleDesign,
			targetDesign,
			{
				sourceElementId: "inner",
				parentId: "target-root",
				index: 0,
			},
		);

		const copiedRoot = (
			design.boards[0].children as TrickroomDesign["boards"]
		)[0];
		expect(design.name).toBe("Target Design");
		expect(design.systemName).toBe("Target System");
		expect(copiedRoot.id).toBe(rootElementId);
		expect(copiedRoot.props["data-trickroom-name"]).toBe("inner");
	});

	it("rejects same-file copies into the source subtree", async () => {
		await expect(
			applyCopySubtree(simpleDesign, simpleDesign, {
				sourceElementId: "root",
				parentId: "inner",
				index: 0,
				sameDesign: true,
			}),
		).rejects.toMatchObject({
			code: "CYCLE_DETECTED",
		});
	});

	it("rejects partial recipe-owned copies", async () => {
		await expect(
			applyCopySubtree(avatarRecipeDesign(), simpleDesign, {
				sourceElementId: "avatar-image",
				parentId: "root",
				index: 0,
			}),
		).rejects.toMatchObject({
			code: "RECIPE_STRUCTURAL_NODE_LOCKED",
		});
	});

	it("rejects partial system component-owned copies", async () => {
		await expect(
			applyCopySubtree(systemComponentDesign(), simpleDesign, {
				sourceElementId: "component-label",
				parentId: "root",
				index: 0,
			}),
		).rejects.toMatchObject({
			code: "COMPONENT_STRUCTURE_LOCKED",
		});
	});

	it("rejects copying a disallowed root into an allowlisted recipe slot", async () => {
		await expect(
			applyCopySubtree(simpleDesign, menuRecipeDesign(), {
				sourceElementId: "inner",
				parentId: "menu-popup",
				index: 1,
			}),
		).rejects.toMatchObject({
			code: "RECIPE_SLOT_DISALLOWED_CHILD",
		});
	});

	it("preserves complete recipe root attachment with a fresh instance id", async () => {
		const { design, rootElementId } = await applyCopySubtree(
			avatarRecipeDesign(),
			simpleDesign,
			{
				sourceElementId: "avatar-root",
				parentId: "root",
				index: 0,
			},
		);

		const root = findNode(design.boards, rootElementId);
		expect(root).not.toBeNull();
		const children = root?.children as TrickroomDesign["boards"];
		const image = children[0];
		const fallback = children[1];
		const instanceId = root?.props[recipeInstanceProp];

		expect(instanceId).toEqual(expect.any(String));
		expect(instanceId).not.toBe("recipe-instance-1");
		expect(image.props[recipeInstanceProp]).toBe(instanceId);
		expect(fallback.props[recipeInstanceProp]).toBe(instanceId);
		expect(root?.props["data-trickroom-recipe-id"]).toBe(
			"base-ui/avatar.default",
		);
		expect(root?.props["data-trickroom-recipe-root"]).toBe("true");
		expect(fallback.props["data-trickroom-recipe-slot"]).toBe("fallback");
		expect(
			(fallback.children as TrickroomDesign["boards"])[0].props[
				"data-trickroom-name"
			],
		).toBe("Slot Child");
	});

	it("preserves complete system component root attachment with a fresh instance id", async () => {
		const linkedTarget: TrickroomDesign = {
			...simpleDesign,
			systemId: "sys-core",
		};
		const { design, rootElementId } = await applyCopySubtree(
			systemComponentDesign(),
			linkedTarget,
			{
				sourceElementId: "component-root",
				parentId: "root",
				index: 0,
			},
		);

		const root = findNode(design.boards, rootElementId);
		expect(root).not.toBeNull();
		const children = root?.children as TrickroomDesign["boards"];
		const label = children[0];
		const slot = children[1];
		const instanceId = root?.props[systemComponentInstanceProp];

		expect(instanceId).toEqual(expect.any(String));
		expect(instanceId).not.toBe("component-instance-1");
		expect(label.props[systemComponentInstanceProp]).toBe(instanceId);
		expect(slot.props[systemComponentInstanceProp]).toBe(instanceId);
		expect(root?.props[systemComponentRootProp]).toBe("true");
	});

	it("rejects preserving complete system component roots into an unlinked target design", async () => {
		await expect(
			applyCopySubtree(systemComponentDesign(), simpleDesign, {
				sourceElementId: "component-root",
				parentId: "root",
				index: 0,
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects copy when preserving complete roots from multiple systems into a single-system target", async () => {
		await expect(
			applyCopySubtree(
				multiSystemComponentDesign(),
				{
					...simpleDesign,
					systemId: "sys-core",
				},
				{
					sourceElementId: "wrapper",
					parentId: "root",
					index: 0,
				},
			),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("rejects duplicate source ids through normalization", async () => {
		const duplicateDesign: TrickroomDesign = {
			name: "Duplicate IDs",
			boards: [
				containerElement("duplicate"),
				textElement("duplicate", "Later duplicate"),
			],
		};

		await expect(
			applyCopySubtree(duplicateDesign, simpleDesign, {
				sourceElementId: "duplicate",
				parentId: "root",
				index: 0,
			}),
		).rejects.toMatchObject({
			code: "DUPLICATE_ELEMENT_ID",
		});
	});
});

describe("applyAddSystemComponent", () => {
	let projectRoot: string;
	let systemId: string;
	let coreLinkedDesign: TrickroomDesign;
	let revision: SystemComponentManifestRevision;
	let componentId: string;
	const now = "2026-05-26T14:00:00.000Z";

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-add-system-component-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
		coreLinkedDesign = {
			...simpleDesign,
			systemId,
		};
		const initial = await readSystemComponentManifest(projectRoot, systemId);
		revision = initial.revision;
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "badge", name: "Badge" },
			{ expectedRevision: revision, now },
		);
		componentId = created.componentId;
		const afterTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemId,
			componentId,
			{
				path: "root",
				library: "trickroom",
				component: "container",
				className: "card",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Badge",
						className: "label",
					},
				],
			},
			{ expectedRevision: created.revision, now },
		);
		const afterVariants = await updateSystemComponentDraftVariants(
			projectRoot,
			systemId,
			componentId,
			{
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: { classesByPath: { root: "brand", label: "label-brand" } },
							neutral: { classesByPath: { root: "neutral" } },
						},
					},
				},
			},
			{ expectedRevision: afterTemplate.revision, now },
		);
		await updateSystemComponentDraftOverrideTargets(
			projectRoot,
			systemId,
			componentId,
			{
				rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
			},
			{ expectedRevision: afterVariants.revision, now },
		);
		await publishSystemComponentDraft(projectRoot, systemId, componentId, {
			expectedRevision: (
				await readSystemComponentManifest(projectRoot, systemId)
			).revision,
			now,
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("rejects insertion when the design is not linked to the component system", async () => {
		await expect(
			applyAddSystemComponent(simpleDesign, {
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "DESIGN_NOT_LINKED_TO_SYSTEM",
		});
	});

	it("inserts a published component with root/path/slot markers and instance state", async () => {
		const result = await applyAddSystemComponent(coreLinkedDesign, {
			projectRoot,
			parentId: "root",
			index: 0,
			systemId,
			componentId,
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "rounded-md" } },
		});

		const inserted = findNode(result.design.boards, result.changedElementId);
		expect(inserted).not.toBeNull();
		const rootMetadata = getSystemComponentStructuralMetadata(inserted?.props);
		expect(rootMetadata).toMatchObject({
			systemId,
			componentId,
			instanceId: result.instanceId,
			version: "1",
			path: "root",
			isRoot: true,
		});
		expect(rootMetadata?.variantValues).toEqual({ tone: "brand" });
		expect(rootMetadata?.overrides).toEqual({
			rootTarget: { className: "rounded-md" },
		});
		expect(inserted?.props[systemComponentRootProp]).toBe("true");
		expect(inserted?.props[systemComponentVariantValuesProp]).toBe(
			JSON.stringify({ tone: "brand" }),
		);
		expect(result.elementIdsByPath).toMatchObject({
			root: result.changedElementId,
		});
		const label = (inserted?.children as TrickroomDesign["boards"])[0];
		expect(label?.props[systemComponentPathProp]).toBe("label");
		expect(label?.props[systemComponentInstanceProp]).toBe(result.instanceId);
		expect(label?.props[systemComponentRootProp]).toBeUndefined();
	});

	it("uses the manifest current version when version is omitted", async () => {
		const result = await applyAddSystemComponent(coreLinkedDesign, {
			projectRoot,
			parentId: null,
			index: 0,
			systemId,
			componentId,
		});

		expect(result.version).toBe("1");
		expect(result.design.boards[0]?.id).toBe(result.changedElementId);
	});

	it("maps missing component and version failures to explicit transform errors", async () => {
		await expect(
			applyAddSystemComponent(coreLinkedDesign, {
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId: "cmp_missing",
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "UNKNOWN_SYSTEM_COMPONENT",
		});

		await expect(
			applyAddSystemComponent(coreLinkedDesign, {
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
				version: "99",
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "UNKNOWN_SYSTEM_COMPONENT_VERSION",
		});
	});

	it("maps invalid instance state to an explicit transform error", async () => {
		await expect(
			applyAddSystemComponent(coreLinkedDesign, {
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
				variantValues: { tone: "missing" },
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});
	});

	it("rejects insertion into recipe slots that disallow the component root", async () => {
		await expect(
			applyAddSystemComponent(
				{ ...menuRecipeDesign(), systemId },
				{
					projectRoot,
					parentId: "menu-popup",
					index: 0,
					systemId,
					componentId,
				},
			),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "RECIPE_SLOT_DISALLOWED_CHILD",
		});
	});
});

describe("applyUpdateSystemComponentInstance", () => {
	let projectRoot: string;
	let systemId: string;
	let componentId: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-update-system-component-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
		const initial = await readSystemComponentManifest(projectRoot, systemId);
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "badge", name: "Badge" },
			{ expectedRevision: initial.revision, now: "2026-05-26T14:00:00.000Z" },
		);
		componentId = created.componentId;
		const afterTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemId,
			componentId,
			{
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Badge",
					},
				],
			},
			{ expectedRevision: created.revision, now: "2026-05-26T14:00:00.000Z" },
		);
		await updateSystemComponentDraftVariants(
			projectRoot,
			systemId,
			componentId,
			{
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "brand" } },
							neutral: { classesByPath: { root: "neutral" } },
						},
					},
				},
			},
			{
				expectedRevision: afterTemplate.revision,
				now: "2026-05-26T14:00:00.000Z",
			},
		);
		await publishSystemComponentDraft(projectRoot, systemId, componentId, {
			expectedRevision: (
				await readSystemComponentManifest(projectRoot, systemId)
			).revision,
			now: "2026-05-26T14:00:00.000Z",
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("maps invalid variant values to INVALID_SYSTEM_COMPONENT_INSTANCE_STATE", async () => {
		const added = await applyAddSystemComponent(
			{ ...simpleDesign, systemId },
			{
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
			},
		);

		await expect(
			applyUpdateSystemComponentInstance(added.design, {
				projectRoot,
				rootElementId: added.changedElementId,
				variantValues: { tone: "missing" },
			}),
		).rejects.toMatchObject({
			name: "DesignTransformError",
			code: "INVALID_SYSTEM_COMPONENT_INSTANCE_STATE",
		});
	});

	it("clears optional variant axes through unsetVariantAxes", async () => {
		const added = await applyAddSystemComponent(
			{ ...simpleDesign, systemId },
			{
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
				variantValues: { tone: "brand" },
			},
		);

		const updated = await applyUpdateSystemComponentInstance(added.design, {
			projectRoot,
			rootElementId: added.changedElementId,
			unsetVariantAxes: ["tone"],
		});
		const root = findNode(updated.design.boards, added.changedElementId);
		const rootMetadata = getSystemComponentStructuralMetadata(root?.props);

		expect(updated.variantValues).toEqual({});
		expect(rootMetadata?.variantValues).toEqual({});
		expect(root?.props.className).toBeUndefined();
	});
});

describe("applyDetachSystemComponent", () => {
	let projectRoot: string;
	let systemId: string;
	let componentId: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-detach-system-component-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
		const initial = await readSystemComponentManifest(projectRoot, systemId);
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "badge", name: "Badge" },
			{ expectedRevision: initial.revision, now: "2026-05-26T14:00:00.000Z" },
		);
		componentId = created.componentId;
		await updateSystemComponentDraftTemplate(
			projectRoot,
			systemId,
			componentId,
			{
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Badge",
					},
				],
			},
			{ expectedRevision: created.revision, now: "2026-05-26T14:00:00.000Z" },
		);
		await publishSystemComponentDraft(projectRoot, systemId, componentId, {
			expectedRevision: (
				await readSystemComponentManifest(projectRoot, systemId)
			).revision,
			now: "2026-05-26T14:00:00.000Z",
		});
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("detaches instances even when the published version is missing", async () => {
		const added = await applyAddSystemComponent(
			{ ...simpleDesign, systemId },
			{
				projectRoot,
				parentId: "root",
				index: 0,
				systemId,
				componentId,
			},
		);
		const staleVersionDesign: TrickroomDesign = {
			...added.design,
			boards: added.design.boards.map((board) => ({
				...board,
				children: (board.children as TrickroomDesign["boards"]).map((child) =>
					child.id === added.changedElementId
						? {
								...child,
								props: {
									...child.props,
									"data-trickroom-system-component-version": "missing-version",
								},
							}
						: child,
				),
			})),
		};

		const detached = await applyDetachSystemComponent(staleVersionDesign, {
			projectRoot,
			elementId: added.changedElementId,
		});

		expect(detached.detachedElementIds).toContain(added.changedElementId);
		const persistedRoot = findNode(
			detached.design.boards,
			added.changedElementId,
		);
		expect(
			persistedRoot?.props["data-trickroom-system-component-instance"],
		).toBeUndefined();
	});
});

describe("cloneBoardForMigrationTrial", () => {
	it("deep-clones nested prop objects so trial migration cannot mutate source boards", () => {
		const nested = { marker: "keep" };
		const sourceBoard = containerElement("board-with-nested-props");
		sourceBoard.props = {
			...sourceBoard.props,
			"x-nested-test": nested as unknown as string,
		};

		const clonedBoard = cloneBoardForMigrationTrial(sourceBoard);
		const clonedNested = (clonedBoard.props as Record<string, unknown>)[
			"x-nested-test"
		] as { marker: string };

		expect(clonedNested).not.toBe(nested);
		expect(clonedNested).toEqual({ marker: "keep" });

		clonedNested.marker = "mutated";
		expect(nested.marker).toBe("keep");
	});
});

describe("DesignTransformError", () => {
	it("has correct name and code properties", () => {
		const error = new DesignTransformError("ELEMENT_NOT_FOUND", "msg");
		expect(error.name).toBe("DesignTransformError");
		expect(error.code).toBe("ELEMENT_NOT_FOUND");
		expect(error instanceof DesignTransformError).toBe(true);
		expect(error instanceof Error).toBe(true);
	});
});
