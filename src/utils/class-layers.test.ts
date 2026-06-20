import { describe, expect, it } from "vitest";
import {
	type ClassLayer,
	createClassLayer,
	createClassLayers,
	flattenClassLayers,
	persistedClassNameOutputPolicy,
	shouldNormalizePersistedClassNameOutput,
	splitClassLayerTokens,
} from "./class-layers";

describe("class layers", () => {
	it("constructs typed layers with source metadata", () => {
		const layer = createClassLayer("registry-base", " h-px  w-full ", {
			library: "base-ui",
			component: "separator",
		});

		expect(layer).toEqual({
			source: "registry-base",
			className: "h-px w-full",
			metadata: {
				library: "base-ui",
				component: "separator",
			},
		});
	});

	it("drops empty layers while preserving source order and metadata", () => {
		const layers = createClassLayers([
			{
				source: "system-template",
				className: "template",
				metadata: { path: "root" },
			},
			{ source: "system-variant", className: "  " },
			{
				source: "system-compound-variant",
				className: "compound",
				metadata: { compoundIndex: 1 },
			},
			{
				source: "instance-override",
				className: "override",
				metadata: { instanceId: "instance-1" },
			},
			{ source: "authored", className: undefined },
			{ source: "materialized-snapshot", className: "snapshot" },
		]);

		expect(layers).toEqual([
			{
				source: "system-template",
				className: "template",
				metadata: { path: "root" },
			},
			{
				source: "system-compound-variant",
				className: "compound",
				metadata: { compoundIndex: 1 },
			},
			{
				source: "instance-override",
				className: "override",
				metadata: { instanceId: "instance-1" },
			},
			{ source: "materialized-snapshot", className: "snapshot" },
		]);
	});

	it("flattens layers deterministically without resolving conflicts", () => {
		const layers: ClassLayer[] = [
			{ source: "registry-base", className: "p-2 text-sm" },
			{ source: "system-template", className: " p-card   p-6 " },
			{ source: "system-variant", className: "hover:p-8" },
			{ source: "instance-override", className: "p-4" },
		];

		expect(flattenClassLayers(layers)).toBe(
			"p-2 text-sm p-card p-6 hover:p-8 p-4",
		);
	});

	it("returns undefined when no class tokens remain", () => {
		expect(flattenClassLayers([])).toBeUndefined();
		expect(flattenClassLayers([{ className: "  " }])).toBeUndefined();
	});

	it("shares token splitting for adapters that need current join behavior", () => {
		expect(splitClassLayerTokens(" px-2\n\tpy-1  ")).toEqual(["px-2", "py-1"]);
	});

	it("documents that resolver output is not a persisted className normalizer", () => {
		expect(shouldNormalizePersistedClassNameOutput()).toBe(false);
		expect(persistedClassNameOutputPolicy.normalizesPersistedOutput).toBe(
			false,
		);
	});
});
