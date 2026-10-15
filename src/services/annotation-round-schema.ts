import { isAnnotationActor } from "./annotation-file-schema";
import {
	ANNOTATION_ROUND_FILE_VERSION,
	type AnnotationRound,
} from "./annotations.types";

/**
 * Versioning for round files (`rounds/<roundId>.json` in a container's
 * annotation folder), in the shape of `annotationFileMigrations`. Reads run
 * the stored value through `roundFileMigrations` in memory; the next write
 * stores the current shape. Files from a newer Trickroom are refused, never
 * down-converted.
 *
 * Adding a version: bump `ANNOTATION_ROUND_FILE_VERSION` in
 * `annotations.types.ts`, append a `{ from, to, migrate }` step (which must
 * not mutate its input), cover it in `annotation-round-schema.test.ts` and
 * document it in `docs/project-files.md#annotations`.
 */

type RoundFileValue = Record<string, unknown>;

export type RoundFileMigration = {
	from: number;
	to: number;
	migrate: (value: RoundFileValue) => RoundFileValue;
};

export const roundFileMigrations: readonly RoundFileMigration[] = [];

export const supportedRoundFileVersions: ReadonlySet<number> = new Set([
	ANNOTATION_ROUND_FILE_VERSION,
	...roundFileMigrations.map((migration) => migration.from),
]);

export type RoundFileMigrationResult =
	| { ok: true; value: AnnotationRound; fromVersion: number; migrated: boolean }
	| {
			ok: false;
			code: "INVALID_ROUND_FILE" | "UNSUPPORTED_ROUND_VERSION";
			message: string;
	  };

const isRecord = (value: unknown): value is RoundFileValue =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const isIdList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(isNonEmptyString);

const isContainer = (value: unknown) =>
	isRecord(value) &&
	((value.kind === "design" && isNonEmptyString(value.designId)) ||
		(value.kind === "component" &&
			isNonEmptyString(value.systemId) &&
			isNonEmptyString(value.componentId)));

/** Why a value is not a round file of the current shape, or null. */
const validateRound = (value: RoundFileValue): string | null => {
	if (!isNonEmptyString(value.id)) return "id must be a non-empty string.";
	if (!isNonEmptyString(value.projectId)) {
		return "projectId must be a non-empty string.";
	}
	if (!isContainer(value.container)) {
		return "container must be a design or a component with its ids.";
	}
	if (!isNonEmptyString(value.branch)) {
		return "branch must be a non-empty string.";
	}
	if (typeof value.worktreePath !== "string") {
		return "worktreePath must be a string.";
	}
	if (value.status !== "open" && value.status !== "closed") {
		return "status must be open or closed.";
	}
	if (!isNonEmptyString(value.openedAt)) return "openedAt must be an ISO time.";
	if (value.status === "closed") {
		if (!isNonEmptyString(value.closedAt)) {
			return "a closed round needs closedAt.";
		}
		if (!isAnnotationActor(value.closedBy)) {
			return "a closed round needs closedBy.";
		}
	} else if (value.closedAt !== undefined || value.closedBy !== undefined) {
		return "an open round has no closedAt or closedBy.";
	}
	if (!isIdList(value.annotationIds)) {
		return "annotationIds must be a list of ids.";
	}
	if (
		!Array.isArray(value.sends) ||
		!value.sends.every(
			(send) =>
				isRecord(send) &&
				isNonEmptyString(send.id) &&
				isNonEmptyString(send.at) &&
				isIdList(send.annotationIds),
		)
	) {
		return "sends must be a list of { id, at, annotationIds }.";
	}
	return null;
};

export const unsupportedRoundVersionMessage = (version: number) =>
	`Round file version ${version} is newer than this Trickroom supports (up to ${ANNOTATION_ROUND_FILE_VERSION}). Update Trickroom to open it.`;

/** Runs a stored round through the migration chain and validates it. */
export const migrateRoundFileValue = (
	value: unknown,
): RoundFileMigrationResult => {
	if (!isRecord(value)) {
		return {
			ok: false,
			code: "INVALID_ROUND_FILE",
			message: "Round file must contain a JSON object.",
		};
	}
	const fromVersion = value.version;
	if (
		typeof fromVersion !== "number" ||
		!Number.isInteger(fromVersion) ||
		fromVersion < 1
	) {
		return {
			ok: false,
			code: "INVALID_ROUND_FILE",
			message: "Round file version must be a positive integer.",
		};
	}
	if (fromVersion > ANNOTATION_ROUND_FILE_VERSION) {
		return {
			ok: false,
			code: "UNSUPPORTED_ROUND_VERSION",
			message: unsupportedRoundVersionMessage(fromVersion),
		};
	}
	if (!supportedRoundFileVersions.has(fromVersion)) {
		return {
			ok: false,
			code: "INVALID_ROUND_FILE",
			message: `Round file version ${fromVersion} is not a known version.`,
		};
	}
	let current = value;
	let version = fromVersion;
	for (const migration of roundFileMigrations) {
		if (migration.from === version) {
			current = migration.migrate(current);
			version = migration.to;
		}
	}
	const problem = validateRound(current);
	if (problem) {
		return {
			ok: false,
			code: "INVALID_ROUND_FILE",
			message: `Round file is invalid: ${problem}`,
		};
	}
	return {
		ok: true,
		value: {
			...current,
			version: ANNOTATION_ROUND_FILE_VERSION,
		} as AnnotationRound,
		fromVersion,
		migrated: fromVersion !== ANNOTATION_ROUND_FILE_VERSION,
	};
};

const roundKeys = [
	"version",
	"id",
	"projectId",
	"container",
	"branch",
	"worktreePath",
	"status",
	"openedAt",
	"closedAt",
	"closedBy",
	"annotationIds",
	"sends",
] as const;

/** Stable key order (`version` first, `sends` last) and a trailing newline. */
export const serializeRound = (round: AnnotationRound) => {
	const ordered: Record<string, unknown> = {};
	const source = round as unknown as Record<string, unknown>;
	for (const key of roundKeys) {
		if (source[key] !== undefined) ordered[key] = source[key];
	}
	for (const [key, entry] of Object.entries(source)) {
		if (
			!(roundKeys as readonly string[]).includes(key) &&
			entry !== undefined
		) {
			ordered[key] = entry;
		}
	}
	return `${JSON.stringify(ordered, null, 2)}\n`;
};
