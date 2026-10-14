import { createHash } from "node:crypto";
import {
	ANNOTATION_FILE_VERSION,
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationActor,
	type AnnotationTarget,
} from "./annotations.types";
import { stableStringify } from "./design-revision";

/**
 * Versioning for annotation files, in the shape of `designFileMigrations`.
 * Every file carries a top-level `version`. Reads run the stored value
 * through `annotationFileMigrations` in memory; the next write persists the
 * current shape. Files from a newer Trickroom are refused, never
 * down-converted.
 *
 * Adding a version: bump `ANNOTATION_FILE_VERSION` in `annotations.types.ts`,
 * append a `{ from, to, migrate }` step (which must not mutate its input),
 * cover it in `annotation-file-schema.test.ts` and document it in
 * `docs/project-files.md#annotations`.
 */

type AnnotationFileValue = Record<string, unknown>;

export type AnnotationFileMigration = {
	from: number;
	to: number;
	migrate: (value: AnnotationFileValue) => AnnotationFileValue;
};

export const annotationFileMigrations: readonly AnnotationFileMigration[] = [];

export const supportedAnnotationFileVersions: ReadonlySet<number> = new Set([
	ANNOTATION_FILE_VERSION,
	...annotationFileMigrations.map((migration) => migration.from),
]);

export type AnnotationFileIssue =
	| { code: "INVALID_ANNOTATION_FILE"; message: string }
	| {
			code: "UNSUPPORTED_ANNOTATION_VERSION";
			message: string;
			version: number;
	  };

export type AnnotationFileMigrationResult =
	| { ok: true; value: Annotation; fromVersion: number; migrated: boolean }
	| ({ ok: false } & AnnotationFileIssue);

const isRecord = (value: unknown): value is AnnotationFileValue =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const isStatus = (value: unknown) =>
	(ANNOTATION_STATUSES as readonly unknown[]).includes(value);

export const isAnnotationActor = (value: unknown): value is AnnotationActor =>
	isRecord(value) &&
	(value.role === "human" ||
		(value.role === "agent" && isNonEmptyString(value.sessionId)));

export const isAnnotationTarget = (
	value: unknown,
): value is AnnotationTarget => {
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "design":
			return isNonEmptyString(value.designId);
		case "board":
			return (
				isNonEmptyString(value.designId) && isNonEmptyString(value.boardId)
			);
		case "layer":
			return (
				isNonEmptyString(value.designId) &&
				isNonEmptyString(value.boardId) &&
				isNonEmptyString(value.elementId)
			);
		case "componentNode":
			return (
				isNonEmptyString(value.systemId) &&
				isNonEmptyString(value.componentId) &&
				typeof value.nodePath === "string" &&
				(value.variants === undefined ||
					(isRecord(value.variants) &&
						Object.values(value.variants).every(
							(entry) => typeof entry === "string",
						)))
			);
		default:
			return false;
	}
};

/**
 * Structural check of the current shape: the fields every reader relies on.
 * Entries are checked for an id, a kind, a time and an actor.
 */
const validateAnnotation = (value: AnnotationFileValue): string | null => {
	if (!isNonEmptyString(value.id)) return "id must be a non-empty string.";
	if (!isNonEmptyString(value.projectId)) {
		return "projectId must be a non-empty string.";
	}
	if (!isAnnotationTarget(value.target)) return "target is not a valid target.";
	if (!isNonEmptyString(value.branch)) {
		return "branch must be a non-empty string.";
	}
	if (typeof value.worktreePath !== "string") {
		return "worktreePath must be a string.";
	}
	if (!isRecord(value.snapshot)) return "snapshot must be an object.";
	if (
		!(ANNOTATION_STATUSES as readonly unknown[]).includes(value.status as never)
	) {
		return `status must be one of ${ANNOTATION_STATUSES.join(", ")}.`;
	}
	if (
		value.acknowledged !== undefined &&
		!(
			isRecord(value.acknowledged) &&
			isNonEmptyString(value.acknowledged.sessionId) &&
			isNonEmptyString(value.acknowledged.at)
		)
	) {
		return "acknowledged must have a sessionId and a time.";
	}
	if (
		!isNonEmptyString(value.createdAt) ||
		!isNonEmptyString(value.updatedAt)
	) {
		return "createdAt and updatedAt must be ISO times.";
	}
	if (
		!Array.isArray(value.entries) ||
		!value.entries.every(
			(entry) =>
				isRecord(entry) &&
				isNonEmptyString(entry.id) &&
				isNonEmptyString(entry.kind) &&
				isNonEmptyString(entry.at) &&
				isAnnotationActor(entry.by),
		)
	) {
		return "entries must be a list of entries with id, kind, at and by.";
	}
	if (
		!Array.isArray(value.transitions) ||
		!value.transitions.every(
			(transition) =>
				isRecord(transition) &&
				isStatus(transition.to) &&
				(transition.from === null || isStatus(transition.from)) &&
				isNonEmptyString(transition.at) &&
				isAnnotationActor(transition.by),
		)
	) {
		return "transitions must be a list of transitions with to, at and by.";
	}
	return null;
};

