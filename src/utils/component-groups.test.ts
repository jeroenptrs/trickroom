import { describe, expect, it } from "vitest";
import type { SystemComponentSummary } from "../queries/system-components";
import {
	buildComponentGroupTree,
	collectGroupFolderPaths,
	flattenComponentGroupSections,
	parseGroupPath,
} from "./component-groups";

const summary = (
	overrides: Partial<SystemComponentSummary>,
): SystemComponentSummary => ({
	componentId: "cmp_1",
	slug: "button",
	name: "Button",
	hasDraft: true,
	hasPublished: false,
	createdAt: "2026-05-26T00:00:00.000Z",
	updatedAt: "2026-05-26T00:00:00.000Z",
	...overrides,
});

describe("parseGroupPath", () => {
	it("splits slash-delimited paths into trimmed segments", () => {
		expect(parseGroupPath("atoms/typography")).toEqual(["atoms", "typography"]);
		expect(parseGroupPath(" atoms / interaction ")).toEqual([
			"atoms",
			"interaction",
		]);
	});

	it("treats a flat group as a single-segment path", () => {
		expect(parseGroupPath("Inputs")).toEqual(["Inputs"]);
	});

	it("returns an empty path for missing or blank groups", () => {
		expect(parseGroupPath(undefined)).toEqual([]);
		expect(parseGroupPath(null)).toEqual([]);
		expect(parseGroupPath("   ")).toEqual([]);
	});

	it("normalizes backslashes and collapses empty segments", () => {
		expect(parseGroupPath("atoms//typography/")).toEqual([
			"atoms",
			"typography",
		]);
		expect(parseGroupPath("atoms\\interaction")).toEqual([
			"atoms",
			"interaction",
		]);
	});
});

describe("buildComponentGroupTree", () => {
	it("nests slash paths under a shared parent folder", () => {
		const tree = buildComponentGroupTree([
			summary({ componentId: "a", name: "Heading", group: "atoms/typography" }),
			summary({ componentId: "b", name: "Hover", group: "atoms/interaction" }),
		]);

		expect(tree.folders).toHaveLength(1);
		const atoms = tree.folders[0];
		expect(atoms?.segment).toBe("atoms");
		expect(atoms?.path).toBe("atoms");
		expect(atoms?.components).toEqual([]);
		expect(atoms?.folders.map((folder) => folder.segment)).toEqual([
			"interaction",
			"typography",
		]);
		expect(atoms?.folders[1]?.path).toBe("atoms/typography");
		expect(atoms?.folders[1]?.components[0]?.name).toBe("Heading");
	});

	it("keeps direct members on an intermediate folder that also has subfolders", () => {
		const tree = buildComponentGroupTree([
			summary({ componentId: "a", name: "Token", group: "atoms" }),
			summary({ componentId: "b", name: "Heading", group: "atoms/typography" }),
		]);

		const atoms = tree.folders[0];
		expect(atoms?.components.map((component) => component.name)).toEqual([
			"Token",
		]);
		expect(atoms?.folders[0]?.segment).toBe("typography");
	});

	it("places groupless components in the ungrouped bucket, sorted by order then name", () => {
		const tree = buildComponentGroupTree([
			summary({ componentId: "a", name: "Beta", order: 2 }),
			summary({ componentId: "b", name: "Alpha", order: 2 }),
			summary({ componentId: "c", name: "Zeta", order: 1 }),
		]);

		expect(tree.folders).toEqual([]);
		expect(tree.ungrouped.map((component) => component.name)).toEqual([
			"Zeta",
			"Alpha",
			"Beta",
		]);
	});
});

describe("flattenComponentGroupSections", () => {
	it("emits one section per folder with direct members, ungrouped last", () => {
		const tree = buildComponentGroupTree([
			summary({ componentId: "a", name: "Token", group: "atoms" }),
			summary({ componentId: "b", name: "Heading", group: "atoms/typography" }),
			summary({ componentId: "c", name: "Loose" }),
		]);

		expect(
			flattenComponentGroupSections(tree).map((section) => section.path),
		).toEqual(["atoms", "atoms/typography", ""]);
	});
});

describe("collectGroupFolderPaths", () => {
	it("lists every folder path depth-first", () => {
		const tree = buildComponentGroupTree([
			summary({ componentId: "a", name: "Heading", group: "atoms/typography" }),
			summary({ componentId: "b", name: "Card", group: "molecules" }),
		]);

		expect(collectGroupFolderPaths(tree)).toEqual([
			"atoms",
			"atoms/typography",
			"molecules",
		]);
	});
});
