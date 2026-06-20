import { describe, expect, it } from "vitest";
import { MATERIALIZED_BASE_CLASS_PROP } from "../libraries/registry";
import {
	resolveMaterializedSystemComponentClassComposition,
	resolveSystemComponentClassComposition,
	resolveSystemComponentClassLayers,
	resolveSystemComponentClassName,
	resolveSystemComponentMaterializedSnapshotClassComposition,
	resolveSystemComponentVariantValues,
} from "./system-component-resolution";
import type { PublishedSystemComponentVersion } from "./system-components";

const version: PublishedSystemComponentVersion = {
	version: "1",
	publishedAt: "2026-05-31T00:00:00.000Z",
	templateHash: "template-hash",
	variantSchemaHash: "variant-hash",
	root: {
		path: "root",
		library: "base-ui",
		component: "button",
	},
	variants: {
		axes: {
			intent: {
				label: "Intent",
				values: {
					neutral: { classesByPath: { root: "bg-neutral-100" } },
					brand: { classesByPath: { root: "bg-brand-600" } },
				},
			},
			size: {
				label: "Size",
				values: {
					sm: { classesByPath: { root: "px-2 py-1" } },
					lg: { classesByPath: { root: "px-4 py-2" } },
				},
			},
		},
		compoundVariants: [
			{
				when: { intent: "neutral", size: "lg" },
				classesByPath: { root: "ring-neutral-200" },
			},
			{
				when: { intent: "brand", size: "lg" },
				classesByPath: { root: "ring-brand-200" },
			},
		],
	},
	overrideTargets: {
		root: {
			targetId: "root",
			label: "Root",
			path: "root",
			capabilities: ["className"],
		},
	},
};

describe("resolveSystemComponentVariantValues", () => {
	it("omits default-less axes unless an explicit value is selected", () => {
		expect(resolveSystemComponentVariantValues(version.variants, {})).toEqual(
			{},
		);
		expect(
			resolveSystemComponentVariantValues(version.variants, {
				intent: "brand",
			}),
		).toEqual({ intent: "brand" });
	});

	it("uses schema defaults before axis defaults", () => {
		expect(
			resolveSystemComponentVariantValues(
				{
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								brand: {},
								neutral: {},
							},
						},
					},
					defaultValues: { tone: "brand" },
				},
				{},
			),
		).toEqual({ tone: "brand" });
	});

	it("throws for unknown axes and invalid explicit values", () => {
		expect(() =>
			resolveSystemComponentVariantValues(version.variants, { tone: "brand" }),
		).toThrow("unknown variant axes: tone");
		expect(() =>
			resolveSystemComponentVariantValues(version.variants, {
				intent: "missing",
			}),
		).toThrow('axis "intent" contains invalid value "missing"');
	});

	it("does not match compounds when an optional axis condition is absent", () => {
		const optionalVersion: PublishedSystemComponentVersion = {
			...version,
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
						},
					},
					size: {
						label: "Size",
						values: {
							lg: { classesByPath: { root: "text-lg" } },
						},
					},
				},
				compoundVariants: [
					{
						when: { tone: "brand", size: "lg" },
						classesByPath: { root: "ring-2" },
					},
				],
			},
		};

		const variantValues = resolveSystemComponentVariantValues(
			optionalVersion.variants,
			{ tone: "brand" },
		);

		expect(variantValues).toEqual({ tone: "brand" });
		expect(
			resolveSystemComponentClassName(
				optionalVersion,
				"root",
				"base",
				variantValues,
			),
		).toBe("base text-blue-600");
	});
});