export const unsupportedAnnotationVersionMessage = (version: number) =>
	`Annotation file version ${version} is newer than this Trickroom supports (up to ${ANNOTATION_FILE_VERSION}). Update Trickroom to open it.`;

/**
 * Runs a stored annotation through the migration chain and validates the
 * result. Nothing is written.
 */
export const migrateAnnotationFileValue = (
	value: unknown,
): AnnotationFileMigrationResult => {
	if (!isRecord(value)) {
		return {
			ok: false,
			code: "INVALID_ANNOTATION_FILE",
			message: "Annotation file must contain a JSON object.",
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
			code: "INVALID_ANNOTATION_FILE",
			message: "Annotation file version must be a positive integer.",
		};
	}
	if (fromVersion > ANNOTATION_FILE_VERSION) {
		return {
			ok: false,
			code: "UNSUPPORTED_ANNOTATION_VERSION",
			message: unsupportedAnnotationVersionMessage(fromVersion),
			version: fromVersion,
		};
	}
	if (!supportedAnnotationFileVersions.has(fromVersion)) {
		return {
			ok: false,
			code: "INVALID_ANNOTATION_FILE",
			message: `Annotation file version ${fromVersion} is not a known version.`,
		};
	}

	let current = value;
	let version = fromVersion;
	for (const migration of annotationFileMigrations) {
		if (migration.from === version) {
			current = migration.migrate(current);
			version = migration.to;
		}
	}
	const problem = validateAnnotation(current);
	if (problem) {
		return {
			ok: false,
			code: "INVALID_ANNOTATION_FILE",
			message: `Annotation file is invalid: ${problem}`,
		};
	}
	return {
		ok: true,
		value: { ...current, version: ANNOTATION_FILE_VERSION } as Annotation,
		fromVersion,
		migrated: fromVersion !== ANNOTATION_FILE_VERSION,
	};
};

const leadingAnnotationKeys = [
	"version",
	"id",
	"projectId",
	"target",
	"branch",
	"worktreePath",
	"status",
	"acknowledged",
	"createdAt",
	"updatedAt",
	"snapshot",
] as const;

/** Stable key order (`version` first, entries and transitions last). */
export const orderAnnotationKeys = (annotation: Annotation): Annotation => {
	const ordered: Record<string, unknown> = {};
	const source = annotation as unknown as Record<string, unknown>;
	for (const key of leadingAnnotationKeys) {
		if (source[key] !== undefined) ordered[key] = source[key];
	}
	for (const [key, entry] of Object.entries(source)) {
		if (
			!(leadingAnnotationKeys as readonly string[]).includes(key) &&
			key !== "entries" &&
			key !== "transitions" &&
			entry !== undefined
		) {
			ordered[key] = entry;
		}
	}
	ordered.entries = annotation.entries;
	ordered.transitions = annotation.transitions;
	return ordered as Annotation;
};

export const serializeAnnotation = (annotation: Annotation) =>
	`${JSON.stringify(orderAnnotationKeys(annotation), null, 2)}\n`;

/** Content revision of an annotation, independent of key order. */
export const calculateAnnotationRevision = (annotation: Annotation) =>
	`sha256:${createHash("sha256").update(stableStringify(annotation)).digest("hex")}`;
