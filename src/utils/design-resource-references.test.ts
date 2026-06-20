import { describe, expect, it } from "vitest";
import { recipeIdProp } from "../recipes/markers";
import type { TrickroomDesign } from "../types";
import {
	assetIdProp,
	collectDesignResourceReferences,
	designReferencesSystemHandle,
	getResourceKindForComponent,
	iconIdProp,
} from "./design-resource-references";

describe("design resource references", () => {
	it("detects resource ownership from registry-declared resource props", () => {
		expect(getResourceKindForComponent("trickroom", "asset")).toBe("asset");
		expect(getResourceKindForComponent("base-ui", "avatar.image")).toBe(
			"asset",
		);
		expect(getResourceKindForComponent("trickroom", "icon")).toBe("icon");
		expect(getResourceKindForComponent("base-ui", "separator")).toBeNull();
		expect(
			getResourceKindForComponent("base-ui", "unknown-component"),
		).toBeNull();
	});

	it("collects avatar image asset references without depending on recipe marker validity", () => {
		const design = {
			name: "Avatar Resource Design",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "avatar-image",
							props: {
								"data-trickroom-name": "Avatar Image",
								"data-trickroom-library": "base-ui",
								"data-trickroom-component": "avatar.image",
								"data-trickroom-role": "leaf",
								[assetIdProp]: " AST_HERO ",
								[recipeIdProp]: "base-ui/missing.recipe",
							},
							children: [],
						},
						{
							id: "blank-avatar-image",
							props: {
								"data-trickroom-name": "Blank Avatar Image",
								"data-trickroom-library": "base-ui",
								"data-trickroom-component": "avatar.image",
								"data-trickroom-role": "leaf",
								[assetIdProp]: "   ",
							},
							children: [],
						},
						{
							id: "icon",
							props: {
								"data-trickroom-name": "Icon",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "icon",
								"data-trickroom-role": "leaf",
								[iconIdProp]: "src/search",
							},
							children: [],
						},
					],
				},
			],
		} satisfies TrickroomDesign;

		expect(collectDesignResourceReferences(design)).toEqual([
			{
				kind: "asset",
				resourceId: "ast_hero",
				allowsBlank: true,
				elementId: "avatar-image",
				path: "boards[0].children[0]",
			},
			{
				kind: "asset",
				resourceId: null,
				allowsBlank: true,
				elementId: "blank-avatar-image",
				path: "boards[0].children[1]",
			},
			{
				kind: "icon",
				resourceId: "src/search",
				allowsBlank: false,
				elementId: "icon",
				path: "boards[0].children[2]",
			},
		]);
	});

	it("matches designs by system id, name, and configured system metadata", () => {
		const system = {
			manifest: {
				systemId: "sys_core",
				systemName: "Core",
				previousSystemNames: ["Legacy Core"],
			},
			storageKey: "core",
		} as const;

		expect(
			designReferencesSystemHandle(
				{ systemId: "sys_core", systemName: null },
				"sys_core",
				system,
			),
		).toBe(true);
		expect(
			designReferencesSystemHandle(
				{ systemId: null, systemName: "Core" },
				"sys_core",
				system,
			),
		).toBe(false);
		expect(
			designReferencesSystemHandle(
				{ systemName: "Legacy Core" },
				"sys_core",
				system,
			),
		).toBe(true);
		expect(
			designReferencesSystemHandle(
				{ systemId: null, systemName: "Legacy Core" },
				"sys_core",
				system,
			),
		).toBe(false);
		expect(
			designReferencesSystemHandle(
				{ systemId: null, systemName: "Other" },
				"sys_core",
				system,
			),
		).toBe(false);
		expect(
			designReferencesSystemHandle(
				{ systemId: null, systemName: null },
				"sys_core",
				system,
			),
		).toBe(false);
	});
});
