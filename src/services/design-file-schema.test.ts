import { describe, expect, it } from "vitest";
import {
	migrateTrickroomDesign,
	readTrickroomDesignValue,
} from "../server-utils";
import {
	DESIGN_FILE_VERSION,
	designFileMigrations,
	migrateDesignFileValue,
	orderDesignFileKeys,
	supportedDesignFileVersions,
} from "./design-file-schema";

const board = {
	id: "root",
	props: {
		"data-trickroom-name": "Root",
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children: [],
};

const legacyDesign = {
	name: "Legacy",
	systemId: null,
	componentMigrationPolicy: null,
	boards: [board],
};

describe("design file migration chain", () => {
	it("forms one contiguous chain ending at the current version", () => {
		designFileMigrations.forEach((migration, index) => {
			expect(migration.from).toBe(index);
			expect(migration.to).toBe(index + 1);
		});
		expect(designFileMigrations.at(-1)?.to).toBe(DESIGN_FILE_VERSION);
		expect([...supportedDesignFileVersions].sort()).toEqual(
			Array.from({ length: DESIGN_FILE_VERSION + 1 }, (_, index) => index),
		);
	});

	it("treats a file without a version as version 0 and migrates it to the current version", () => {
		const result = migrateDesignFileValue(legacyDesign);

		expect(result).toEqual({
			ok: true,
			fromVersion: 0,
			migrated: true,
			value: {
				name: "Legacy",
				systemId: null,
				boards: [board],
				version: DESIGN_FILE_VERSION,
			},
		});
	});

	it("migrates version 1 to version 2 without changing the in-memory shape", () => {
		const v1 = { version: 1, name: "One", boards: [board] };

		expect(migrateDesignFileValue(v1)).toEqual({
			ok: true,
			fromVersion: 1,
			migrated: true,
			value: { version: 2, name: "One", boards: [board] },
		});
		expect(readTrickroomDesignValue(v1)).toMatchObject({
			ok: true,
			design: { name: "One", boards: [board] },
		});
	});

	it("does not add a missing component migration policy when migrating from version 0", () => {
		const { componentMigrationPolicy: _policy, ...withoutPolicy } =
			legacyDesign;
		void _policy;

		const result = migrateDesignFileValue(withoutPolicy);

		expect(
			result.ok && Object.hasOwn(result.value, "componentMigrationPolicy"),
		).toBe(false);
	});

	it("keeps a set component migration policy when migrating from version 0", () => {
		const result = migrateDesignFileValue({
			...legacyDesign,
			componentMigrationPolicy: "manual",
		});

		expect(result).toMatchObject({
			ok: true,
			value: { componentMigrationPolicy: "manual" },
		});
	});

	it("is idempotent once a value reaches the current version", () => {
		const first = migrateDesignFileValue(legacyDesign);
		if (!first.ok) throw new Error("expected migration to succeed");

		const second = migrateDesignFileValue(first.value);

		expect(second).toEqual({
			ok: true,
			fromVersion: DESIGN_FILE_VERSION,
			migrated: false,
			value: first.value,
		});
	});

	it("does not mutate its input", () => {
		const input = structuredClone(legacyDesign);
		migrateDesignFileValue(input);
		expect(input).toEqual(legacyDesign);
	});

	it("rejects a version from a newer Trickroom without down-converting", () => {
		const newer = { ...legacyDesign, version: DESIGN_FILE_VERSION + 1 };

		expect(migrateDesignFileValue(newer)).toEqual({
			ok: false,
			code: "UNSUPPORTED_DESIGN_VERSION",
			version: DESIGN_FILE_VERSION + 1,
			message: expect.stringContaining("newer than this Trickroom supports"),
		});
		expect(readTrickroomDesignValue(newer)).toMatchObject({
			ok: false,
			code: "UNSUPPORTED_DESIGN_VERSION",
		});
		expect(migrateTrickroomDesign(newer)).toBeNull();
	});

	it.each([
		["a string", "1"],
		["a negative number", -1],
		["a fraction", 1.5],
		["null", null],
	])("rejects a version that is %s", (_label, version) => {
		expect(migrateDesignFileValue({ ...legacyDesign, version })).toMatchObject({
			ok: false,
			code: "INVALID_DESIGN_PAYLOAD",
		});
	});

	it("treats a missing version as current when asked to, as writers do", () => {
		const { componentMigrationPolicy: _policy, ...current } = legacyDesign;

		expect(
			migrateDesignFileValue(current, { missingVersion: DESIGN_FILE_VERSION }),
		).toEqual({
			ok: true,
			fromVersion: DESIGN_FILE_VERSION,
			migrated: false,
			value: { ...current, version: DESIGN_FILE_VERSION },
		});
	});

	it("returns validated designs without the storage version", () => {
		const read = readTrickroomDesignValue(legacyDesign);

		expect(read).toEqual({
			ok: true,
			fromVersion: 0,
			migrated: true,
			design: { name: "Legacy", systemId: null, boards: [board] },
		});
	});

	it("orders top-level keys with version first and boards last", () => {
		const ordered = orderDesignFileKeys({
			boards: [board],
			extra: true,
			componentMigrationPolicy: "auto",
			name: "Ordered",
			version: DESIGN_FILE_VERSION,
			systemId: null,
		});

		expect(Object.keys(ordered)).toEqual([
			"version",
			"name",
			"systemId",
			"componentMigrationPolicy",
			"extra",
			"boards",
		]);
	});
});
