import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getRenderableClassComposition,
	getRenderableProps,
	resolveRegistryComponent,
	type RegistryId,
	type RegistryResolution,
} from "../libraries/registry";
import {
	recipeIdProp,
	recipeInstanceProp,
	recipePathProp,
	recipeRootProp,
	recipeSlotProp,
} from "../recipes/markers";
import type { Props, TrickroomDesign } from "../types";
import { assetIdProp } from "../utils/resource-props";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	systemComponentPathProp,
} from "../utils/system-component-markers";
import { layerDropInsertionIndex } from "../utils/reorder-insertion-index";
import {
	addElement,
	addNodeTree,
	addRecipe,
	clearDirty,
	deleteElement,
	designStore,
	detachRecipe,
	extractSubtreeToDesign,
	hydrateDesign,
	isDesignCleanAtRevision,
	moveElement,
	normalizeDesign,
	replaceElementWithNodeTree,
	selectElement,
	serializeDesignState,
	setSystemComponentVariantValue,
	updateElementProps,
	updateElementText,
} from "./design-store";

const rootId = "root";
const titleId = "title";
const containerId = "container";
const childOneId = "child-one";
const childTwoId = "child-two";
const infoId = "info";
const rootTextId = "root-text";

const trickroomComponent = (component: Props["data-trickroom-component"]) => ({
	"data-trickroom-library": "trickroom" as const,
	"data-trickroom-component": component,
});
const baseUiComponent = (component: Props["data-trickroom-component"]) => ({
	"data-trickroom-library": "base-ui" as const,
	"data-trickroom-component": component,
});

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

