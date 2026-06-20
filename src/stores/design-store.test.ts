import { beforeEach, describe, expect, it, vi } from "vitest";
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
	addElement,
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
	selectElement,
	serializeDesignState,
	updateElementProps,
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

beforeEach(() => {
	designStore.setState(() => normalizeDesign(fixture));
});

describe("design store transforms", () => {
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
		const randomUuid = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("new-container")
			.mockReturnValueOnce("new-child-one")
			.mockReturnValueOnce("new-child-two");
		designStore.setState((state) => ({ ...state, systemName: "Core" }));

		const extracted = extractSubtreeToDesign(containerId);

		expect(extracted.name).toBe("Container");
		expect(extracted.systemName).toBe("Core");
		expect(extracted.boards).toHaveLength(1);
		expect(extracted.boards[0].id).toBe("new-container");
		expect(extracted.boards[0].id).not.toBe(containerId);
		const children = extracted.boards[0].children as TrickroomDesign["boards"];
		expect(children.map((child) => child.id)).toEqual([
			"new-child-one",
			"new-child-two",
		]);
		expect(children[0].children).toBe("Main area");
		expect(children[1].children).toBe("Secondary area");

		randomUuid.mockRestore();
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
				className:
					"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
				orientation: "horizontal",
			},
		});

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
