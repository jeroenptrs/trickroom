import { describe, expect, it } from "vitest";
import { buildClassInventory } from "./classInventory";

const opts = { colorTokens: new Set(["red-500"]) };

describe("buildClassInventory", () => {
	it("separates managed, arbitrary-property, and unrecognized classes", () => {
		const inv = buildClassInventory(
			"p-4 unknown-card hover:p-6 md:bg-red-500 [grid-area:main] mt-2!",
			opts,
		);

		expect(inv.managed.map((i) => i.raw)).toEqual([
			"p-4",
			"hover:p-6",
			"md:bg-red-500",
			"mt-2!",
		]);
		expect(inv.unknown.map((i) => i.raw)).toEqual(["unknown-card"]);
		expect(inv.arbitrary.map((i) => i.raw)).toEqual(["[grid-area:main]"]);
		expect(inv.conflicts).toEqual([]);
		// original order + count is preserved across all categories
		expect(inv.items).toHaveLength(6);
	});

	it("flags same-slot conflicts and marks the shadowed class", () => {
		const inv = buildClassInventory("p-4 p-6 flex", opts);

		expect(inv.conflicts).toHaveLength(1);
		expect(inv.conflicts[0].slot).toBe("spacing.padding");
		expect(inv.conflicts[0].raws).toEqual(["p-4", "p-6"]);
		expect(inv.items.filter((i) => i.shadowed).map((i) => i.raw)).toEqual([
			"p-4",
		]);
	});

	it("treats per-variant slots independently (no false conflict)", () => {
		const inv = buildClassInventory("p-4 hover:p-6 md:p-8", opts);
		expect(inv.conflicts).toEqual([]);
		expect(inv.managed).toHaveLength(3);
	});

	it("does not shadow a same-property class in a different mode bucket", () => {
		const inv = buildClassInventory("p-4 p-6 dark:p-8", opts);
		// Only the base bucket conflicts; dark:p-8 lives in its own bucket.
		expect(inv.conflicts).toHaveLength(1);
		expect(inv.items.filter((i) => i.shadowed).map((i) => i.raw)).toEqual([
			"p-4",
		]);
	});

	it("preserves layer source metadata and resolver shadowed status", () => {
		const inv = buildClassInventory(
			{
				layers: [
					{ source: "registry-base", className: "p-1 text-red-500" },
					{ source: "system-template", className: "p-2" },
					{ source: "system-variant", className: "p-3" },
					{ source: "system-compound-variant", className: "p-4" },
					{ source: "instance-override", className: "p-5" },
					{ source: "authored", className: "p-6 unknown-card" },
				],
			},
			opts,
		);

		expect(
			inv.items.map((item) => ({
				raw: item.raw,
				source: item.source,
				status: item.status,
				readOnly: item.readOnly,
				shadowedBy: item.shadowedBy,
			})),
		).toEqual([
			{
				raw: "p-1",
				source: "registry-base",
				status: "shadowed",
				readOnly: true,
				shadowedBy: 2,
			},
			{
				raw: "text-red-500",
				source: "registry-base",
				status: "active",
				readOnly: true,
				shadowedBy: undefined,
			},
			{
				raw: "p-2",
				source: "system-template",
				status: "shadowed",
				readOnly: true,
				shadowedBy: 3,
			},
			{
				raw: "p-3",
				source: "system-variant",
				status: "shadowed",
				readOnly: true,
				shadowedBy: 4,
			},
			{
				raw: "p-4",
				source: "system-compound-variant",
				status: "shadowed",
				readOnly: true,
				shadowedBy: 5,
			},
			{
				raw: "p-5",
				source: "instance-override",
				status: "shadowed",
				readOnly: false,
				shadowedBy: 6,
			},
			{
				raw: "p-6",
				source: "authored",
				status: "active",
				readOnly: false,
				shadowedBy: undefined,
			},
			{
				raw: "unknown-card",
				source: "authored",
				status: "unknown",
				readOnly: false,
				shadowedBy: undefined,
			},
		]);
		expect(inv.conflicts[0].raws).toEqual([
			"p-1",
			"p-2",
			"p-3",
			"p-4",
			"p-5",
			"p-6",
		]);
	});

	it("treats materialized base snapshots as read-only inventory input", () => {
		const inv = buildClassInventory(
			{
				layers: [
					{
						source: "materialized-snapshot",
						className: "h-px w-full authored-separator",
					},
				],
			},
			opts,
		);

		expect(inv.readOnly.map((item) => item.raw)).toEqual([
			"h-px",
			"w-full",
			"authored-separator",
		]);
		expect(inv.items.every((item) => item.readOnly)).toBe(true);
	});
});
