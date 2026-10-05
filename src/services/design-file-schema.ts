/**
 * Versioning for persisted design files.
 *
 * Every design file carries a top-level `version`. Files written before the
 * field existed have none and are version 0. Reads run the stored value
 * through `designFileMigrations` in memory, so callers always see the current
 * shape; nothing is written on read. The design file service persists the
 * current shape (and version) on the next real write.
 *
 * Adding a version:
 * 1. Bump `DESIGN_FILE_VERSION`.
 * 2. Append a `{ from, to, migrate }` step that turns the previous shape into
 *    the new one. Steps receive a plain object that has already passed every
 *    earlier step and must not mutate it.
 * 3. Teach the service's storage reader/writer about any layout change. A
 *    layout change (for example splitting a design into a manifest plus one
 *    file per board) is a step whose `migrate` may be the identity on the
 *    in-memory shape; the service decides how a given version is laid out on
 *    disk.
 * 4. Cover the step in `design-file-schema.test.ts` and document it in
 *    `docs/project-files.md`.
 */

export const DESIGN_FILE_VERSION = 2;
export type DesignFileVersion = typeof DESIGN_FILE_VERSION;

/** Version assumed for files that have no `version` field. */
export const LEGACY_DESIGN_FILE_VERSION = 0;

type DesignFileValue = Record<string, unknown>;

export type DesignFileMigration = {
	from: number;
	to: number;
	migrate: (value: DesignFileValue) => DesignFileValue;
};

const isRecord = (value: unknown): value is DesignFileValue =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * v0 → v1: introduces the `version` field. Early files stored
 * `componentMigrationPolicy: null`, which now means "not set".
 */
const migrateV0ToV1 = (value: DesignFileValue): DesignFileValue => {
	const { componentMigrationPolicy, ...rest } = value;
	return {
		...rest,
		...(componentMigrationPolicy === null ||
		componentMigrationPolicy === undefined
			? {}
			: { componentMigrationPolicy }),
		version: 1,
	};
};

/**
 * v1 → v2: storage layout only. A design is stored as a folder with a
 * manifest (`design.json`) and one file per board (see `design-storage.ts`);
 * the in-memory shape is unchanged.
 */
const migrateV1ToV2 = (value: DesignFileValue): DesignFileValue => ({
	...value,
	version: 2,
});

export const designFileMigrations: readonly DesignFileMigration[] = [
	{ from: 0, to: 1, migrate: migrateV0ToV1 },
	{ from: 1, to: 2, migrate: migrateV1ToV2 },
];

export const supportedDesignFileVersions: ReadonlySet<number> = new Set([
	LEGACY_DESIGN_FILE_VERSION,
	...designFileMigrations.map((migration) => migration.to),
]);

export type DesignFileVersionIssue =
	| { code: "INVALID_DESIGN_PAYLOAD"; message: string }
	| { code: "UNSUPPORTED_DESIGN_VERSION"; message: string; version: number };

export type DesignFileMigrationResult =
	| {
			ok: true;
			value: DesignFileValue;
			/** Version found in the input (0 when it had none). */
			fromVersion: number;
			/** Whether any migration step ran. */
			migrated: boolean;
	  }
	| ({ ok: false } & DesignFileVersionIssue);

export const unsupportedDesignVersionMessage = (version: number) =>
	`Design file version ${version} is newer than this Trickroom supports (up to ${DESIGN_FILE_VERSION}). Update Trickroom to open it.`;

/**
 * Reads the stored version of a design value. `missing` decides what an
 * absent field means: stored files without one are legacy (version 0), while
 * in-memory designs handed to a writer are already in the current shape.
 */
export const getDesignFileVersion = (
	value: DesignFileValue,
	missing: number = LEGACY_DESIGN_FILE_VERSION,
): number | null => {
	if (value.version === undefined) {
		return missing;
	}

	return typeof value.version === "number" &&
		Number.isInteger(value.version) &&
		value.version >= 0
		? value.version
		: null;
};

/**
 * Runs a design value through the migration chain up to
 * `DESIGN_FILE_VERSION`. Values from a newer Trickroom are rejected, never
 * down-converted. The result is not validated as a design; callers do that.
 */
export const migrateDesignFileValue = (
	value: unknown,
	options: { missingVersion?: number } = {},
): DesignFileMigrationResult => {
	if (!isRecord(value)) {
		return {
			ok: false,
			code: "INVALID_DESIGN_PAYLOAD",
			message: "Design file must contain a JSON object.",
		};
	}

	const fromVersion = getDesignFileVersion(value, options.missingVersion);
	if (fromVersion === null) {
		return {
			ok: false,
			code: "INVALID_DESIGN_PAYLOAD",
			message: "Design file version must be a non-negative integer.",
		};
	}
	if (fromVersion > DESIGN_FILE_VERSION) {
		return {
			ok: false,
			code: "UNSUPPORTED_DESIGN_VERSION",
			message: unsupportedDesignVersionMessage(fromVersion),
			version: fromVersion,
		};
	}
	if (!supportedDesignFileVersions.has(fromVersion)) {
		return {
			ok: false,
			code: "INVALID_DESIGN_PAYLOAD",
			message: `Design file version ${fromVersion} is not a known version.`,
		};
	}

	let current = value;
	let version = fromVersion;
	for (const migration of designFileMigrations) {
		if (migration.from === version) {
			current = migration.migrate(current);
			version = migration.to;
		}
	}

	return {
		ok: true,
		value:
			current.version === DESIGN_FILE_VERSION
				? current
				: { ...current, version: DESIGN_FILE_VERSION },
		fromVersion,
		migrated: fromVersion !== DESIGN_FILE_VERSION,
	};
};

const leadingDesignKeys = [
	"version",
	"name",
	"systemId",
	"systemName",
	"componentMigrationPolicy",
] as const;

/**
 * Returns the design with a stable top-level key order (`version` first,
 * `boards` last, unknown keys in their existing order in between) so written
 * JSON is deterministic regardless of how callers assembled the object.
 */
export const orderDesignFileKeys = <T extends DesignFileValue>(value: T): T => {
	const ordered: DesignFileValue = {};
	for (const key of leadingDesignKeys) {
		if (value[key] !== undefined) {
			ordered[key] = value[key];
		}
	}
	for (const [key, entry] of Object.entries(value)) {
		if (
			key !== "boards" &&
			!(leadingDesignKeys as readonly string[]).includes(key) &&
			entry !== undefined
		) {
			ordered[key] = entry;
		}
	}
	if (value.boards !== undefined) {
		ordered.boards = value.boards;
	}

	return ordered as T;
};
