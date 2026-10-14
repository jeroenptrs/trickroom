import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../stores/design-store";
import type { Props } from "../types";
import {
	designStoreTargetLocator,
	getDesignTargetName,
	getSelectionAnnotationTarget,
} from "./design-annotation-targets";

const entity = (
	id: string,
	parentId: string | null,
	name?: string,
	childIds: string[] = [],
): DesignEntity => ({
	id,
	parentId,
	role: "branch",
	childIds,
	props: {
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		...(name === undefined ? {} : { "data-trickroom-name": name }),
	} as Props,
});

// b1 > l1 > l2; b2
const entitiesById: Record<string, DesignEntity> = {
	b1: entity("b1", null, "Home", ["l1"]),
	l1: entity("l1", "b1", "Card", ["l2"]),
	l2: entity("l2", "l1", "  ", []),
	b2: entity("b2", null),
};

describe("designStoreTargetLocator", () => {
	const locator = designStoreTargetLocator(entitiesById);

	it("finds the board of a layer, nested or direct", () => {
		expect(locator.boardOfLayer("l1")).toBe("b1");
		expect(locator.boardOfLayer("l2")).toBe("b1");
	});

	it("knows no board for an unknown layer", () => {
		expect(locator.boardOfLayer("missing")).toBeNull();
	});

	it("only counts root entities as boards", () => {
		expect(locator.hasBoard("b1")).toBe(true);
		expect(locator.hasBoard("b2")).toBe(true);
		expect(locator.hasBoard("l1")).toBe(false);
		expect(locator.hasBoard("missing")).toBe(false);
	});
});

describe("getSelectionAnnotationTarget", () => {
	it("targets the design when nothing is selected", () => {
		expect(getSelectionAnnotationTarget("d1", entitiesById, null)).toEqual({
			kind: "design",
			designId: "d1",
		});
	});

	it("targets a selected board", () => {
		expect(getSelectionAnnotationTarget("d1", entitiesById, "b1")).toEqual({
			kind: "board",
			designId: "d1",
			boardId: "b1",
		});
	});

	it("targets a nested layer with its board", () => {
		expect(getSelectionAnnotationTarget("d1", entitiesById, "l2")).toEqual({
			kind: "layer",
			designId: "d1",
			boardId: "b1",
			elementId: "l2",
		});
	});

	it("falls back to the design for an unknown id", () => {
		expect(getSelectionAnnotationTarget("d1", entitiesById, "nope")).toEqual({
			kind: "design",
			designId: "d1",
		});
	});

	it("falls back to the design for a layer with no board above it", () => {
		const orphaned = { o: entity("o", "gone") };
		expect(getSelectionAnnotationTarget("d1", orphaned, "o")).toEqual({
			kind: "design",
			designId: "d1",
		});
	});
});

describe("getDesignTargetName", () => {
	const layerTarget = (elementId: string) =>
		({ kind: "layer", designId: "d1", boardId: "b1", elementId }) as const;

	it("prefers the live name over the snapshot", () => {
		expect(
			getDesignTargetName(layerTarget("l1"), entitiesById, "Old name"),
		).toBe("Card");
	});

	it("uses the component name when the layer has no custom name", () => {
		expect(getDesignTargetName(layerTarget("l2"), entitiesById, "Old")).toBe(
			"container",
		);
	});

	it("falls back to the snapshot name once the layer is gone", () => {
		expect(
			getDesignTargetName(layerTarget("gone"), entitiesById, "Old name"),
		).toBe("Old name");
	});

	it("falls back to Layer without a snapshot", () => {
		expect(getDesignTargetName(layerTarget("gone"), entitiesById)).toBe(
			"Layer",
		);
	});

	it("names a board from the store", () => {
		expect(
			getDesignTargetName(
				{ kind: "board", designId: "d1", boardId: "b1" },
				entitiesById,
				"Old",
			),
		).toBe("Home");
	});

	it("uses the design name for a design target", () => {
		const target = { kind: "design", designId: "d1" } as const;
		expect(getDesignTargetName(target, entitiesById, "Snap", "My design")).toBe(
			"My design",
		);
		expect(getDesignTargetName(target, entitiesById, "Snap")).toBe("Snap");
		expect(getDesignTargetName(target, entitiesById)).toBe("Design");
	});
});
