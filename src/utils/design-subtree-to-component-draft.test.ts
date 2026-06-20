import { describe, expect, it } from "vitest";
import {
	recipeIdProp,
	recipeInstanceProp,
	recipePathProp,
	recipeRootProp,
	recipeSlotProp,
} from "../recipes/markers";
import {
	hydrateComponentDraftFromDesignSubtree,
	normalizeComponentDraft,
	resetComponentDraftStore,
	serializeComponentDraftState,
} from "../stores/component-draft-store";
import { normalizeDesign } from "../stores/design-store";
import type { Props, TrickroomDesign } from "../types";
import { assetIdProp } from "./resource-props";
import {
	getSystemComponentMarkerProps,
	systemComponentPathProp,
	systemComponentSlotProp,
} from "./system-component-markers";
import { FIXTURE_COMPONENT_ID } from "./system-component-test-fixtures";
import {
	convertDesignSubtreeToComponentDraftRoot,
	DESIGN_SUBTREE_TO_COMPONENT_DRAFT_MARKER_POLICY,
	summarizeDesignSubtreeToComponentDraftMarkers,
	validateComponentDraftTemplateRoot,
} from "./design-subtree-to-component-draft";

const rootId = "root";
const titleId = "title";
const containerId = "container";
const childOneId = "child-one";

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
								[assetIdProp]: "ast_hero",
							},
							children: "Main area",
						},
					],
				},
			],
		},
	],
} satisfies TrickroomDesign;

const recipeInstanceId = "recipe-instance-1";
const recipeMarkedContainer: Props = {
	"data-trickroom-name": "Avatar",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	[recipeIdProp]: "base-ui/avatar.default",
	[recipeInstanceProp]: recipeInstanceId,
	[recipeRootProp]: "true",
	[recipePathProp]: "root",
	className: "flex gap-2",
};
const recipeMarkedLabel: Props = {
	"data-trickroom-name": "Fallback",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "text",
	"data-trickroom-role": "text",
	[recipeIdProp]: "base-ui/avatar.default",
	[recipeInstanceProp]: recipeInstanceId,
	[recipePathProp]: "avatar.fallback",
	[recipeSlotProp]: "fallback",
};

const componentInstanceId = "cmp-instance-1";
const componentMarkedRoot: Props = {
	"data-trickroom-name": "Published Card",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	...getSystemComponentMarkerProps({
		systemId: "sys",
		componentId: FIXTURE_COMPONENT_ID,
		instanceId: componentInstanceId,
		version: "1",
		path: "root",
		isRoot: true,
	}),
};
const componentMarkedSlotChild: Props = {
	"data-trickroom-name": "Slot Label",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "text",
	"data-trickroom-role": "text",
	...getSystemComponentMarkerProps({
		systemId: "sys",
		componentId: FIXTURE_COMPONENT_ID,
		instanceId: componentInstanceId,
		version: "1",
		path: "label",
		slotName: "default",
	}),
	[systemComponentSlotProp]: "default",
	[systemComponentPathProp]: "label",
};

