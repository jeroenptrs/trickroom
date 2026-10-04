import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
	buildMemoryReferenceDeepLink,
	collectMemoryReferenceWarnings,
	listMemoryReferenceTargets,
	parseMemoryReferences,
	resolveMemoryReferences,
} from "./memory-references";

const board = (name: string) => ({
	id: "board",
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children: [],
});

describe("parseMemoryReferences", () => {
	it("extracts typed reference tokens with positions", () => {
		const body =
			"See {{design:11111111-1111-4111-8111-111111111111}} and {{ component: btn }}.";
		const tokens = parseMemoryReferences(body);
		expect(tokens).toHaveLength(2);
		expect(tokens[0]).toMatchObject({
			type: "design",
			id: "11111111-1111-4111-8111-111111111111",
		});
		expect(tokens[1]).toMatchObject({ type: "component", id: "btn" });
		expect(body.slice(tokens[0]?.start, tokens[0]?.end)).toBe(tokens[0]?.raw);
	});

	it("extracts board and layer references", () => {
		expect(
			parseMemoryReferences("{{board:d1/b1}} then {{ layer : d1/el-2 }}"),
		).toMatchObject([
			{ type: "board", id: "d1/b1" },
			{ type: "layer", id: "d1/el-2" },
		]);
	});

	it("ignores unknown types and empty ids", () => {
		expect(parseMemoryReferences("{{unknown:x}} {{design:}}")).toHaveLength(0);
	});
});

describe("buildMemoryReferenceDeepLink", () => {
	it("builds design and system editor paths", () => {
		expect(buildMemoryReferenceDeepLink("design", "uuid-1")).toBe(
			"/design/uuid-1",
		);
		expect(
			buildMemoryReferenceDeepLink("design", "uuid-1", null, {
				boardId: "board-1",
				layerId: "layer-1",
			}),
		).toBe("/design/uuid-1?board=board-1&layer=layer-1");
		expect(buildMemoryReferenceDeepLink("component", "cmp_btn", "sys_1")).toBe(
			"/system/sys_1?component=cmp_btn",
		);
		expect(buildMemoryReferenceDeepLink("token", "color/brand", "sys_1")).toBe(
			"/system/sys_1?tab=tokens",
		);
		expect(buildMemoryReferenceDeepLink("asset", "asset_1", "sys_1")).toBe(
			"/system/sys_1?tab=assets",
		);
		expect(buildMemoryReferenceDeepLink("icon", "icon_1", "sys_1")).toBe(
			"/system/sys_1?tab=icons",
		);
	});

	it("points board and layer references into their design", () => {
		expect(buildMemoryReferenceDeepLink("board", "uuid-1/board-1")).toBe(
			"/design/uuid-1?board=board-1",
		);
		expect(
			buildMemoryReferenceDeepLink("layer", "uuid-1/layer-1", null, {
				boardId: "board-1",
			}),
		).toBe("/design/uuid-1?board=board-1&layer=layer-1");
		expect(buildMemoryReferenceDeepLink("layer", "layer-1")).toBeUndefined();
	});
});

describe("resolveMemoryReferences", () => {
	let tempProjectRoot: string;
	const designA = "11111111-1111-4111-8111-111111111111";

	const writeDesign = async (uuid: string, design: TrickroomDesign) => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "designs", `${uuid}.json`),
			JSON.stringify(design),
			"utf8",
		);
	};

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-memory-refs-"),
		);
		await writeDesign(designA, {
			name: "Design A",
			boards: [
				{
					...board("A"),
					children: [
						{
							id: "cta",
							props: {
								"data-trickroom-name": "Primary CTA",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Start",
						},
					],
				},
			],
		} as TrickroomDesign);
	});

	afterEach(async () => {
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	it("resolves existing and missing design references", async () => {
		const tokens = parseMemoryReferences(
			`{{design:${designA}}} {{design:99999999-9999-4999-8999-999999999999}}`,
		);
		const resolved = await resolveMemoryReferences(
			tempProjectRoot,
			{ kind: "project" },
			tokens,
		);
		expect(resolved[0]).toMatchObject({
			status: "valid",
			label: "Design A",
			deepLink: `/design/${designA}`,
		});
		expect(resolved[1]).toMatchObject({ status: "broken" });
	});

	it("marks system-scoped references as unresolvable without a linked system", async () => {
		const tokens = parseMemoryReferences("{{component:btn}}");
		const resolved = await resolveMemoryReferences(
			tempProjectRoot,
			{ kind: "project" },
			tokens,
		);
		expect(resolved[0]?.status).toBe("unresolvable_scope");
	});

	it("collects warnings for non-resolving references only", async () => {
		const warnings = await collectMemoryReferenceWarnings(
			tempProjectRoot,
			{ kind: "project" },
			`Valid {{design:${designA}}} and broken {{design:00000000-0000-4000-8000-000000000000}}.`,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ type: "design", status: "broken" });
	});

	it("resolves board and layer references with names and deep links", async () => {
		const resolved = await resolveMemoryReferences(
			tempProjectRoot,
			{ kind: "project" },
			parseMemoryReferences(
				`{{board:${designA}/board}} {{layer:${designA}/cta}} {{layer:${designA}/gone}} {{layer:cta}} {{board:99999999-9999-4999-8999-999999999999/board}}`,
			),
		);
		expect(resolved).toMatchObject([
			{
				status: "valid",
				label: "A",
				detail: "Design A",
				deepLink: `/design/${designA}?board=board`,
			},
			{
				status: "valid",
				label: "Primary CTA",
				detail: "Design A / A",
				deepLink: `/design/${designA}?board=board&layer=cta`,
			},
			{ status: "broken" },
			{ status: "broken" },
			{ status: "broken" },
		]);
	});

	it("warns about board and layer references that do not resolve", async () => {
		const warnings = await collectMemoryReferenceWarnings(
			tempProjectRoot,
			{ kind: "project" },
			`{{layer:${designA}/cta}} {{layer:${designA}/gone}} {{layer:cta}}`,
		);
		expect(warnings).toMatchObject([
			{ type: "layer", id: `${designA}/gone`, status: "broken" },
			{
				type: "layer",
				id: "cta",
				message: expect.stringContaining("{{layer:<designId>/<elementId>}}"),
			},
		]);
	});

	it("lists board targets everywhere and layer targets of one design", async () => {
		expect(
			await listMemoryReferenceTargets(
				tempProjectRoot,
				{ kind: "project" },
				"board",
			),
		).toEqual([{ id: `${designA}/board`, label: "A", detail: "Design A" }]);
		expect(
			await listMemoryReferenceTargets(
				tempProjectRoot,
				{ kind: "design", designId: designA },
				"layer",
				"cta",
			),
		).toEqual([{ id: `${designA}/cta`, label: "Primary CTA", detail: "A" }]);
		expect(
			await listMemoryReferenceTargets(
				tempProjectRoot,
				{ kind: "project" },
				"layer",
				`${designA}/primary`,
			),
		).toEqual([{ id: `${designA}/cta`, label: "Primary CTA", detail: "A" }]);
		expect(
			await listMemoryReferenceTargets(
				tempProjectRoot,
				{ kind: "project" },
				"layer",
			),
		).toEqual([]);
	});

	it("lists design reference targets", async () => {
		const targets = await listMemoryReferenceTargets(
			tempProjectRoot,
			{ kind: "project" },
			"design",
		);
		expect(targets).toEqual([{ id: designA, label: "Design A" }]);
	});
});
