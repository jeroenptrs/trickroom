import { describe, expect, it } from "vitest";
import type { SystemComponentSummary } from "../../queries/system-components";
import { expandRegistryRecipe } from "../../recipes/expansion";
import { normalizeDesign } from "../../stores/design-store";
import {
	getRegistryPickerSections,
	getUserComponentPickerSections,
	getVisibleLayerRows,
	resolveLayerInsertionPlacement,
} from "./Layers";

describe("visible layer rows", () => {
	it("flattens only expanded layer branches", () => {
		const state = normalizeDesign({
			name: "Visible rows",
			boards: [
				{
					id: "root",
					props: {
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						"data-trickroom-name": "Root",
					},
					children: [
						{
							id: "child",
							props: {
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
								"data-trickroom-role": "branch",
								"data-trickroom-name": "Child",
							},
							children: [
								{
									id: "grandchild",
									props: {
										"data-trickroom-library": "trickroom",
										"data-trickroom-component": "text",
										"data-trickroom-role": "text",
										"data-trickroom-name": "Grandchild",
									},
									children: "Text",
								},
							],
						},
					],
				},
				{
					id: "second-root",
					props: {
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						"data-trickroom-name": "Second",
					},
					children: [],
				},
			],
		});

		expect(
			getVisibleLayerRows({
				rootIds: state.rootIds,
				entitiesById: state.entitiesById,
				openById: {},
			}),
		).toEqual([
			{ id: "root", depth: 0, hasTopSeparator: false },
			{ id: "child", depth: 1, hasTopSeparator: false },
			{ id: "grandchild", depth: 2, hasTopSeparator: false },
			{ id: "second-root", depth: 0, hasTopSeparator: true },
		]);

		expect(
			getVisibleLayerRows({
				rootIds: state.rootIds,
				entitiesById: state.entitiesById,
				openById: { child: false },
			}),
		).toEqual([
			{ id: "root", depth: 0, hasTopSeparator: false },
			{ id: "child", depth: 1, hasTopSeparator: false },
			{ id: "second-root", depth: 0, hasTopSeparator: true },
		]);
	});
});

describe("registry picker sections", () => {
	it("lists components and recipes separately for Base UI with Avatar as a recipe", () => {
		const sections = getRegistryPickerSections("base-ui", "");

		expect(sections.map((section) => section.title)).toEqual([
			"Components",
			"Recipes",
		]);
		expect(
			sections
				.find((section) => section.title === "Components")
				?.items.some(
					(item) =>
						item.type === "component" && item.component === "avatar.root",
				),
		).toBe(true);
		expect(
			sections
				.find((section) => section.title === "Recipes")
				?.items.some(
					(item) =>
						item.type === "recipe" && item.recipe === "base-ui/avatar.default",
				),
		).toBe(true);
	});

	it("filters recipes by label", () => {
		const recipes = getRegistryPickerSections("base-ui", "avatar")
			.find((section) => section.title === "Recipes")
			?.items.filter((item) => item.type === "recipe");

		expect(recipes?.map((item) => item.recipe)).toEqual([
			"base-ui/avatar.default",
		]);
	});

	it("lists only published user-authored components", () => {
		const base = {
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			slug: "primary-button",
			name: "Primary Button",
			hasDraft: false,
			hasPublished: true,
			currentVersion: "1",
			createdAt: "2026-05-26T10:00:00.000Z",
			updatedAt: "2026-05-26T10:00:00.000Z",
		} satisfies SystemComponentSummary;
		const sections = getUserComponentPickerSections(
			[
				{ ...base, order: 2 },
				{
					...base,
					componentId: "cmp_22222222-2222-4222-8222-222222222222",
					slug: "draft-card",
					name: "Draft Card",
					hasDraft: true,
					hasPublished: false,
					currentVersion: undefined,
					order: 1,
				},
				{
					...base,
					componentId: "cmp_33333333-3333-4333-8333-333333333333",
					slug: "badge",
					name: "Badge",
					order: 1,
				},
			],
			"",
		);

		expect(sections.map((section) => section.title)).toEqual([
			"User authored components",
		]);
		expect(sections[0]?.items.map((item) => item.component.slug)).toEqual([
			"badge",
			"primary-button",
		]);
	});

	it("preflights picker placement against recipe structural boundaries", () => {
		const ids = ["avatar-root", "avatar-image", "avatar-fallback"];
		const expansion = expandRegistryRecipe("base-ui", "avatar.default", {
			createElementId: () => ids.shift() ?? "unexpected-id",
			createRecipeInstanceId: () => "recipe-instance-1",
		});
		const state = normalizeDesign({
			name: "Recipe Placement",
			boards: [expansion.root],
		});

		expect(
			resolveLayerInsertionPlacement({
				intent: "after",
				rootIds: state.rootIds,
				selectedElement: state.entitiesById["avatar-root"],
				selectedParent: null,
				entitiesById: state.entitiesById,
			}),
		).toEqual({ parentId: null, index: 1 });

		expect(
			resolveLayerInsertionPlacement({
				intent: "after",
				rootIds: state.rootIds,
				selectedElement: state.entitiesById["avatar-image"],
				selectedParent: state.entitiesById["avatar-root"],
				entitiesById: state.entitiesById,
			}),
		).toBeNull();

		expect(
			resolveLayerInsertionPlacement({
				intent: "inside",
				rootIds: state.rootIds,
				selectedElement: state.entitiesById["avatar-fallback"],
				selectedParent: state.entitiesById["avatar-root"],
				entitiesById: state.entitiesById,
			}),
		).toEqual({ parentId: "avatar-fallback", index: 0 });

		expect(
			resolveLayerInsertionPlacement({
				intent: "after",
				rootIds: state.rootIds,
				selectedElement: state.entitiesById["avatar-fallback"],
				selectedParent: state.entitiesById["avatar-root"],
				entitiesById: state.entitiesById,
			}),
		).toBeNull();
	});
});
