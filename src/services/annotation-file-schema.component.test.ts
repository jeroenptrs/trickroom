import { describe, expect, it } from "vitest";
import {
	migrateAnnotationFileValue,
	serializeAnnotation,
} from "./annotation-file-schema";
import type {
	Annotation,
	AnnotationChangeRecord,
	AnnotationEntry,
} from "./annotations.types";

const human = { role: "human" } as const;
const agent = { role: "agent", sessionId: "s-1" } as const;
const at = "2026-10-14T10:00:00.000Z";

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
	version: 1,
	id: "ann-1",
	projectId: "proj-1",
	target: {
		kind: "componentNode",
		systemId: "sys_1",
		componentId: "cmp_1",
		nodePath: "label",
		variants: { size: "lg" },
	},
	branch: "main",
	worktreePath: "/work/tree",
	snapshot: {
		branch: "main",
		worktreePath: "/work/tree",
		layerName: "Label",
		component: "trickroom/text",
		ancestorNames: ["Root"],
		designRevision: "sha256:abc",
		variants: { size: "lg", tone: "brand" },
	},
	status: "open",
	createdAt: at,
	updatedAt: at,
	entries: [{ id: "e1", kind: "remark", at, by: human, body: "Too small" }],
	transitions: [{ from: null, to: "open", at, by: human }],
	...overrides,
});

const asValue = (annotation: Annotation) =>
	JSON.parse(JSON.stringify(annotation)) as Record<string, unknown>;

const baseChange = (): AnnotationChangeRecord => ({
	revisionBefore: "sha256:a",
	revisionAfter: "sha256:b",
	boards: [],
	layerIds: ["label"],
	operations: [{ operation: "component_draft_update", summary: "Edited" }],
	summary: "Edited",
});

const withChange = (change: Record<string, unknown>) => {
	const entry = {
		id: "e2",
		kind: "change",
		at,
		by: agent,
		change,
	} as unknown as AnnotationEntry;
	return asValue(
		makeAnnotation({
			entries: [makeAnnotation().entries[0], entry] as AnnotationEntry[],
		}),
	);
};

const draftBefore = () => ({
	root: { path: "root", library: "trickroom", component: "container" },
});
const draftAfter = () => ({ templateHash: "t", variantSchemaHash: "v" });

describe("component node annotation files", () => {
	it("reads a version 1 file with a componentNode target and snapshot.variants", () => {
		const annotation = makeAnnotation();
		const result = migrateAnnotationFileValue(asValue(annotation));
		expect(result).toEqual({
			ok: true,
			value: annotation,
			fromVersion: 1,
			migrated: false,
		});
	});

	it("round-trips through serialize and read", () => {
		const annotation = makeAnnotation();
		const result = migrateAnnotationFileValue(
			JSON.parse(serializeAnnotation(annotation)),
		);
		expect(result.ok && result.value).toEqual(annotation);
	});

	it("refuses a snapshot.variants value that is not a string", () => {
		const value = asValue(makeAnnotation());
		(value.snapshot as Record<string, unknown>).variants = { size: 3 };
		const result = migrateAnnotationFileValue(value);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("INVALID_ANNOTATION_FILE");
			expect(result.message).toContain("snapshot.variants");
		}
	});

	it("refuses snapshot.variants that is not a record", () => {
		for (const variants of [["lg"], "lg", null, 3]) {
			const value = asValue(makeAnnotation());
			(value.snapshot as Record<string, unknown>).variants = variants;
			expect(migrateAnnotationFileValue(value).ok).toBe(false);
		}
	});

	it("refuses a componentNode target pinned to a non-string value", () => {
		const value = asValue(makeAnnotation());
		(value.target as Record<string, unknown>).variants = { size: 1 };
		expect(migrateAnnotationFileValue(value).ok).toBe(false);
	});

	it("reads a file without snapshot.variants or a pin", () => {
		const annotation = makeAnnotation({
			target: {
				kind: "componentNode",
				systemId: "sys_1",
				componentId: "cmp_1",
				nodePath: "root",
			},
			snapshot: { branch: "main", worktreePath: "/work/tree" },
		});
		expect(migrateAnnotationFileValue(asValue(annotation)).ok).toBe(true);
	});

	it("refuses a newer version", () => {
		const result = migrateAnnotationFileValue({
			...asValue(makeAnnotation()),
			version: 2,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("UNSUPPORTED_ANNOTATION_VERSION");
	});
});

describe("component change records", () => {
	it("reads a change record with draftBefore and draftAfter", () => {
		const value = withChange({
			...baseChange(),
			draftBefore: draftBefore(),
			draftAfter: draftAfter(),
		});
		const result = migrateAnnotationFileValue(value);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const entry = result.value.entries[1];
		expect(entry?.kind === "change" && entry.change.draftAfter).toEqual(
			draftAfter(),
		);
	});

	it("refuses draftBefore without draftAfter", () => {
		const result = migrateAnnotationFileValue(
			withChange({ ...baseChange(), draftBefore: draftBefore() }),
		);
		expect(result.ok).toBe(false);
	});

	it("refuses draftAfter without draftBefore", () => {
		const result = migrateAnnotationFileValue(
			withChange({ ...baseChange(), draftAfter: draftAfter() }),
		);
		expect(result.ok).toBe(false);
	});

	it("refuses malformed draftBefore or draftAfter", () => {
		expect(
			migrateAnnotationFileValue(
				withChange({
					...baseChange(),
					draftBefore: { root: "nope" },
					draftAfter: draftAfter(),
				}),
			).ok,
		).toBe(false);
		expect(
			migrateAnnotationFileValue(
				withChange({
					...baseChange(),
					draftBefore: draftBefore(),
					draftAfter: { templateHash: "t" },
				}),
			).ok,
		).toBe(false);
	});

	it("still reads a change record without any revert state", () => {
		expect(migrateAnnotationFileValue(withChange(baseChange())).ok).toBe(true);
	});

	it("still reads a design change record with before and after (no shape change)", () => {
		const result = migrateAnnotationFileValue(
			withChange({
				...baseChange(),
				before: { layers: {} },
				after: { layers: {} },
			}),
		);
		expect(result.ok).toBe(true);
	});

	it("still reads a design annotation file written before WP5", () => {
		const legacy = {
			version: 1,
			id: "ann-old",
			projectId: "proj-1",
			target: { kind: "layer", designId: "d", boardId: "b", elementId: "e" },
			branch: "main",
			worktreePath: "/w",
			snapshot: { branch: "main", worktreePath: "/w", layerName: "Hero" },
			status: "open",
			createdAt: at,
			updatedAt: at,
			entries: [{ id: "e1", kind: "remark", at, by: human, body: "x" }],
			transitions: [{ from: null, to: "open", at, by: human }],
		};
		const result = migrateAnnotationFileValue(legacy);
		expect(result).toMatchObject({ ok: true, migrated: false });
	});
});
