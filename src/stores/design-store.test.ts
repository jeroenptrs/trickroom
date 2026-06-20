import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Props, TrickroomDesign } from "../types";
import {
	addElement,
	designStore,
	clearDirty,
	deleteElement,
	hydrateDesign,
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
	it("normalizes and serializes a design without changing its structure", () => {
		const normalized = normalizeDesign(fixture);

		expect(normalized.rootIds).toEqual([rootId]);
		expect(normalized.entitiesById[rootId]?.role).toBeUndefined();
		expect(normalized.entitiesById[titleId]?.role).toBe("text");
		expect(normalized.entitiesById[containerId]?.childIds).toEqual([
			childOneId,
			childTwoId,
		]);
		expect(serializeDesignState(normalized)).toEqual(fixture);
		// TODO: this can be deleted
		expect(JSON.stringify(serializeDesignState(normalized))).not.toContain(
			"data-trickroom-type",
		);
		// TODO: this can be deleted
		expect(JSON.stringify(serializeDesignState(normalized))).not.toContain(
			'"type"',
		);
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
		expect(state.entitiesById[rootId]?.childIds).toEqual([
			containerId,
			infoId,
		]);
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
		hydrateDesign(serializeDesignState(designStore.get()));

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

	it("adds a new child container without a role", () => {
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
			role: undefined,
			childIds: [],
			props: {
				"data-trickroom-name": "Container",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
		});
		expect(state.entitiesById["new-child"]?.props).not.toHaveProperty(
			"data-trickroom-role",
		);
		expect(state.selectedId).toBe("new-child");

		randomUuid.mockRestore();
	});

	it("does not add inside a text role parent", () => {
		const previousState = designStore.get();

		addElement(trickroomComponent("text"), titleId, 0);

		expect(designStore.get()).toEqual(previousState);
	});
});