describe("resolveSystemComponentClassLayers", () => {
	it("preserves class source metadata in deterministic flattening order", () => {
		const layers = resolveSystemComponentClassLayers(
			version,
			"root",
			" inline-flex   items-center ",
			{ intent: "brand", size: "lg" },
			{ root: { className: "shadow-sm" } },
		);

		expect(layers).toEqual([
			{
				source: "system-template",
				className: "inline-flex items-center",
				metadata: { path: "root" },
			},
			{
				source: "system-variant",
				className: "bg-brand-600",
				metadata: { path: "root", axis: "intent", value: "brand" },
			},
			{
				source: "system-variant",
				className: "px-4 py-2",
				metadata: { path: "root", axis: "size", value: "lg" },
			},
			{
				source: "system-compound-variant",
				className: "ring-brand-200",
				metadata: { path: "root", compoundIndex: 1 },
			},
			{
				source: "instance-override",
				className: "shadow-sm",
				metadata: { path: "root", prop: "className" },
			},
		]);

		expect(
			resolveSystemComponentClassName(
				version,
				"root",
				" inline-flex   items-center ",
				{ intent: "brand", size: "lg" },
				{ root: { className: "shadow-sm" } },
			),
		).toBe(
			"inline-flex items-center bg-brand-600 px-4 py-2 ring-brand-200 shadow-sm",
		);
	});

	it("resolves active and shadowed class tokens across system layers", () => {
		const composition = resolveSystemComponentClassComposition(
			version,
			"root",
			"h-4 px-2 inline-flex",
			{ intent: "brand", size: "lg" },
			{ root: { className: "px-8" } },
			{
				systemId: "sys-core",
				componentId: "cmp-button",
				instanceId: "instance-1",
			},
		);

		expect(composition.className).toBe(
			"h-4 px-2 inline-flex bg-brand-600 px-4 py-2 ring-brand-200 px-8",
		);
		expect(
			composition.resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				status: token.status,
				metadata: token.layer.metadata,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "h-4",
				source: "system-template",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "px-2",
				source: "system-template",
				status: "shadowed",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
				},
				shadowedBy: 4,
			},
			{
				classToken: "inline-flex",
				source: "system-template",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "bg-brand-600",
				source: "system-variant",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
					axis: "intent",
					value: "brand",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "px-4",
				source: "system-variant",
				status: "shadowed",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
					axis: "size",
					value: "lg",
				},
				shadowedBy: 7,
			},
			{
				classToken: "py-2",
				source: "system-variant",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
					axis: "size",
					value: "lg",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "ring-brand-200",
				source: "system-compound-variant",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
					compoundIndex: 1,
				},
				shadowedBy: undefined,
			},
			{
				classToken: "px-8",
				source: "instance-override",
				status: "active",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					path: "root",
					prop: "className",
				},
				shadowedBy: undefined,
			},
		]);
	});

	it("materializes registry base classes once while keeping system layer metadata", () => {
		const composition = resolveMaterializedSystemComponentClassComposition(
			version,
			"root",
			"h-4 px-2",
			"fallback",
			{ intent: "brand", size: "lg" },
			{ root: { className: "px-8" } },
			{
				role: "branch",
				label: "Button",
				baseClassName: "h-px w-full",
			},
			{
				systemId: "sys-core",
				componentId: "cmp-button",
				instanceId: "instance-1",
				library: "base-ui",
				component: "button",
			},
		);

		expect(composition.className).toBe(
			"h-px w-full h-4 px-2 bg-brand-600 px-4 py-2 ring-brand-200 px-8",
		);
		expect(composition.props).toEqual({
			className:
				"h-px w-full h-4 px-2 bg-brand-600 px-4 py-2 ring-brand-200 px-8",
			[MATERIALIZED_BASE_CLASS_PROP]: "true",
		});
		expect(composition.layers.map((layer) => layer.source)).toEqual([
			"registry-base",
			"system-template",
			"system-variant",
			"system-variant",
			"system-compound-variant",
			"instance-override",
		]);
		expect(
			composition.resolution.tokens
				.filter((token) => token.classToken.startsWith("h-"))
				.map((token) => ({
					classToken: token.classToken,
					source: token.layer.source,
					status: token.status,
					shadowedBy: token.shadowedBy,
				})),
		).toEqual([
			{
				classToken: "h-px",
				source: "registry-base",
				status: "shadowed",
				shadowedBy: 2,
			},
			{
				classToken: "h-4",
				source: "system-template",
				status: "active",
				shadowedBy: undefined,
			},
		]);
	});

	it("resolves materialized snapshots as their own source layer", () => {
		const composition =
			resolveSystemComponentMaterializedSnapshotClassComposition(
				"h-px w-full h-4",
				{
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					library: "base-ui",
					component: "button",
				},
			);

		expect(composition.layers).toEqual([
			{
				source: "materialized-snapshot",
				className: "h-px w-full h-4",
				metadata: {
					systemId: "sys-core",
					componentId: "cmp-button",
					instanceId: "instance-1",
					library: "base-ui",
					component: "button",
				},
			},
		]);
		expect(
			composition.resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				status: token.status,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "h-px",
				source: "materialized-snapshot",
				status: "shadowed",
				shadowedBy: 2,
			},
			{
				classToken: "w-full",
				source: "materialized-snapshot",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "h-4",
				source: "materialized-snapshot",
				status: "active",
				shadowedBy: undefined,
			},
		]);
	});
});
