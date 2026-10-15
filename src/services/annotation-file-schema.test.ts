import { describe, expect, it } from "vitest";
import {
	annotationFileMigrations,
	calculateAnnotationRevision,
	migrateAnnotationFileValue,
	serializeAnnotation,
	supportedAnnotationFileVersions,
} from "./annotation-file-schema";
import type { Annotation } from "./annotations.types";

const human = { role: "human" } as const;

const makeAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
	version: 2,
	id: "ann-1",
	projectId: "proj-1",
	target: { kind: "layer", designId: "home", boardId: "b1", elementId: "e1" },
	branch: "main",
	worktreePath: "/work/tree",
	snapshot: { branch: "main", worktreePath: "/work/tree", layerName: "Hero" },
	status: "open",
	createdAt: "2026-10-01T10:00:00.000Z",
	updatedAt: "2026-10-01T10:00:00.000Z",
	entries: [
		{
			id: "entry-1",
			kind: "remark",
			at: "2026-10-01T10:00:00.000Z",
			by: human,
			body: "Make this bigger",
		},
	],
	transitions: [
		{ from: null, to: "open", at: "2026-10-01T10:00:00.000Z", by: human },
	],
	...overrides,
});

const asValue = (annotation: Annotation) =>
	JSON.parse(JSON.stringify(annotation)) as Record<string, unknown>;

const expectInvalid = (value: unknown) => {
	const result = migrateAnnotationFileValue(value);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.code).toBe("INVALID_ANNOTATION_FILE");
};

describe("annotation file migration", () => {
	it("reads a version 2 annotation back unchanged", () => {
		const annotation = makeAnnotation({ roundId: "round-1" });
		const result = migrateAnnotationFileValue(asValue(annotation));
		expect(result).toEqual({
			ok: true,
			value: annotation,
			fromVersion: 2,
			migrated: false,
		});
	});

	it("migrates a version 1 annotation by its version alone", () => {
		const annotation = makeAnnotation();
		const result = migrateAnnotationFileValue({
			...asValue(annotation),
			version: 1,
		});
		expect(result).toEqual({
			ok: true,
			value: annotation,
			fromVersion: 1,
			migrated: true,
		});
		if (!result.ok) return;
		expect(result.value).not.toHaveProperty("roundId");
	});

	it("accepts the proposed status with a proposal entry", () => {
		const annotation = makeAnnotation({
			status: "proposed",
			entries: [
				...makeAnnotation().entries,
				{
					id: "entry-2",
					kind: "proposal",
					at: "2026-10-01T10:05:00.000Z",
					by: { role: "agent", sessionId: "s-1" },
					summary: "The title is already text-2xl.",
				},
			],
		});
		expect(migrateAnnotationFileValue(asValue(annotation)).ok).toBe(true);
	});

	it("refuses a blank roundId and a proposal without its summary", () => {
		expectInvalid({ ...asValue(makeAnnotation()), roundId: "" });
		expectInvalid({
			...asValue(makeAnnotation()),
			entries: [
				...makeAnnotation().entries,
				{
					id: "entry-2",
					kind: "proposal",
					at: "2026-10-01T10:05:00.000Z",
					by: { role: "agent", sessionId: "s-1" },
				},
			],
		});
	});

	it("is idempotent on its own output", () => {
		const first = migrateAnnotationFileValue(asValue(makeAnnotation()));
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = migrateAnnotationFileValue(first.value);
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value).toEqual(first.value);
		expect(second.migrated).toBe(false);
	});

	it("does not mutate its input", () => {
		const value = asValue(makeAnnotation());
		const copy = structuredClone(value);
		migrateAnnotationFileValue(value);
		expect(value).toEqual(copy);
	});

	it("accepts every target kind with its required ids", () => {
		const targets = [
			{ kind: "design", designId: "d" },
			{ kind: "board", designId: "d", boardId: "b" },
			{ kind: "layer", designId: "d", boardId: "b", elementId: "e" },
			{ kind: "componentNode", systemId: "s", componentId: "c", nodePath: "" },
			{
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "0.1",
				variants: { size: "lg" },
			},
		];
		for (const target of targets) {
			const result = migrateAnnotationFileValue({
				...asValue(makeAnnotation()),
				target,
			});
			expect(result.ok, JSON.stringify(target)).toBe(true);
		}
	});

	it("accepts agent actors with a session id and an acknowledgement", () => {
		const annotation = makeAnnotation({
			status: "acknowledged",
			acknowledged: { sessionId: "s-1", at: "2026-10-01T10:05:00.000Z" },
			entries: [
				{
					id: "entry-2",
					kind: "reply",
					at: "2026-10-01T10:05:00.000Z",
					by: { role: "agent", sessionId: "s-1" },
					body: "On it",
				},
			],
		});
		expect(migrateAnnotationFileValue(asValue(annotation)).ok).toBe(true);
	});
});

