import { describe, expect, it } from "vitest";
import {
	getControlProps,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node } from "../types";
import { detachSystemComponentInstance } from "./system-component-detach";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	SYSTEM_COMPONENT_MARKER_PROP_KEYS,
} from "./system-component-markers";
import type { PublishedSystemComponentVersion } from "./system-components";

const baseProps = (name: string, component = "container") => ({
	"data-trickroom-name": name,
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": component,
});

const expectNoSystemComponentMarkers = (node: Node) => {
	for (const markerProp of SYSTEM_COMPONENT_MARKER_PROP_KEYS) {
		expect(node.props).not.toHaveProperty(markerProp);
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			expectNoSystemComponentMarkers(child);
		}
	}
};

describe("detachSystemComponentInstance", () => {
	it("removes system component markers from the whole instance", () => {
		const roots = [
			{
				id: "root",
				props: {
					"data-trickroom-name": "Root",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
					}),
				},
				children: [
					{
						id: "label",
						props: {
							"data-trickroom-name": "Label",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "text",
							...getSystemComponentMarkerProps({
								systemId: "sys-core",
								componentId: "cmp_11111111-1111-4111-8111-111111111111",
								instanceId: "instance-1",
								version: "1",
								path: "label",
							}),
						},
						children: "Text",
					},
				],
			},
		];

		const result = detachSystemComponentInstance(roots, "label");
		expect(result?.detachedElementIds.sort()).toEqual(["label", "root"]);
		const detachedRoot = result?.roots[0] ?? null;
		const detachedLabel =
			detachedRoot && Array.isArray(detachedRoot.children)
				? detachedRoot.children[0]
				: null;
		expect(
			getSystemComponentStructuralMetadata(detachedRoot?.props),
		).toBeNull();
		expect(
			getSystemComponentStructuralMetadata(detachedLabel?.props),
		).toBeNull();
	});

	it("flattens resolved template, variant, compound, and override classes into ordinary props", () => {
		const version: PublishedSystemComponentVersion = {
			version: "1",
			publishedAt: "2026-05-26T00:00:00.000Z",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				className: "base-root",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						className: "base-label",
					},
				],
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: {
								classesByPath: {
									root: "tone-root",
									label: "tone-label",
								},
							},
							neutral: {},
						},
					},
				},
				compoundVariants: [
					{
						when: { tone: "brand" },
						classesByPath: {
							root: "compound-root",
							label: "compound-label",
						},
					},
				],
			},
			overrideTargets: {
				labelTarget: {
					targetId: "labelTarget",
					label: "Label",
					path: "label",
				},
			},
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		};
		const roots: Node[] = [
			{
				id: "root",
				props: {
					...baseProps("Root"),
					className: "stale-root",
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
						variantValues: { tone: "brand" },
						overrides: { labelTarget: { className: "override-label" } },
					}),
				},
				children: [
					{
						id: "label",
						props: {
							...baseProps("Label", "text"),
							className: "stale-label",
							...getSystemComponentMarkerProps({
								systemId: "sys-core",
								componentId: "cmp_11111111-1111-4111-8111-111111111111",
								instanceId: "instance-1",
								version: "1",
								path: "label",
							}),
						},
						children: "Text",
					},
				],
			},
		];

		const result = detachSystemComponentInstance(roots, "label", version);
		expect(result).not.toBeNull();
		const root = result?.roots[0];
		const label = Array.isArray(root?.children) ? root.children[0] : null;

		expect(root?.props.className).toBe("base-root tone-root compound-root");
		expect(label?.props.className).toBe(
			"base-label tone-label compound-label override-label",
		);
		expectNoSystemComponentMarkers(root as Node);
	});

	it("keeps a sublayer's registry default className when detaching with no resolved system class", () => {
		const iconResolution = resolveRegistryComponent("trickroom", "icon");
		if (iconResolution.status !== "known") {
			throw new Error("trickroom/icon must resolve for this test");
		}
		const iconDefaultClassName = getControlProps(
			iconResolution.definition,
		).className;
		expect(typeof iconDefaultClassName).toBe("string");

		const version: PublishedSystemComponentVersion = {
			version: "1",
			publishedAt: "2026-05-26T00:00:00.000Z",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "node",
						library: "trickroom",
						component: "icon",
						props: { "data-trickroom-icon-id": "icons-1/a-arrow-down" },
					},
				],
			},
			variants: { axes: {} },
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		};
		const roots: Node[] = [
			{
				id: "root",
				props: {
					...baseProps("Root"),
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
					}),
				},
				children: [
					{
						id: "icon",
						props: {
							...baseProps("Icon", "icon"),
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

		const result = detachSystemComponentInstance(roots, "root", version);
		const icon = Array.isArray(result?.roots[0].children)
			? result.roots[0].children[0]
			: null;
		expect(icon?.props.className).toBe(iconDefaultClassName);
	});

	it("preserves nested attached component markers inside slot content", () => {
		const roots: Node[] = [
			{
				id: "root",
				props: {
					...baseProps("Root"),
					...getSystemComponentMarkerProps({
						systemId: "sys-core",
						componentId: "cmp_11111111-1111-4111-8111-111111111111",
						instanceId: "instance-1",
						version: "1",
						path: "root",
						isRoot: true,
					}),
				},
				children: [
					{
						id: "slot-child",
						props: {
							...baseProps("Nested Root"),
							...getSystemComponentMarkerProps({
								systemId: "sys-core",
								componentId: "cmp_22222222-2222-4222-8222-222222222222",
								instanceId: "nested-instance",
								version: "1",
								path: "root",
								isRoot: true,
							}),
						},
						children: [],
					},
				],
			},
		];

		const result = detachSystemComponentInstance(roots, "root");
		const root = result?.roots[0];
		const slotChild = Array.isArray(root?.children) ? root.children[0] : null;

		expect(result?.detachedElementIds).toEqual(["root"]);
		expect(root ? getSystemComponentStructuralMetadata(root.props) : null).toBe(
			null,
		);
		expect(
			slotChild ? getSystemComponentStructuralMetadata(slotChild.props) : null,
		)?.toMatchObject({
			componentId: "cmp_22222222-2222-4222-8222-222222222222",
			instanceId: "nested-instance",
		});
	});
});
