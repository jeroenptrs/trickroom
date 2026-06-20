import { describe, expect, it } from "vitest";
import {
	getControlProps,
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

	it("preserves a sublayer's registry default className when the variant contributes none", () => {
		const iconResolution = resolveRegistryComponent("trickroom", "icon");
		if (iconResolution.status !== "known") {
			throw new Error("trickroom/icon must resolve for this test");
		}
		const iconDefaultClassName = getControlProps(
			iconResolution.definition,
		).className;
		expect(typeof iconDefaultClassName).toBe("string");

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
						props: { "data-trickroom-icon-id": "icons-1/a-arrow-down" },
					},
				],
			},
			// The active variant defines no classesByPath for the icon node, so the
			// resolved system className is empty — the icon must keep the registry
			// default rather than have it deleted.
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
							className: iconDefaultClassName,
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
		expect(iconNode?.props.className).toBe(iconDefaultClassName);
		// The icon className did not change, so it should not be reported as edited.
		expect(result?.changedElementIds).not.toContain("icon");
	});

	it("persists override class names on the root and reapplies classes", () => {
		const result = setSystemComponentOverrideClassNameOnRoots(
			roots,
			"root",
			publishedVersion,
			"rootTarget",
			"tracking-wide",
		);

		expect(result?.overrides).toEqual({
			rootTarget: { className: "tracking-wide" },
		});
		expect(result?.roots[0].props.className).toBe(
			"base text-zinc-700 tracking-wide",
		);
	});
});
