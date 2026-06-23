import { describe, expect, it } from "vitest";
import {
	type MemoryQueryScope,
	memoryQueryKey,
	referenceTargetsQueryKey,
} from "./memory";

describe("memoryQueryKey", () => {
	const cases: Array<[MemoryQueryScope, unknown[]]> = [
		[{ kind: "project" }, ["trickroom-memory", "project"]],
		[
			{ kind: "system", systemId: "sys_1" },
			["trickroom-memory", "system", "sys_1"],
		],
		[
			{ kind: "design", designId: "design_1" },
			["trickroom-memory", "design", "design_1"],
		],
	];

	it.each(cases)("builds a stable key for %o", (scope, expected) => {
		expect(memoryQueryKey(scope)).toEqual(expected);
	});

	it("appends the project scope when provided", () => {
		expect(memoryQueryKey({ kind: "project" }, "loc_1")).toEqual([
			"trickroom-memory",
			"project",
			"loc_1",
		]);
	});

	it("namespaces reference-target keys by type and query", () => {
		expect(
			referenceTargetsQueryKey(
				{ kind: "system", systemId: "sys_1" },
				"component",
				"btn",
			),
		).toEqual([
			"trickroom-memory-reference-targets",
			"system",
			"sys_1",
			"component",
			"btn",
		]);
	});
});
