import { describe, expect, it } from "vitest";
import type { RecipeTemplateNode } from "../types";
import {
	availableRegistries,
	getComponentIds,
	getRegistryRecipes,
} from "./registry";
import { resolveRenderableRegistryComponent } from "./render-registry";

// The stage renders nothing useful for a registry component without a render
// component, so a missing renderer silently blanks designs and agent
// screenshots. `render-components.ts` also has a `satisfies` check, but this
// test keeps the guard in `pnpm test` where it cannot hide in a tsc baseline.

const collectTemplateNodes = (
	node: RecipeTemplateNode,
	nodes: RecipeTemplateNode[] = [],
) => {
	nodes.push(node);
	for (const child of node.children ?? []) {
		collectTemplateNodes(child, nodes);
	}
	return nodes;
};

describe("registry integrity", () => {
	it("has a render component for every registry component", () => {
		const missing = availableRegistries.flatMap((library) =>
			getComponentIds(library)
				.filter(
					(component) =>
						resolveRenderableRegistryComponent(library, component).status !==
						"known",
				)
				.map((component) => `${library}/${component}`),
		);

		expect(missing).toEqual([]);
	});

	it("only builds recipes from renderable components", () => {
		const unrenderable = availableRegistries.flatMap((library) =>
			getRegistryRecipes(library).flatMap((recipe) => {
				const templates = [
					recipe.root,
					...Object.values(recipe.slots ?? {}).flatMap(
						(slot) => slot.defaultChildren ?? [],
					),
				];
				return templates
					.flatMap((template) => collectTemplateNodes(template))
					.filter(
						(node) =>
							resolveRenderableRegistryComponent(node.library, node.component)
								.status !== "known",
					)
					.map((node) => `${recipe.id}:${node.path}`);
			}),
		);

		expect(unrenderable).toEqual([]);
	});

	it("points every recipe control at a structural path in its recipe", () => {
		const danglingControls = availableRegistries.flatMap((library) =>
			getRegistryRecipes(library).flatMap((recipe) => {
				const paths = new Set(
					collectTemplateNodes(recipe.root).map((node) => node.path),
				);
				return Object.entries(recipe.controls ?? {})
					.filter(([, control]) => !paths.has(control.path))
					.map(([key, control]) => `${recipe.id}:${key} -> ${control.path}`);
			}),
		);

		expect(danglingControls).toEqual([]);
	});
});
