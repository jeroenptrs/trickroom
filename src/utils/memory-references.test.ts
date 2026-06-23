import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
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

	it("ignores unknown types and empty ids", () => {
		expect(parseMemoryReferences("{{unknown:x}} {{design:}}")).toHaveLength(0);
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
			boards: [board("A")],
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
		expect(resolved[0]).toMatchObject({ status: "valid", label: "Design A" });
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

	it("lists design reference targets", async () => {
		const targets = await listMemoryReferenceTargets(
			tempProjectRoot,
			{ kind: "project" },
			"design",
		);
		expect(targets).toEqual([{ id: designA, label: "Design A" }]);
	});
});
