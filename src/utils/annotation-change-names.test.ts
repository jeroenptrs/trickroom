import { describe, expect, it } from "vitest";
import type { AnnotationView } from "../services/annotations.types";
import {
	describeChangeLayers,
	nameLayersInText,
	resolveChangeLayerName,
	shortLayerId,
} from "./annotation-change-names";

const DESIGN = "5ed7a853-16d5-4a6d-84a2-559c5f78af93";
const BOARD = "a091c1ec-5085-4ed0-95dc-904d153d8f8d";
const TITLE = "e1a28cc2-dafd-4cf2-97f6-d024e16c8fe5";
const LEAD = "5e0b52bd-9944-4db8-b930-5b8b3ae24945";
const GONE = "0badc0de-0000-4000-8000-000000000000";

const annotation: Pick<AnnotationView, "target" | "snapshot"> = {
	target: { kind: "layer", designId: DESIGN, boardId: BOARD, elementId: TITLE },
	snapshot: { branch: "main", worktreePath: "/w", layerName: "Old title" },
};

const live: Record<string, string> = { [TITLE]: "Title", [LEAD]: "Lead" };
const lookup = (id: string) => live[id] ?? null;

describe("resolveChangeLayerName", () => {
	it("prefers the layer's current name in the open design", () => {
		expect(resolveChangeLayerName(TITLE, annotation, lookup)).toEqual({
			id: TITLE,
			name: "Title",
			present: true,
		});
	});

	it("falls back to the annotation's snapshot name for its own target", () => {
		expect(resolveChangeLayerName(TITLE, annotation, () => null)).toEqual({
			id: TITLE,
			name: "Old title",
			present: false,
		});
	});

	it("falls back to a short id for any other layer that is gone", () => {
		expect(resolveChangeLayerName(GONE, annotation, lookup)).toEqual({
			id: GONE,
			name: "#0badc0de",
			present: false,
		});
		expect(shortLayerId(GONE)).toBe("#0badc0de");
	});

	it("treats a blank live name as missing", () => {
		expect(resolveChangeLayerName(LEAD, annotation, () => "  ").name).toBe(
			"#5e0b52bd",
		);
	});

	it("uses the snapshot of a board target for that board", () => {
		const boardAnnotation: Pick<AnnotationView, "target" | "snapshot"> = {
			target: { kind: "board", designId: DESIGN, boardId: BOARD },
			snapshot: { branch: "main", worktreePath: "/w", layerName: "Launcher" },
		};
		expect(resolveChangeLayerName(BOARD, boardAnnotation).name).toBe(
			"Launcher",
		);
	});

	it("works without a lookup (no open design)", () => {
		expect(resolveChangeLayerName(LEAD, annotation).name).toBe("#5e0b52bd");
	});
});

describe("describeChangeLayers", () => {
	it("names each touched layer once, in the record's order", () => {
		expect(
			describeChangeLayers(
				{ layerIds: [LEAD, TITLE, LEAD, GONE] },
				annotation,
				lookup,
			),
		).toEqual([
			{ id: LEAD, name: "Lead", present: true },
			{ id: TITLE, name: "Title", present: true },
			{ id: GONE, name: "#0badc0de", present: false },
		]);
	});
});

describe("nameLayersInText", () => {
	const change = { layerIds: [TITLE, "lead-node"], boards: [BOARD] };

	it("replaces layer ids in an agent's summary with layer names", () => {
		expect(
			nameLayersInText(
				`Set ${TITLE} className to "text-3xl font-bold"`,
				change,
				annotation,
				lookup,
			),
		).toBe('Set Title className to "text-3xl font-bold"');
	});

	it("replaces the record's own non-UUID ids and any other UUID", () => {
		live["lead-node"] = "Lead copy";
		expect(
			nameLayersInText(
				`moved lead-node into ${BOARD}; removed ${GONE}`,
				change,
				annotation,
				lookup,
			),
		).toBe("moved Lead copy into #a091c1ec; removed #0badc0de");
	});

	it("leaves text without ids alone", () => {
		expect(
			nameLayersInText("Tightened the tracking.", change, annotation, lookup),
		).toBe("Tightened the tracking.");
	});
});