const fixture = {
	name: "Test Design",
	boards: [
		{
			id: rootId,
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: titleId,
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						className: "text-red-500",
					},
					children: "Demo UI",
				},
				{
					id: containerId,
					props: {
						"data-trickroom-name": "Container",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [
						{
							id: childOneId,
							props: {
								"data-trickroom-name": "Child One",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Main area",
						},
						{
							id: childTwoId,
							props: {
								"data-trickroom-name": "Child Two",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Secondary area",
						},
					],
				},
				{
					id: infoId,
					props: {
						"data-trickroom-name": "Info",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Unstyled content",
				},
			],
		},
	],
} satisfies TrickroomDesign;

const topLevelTextFixture = {
	name: "Top Level Text",
	boards: [
		{
			id: rootTextId,
			props: {
				"data-trickroom-name": "Headline",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "text",
				"data-trickroom-role": "text",
			},
			children: "Top-level text node",
		},
	],
} satisfies TrickroomDesign;

const systemMarkerProps = (
	path: string,
	options: { isRoot?: boolean; slotName?: string | null } = {},
) =>
	getSystemComponentMarkerProps({
		systemId: "system-1",
		componentId: "component-1",
		instanceId: "component-instance-1",
		version: "1",
		path,
		...options,
	});

const attachedComponentFixture = {
	name: "Attached Component",
	boards: [
		{
			id: "component-root",
			props: {
				"data-trickroom-name": "Component Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...systemMarkerProps("root", { isRoot: true }),
			},
			children: [
				{
					id: "component-label",
					props: {
						"data-trickroom-name": "Component Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...systemMarkerProps("label"),
					},
					children: "Locked label",
				},
				{
					id: "component-slot",
					props: {
						"data-trickroom-name": "Component Slot",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						...systemMarkerProps("slot", { slotName: "default" }),
					},
					children: [
						{
							id: "slot-text",
							props: {
								"data-trickroom-name": "Slot Text",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Editable slot text",
						},
					],
				},
			],
		},
		{
			id: "outside-root",
			props: {
				"data-trickroom-name": "Outside",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

beforeEach(() => {
	designStore.setState(() => normalizeDesign(fixture));
});

describe("design store transforms", () => {
	it("preserves componentMigrationPolicy through normalize and serialize", () => {
		const design = {
			...fixture,
			componentMigrationPolicy: "manual" as const,
		};
		const normalized = normalizeDesign(design);
		expect(normalized.componentMigrationPolicy).toBe("manual");
		expect(serializeDesignState(normalized).componentMigrationPolicy).toBe(
			"manual",
		);
	});

	it("normalizes legacy branch nodes and serializes explicit roles", () => {
		const normalized = normalizeDesign(fixture);

		expect(normalized.rootIds).toEqual([rootId]);
		expect(normalized.entitiesById[rootId]?.role).toBe("branch");
		expect(normalized.entitiesById[titleId]?.role).toBe("text");
		expect(normalized.entitiesById[containerId]?.role).toBe("branch");
		expect(normalized.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			childTwoId,
		]);
		const serialized = serializeDesignState(normalized);
		expect(serialized.boards[0].props["data-trickroom-role"]).toBe("branch");
		expect(
			(serialized.boards[0].children as TrickroomDesign["boards"])[1].props[
				"data-trickroom-role"
			],
		).toBe("branch");
		// TODO: this can be deleted
		expect(JSON.stringify(serialized)).not.toContain("data-trickroom-type");
		// TODO: this can be deleted
		expect(JSON.stringify(serialized)).not.toContain('"type"');
	});

	it("replaces the selected subtree with an attached component instance", () => {
		selectElement(containerId);

		const didReplace = replaceElementWithNodeTree(containerId, {
			id: "attached-root",
			props: {
				"data-trickroom-name": "Primary Button",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				...getSystemComponentMarkerProps({
					systemId: "system-1",
					componentId: "cmp_primary_button",
					instanceId: "instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					templateHash: "sha256:template",
					variantSchemaHash: "sha256:variants",
				}),
			},
			children: [
				{
					id: "attached-label",
					props: {
						"data-trickroom-name": "Label",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
						...getSystemComponentMarkerProps({
							systemId: "system-1",
							componentId: "cmp_primary_button",
							instanceId: "instance-1",
							version: "1",
							path: "label",
							templateHash: "sha256:template",
							variantSchemaHash: "sha256:variants",
						}),
					},
					children: "Button",
				},
			],
		});

		const state = designStore.get();
		expect(didReplace).toBe(true);
		expect(state.entitiesById[rootId]?.childIds).toEqual([
			titleId,
			"attached-root",
			infoId,
		]);
		expect(state.entitiesById[containerId]).toBeUndefined();
		expect(state.entitiesById[childOneId]).toBeUndefined();
		expect(state.entitiesById["attached-root"]?.parentId).toBe(rootId);
		expect(state.entitiesById["attached-label"]?.parentId).toBe(
			"attached-root",
		);
		expect(state.selectedId).toBe("attached-root");
		expect(state.entitiesById["attached-root"]?.props).toMatchObject({
			"data-trickroom-system-component-system-id": "system-1",
			"data-trickroom-system-component-id": "cmp_primary_button",
			"data-trickroom-system-component-instance": "instance-1",
			"data-trickroom-system-component-version": "1",
			"data-trickroom-system-component-root": "true",
		});
	});

	it("leaves the selected subtree intact when extraction replacement is declined", () => {
		selectElement(containerId);
		const before = serializeDesignState(designStore.get());

		const state = designStore.get();

		expect(serializeDesignState(state)).toEqual(before);
		expect(state.selectedId).toBe(containerId);
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			childTwoId,
		]);
	});

	it("updates selected element props without mutating unrelated entities", () => {
		const originalContainer = designStore.get().entitiesById[containerId];

		selectElement(titleId);
		updateElementProps(titleId, { className: "text-blue-500" });

		const state = designStore.get();
		expect(state.selectedId).toBe(titleId);
		expect(state.entitiesById[titleId]?.props.className).toBe("text-blue-500");
		expect(state.entitiesById[containerId]).toBe(originalContainer);
		expect(state.dirtyIds).toEqual({ [titleId]: true });
	});

	it("preserves authored class string order and unknown tokens on registry element updates", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("separator");
		const authoredClassName =
			"data-[orientation=horizontal]:h-2 unknown-separator-token data-[orientation=horizontal]:h-4";

		addElement(baseUiComponent("separator"), containerId, 1);
		updateElementProps("separator", { className: authoredClassName });

		const state = designStore.get();
		const separatorDefinition = getKnownRegistryDefinition(
			"base-ui",
			"separator",
		);
		const composition = getRenderableClassComposition(
			state.entitiesById.separator?.props ?? {},
			separatorDefinition,
		);

		expect(state.entitiesById.separator?.props.className).toBe(
			authoredClassName,
		);
		expect(
			serializeDesignState(state).boards[0].children?.[1]?.children?.[1]?.props
				.className,
		).toBe(authoredClassName);
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

		randomUuid.mockRestore();
	});

	it("clears dirty state after a successful save", () => {
		selectElement(rootId);
		updateElementProps(titleId, { className: "text-blue-500" });
		const savedRevision = designStore.get().revision;
		expect(designStore.get().dirtyIds).toEqual({ [titleId]: true });

		clearDirty(savedRevision);

		expect(designStore.get().dirtyIds).toEqual({});
		expect(designStore.get().selectedId).toBe(rootId);
	});

	it("does not clear newer dirty state for an older save", () => {
		updateElementProps(titleId, { className: "text-blue-500" });
		const staleRevision = designStore.get().revision;
		updateElementProps(infoId, { className: "text-green-500" });

		clearDirty(staleRevision);

		expect(designStore.get().dirtyIds).toEqual({
			[titleId]: true,
			[infoId]: true,
		});
	});

	it("reports when the design is clean at a saved revision", () => {
		updateElementProps(titleId, { className: "text-blue-500" });
		const savedRevision = designStore.get().revision;

		clearDirty(savedRevision);

		expect(isDesignCleanAtRevision(savedRevision)).toBe(true);
	});

	it("reports when the design changed after an async action started", () => {
		const actionRevision = designStore.get().revision;

		updateElementProps(titleId, { className: "text-blue-500" });

		expect(isDesignCleanAtRevision(actionRevision)).toBe(false);
	});

	it("reports when clean hydration changed the design after an async action started", () => {
		const actionRevision = designStore.get().revision;

		hydrateDesign({
			...fixture,
			name: "Fresh Query Result",
		});

		expect(designStore.get().revision).toBe(actionRevision + 1);
		expect(isDesignCleanAtRevision(actionRevision)).toBe(false);
	});

	it("moves a node between parents while preserving child order", () => {
		moveElement(titleId, containerId, 1);

		const state = designStore.get();
		expect(state.entitiesById[rootId]?.childIds).toEqual([containerId, infoId]);
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			titleId,
			childTwoId,
		]);
		expect(state.entitiesById[titleId]?.parentId).toBe(containerId);
	});

	it("reorders a node within the same parent", () => {
		moveElement(infoId, rootId, 0);

		const state = designStore.get();
		expect(state.entitiesById[rootId]?.childIds).toEqual([
			infoId,
			titleId,
			containerId,
		]);
		expect(state.entitiesById[infoId]?.parentId).toBe(rootId);
	});

	it("reorders the first sibling after a later sibling using layer-drop indices", () => {
		const siblings = designStore.get().entitiesById[rootId]?.childIds ?? [];
		expect(siblings).toEqual([titleId, containerId, infoId]);

		const index = layerDropInsertionIndex(
			siblings,
			titleId,
			"after",
			containerId,
		);
		expect(index).toBe(1);

		moveElement(titleId, rootId, index);

		expect(designStore.get().entitiesById[rootId]?.childIds).toEqual([
			containerId,
			titleId,
			infoId,
		]);
	});

	it("shows the pre-adjustment after index would land at the end instead of between siblings", () => {
		const siblings = designStore.get().entitiesById[rootId]?.childIds ?? [];
		const buggyIndex = siblings.indexOf(containerId) + 1;

		moveElement(titleId, rootId, buggyIndex);

		expect(designStore.get().entitiesById[rootId]?.childIds).toEqual([
			containerId,
			infoId,
			titleId,
		]);
	});

	it("moves root elements to a requested root index", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("new-root");

		addElement(trickroomComponent("container"), null, 1);
		moveElement("new-root", null, 0);

		const state = designStore.get();
		expect(state.rootIds).toEqual(["new-root", rootId]);
		expect(state.entitiesById["new-root"]?.parentId).toBeNull();

		randomUuid.mockRestore();
	});

	it("allows moving text nodes to the top level", () => {
		moveElement(titleId, null, 1);

		const state = designStore.get();
		expect(state.rootIds).toEqual([rootId, titleId]);
		expect(state.entitiesById[rootId]?.childIds).toEqual([containerId, infoId]);
		expect(state.entitiesById[titleId]?.parentId).toBeNull();
	});

	it("ignores moving an element into itself", () => {
		const previousState = designStore.get();

		moveElement(rootId, rootId, 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("ignores moving an element into one of its descendants", () => {
		const previousState = designStore.get();

		moveElement(rootId, containerId, 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("ignores moving an element into a text role node", () => {
		const previousState = designStore.get();

		moveElement(childOneId, titleId, 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("deletes a leaf element from its parent", () => {
		deleteElement(titleId);

		const state = designStore.get();
		expect(state.entitiesById[titleId]).toBeUndefined();
		expect(state.entitiesById[rootId]?.childIds).toEqual([containerId, infoId]);
		expect(state.dirtyIds).toEqual({ [rootId]: true });
	});

	it("deletes an element and its descendants", () => {
		deleteElement(containerId);

		const state = designStore.get();
		expect(state.entitiesById[containerId]).toBeUndefined();
		expect(state.entitiesById[childOneId]).toBeUndefined();
		expect(state.entitiesById[childTwoId]).toBeUndefined();
		expect(state.entitiesById[rootId]?.childIds).toEqual([titleId, infoId]);
	});

	it("deletes a root element from the root list", () => {
		deleteElement(rootId);

		const state = designStore.get();
		expect(state.rootIds).toEqual([]);
		expect(state.entitiesById[rootId]).toBeUndefined();
		expect(state.entitiesById[titleId]).toBeUndefined();
		expect(state.entitiesById[containerId]).toBeUndefined();
	});

	it("clears selection when deleting the selected element or its ancestor", () => {
		selectElement(childOneId);

		deleteElement(containerId);

		const state = designStore.get();
		expect(state.selectedId).toBeNull();
	});

	it("extracts a subtree to a standalone design with regenerated ids", () => {
		let uuidIndex = 0;
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockImplementation(() => `new-id-${++uuidIndex}`);
		designStore.setState((state) => ({ ...state, systemName: "Core" }));

		try {
			const extracted = extractSubtreeToDesign(containerId);

			expect(extracted.name).toBe("Container");
			expect(extracted.systemName).toBe("Core");
			expect(extracted.boards).toHaveLength(1);
			expect(extracted.boards[0].id).not.toBe(containerId);
			const children = extracted.boards[0]
				.children as TrickroomDesign["boards"];
			expect(children.map((child) => child.id)).not.toContain(childOneId);
			expect(children.map((child) => child.id)).not.toContain(childTwoId);
			expect(
				new Set([extracted.boards[0].id, ...children.map((child) => child.id)])
					.size,
			).toBe(3);
			expect(children[0].children).toBe("Main area");
			expect(children[1].children).toBe("Secondary area");
		} finally {
			randomUuid.mockRestore();
		}
	});

	it("uses shared extraction validation for blank requested names", () => {
		expect(() => extractSubtreeToDesign(containerId, { name: " " })).toThrow(
			'Parameter "name" must not be blank.',
		);
	});

	it("does not overwrite dirty local changes when fresh query data arrives", () => {
		updateElementProps(titleId, { className: "text-blue-500" });
		hydrateDesign({
			...fixture,
			name: "Fresh Query Result",
		});

		const state = designStore.get();
		expect(state.name).toBe(fixture.name);
		expect(state.entitiesById[titleId]?.props.className).toBe("text-blue-500");
	});

	it("does not reset selection when hydrating the same serialized design", () => {
		selectElement(rootId);
		clearDirty();
		const revision = designStore.get().revision;
		hydrateDesign(serializeDesignState(designStore.get()));

		expect(designStore.get().revision).toBe(revision);
		expect(designStore.get().selectedId).toBe(rootId);
	});

	it("supports top-level text elements", () => {
		const normalized = normalizeDesign(topLevelTextFixture);

		expect(normalized.rootIds).toEqual([rootTextId]);
		expect(normalized.entitiesById[rootTextId]?.text).toBe(
			"Top-level text node",
		);
		expect(serializeDesignState(normalized)).toEqual(topLevelTextFixture);
	});

	it("adds a new root text element using registry role metadata", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("new-root");

		addElement(
			trickroomComponent("text"),
			null,
			designStore.get().rootIds.length,
		);

		const state = designStore.get();
		expect(state.rootIds).toEqual([rootId, "new-root"]);
		expect(state.entitiesById["new-root"]).toMatchObject({
			id: "new-root",
			parentId: null,
			role: "text",
			text: "Text",
			props: {
				"data-trickroom-name": "Text",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "text",
				"data-trickroom-role": "text",
			},
		});
		expect(state.selectedId).toBe("new-root");

		randomUuid.mockRestore();
	});

	it("adds a new child container with an explicit branch role", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("new-child");

		addElement(trickroomComponent("container"), containerId, 1);

		const state = designStore.get();
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			"new-child",
			childTwoId,
		]);
		expect(state.entitiesById["new-child"]).toMatchObject({
			id: "new-child",
			parentId: containerId,
			role: "branch",
			childIds: [],
			props: {
				"data-trickroom-name": "Container",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
			},
		});
		expect(state.selectedId).toBe("new-child");

		randomUuid.mockRestore();
	});

	it("adds Base UI Separator as a leaf with default orientation", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("separator");

		addElement(baseUiComponent("separator"), containerId, 1);

		const state = designStore.get();
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			"separator",
			childTwoId,
		]);
		expect(state.entitiesById.separator).toMatchObject({
			id: "separator",
			parentId: containerId,
			role: "leaf",
			childIds: [],
			props: {
				"data-trickroom-name": "Separator",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "separator",
				"data-trickroom-role": "leaf",
				orientation: "horizontal",
			},
		});
		expect(state.entitiesById.separator?.props).not.toHaveProperty("className");
		expect(
			getRenderableProps(
				state.entitiesById.separator?.props ?? {},
				getKnownRegistryDefinition("base-ui", "separator"),
			).className,
		).toBe(separatorBaseClassName);

		randomUuid.mockRestore();
	});

	it("adds Base UI Menu Separator without persisting base className", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("menu-separator");

		addElement(baseUiComponent("menu.separator"), containerId, 1);

		const state = designStore.get();
		expect(state.entitiesById["menu-separator"]).toMatchObject({
			id: "menu-separator",
			parentId: containerId,
			role: "leaf",
			childIds: [],
			props: {
				"data-trickroom-name": "Menu Separator",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "menu.separator",
				"data-trickroom-role": "leaf",
				orientation: "horizontal",
			},
		});
		expect(state.entitiesById["menu-separator"]?.props).not.toHaveProperty(
			"className",
		);
		expect(
			getRenderableProps(
				state.entitiesById["menu-separator"]?.props ?? {},
				getKnownRegistryDefinition("base-ui", "menu.separator"),
			).className,
		).toBe(separatorBaseClassName);

		randomUuid.mockRestore();
	});

	it("adds an Avatar recipe under the requested parent and selects the recipe root", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");

		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		const state = designStore.get();
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			"avatar-root",
			childTwoId,
		]);
		expect(state.selectedId).toBe("avatar-root");
		expect(state.entitiesById["avatar-root"]).toMatchObject({
			id: "avatar-root",
			parentId: containerId,
			role: "branch",
			childIds: ["avatar-image", "avatar-fallback"],
			props: {
				"data-trickroom-name": "Avatar Root",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.root",
				"data-trickroom-role": "branch",
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipeRootProp]: "true",
				[recipePathProp]: "root",
			},
		});
		expect(state.entitiesById["avatar-image"]).toMatchObject({
			id: "avatar-image",
			parentId: "avatar-root",
			role: "leaf",
			childIds: [],
			props: {
				"data-trickroom-name": "Avatar Image",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.image",
				"data-trickroom-role": "leaf",
				[assetIdProp]: "",
				alt: "",
				[recipePathProp]: "image",
			},
		});
		expect(state.entitiesById["avatar-fallback"]).toMatchObject({
			id: "avatar-fallback",
			parentId: "avatar-root",
			role: "branch",
			childIds: [],
			props: {
				"data-trickroom-name": "Avatar Fallback",
				"data-trickroom-library": "base-ui",
				"data-trickroom-component": "avatar.fallback",
				"data-trickroom-role": "branch",
				[recipePathProp]: "fallback",
				[recipeSlotProp]: "fallback",
			},
		});
		expect(serializeDesignState(state).boards[0].children).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: containerId,
					children: expect.arrayContaining([
						expect.objectContaining({ id: "avatar-root" }),
					]),
				}),
			]),
		);

		randomUuid.mockRestore();
	});

	it("does not add ordinary elements inside recipe-owned non-slot structure", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		const previousState = designStore.get();
		addElement(trickroomComponent("text"), "avatar-root", 0);

		expect(designStore.get()).toEqual(previousState);
		expect(randomUuid).toHaveBeenCalledTimes(4);

		randomUuid.mockRestore();
	});

	it("allows ordinary elements inside recipe slot hosts", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback")
			.mockReturnValueOnce("slot-text");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		addElement(trickroomComponent("text"), "avatar-fallback", 0);

		const state = designStore.get();
		expect(state.entitiesById["avatar-fallback"]?.childIds).toEqual([
			"slot-text",
		]);
		expect(state.entitiesById["slot-text"]).toMatchObject({
			id: "slot-text",
			parentId: "avatar-fallback",
			role: "text",
			text: "Text",
		});
		expect(state.selectedId).toBe("slot-text");

		randomUuid.mockRestore();
	});

	it("does not add disallowed ordinary elements inside allowlisted recipe slots", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("menu-root")
			.mockReturnValueOnce("menu-trigger")
			.mockReturnValueOnce("menu-portal")
			.mockReturnValueOnce("menu-positioner")
			.mockReturnValueOnce("menu-popup");
		addRecipe({ library: "base-ui", recipe: "menu.default" }, containerId, 1);

		const previousState = designStore.get();
		addElement(trickroomComponent("container"), "menu-popup", 0);

		expect(designStore.get()).toEqual(previousState);

		randomUuid.mockRestore();
	});

	it("does not add disallowed node trees inside allowlisted recipe slots", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("menu-root")
			.mockReturnValueOnce("menu-trigger")
			.mockReturnValueOnce("menu-portal")
			.mockReturnValueOnce("menu-positioner")
			.mockReturnValueOnce("menu-popup");
		addRecipe({ library: "base-ui", recipe: "menu.default" }, containerId, 1);

		const previousState = designStore.get();
		addNodeTree(
			{
				id: "system-root",
				props: {
					"data-trickroom-name": "System Root",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
				children: [],
			},
			"menu-popup",
			0,
		);

		expect(designStore.get()).toEqual(previousState);

		randomUuid.mockRestore();
	});

	it("does not add nested recipes inside recipe-owned non-slot structure", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		const previousState = designStore.get();
		addRecipe(
			{ library: "base-ui", recipe: "avatar.default" },
			"avatar-root",
			0,
		);

		expect(designStore.get()).toEqual(previousState);

		randomUuid.mockRestore();
	});

	it("allows nested recipes inside recipe slot hosts", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback")
			.mockReturnValueOnce("nested-recipe-instance")
			.mockReturnValueOnce("nested-avatar-root")
			.mockReturnValueOnce("nested-avatar-image")
			.mockReturnValueOnce("nested-avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		addRecipe(
			{ library: "base-ui", recipe: "avatar.default" },
			"avatar-fallback",
			0,
		);

		const state = designStore.get();
		expect(state.entitiesById["avatar-fallback"]?.childIds).toEqual([
			"nested-avatar-root",
		]);
		expect(state.entitiesById["nested-avatar-root"]).toMatchObject({
			id: "nested-avatar-root",
			parentId: "avatar-fallback",
			role: "branch",
			childIds: ["nested-avatar-image", "nested-avatar-fallback"],
			props: {
				[recipeInstanceProp]: "nested-recipe-instance",
				[recipeRootProp]: "true",
				[recipePathProp]: "root",
			},
		});
		expect(state.selectedId).toBe("nested-avatar-root");

		randomUuid.mockRestore();
	});

	it("keeps Avatar Image leaf-blocked by role behavior", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);

		const previousState = designStore.get();
		addElement(trickroomComponent("text"), "avatar-image", 0);

		expect(designStore.get()).toEqual(previousState);
		expect(randomUuid).toHaveBeenCalledTimes(4);

		randomUuid.mockRestore();
	});

	it("does not move recipe-owned structural child nodes", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);
		randomUuid.mockRestore();

		const previousState = designStore.get();
		moveElement("avatar-image", null, 0);
		moveElement("avatar-fallback", rootId, 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("moves the recipe root as an attached subtree", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);
		randomUuid.mockRestore();

		moveElement("avatar-root", null, 0);

		const state = designStore.get();
		expect(state.rootIds).toEqual(["avatar-root", rootId]);
		expect(state.entitiesById["avatar-root"]).toMatchObject({
			parentId: null,
			childIds: ["avatar-image", "avatar-fallback"],
			props: {
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipeRootProp]: "true",
				[recipePathProp]: "root",
			},
		});
		expect(state.entitiesById["avatar-image"]).toMatchObject({
			parentId: "avatar-root",
			props: {
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipePathProp]: "image",
			},
		});
		expect(state.entitiesById["avatar-fallback"]).toMatchObject({
			parentId: "avatar-root",
			props: {
				[recipeIdProp]: "base-ui/avatar.default",
				[recipeInstanceProp]: "recipe-instance-1",
				[recipePathProp]: "fallback",
				[recipeSlotProp]: "fallback",
			},
		});
	});

	it("allows moving slot contents while blocking moves into recipe-owned non-slot structure", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback")
			.mockReturnValueOnce("slot-text");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);
		addElement(trickroomComponent("text"), "avatar-fallback", 0);
		randomUuid.mockRestore();

		moveElement("slot-text", rootId, 0);
		let state = designStore.get();
		expect(state.entitiesById["slot-text"]?.parentId).toBe(rootId);
		expect(state.entitiesById["avatar-fallback"]?.childIds).toEqual([]);

		const previousState = designStore.get();
		moveElement(titleId, "avatar-root", 0);
		expect(designStore.get()).toEqual(previousState);

		moveElement(titleId, "avatar-fallback", 0);
		state = designStore.get();
		expect(state.entitiesById[titleId]?.parentId).toBe("avatar-fallback");
		expect(state.entitiesById["avatar-fallback"]?.childIds).toEqual([titleId]);
	});

	it("does not move disallowed existing nodes into allowlisted recipe slots", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("menu-root")
			.mockReturnValueOnce("menu-trigger")
			.mockReturnValueOnce("menu-portal")
			.mockReturnValueOnce("menu-positioner")
			.mockReturnValueOnce("menu-popup")
			.mockReturnValueOnce("separator");
		addRecipe({ library: "base-ui", recipe: "menu.default" }, containerId, 1);
		addElement(baseUiComponent("separator"), rootId, 1);
		randomUuid.mockRestore();

		const previousState = designStore.get();
		moveElement("separator", "menu-popup", 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("does not replace allowed slot contents with disallowed node trees inside allowlisted recipe slots", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("menu-root")
			.mockReturnValueOnce("menu-trigger")
			.mockReturnValueOnce("menu-portal")
			.mockReturnValueOnce("menu-positioner")
			.mockReturnValueOnce("menu-popup")
			.mockReturnValueOnce("menu-item");
		addRecipe({ library: "base-ui", recipe: "menu.default" }, containerId, 1);
		addElement(baseUiComponent("menu.item"), "menu-popup", 0);
		randomUuid.mockRestore();

		const previousState = designStore.get();
		const didReplace = replaceElementWithNodeTree("menu-item", {
			id: "disallowed-root",
			props: {
				"data-trickroom-name": "Disallowed Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [],
		});

		expect(didReplace).toBe(false);
		expect(designStore.get()).toEqual(previousState);
	});

	it("does not delete recipe-owned structural child nodes but allows slot content and recipe root deletion", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback")
			.mockReturnValueOnce("slot-text");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);
		addElement(trickroomComponent("text"), "avatar-fallback", 0);
		randomUuid.mockRestore();

		const previousState = designStore.get();
		deleteElement("avatar-image");
		deleteElement("avatar-fallback");
		expect(designStore.get()).toEqual(previousState);

		deleteElement("slot-text");
		let state = designStore.get();
		expect(state.entitiesById["slot-text"]).toBeUndefined();
		expect(state.entitiesById["avatar-fallback"]?.childIds).toEqual([]);

		deleteElement("avatar-root");
		state = designStore.get();
		expect(state.entitiesById["avatar-root"]).toBeUndefined();
		expect(state.entitiesById["avatar-image"]).toBeUndefined();
		expect(state.entitiesById["avatar-fallback"]).toBeUndefined();
		expect(state.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			childTwoId,
		]);
	});

	it("protects attached component structure while allowing slot content edits", () => {
		designStore.setState(() => normalizeDesign(attachedComponentFixture));

		const previousState = designStore.get();
		updateElementProps("component-label", { className: "text-blue-500" });
		updateElementProps("component-label", {
			[systemComponentPathProp]: "corrupted",
		});
		updateElementText("component-label", "Changed");
		moveElement("component-label", null, 0);
		deleteElement("component-label");
		expect(designStore.get()).toEqual(previousState);

		addElement(trickroomComponent("text"), "component-label", 0);
		expect(designStore.get()).toEqual(previousState);

		addNodeTree(
			{
				id: "inserted-tree",
				props: {
					"data-trickroom-name": "Inserted Tree",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
				children: [],
			},
			"component-label",
			0,
		);
		expect(designStore.get()).toEqual(previousState);

		updateElementText("slot-text", "Changed slot text");
		moveElement("slot-text", "outside-root", 0);
		let state = designStore.get();
		expect(state.entitiesById["slot-text"]?.text).toBe("Changed slot text");
		expect(state.entitiesById["slot-text"]?.parentId).toBe("outside-root");
		expect(state.entitiesById["component-slot"]?.childIds).toEqual([]);

		deleteElement("slot-text");
		state = designStore.get();
		expect(state.entitiesById["slot-text"]).toBeUndefined();
	});

	it("clears optional attached component variant axes through the UI-facing setter", () => {
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
							neutral: { classesByPath: { root: "text-zinc-700" } },
						},
					},
				},
			},
		};
		designStore.setState(() =>
			normalizeDesign({
				name: "Optional Attached Component",
				boards: [
					{
						id: "component-root",
						props: {
							"data-trickroom-name": "Component Root",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
							"data-trickroom-role": "branch",
							className: "base text-blue-600",
							...getSystemComponentMarkerProps({
								systemId: "system-1",
								componentId: "component-1",
								instanceId: "component-instance-1",
								version: "1",
								path: "root",
								isRoot: true,
								variantValues: { tone: "brand" },
							}),
						},
						children: [],
					},
				],
			}),
		);

		setSystemComponentVariantValue("component-root", version, "tone", null);

		const state = designStore.get();
		const root = state.entitiesById["component-root"];
		expect(root?.props.className).toBe("base");
		expect(
			getSystemComponentStructuralMetadata(root?.props ?? {})?.variantValues,
		).toEqual({});
		expect(state.dirtyIds).toEqual({ "component-root": true });
	});

	it("detaches the whole recipe instance from a structural child and preserves selection", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("recipe-instance-1")
			.mockReturnValueOnce("avatar-root")
			.mockReturnValueOnce("avatar-image")
			.mockReturnValueOnce("avatar-fallback");
		addRecipe({ library: "base-ui", recipe: "avatar.default" }, containerId, 1);
		randomUuid.mockRestore();

		selectElement("avatar-image");
		detachRecipe("avatar-image");

		let state = designStore.get();
		expect(state.selectedId).toBe("avatar-image");
		for (const id of ["avatar-root", "avatar-image", "avatar-fallback"]) {
			expect(state.entitiesById[id]?.props).not.toHaveProperty(recipeIdProp);
			expect(state.entitiesById[id]?.props).not.toHaveProperty(
				recipeInstanceProp,
			);
			expect(state.entitiesById[id]?.props).not.toHaveProperty(recipeRootProp);
			expect(state.entitiesById[id]?.props).not.toHaveProperty(recipePathProp);
			expect(state.entitiesById[id]?.props).not.toHaveProperty(recipeSlotProp);
			expect(state.dirtyIds[id]).toBe(true);
		}
		expect(state.entitiesById["avatar-root"]?.childIds).toEqual([
			"avatar-image",
			"avatar-fallback",
		]);

		moveElement("avatar-image", null, 0);
		state = designStore.get();
		expect(state.rootIds).toEqual(["avatar-image", rootId]);
		expect(state.entitiesById["avatar-image"]?.parentId).toBeNull();
		expect(state.entitiesById["avatar-root"]?.childIds).toEqual([
			"avatar-fallback",
		]);

		deleteElement("avatar-fallback");
		state = designStore.get();
		expect(state.entitiesById["avatar-fallback"]).toBeUndefined();
		expect(state.entitiesById["avatar-root"]?.childIds).toEqual([]);
	});

	it("does not add inside a text role parent", () => {
		const previousState = designStore.get();

		addElement(trickroomComponent("text"), titleId, 0);

		expect(designStore.get()).toEqual(previousState);
	});

	it("does not add inside a leaf role parent", () => {
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("separator");
		addElement(baseUiComponent("separator"), containerId, 1);
		randomUuid.mockRestore();

		const previousState = designStore.get();
		addElement(trickroomComponent("text"), "separator", 0);

		expect(designStore.get()).toEqual(previousState);
	});
});
