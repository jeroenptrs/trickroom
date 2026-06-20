import { describe, expect, it } from "vitest";
import {
	getControlProps,
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import {
	setSystemComponentOverrideClassNameOnRoots,
	setSystemComponentVariantValueOnRoots,
} from "./system-component-instance-update";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
} from "./system-component-markers";
import { resolveSystemComponentClassComposition } from "./system-component-resolution";

const publishedVersion = {
	version: "1",
	publishedAt: "2026-05-26T14:00:00.000Z",
	templateHash: "sha256:template",
	variantSchemaHash: "sha256:variants",
	root: {
		path: "root",
		library: "trickroom",
		component: "container",
		className: "base",
		children: [
			{
				path: "label",
				library: "trickroom",
				component: "text",
				text: "Label",
			},
		],
	},
	variants: {
		axes: {
			tone: {
				label: "Tone",
				defaultValue: "neutral",
				values: {
					brand: { classesByPath: { root: "text-blue-600" } },
					neutral: { classesByPath: { root: "text-zinc-700" } },
				},
			},
		},
	},
	overrideTargets: {
		rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
	},
};

describe("system-component-instance-update", () => {
	const roots = [
		{
			id: "root",
			props: {
				className: "base text-zinc-700",
				...getSystemComponentMarkerProps({
					systemId: "sys-core",
					componentId: "cmp_11111111-1111-4111-8111-111111111111",
					instanceId: "instance-1",
					version: "1",
					path: "root",
					isRoot: true,
					variantValues: { tone: "neutral" },
					overrides: {},
				}),
			},
			children: [
				{
					id: "label",
					props: {
						...getSystemComponentMarkerProps({
							systemId: "sys-core",
							componentId: "cmp_11111111-1111-4111-8111-111111111111",
							instanceId: "instance-1",
							version: "1",
							path: "label",
						}),
					},
					children: "Label",
				},
			],
		},
	];

	it("persists variant values on the root and reapplies classes", () => {
		const result = setSystemComponentVariantValueOnRoots(
			roots,
			"root",
			publishedVersion,
			"tone",
			"brand",
		);

		expect(result?.variantValues).toEqual({ tone: "brand" });
		const rootMetadata = getSystemComponentStructuralMetadata(
			result?.roots[0].props ?? {},
		);
		expect(rootMetadata?.variantValues).toEqual({ tone: "brand" });
		expect(result?.roots[0].props.className).toBe("base text-blue-600");
	});

	it("unsets optional variant values on the root and removes their classes", () => {
		const optionalVersion = {
			...publishedVersion,
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
							neutral: { classesByPath: { root: "text-zinc-700" } },
						},
					},
				},
			},
		};
		const result = setSystemComponentVariantValueOnRoots(
			roots,
			"root",
			optionalVersion,
			"tone",
			null,
		);

		expect(result?.variantValues).toEqual({});
		const rootMetadata = getSystemComponentStructuralMetadata(
			result?.roots[0].props ?? {},
		);
		expect(rootMetadata?.variantValues).toEqual({});
		expect(result?.roots[0].props.className).toBe("base");
	});

	it("materializes registry base classes when updating attached snapshots", () => {
		const separatorResolution = resolveRegistryComponent(
			"base-ui",
			"separator",
		);
		expect(separatorResolution.status).toBe("known");
		if (separatorResolution.status !== "known") return;

		const baseClassName = separatorResolution.definition.baseClassName;
		expect(baseClassName).toBeTruthy();

		const versionWithSeparator = {
			...publishedVersion,
			root: {
				path: "root",
				library: "base-ui",
				component: "separator",
				className: "template-separator",
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: { classesByPath: { root: "brand-separator" } },
							neutral: { classesByPath: { root: "neutral-separator" } },
						},
					},
				},
			},
		};
		const instanceRoots = [
			{
				id: "root",
				props: {
					className: `${baseClassName} template-separator neutral-separator`,
					[MATERIALIZED_BASE_CLASS_PROP]: "true",
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
						variantValues: { tone: "neutral" },
						overrides: {},
					}),
				},
				children: [],
			},
		];

		const result = setSystemComponentVariantValueOnRoots(
			instanceRoots,
			"root",
			versionWithSeparator,
			"tone",
			"brand",
		);

		expect(result?.roots[0].props.className).toBe(
			`${baseClassName} template-separator brand-separator`,
		);
		expect(result?.roots[0].props[MATERIALIZED_BASE_CLASS_PROP]).toBe("true");
		expect(
			getRenderableProps(
				result?.roots[0].props ?? {},
				separatorResolution.definition,
			).className,
		).toBe(result?.roots[0].props.className);
	});

	it("does not preserve a fake default className on icon when the variant contributes none", () => {
		const iconResolution = resolveRegistryComponent("trickroom", "icon");
		if (iconResolution.status !== "known") {
			throw new Error("trickroom/icon must resolve for this test");
		}
		const iconDefaultClassName = getControlProps(
			iconResolution.definition,
		).className;
		expect(iconDefaultClassName).toBeUndefined();

		const versionWithIcon = {
			...publishedVersion,
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				className: "base",
				children: [
					{
						path: "node",
						library: "trickroom",
						component: "icon",
						props: {
							"data-trickroom-icon-id": "icons-1/a-arrow-down",
						},
					},
				],
			},
			// The active variant defines no classesByPath for the icon node, so the
			// resolved system className is empty — the icon must stay without any
			// default className and should not synthesize `size-5`.
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: { brand: {}, neutral: {} },
					},
				},
			},
		};

		const instanceRoots = [
			{
				id: "root",
				props: {
					className: "base",
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
						variantValues: { tone: "neutral" },
						overrides: {},
					}),
				},
				children: [
					{
						id: "icon",
						props: {
							"data-trickroom-icon-id": "icons-1/a-arrow-down",
							...getSystemComponentMarkerProps({
								systemId: "sys-core",
								componentId: "cmp_11111111-1111-4111-8111-111111111111",
								instanceId: "instance-1",
								version: "1",
								path: "node",
							}),
						},
						children: [],
					},
				],
			},
		];

		const result = setSystemComponentVariantValueOnRoots(
			instanceRoots,
			"root",
			versionWithIcon,
			"tone",
			"brand",
		);

		const iconNode = result?.roots[0].children?.[0];
		expect(iconNode?.props.className).not.toBe("size-5");
		expect(iconNode?.props).not.toHaveProperty("className");
		expect(iconNode?.props.className).toBeUndefined();
		expect(result?.changedElementIds).not.toContain("icon");
	});

	it("persists override class names on the root and reapplies classes", () => {
		const overrideClassName =
			"tracking-tight unknown-override-token tracking-wide";
		const result = setSystemComponentOverrideClassNameOnRoots(
			roots,
			"root",
			publishedVersion,
			"rootTarget",
			overrideClassName,
		);

		expect(result?.overrides).toEqual({
			rootTarget: { className: overrideClassName },
		});
		expect(result?.roots[0].props.className).toBe(
			`base text-zinc-700 ${overrideClassName}`,
		);
		expect(
			getSystemComponentStructuralMetadata(result?.roots[0].props ?? {})
				?.overrides.rootTarget?.className,
		).toBe(overrideClassName);
		expect(
			resolveSystemComponentClassComposition(
				publishedVersion,
				"root",
				publishedVersion.root.className,
				result?.variantValues ?? {},
				result?.overrides ?? {},
			)
				.resolution.tokens.filter((token) =>
					token.classToken.startsWith("tracking-"),
				)
				.map((token) => ({
					classToken: token.classToken,
					status: token.status,
					shadowedBy: token.shadowedBy,
				})),
		).toEqual([
			{
				classToken: "tracking-tight",
				status: "shadowed",
				shadowedBy: 4,
			},
			{
				classToken: "tracking-wide",
				status: "active",
				shadowedBy: undefined,
			},
		]);
	});
});