describe("design subtree to component draft", () => {
	it("converts a plain subtree into a valid component draft root", () => {
		const { entitiesById } = normalizeDesign(fixture);
		const { root, pathByEntityId } = convertDesignSubtreeToComponentDraftRoot(
			containerId,
			entitiesById,
		);

		expect(root.path).toBe("root");
		expect(root.library).toBe("trickroom");
		expect(root.component).toBe("container");
		expect(root.children?.map((child) => child.path)).toEqual(["child-one"]);
		expect(pathByEntityId[containerId]).toBe("root");
		expect(pathByEntityId[childOneId]).toBe("child-one");

		const validation = validateComponentDraftTemplateRoot(root);
		expect(validation.valid).toBe(true);
		expect(validation.errors).toEqual([]);

		const draftState = normalizeComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root,
		});
		expect(draftState.rootPath).toBe("root");
		expect(serializeComponentDraftState(draftState)).toEqual(root);
	});

	it("preserves className, text, and compatible resource props", () => {
		const { entitiesById } = normalizeDesign(fixture);
		const { root } = convertDesignSubtreeToComponentDraftRoot(
			rootId,
			entitiesById,
		);

		expect(root.className).toBeUndefined();
		expect(root.children?.[0]).toMatchObject({
			path: "title",
			className: "text-red-500",
			text: "Demo UI",
		});
		expect(root.children?.[1]?.children?.[0]).toMatchObject({
			path: "child-one",
			props: { [assetIdProp]: "ast_hero" },
			text: "Main area",
		});
	});

	it("strips recipe markers for complete and partial instances", () => {
		const recipeRootId = "recipe-root";
		const recipeLabelId = "recipe-label";
		const entitiesById = {
			[recipeRootId]: {
				id: recipeRootId,
				parentId: null,
				role: "branch" as const,
				props: recipeMarkedContainer,
				childIds: [recipeLabelId],
			},
			[recipeLabelId]: {
				id: recipeLabelId,
				parentId: recipeRootId,
				role: "text" as const,
				props: recipeMarkedLabel,
				text: "AB",
			},
		};

		const markers = summarizeDesignSubtreeToComponentDraftMarkers(
			recipeRootId,
			entitiesById,
		);
		expect(markers.policy).toBe(
			DESIGN_SUBTREE_TO_COMPONENT_DRAFT_MARKER_POLICY,
		);
		expect(markers.completeRecipeInstanceIds).toEqual([recipeInstanceId]);
		expect(markers.partialRecipeInstanceIds).toEqual([]);

		const { root } = convertDesignSubtreeToComponentDraftRoot(
			recipeRootId,
			entitiesById,
		);

		expect(root.props).toBeUndefined();
		expect(root.className).toBe("flex gap-2");
		expect(root.children?.[0]).toMatchObject({
			path: "fallback",
			slot: "fallback",
			text: "AB",
		});
		expect(root.children?.[0]?.props?.[recipeInstanceProp]).toBeUndefined();
		expect(root.children?.[0]?.props?.[recipePathProp]).toBeUndefined();
	});

	it("strips system component markers and preserves slot metadata on nodes", () => {
		const componentRootId = "component-root";
		const componentLabelId = "component-label";
		const entitiesById = {
			[componentRootId]: {
				id: componentRootId,
				parentId: null,
				role: "branch" as const,
				props: componentMarkedRoot,
				childIds: [componentLabelId],
			},
			[componentLabelId]: {
				id: componentLabelId,
				parentId: componentRootId,
				role: "text" as const,
				props: componentMarkedSlotChild,
				text: "Slot text",
			},
		};

		const markers = summarizeDesignSubtreeToComponentDraftMarkers(
			componentRootId,
			entitiesById,
		);
		expect(markers.completeComponentInstanceIds).toEqual([
			componentInstanceId,
		]);
		expect(markers.partialComponentInstanceIds).toEqual([]);

		const { root } = convertDesignSubtreeToComponentDraftRoot(
			componentRootId,
			entitiesById,
		);

		expect(root.props?.[systemComponentPathProp]).toBeUndefined();
		expect(root.children?.[0]).toMatchObject({
			path: "label",
			slot: "default",
			text: "Slot text",
		});
	});

	it("classifies partial recipe instances when only a slice is selected", () => {
		const recipeRootId = "recipe-root";
		const recipeLabelId = "recipe-label";
		const entitiesById = {
			[recipeRootId]: {
				id: recipeRootId,
				parentId: null,
				role: "branch" as const,
				props: recipeMarkedContainer,
				childIds: [recipeLabelId],
			},
			[recipeLabelId]: {
				id: recipeLabelId,
				parentId: recipeRootId,
				role: "text" as const,
				props: recipeMarkedLabel,
				text: "AB",
			},
		};

		const markers = summarizeDesignSubtreeToComponentDraftMarkers(
			recipeLabelId,
			entitiesById,
		);
		expect(markers.partialRecipeInstanceIds).toEqual([recipeInstanceId]);
		expect(markers.completeRecipeInstanceIds).toEqual([]);

		const { root } = convertDesignSubtreeToComponentDraftRoot(
			recipeLabelId,
			entitiesById,
		);

		expect(root.path).toBe("root");
		expect(root.slot).toBe("fallback");
		expect(root.props?.[recipeInstanceProp]).toBeUndefined();
	});

	it("does not mutate source design entities", () => {
		const { entitiesById } = normalizeDesign(fixture);
		const before = structuredClone(entitiesById);

		convertDesignSubtreeToComponentDraftRoot(containerId, entitiesById);

		expect(entitiesById).toEqual(before);
	});

	it("hydrates the component draft store from a design subtree", () => {
		resetComponentDraftStore();
		const { entitiesById } = normalizeDesign(fixture);

		const result = hydrateComponentDraftFromDesignSubtree({
			componentId: FIXTURE_COMPONENT_ID,
			rootId: containerId,
			entitiesById,
		});

		expect(result).toBe("hydrated");
		expect(serializeComponentDraftState(
			normalizeComponentDraft({
				componentId: FIXTURE_COMPONENT_ID,
				root: convertDesignSubtreeToComponentDraftRoot(
					containerId,
					entitiesById,
				).root,
			}),
		)).toMatchObject({
			path: "root",
			component: "container",
		});
	});
});
