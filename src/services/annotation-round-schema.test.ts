import { describe, expect, it } from "vitest";
import {
	migrateRoundFileValue,
	roundFileMigrations,
	serializeRound,
	supportedRoundFileVersions,
} from "./annotation-round-schema";
import type { AnnotationRound } from "./annotations.types";

const makeRound = (
	overrides: Partial<AnnotationRound> = {},
): AnnotationRound => ({
	version: 1,
	id: "round-1",
	projectId: "proj-1",
	container: { kind: "design", designId: "home" },
	branch: "main",
	worktreePath: "/work",
	status: "open",
	openedAt: "2026-10-15T10:00:00.000Z",
	annotationIds: ["a1", "a2"],
	sends: [
		{ id: "s1", at: "2026-10-15T10:00:00.000Z", annotationIds: ["a1", "a2"] },
	],
	...overrides,
});

const asValue = (round: AnnotationRound) =>
	JSON.parse(JSON.stringify(round)) as Record<string, unknown>;

const expectInvalid = (value: unknown) => {
	const result = migrateRoundFileValue(value);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.code).toBe("INVALID_ROUND_FILE");
};

describe("round file migration", () => {
	it("reads a version 1 round back unchanged", () => {
		const round = makeRound();
		expect(migrateRoundFileValue(asValue(round))).toEqual({
			ok: true,
			value: round,
			fromVersion: 1,
			migrated: false,
		});
	});

	it("reads a closed component round", () => {
		const round = makeRound({
			container: { kind: "component", systemId: "sys", componentId: "btn" },
			status: "closed",
			closedAt: "2026-10-15T11:00:00.000Z",
			closedBy: { role: "human" },
		});
		expect(migrateRoundFileValue(asValue(round)).ok).toBe(true);
	});

	it("is idempotent and does not mutate its input", () => {
		const value = asValue(makeRound());
		const copy = structuredClone(value);
		const first = migrateRoundFileValue(value);
		expect(value).toEqual(copy);
		if (!first.ok) throw new Error(first.message);
		expect(migrateRoundFileValue(first.value)).toMatchObject({
			ok: true,
			value: first.value,
			migrated: false,
		});
	});

	it("has an empty chain and supports version 1", () => {
		expect(roundFileMigrations).toEqual([]);
		expect([...supportedRoundFileVersions]).toEqual([1]);
	});

	it("refuses a newer version", () => {
		const result = migrateRoundFileValue({
			...asValue(makeRound()),
			version: 2,
		});
		expect(result).toMatchObject({
			ok: false,
			code: "UNSUPPORTED_ROUND_VERSION",
		});
	});

	it("refuses invalid shapes", () => {
		for (const value of [null, [], "x", { version: 0 }, { version: "1" }]) {
			expectInvalid(value);
		}
		const base = asValue(makeRound());
		expectInvalid({ ...base, status: "paused" });
		expectInvalid({ ...base, container: { kind: "design" } });
		expectInvalid({ ...base, annotationIds: [""] });
		expectInvalid({ ...base, sends: [{ id: "s1", at: "x" }] });
		expectInvalid({ ...base, status: "closed" });
		expectInvalid({ ...base, closedAt: "2026-10-15T11:00:00.000Z" });
		expectInvalid({
			...base,
			status: "closed",
			closedAt: "2026-10-15T11:00:00.000Z",
			closedBy: { role: "robot" },
		});
	});

	it("serializes with version first and a trailing newline", () => {
		const text = serializeRound(makeRound());
		expect(text.startsWith('{\n  "version": 1,\n  "id": "round-1"')).toBe(true);
		expect(text.endsWith("}\n")).toBe(true);
	});
});
