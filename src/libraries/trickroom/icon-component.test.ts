import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDesignDiagnostics } from "../../mcp/diagnostics";
import type { TrickroomMcpServerContext } from "../../mcp/server";
import { applyAddElement } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import { writeDesignSystemManifest } from "../../utils/design-system-store";
import { syncIconManifest } from "../../utils/icon-manifest-service";
import { iconIdProp } from "../../utils/resource-props";

const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

describe("trickroom icon component", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-icon-component-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("serializes as a leaf node with an icon id instance prop", () => {
		const design = {
			name: "Icon Design",
			systemName: "Core",
			boards: [],
		} satisfies TrickroomDesign;

		const result = applyAddElement(design, {
			parentId: null,
			index: 0,
			library: "trickroom",
			component: "icon",
			props: {
				[iconIdProp]: "src/search",
			},
		});

		expect(result.design.boards[0]).toMatchObject({
			props: {
				"data-trickroom-component": "icon",
				"data-trickroom-role": "leaf",
				[iconIdProp]: "src/search",
			},
			children: [],
		});
	});

	it("reports unknown icon ids against the linked system manifest", async () => {
		await writeDesignSystemManifest(projectRoot, "Core", {});
		const context = {
			projectRoot,
			config: {
				name: "Icon Project",
				systems: { Core: "src/index.css" },
			},
		} as TrickroomMcpServerContext;
		const design = createIconDesign("src/missing");

		const diagnostics = await getDesignDiagnostics(context, design);

		expect(diagnostics.issues).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "UNKNOWN_ICON_ID",
				elementId: "icon",
			}),
		);
	});

	it("accepts icon ids that exist in the linked generated icon manifest", async () => {
		await mkdir(path.join(projectRoot, "src", "icons"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "icons", "search.svg"),
			safeSvg,
		);
		await writeDesignSystemManifest(projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});
		await syncIconManifest(projectRoot, "Core");
		const context = {
			projectRoot,
			config: {
				name: "Icon Project",
				systems: { Core: "src/index.css" },
			},
		} as TrickroomMcpServerContext;
		const design = createIconDesign("src/search");

		const diagnostics = await getDesignDiagnostics(context, design);

		expect(diagnostics.issues).not.toContainEqual(
			expect.objectContaining({ code: "UNKNOWN_ICON_ID" }),
		);
	});
});

function createIconDesign(iconId: string): TrickroomDesign {
	return {
		name: "Icon Design",
		systemName: "Core",
		boards: [
			{
				id: "icon",
				props: {
					"data-trickroom-name": "Search",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "icon",
					"data-trickroom-role": "leaf",
					[iconIdProp]: iconId,
				},
				children: [],
			},
		],
	};
}
