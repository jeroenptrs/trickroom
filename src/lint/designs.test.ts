import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { createDesignFileService } from "../services/design-file-service";
import type { Node, TrickroomDesign } from "../types";
import { findDesignSystem } from "../utils/design-system-store";
import { getSystemComponentMarkerProps } from "../utils/system-component-markers";
import { buildLintDesignIndex, countDesignUsages } from "./designs";
import { readLinkedDesigns } from "./run-lint";

const button = publishedComponent("button", flatPayload("px-3"));

const node = (
	id: string,
	props: Record<string, unknown> = {},
	children: Node[] = [],
): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		...props,
	} as Node["props"],
	children,
});

const buttonInstance = (id: string, systemId = CODEGEN_TEST_SYSTEM_ID) =>
	node(
		id,
		{
			className: "px-3",
			...getSystemComponentMarkerProps({
				systemId,
				componentId: button.componentId,
				instanceId: `inst_${id}`,
				version: "1",
				path: "root",
				isRoot: true,
				variantValues: { size: "sm" },
			}),
		},
		[
			node(`${id}-label`, {
				...getSystemComponentMarkerProps({
					systemId,
					componentId: button.componentId,
					instanceId: `inst_${id}`,
					version: "1",
					path: "label",
				}),
			}),
		],
	);

const linked: TrickroomDesign = {
	name: "Linked",
	systemId: CODEGEN_TEST_SYSTEM_ID,
	boards: [
		node("cart", { "data-trickroom-name": "Cart", className: "flex gap-2" }, [
			buttonInstance("buy"),
			buttonInstance("foreign", "sys_other"),
		]),
		node("empty", { "data-trickroom-name": "Empty" }),
	],
};

const otherSystem: TrickroomDesign = {
	name: "Other",
	systemId: "sys_00000000-0000-4000-8000-0000000000ff",
	boards: [node("board", {}, [buttonInstance("elsewhere")])],
};

describe("design index", () => {
	const cleanups: Array<() => Promise<void>> = [];
	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});

	const setup = async () => {
		const project: CodegenTestProject = await createCodegenTestProject({
			components: [button],
		});
		const home = await mkdtemp(path.join(os.tmpdir(), "trickroom-home-"));
		cleanups.push(project.cleanup, () =>
			rm(home, { recursive: true, force: true }),
		);
		const service = createDesignFileService(project.root, {
			trickroomHome: home,
		});
		await service.initializeDesignsDirectory();
		await service.writeDesignFile("d-linked", linked);
		await service.writeDesignFile("d-other", otherSystem);
		const system = await findDesignSystem(
			project.root,
			CODEGEN_TEST_SYSTEM_ID,
			{
				readOnly: true,
			},
		);
		if (!system) throw new Error("no system");
		return { project, system };
	};

	it("reads the designs linked to the system read-only and indexes them", async () => {
		const { project, system } = await setup();
		await writeFile(
			project.path(".trickroom/designs/d-broken.json"),
			"{ not json",
		);
		const before = await project.snapshotMtimes();

		const read = await readLinkedDesigns(project.root, system);
		expect(await project.snapshotMtimes()).toEqual(before);
		expect(read.designs.map((entry) => entry.id)).toEqual(["d-linked"]);
		expect(read.unreadable).toEqual([
			{
				id: "d-broken",
				file: ".trickroom/designs/d-broken",
				message: expect.any(String),
			},
		]);

		const index = buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: read.designs,
		});
		expect(index.designs).toHaveLength(1);
		const [design] = index.designs;
		expect(design).toMatchObject({ id: "d-linked", name: "Linked" });
		expect(design.boards.map((board) => [board.id, board.name])).toEqual([
			["cart", "Cart"],
			["empty", "Empty"],
		]);
		expect(design.boards[0].nodes.map((entry) => entry.path)).toEqual([
			"boards[0]",
			"boards[0].children[0]",
			"boards[0].children[0].children[0]",
			"boards[0].children[1]",
			"boards[0].children[1].children[0]",
		]);
		expect(design.boards[0].nodes[0]).toEqual({
			element: "cart",
			path: "boards[0]",
			className: "flex gap-2",
			checkedClassName: "flex gap-2",
			classSource: "layer",
			render: { kind: "classes", className: "flex gap-2", known: true },
			instance: null,
		});
		expect(design.boards[0].nodes[1].instance).toEqual({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			componentId: button.componentId,
			instanceId: "inst_buy",
			version: "1",
			templatePath: "root",
			root: true,
			variantValues: { size: "sm" },
		});
		expect(design.boards[0].nodes[2].instance).toMatchObject({
			templatePath: "label",
			root: false,
			variantValues: {},
		});
		// Only roots of this system's instances count as usages.
		expect(index.usages).toEqual({
			[button.componentId]: [
				{
					design: "d-linked",
					board: "cart",
					element: "buy",
					path: "boards[0].children[0]",
					instanceId: "inst_buy",
					version: "1",
					variantValues: { size: "sm" },
				},
			],
		});
		expect(countDesignUsages(index)).toEqual({ [button.componentId]: 1 });
	});

	it("limits a design to some boards, keeping the design's board indexes", () => {
		const index = buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "d", design: linked, boardIds: new Set(["empty"]) }],
		});
		expect(index.designs[0].boards.map((board) => board.id)).toEqual(["empty"]);
		expect(index.designs[0].boards[0].nodes[0].path).toBe("boards[1]");
		expect(index.usages).toEqual({});
	});

	it("lists nothing when the project has no designs folder", async () => {
		const project = await createCodegenTestProject();
		cleanups.push(project.cleanup);
		await mkdir(project.path(".trickroom/systems/core"), { recursive: true });
		const system = await findDesignSystem(
			project.root,
			CODEGEN_TEST_SYSTEM_ID,
			{
				readOnly: true,
			},
		);
		if (!system) throw new Error("no system");
		expect(await readLinkedDesigns(project.root, system)).toEqual({
			designs: [],
			unreadable: [],
		});
	});
});
