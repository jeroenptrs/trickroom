import { describe, expect, it } from "vitest";
import type { Node, Props } from "../types";
import { getSystemComponentMarkerProps } from "./system-component-markers";
import {
	canDeleteElementAcrossSystemComponentBoundary,
	canInsertIntoSystemComponentBoundary,
	canMoveElementAcrossSystemComponentBoundary,
	canUpdateSystemComponentStructuralNode,
	collectSystemComponentInstanceNodes,
	findSystemComponentRootNode,
	getContainingSystemComponentSlot,
	getSystemComponentOwnedStructuralIds,
	isSystemComponentOwnedStructuralNode,
	isSystemComponentRoot,
	isSystemComponentSlotContent,
	isSystemComponentSlotHost,
	type SystemComponentBoundaryEntityMap,
} from "./system-component-ownership";

const markerProps = (
	overrides: Partial<Parameters<typeof getSystemComponentMarkerProps>[0]> = {},
): Props =>
	getSystemComponentMarkerProps({
		systemId: "sys_core",
		componentId: "cmp_11111111-1111-4111-8111-111111111111",
		instanceId: "instance-1",
		version: "1",
		path: "root",
		isRoot: true,
		...overrides,
	}) as Props;

const entity = (
	id: string,
	parentId: string | null,
	props: Props,
): SystemComponentBoundaryEntityMap[string] => ({
	id,
	parentId,
	props,
});

describe("system component ownership boundaries", () => {
	const entities: SystemComponentBoundaryEntityMap = {
		root: entity("root", null, markerProps({ path: "root", isRoot: true })),
		label: entity(
			"label",
			"root",
			markerProps({ path: "label", isRoot: false }),
		),
		slotHost: entity(
			"slotHost",
			"root",
			markerProps({
				path: "default",
				isRoot: false,
				slotName: "default",
			}),
		),
		slotChild: entity("slotChild", "slotHost", {
			"data-trickroom-name": "Slot content",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "text",
			"data-trickroom-role": "text",
		}),
		external: entity("external", "root", {
			"data-trickroom-name": "Outside",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "text",
			"data-trickroom-role": "text",
		}),
	};

	it("classifies owned structural nodes, roots, and slot hosts", () => {
		expect(isSystemComponentOwnedStructuralNode(entities.label)).toBe(true);
		expect(isSystemComponentRoot(entities.root)).toBe(true);
		expect(isSystemComponentSlotHost(entities.slotHost)).toBe(true);
		expect(isSystemComponentSlotContent(entities, "slotChild")).toBe(true);
		expect(isSystemComponentSlotContent(entities, "external")).toBe(false);
	});

	it("collects owned structural ids for one instance", () => {
		expect(getSystemComponentOwnedStructuralIds(entities, "instance-1")).toEqual(
			["label", "root", "slotHost"],
		);
	});

	it("reports slot containment for authored slot content", () => {
		expect(getContainingSystemComponentSlot(entities, "slotChild")).toEqual({
			hostId: "slotHost",
			slotName: "default",
			systemId: "sys_core",
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			instanceId: "instance-1",
			version: "1",
		});
	});

	it("allows insertion only into slot hosts or outside owned structure", () => {
		expect(canInsertIntoSystemComponentBoundary(entities, "slotHost")).toBe(
			true,
		);
		expect(canInsertIntoSystemComponentBoundary(entities, "label")).toBe(false);
		expect(canInsertIntoSystemComponentBoundary(entities, null)).toBe(true);
	});

	it("blocks structural edits and cross-boundary moves for owned nodes", () => {
		expect(canUpdateSystemComponentStructuralNode(entities, "label")).toBe(
			false,
		);
		expect(canUpdateSystemComponentStructuralNode(entities, "slotChild")).toBe(
			true,
		);
		expect(
			canMoveElementAcrossSystemComponentBoundary(entities, "label", null),
		).toBe(false);
		expect(
			canMoveElementAcrossSystemComponentBoundary(entities, "root", null),
		).toBe(true);
		expect(
			canMoveElementAcrossSystemComponentBoundary(
				entities,
				"slotChild",
				"slotHost",
			),
		).toBe(true);
	});

	it("allows deleting only the instance root inside a component boundary", () => {
		expect(canDeleteElementAcrossSystemComponentBoundary(entities, "label")).toBe(
			false,
		);
		expect(canDeleteElementAcrossSystemComponentBoundary(entities, "root")).toBe(
			true,
		);
		expect(
			canDeleteElementAcrossSystemComponentBoundary(entities, "slotChild"),
		).toBe(true);
	});

	it("walks nested trees when collecting instance nodes", () => {
		const roots: Node[] = [
			{
				id: "root",
				props: markerProps({ path: "root", isRoot: true }),
				children: [
					{
						id: "label",
						props: markerProps({ path: "label", isRoot: false }),
						children: [],
					},
				],
			},
		];

		expect(collectSystemComponentInstanceNodes(roots, "instance-1").map((n) => n.id)).toEqual(
			["root", "label"],
		);
		expect(findSystemComponentRootNode(roots, "instance-1")?.id).toBe("root");
	});
});