describe("unsupported annotation versions", () => {
	it("refuses a newer version with its number", () => {
		const result = migrateAnnotationFileValue({
			...asValue(makeAnnotation()),
			version: 3,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("UNSUPPORTED_ANNOTATION_VERSION");
		if (result.code !== "UNSUPPORTED_ANNOTATION_VERSION") return;
		expect(result.version).toBe(3);
		expect(result.message).toContain("3");
	});

	it("refuses a newer version even when the rest of the file is garbage", () => {
		const result = migrateAnnotationFileValue({ version: 7 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("UNSUPPORTED_ANNOTATION_VERSION");
	});

	it("supports versions 1 and 2, with one migration step", () => {
		expect(annotationFileMigrations).toEqual([
			{ from: 1, to: 2, migrate: expect.any(Function) },
		]);
		expect([...supportedAnnotationFileVersions].sort()).toEqual([1, 2]);
	});
});

describe("invalid annotation files", () => {
	it("refuses values that are not objects", () => {
		for (const value of [null, undefined, "text", 3, true, []]) {
			expectInvalid(value);
		}
	});

	it("refuses a missing, zero, negative, fractional or non-numeric version", () => {
		const { version: _version, ...withoutVersion } = asValue(makeAnnotation());
		expectInvalid(withoutVersion);
		for (const version of [0, -1, 1.5, "1", null, Number.NaN]) {
			expectInvalid({ ...asValue(makeAnnotation()), version });
		}
	});

	it("refuses missing top-level fields", () => {
		for (const key of [
			"id",
			"projectId",
			"target",
			"branch",
			"worktreePath",
			"snapshot",
			"status",
			"createdAt",
			"updatedAt",
			"entries",
			"transitions",
		]) {
			const value = asValue(makeAnnotation());
			delete value[key];
			expectInvalid(value);
		}
	});

	it("refuses bad target kinds", () => {
		for (const target of [
			null,
			"design",
			{},
			{ kind: "page", designId: "d" },
			{ designId: "d" },
		]) {
			expectInvalid({ ...asValue(makeAnnotation()), target });
		}
	});

	it("refuses targets missing the ids their kind requires", () => {
		const targets = [
			{ kind: "design" },
			{ kind: "design", designId: "" },
			{ kind: "board", designId: "d" },
			{ kind: "board", boardId: "b" },
			{ kind: "layer", designId: "d", boardId: "b" },
			{ kind: "layer", designId: "d", elementId: "e" },
			{ kind: "layer", boardId: "b", elementId: "e" },
			{ kind: "componentNode", componentId: "c", nodePath: "" },
			{ kind: "componentNode", systemId: "s", nodePath: "" },
			{ kind: "componentNode", systemId: "s", componentId: "c" },
			{
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "",
				variants: { size: 3 },
			},
			{
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "",
				variants: ["lg"],
			},
		];
		for (const target of targets) {
			expectInvalid({ ...asValue(makeAnnotation()), target });
		}
	});

	it("refuses an unknown status", () => {
		expectInvalid({ ...asValue(makeAnnotation()), status: "done" });
		expectInvalid({ ...asValue(makeAnnotation()), status: undefined });
	});

	it("refuses an empty branch and a non-string worktree path", () => {
		expectInvalid({ ...asValue(makeAnnotation()), branch: "" });
		expectInvalid({ ...asValue(makeAnnotation()), worktreePath: 4 });
	});

	it("refuses a malformed acknowledgement", () => {
		expectInvalid({
			...asValue(makeAnnotation()),
			acknowledged: { at: "2026-10-01T10:05:00.000Z" },
		});
	});

	it("refuses entries that are not a list", () => {
		expectInvalid({ ...asValue(makeAnnotation()), entries: {} });
	});

	it("refuses entries missing an id, kind, time or actor", () => {
		const entry = {
			id: "e",
			kind: "remark",
			at: "2026-10-01T10:00:00.000Z",
			by: { role: "human" },
			body: "x",
		};
		for (const key of ["id", "kind", "at", "by"]) {
			const broken: Record<string, unknown> = { ...entry };
			delete broken[key];
			expectInvalid({ ...asValue(makeAnnotation()), entries: [broken] });
		}
		expectInvalid({ ...asValue(makeAnnotation()), entries: ["text"] });
	});

	it("refuses entries by an agent without a session id or an unknown role", () => {
		const entry = {
			id: "e",
			kind: "reply",
			at: "2026-10-01T10:00:00.000Z",
			body: "x",
		};
		for (const by of [
			{ role: "agent" },
			{ role: "agent", sessionId: "" },
			{ role: "robot" },
			"human",
			null,
		]) {
			expectInvalid({
				...asValue(makeAnnotation()),
				entries: [{ ...entry, by }],
			});
		}
	});

	it("refuses transitions that are not a list or are malformed", () => {
		expectInvalid({ ...asValue(makeAnnotation()), transitions: null });
		const transition = {
			from: null,
			to: "open",
			at: "2026-10-01T10:00:00.000Z",
			by: { role: "human" },
		};
		for (const key of ["to", "at", "by"]) {
			const broken: Record<string, unknown> = { ...transition };
			delete broken[key];
			expectInvalid({ ...asValue(makeAnnotation()), transitions: [broken] });
		}
		expectInvalid({
			...asValue(makeAnnotation()),
			transitions: [{ ...transition, by: { role: "agent" } }],
		});
		expectInvalid({ ...asValue(makeAnnotation()), transitions: [3] });
	});
});

describe("entry payloads", () => {
	const at = "2026-10-01T10:00:00.000Z";
	const agent = { role: "agent", sessionId: "s-1" } as const;
	const changeRecord = {
		revisionBefore: "r1",
		revisionAfter: "r2",
		boards: ["b1"],
		layerIds: ["e1"],
		operations: [{ operation: "updateElementProps", summary: "x" }],
		summary: "Edited",
		before: {
			layers: {
				e1: {
					parentId: "b1",
					props: { "data-trickroom-name": "E1" },
					children: [],
				},
				added: null,
			},
			boardOrder: ["b1"],
			settings: { name: "Home" },
		},
		after: { layers: { e1: "sha256:a", added: "sha256:b" } },
	};
	const withEntry = (entry: Record<string, unknown>) => ({
		...asValue(makeAnnotation()),
		entries: [{ id: "entry-x", at, by: agent, ...entry }],
	});

	it("accepts every entry kind with its payload", () => {
		const target = { kind: "design", designId: "home" };
		const scope = { branch: "main", worktreePath: "/w" };
		for (const entry of [
			{ kind: "remark", body: "x", by: human },
			{ kind: "reply", body: "x" },
			{ kind: "question", body: "x" },
			{ kind: "dismissal", reason: "x" },
			{ kind: "resolution" },
			{ kind: "resolution", summary: "x" },
			{ kind: "change", change: changeRecord },
			{ kind: "change", body: "x", change: changeRecord, revertedBy: "e" },
			// A write id (optional within version 1; files without one read).
			{ kind: "change", change: { ...changeRecord, writeId: "w1" } },
			{
				kind: "change",
				change: { ...changeRecord, before: undefined, after: undefined },
			},
			{ kind: "revert", entryId: "e", revisionBefore: "a", revisionAfter: "b" },
			{ kind: "reanchor", from: target, to: target },
			{ kind: "move", from: scope, to: scope },
		]) {
			expect(migrateAnnotationFileValue(withEntry(entry)).ok).toBe(true);
		}
	});

	it("refuses a change entry without its record, then nothing reads it", () => {
		expectInvalid(withEntry({ kind: "change" }));
		expectInvalid(withEntry({ kind: "change", change: "x" }));
	});

	it("refuses change records with malformed fields or revert state", () => {
		const broken: Record<string, unknown>[] = [
			{ ...changeRecord, revisionAfter: 2 },
			{ ...changeRecord, writeId: 7 },
			{ ...changeRecord, writeId: "" },
			{ ...changeRecord, boards: "b1" },
			{ ...changeRecord, layerIds: [1] },
			{ ...changeRecord, operations: [{ operation: "x" }] },
			{ ...changeRecord, summary: undefined },
			{ ...changeRecord, before: { layers: [] } },
			{ ...changeRecord, before: { layers: { e1: { props: {} } } } },
			{
				...changeRecord,
				before: {
					layers: { e1: { parentId: 1, props: {}, children: [] } },
				},
			},
			{
				...changeRecord,
				before: {
					layers: { e1: { parentId: null, props: {}, children: [1] } },
				},
			},
			{ ...changeRecord, before: { ...changeRecord.before, boardOrder: "b1" } },
			{ ...changeRecord, before: { ...changeRecord.before, settings: [] } },
			{ ...changeRecord, after: { layers: { e1: 1 } } },
			{ ...changeRecord, after: undefined },
			{ ...changeRecord, before: undefined },
		];
		for (const change of broken) {
			expectInvalid(withEntry({ kind: "change", change }));
		}
	});

	it("refuses other entries missing their payload", () => {
		for (const entry of [
			{ kind: "remark" },
			{ kind: "reply", body: 1 },
			{ kind: "question" },
			{ kind: "dismissal" },
			{ kind: "resolution", summary: 1 },
			{ kind: "change", change: changeRecord, revertedBy: 1 },
			{ kind: "revert", revisionBefore: "a", revisionAfter: "b" },
			{ kind: "revert", entryId: "e", revisionBefore: "a" },
			{
				kind: "reanchor",
				from: { kind: "design" },
				to: { kind: "design", designId: "d" },
			},
			{
				kind: "move",
				from: { branch: "", worktreePath: "/w" },
				to: { branch: "m", worktreePath: "/w" },
			},
			{ kind: "unknown", body: "x" },
		]) {
			expectInvalid(withEntry(entry));
		}
	});

	it("refuses a snapshot without its branch and worktree path", () => {
		expectInvalid({
			...asValue(makeAnnotation()),
			snapshot: { layerName: "x" },
		});
	});
});

describe("calculateAnnotationRevision", () => {
	it("is independent of key order", () => {
		const annotation = makeAnnotation();
		const reversed = Object.fromEntries(
			Object.entries(annotation).reverse(),
		) as Annotation;
		const nested = {
			...annotation,
			target: Object.fromEntries(
				Object.entries(annotation.target).reverse(),
			) as Annotation["target"],
		};
		expect(Object.keys(reversed)[0]).not.toBe("version");
		expect(calculateAnnotationRevision(reversed)).toBe(
			calculateAnnotationRevision(annotation),
		);
		expect(calculateAnnotationRevision(nested)).toBe(
			calculateAnnotationRevision(annotation),
		);
	});

	it("changes when content changes", () => {
		const annotation = makeAnnotation();
		const base = calculateAnnotationRevision(annotation);
		expect(base).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(
			calculateAnnotationRevision({ ...annotation, status: "resolved" }),
		).not.toBe(base);
		expect(
			calculateAnnotationRevision({
				...annotation,
				entries: [
					...annotation.entries,
					{
						id: "entry-2",
						kind: "reply",
						at: "2026-10-01T10:01:00.000Z",
						by: { role: "agent", sessionId: "s" },
						body: "ok",
					},
				],
			}),
		).not.toBe(base);
		expect(
			calculateAnnotationRevision({
				...annotation,
				updatedAt: "2026-10-02T00:00:00.000Z",
			}),
		).not.toBe(base);
	});

	it("is stable across a serialise and parse round trip", () => {
		const annotation = makeAnnotation({
			acknowledged: { sessionId: "s", at: "2026-10-01T10:05:00.000Z" },
		});
		const parsed = JSON.parse(serializeAnnotation(annotation)) as Annotation;
		expect(calculateAnnotationRevision(parsed)).toBe(
			calculateAnnotationRevision(annotation),
		);
	});
});

describe("serializeAnnotation", () => {
	it("puts version first and entries and transitions last", () => {
		const annotation = makeAnnotation();
		const shuffled = Object.fromEntries(
			Object.entries(annotation).reverse(),
		) as Annotation;
		const text = serializeAnnotation(shuffled);
		const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
		expect(keys[0]).toBe("version");
		expect(keys.slice(-2)).toEqual(["entries", "transitions"]);
		expect(keys).toEqual([
			"version",
			"id",
			"projectId",
			"target",
			"branch",
			"worktreePath",
			"status",
			"createdAt",
			"updatedAt",
			"snapshot",
			"entries",
			"transitions",
		]);
	});

	it("ends with exactly one newline and uses two-space indentation", () => {
		const text = serializeAnnotation(makeAnnotation());
		expect(text.endsWith("}\n")).toBe(true);
		expect(text.endsWith("\n\n")).toBe(false);
		expect(text.split("\n")[1]).toMatch(/^ {2}"version"/u);
	});

	it("places the acknowledgement before the timestamps and omits undefined fields", () => {
		const text = serializeAnnotation(
			makeAnnotation({
				acknowledged: { sessionId: "s", at: "2026-10-01T10:05:00.000Z" },
			}),
		);
		const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
		expect(keys.indexOf("acknowledged")).toBeGreaterThan(
			keys.indexOf("status"),
		);
		expect(keys.indexOf("acknowledged")).toBeLessThan(
			keys.indexOf("createdAt"),
		);
		const without = serializeAnnotation(
			makeAnnotation({ acknowledged: undefined }),
		);
		expect(without).not.toContain("acknowledged");
	});

	it("reads back through the migration unchanged", () => {
		const annotation = makeAnnotation();
		const result = migrateAnnotationFileValue(
			JSON.parse(serializeAnnotation(annotation)),
		);
		expect(result.ok && result.value).toEqual(annotation);
	});
});
