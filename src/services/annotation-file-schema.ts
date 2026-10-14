import { createHash } from "node:crypto";
import { isAnnotationTarget } from "./annotation-model";
import {
	ANNOTATION_FILE_VERSION,
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationActor,
} from "./annotations.types";
import { stableStringify } from "./design-revision";

export { isAnnotationTarget };

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

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isOptionalString = (value: unknown) =>
	value === undefined || typeof value === "string";

const isScope = (value: unknown) =>
	isRecord(value) &&
	isNonEmptyString(value.branch) &&
	typeof value.worktreePath === "string";

const isLayerState = (value: unknown) =>
	value === null ||
	(isRecord(value) &&
		(value.parentId === null || typeof value.parentId === "string") &&
		isRecord(value.props) &&
		(typeof value.children === "string" || isStringArray(value.children)));

/**
 * A change record's revert state: `layers` of layer states (`before`) or
 * of hashes (`after`), optional board order and settings.
 */
const isChangeState = (value: unknown, isLayer: (layer: unknown) => boolean) =>
	value === undefined ||
	(isRecord(value) &&
		isRecord(value.layers) &&
		Object.values(value.layers).every(isLayer) &&
		(value.boardOrder === undefined || isStringArray(value.boardOrder)) &&
		(value.settings === undefined || isRecord(value.settings)));

const isChangeRecord = (value: unknown) =>
	isRecord(value) &&
	typeof value.revisionBefore === "string" &&
	typeof value.revisionAfter === "string" &&
	isStringArray(value.boards) &&
	isStringArray(value.layerIds) &&
	Array.isArray(value.operations) &&
	value.operations.every(
		(operation) =>
			isRecord(operation) &&
			typeof operation.operation === "string" &&
			typeof operation.summary === "string",
	) &&
	typeof value.summary === "string" &&
	isChangeState(value.before, isLayerState) &&
	isChangeState(
		value.after,
		(hash) => hash === null || typeof hash === "string",
	) &&
	// Revert needs both or neither.
	(value.before === undefined) === (value.after === undefined) &&
	(value.draftBefore === undefined ||
		(isRecord(value.draftBefore) && isRecord(value.draftBefore.root))) &&
	(value.draftAfter === undefined ||
		(isRecord(value.draftAfter) &&
			typeof value.draftAfter.templateHash === "string" &&
			typeof value.draftAfter.variantSchemaHash === "string")) &&
	(value.draftBefore === undefined) === (value.draftAfter === undefined);

/** Why an entry is not one of the entry kinds with its payload, or null. */
const describeEntryProblem = (entry: unknown): string | null => {
	if (
		!isRecord(entry) ||
		!isNonEmptyString(entry.id) ||
		!isNonEmptyString(entry.at) ||
		!isAnnotationActor(entry.by)
	) {
		return "every entry needs an id, a time and a valid by.";
	}
	const valid = (() => {
		switch (entry.kind) {
			case "remark":
			case "reply":
			case "question":
				return typeof entry.body === "string";
			case "dismissal":
				return typeof entry.reason === "string";
			case "resolution":
				return isOptionalString(entry.summary);
			case "change":
				return (
					isOptionalString(entry.body) &&
					isOptionalString(entry.revertedBy) &&
					isChangeRecord(entry.change)
				);
			case "revert":
				return (
					isNonEmptyString(entry.entryId) &&
					typeof entry.revisionBefore === "string" &&
					typeof entry.revisionAfter === "string"
				);
			case "reanchor":
				return isAnnotationTarget(entry.from) && isAnnotationTarget(entry.to);
			case "move":
				return isScope(entry.from) && isScope(entry.to);
			default:
				return null;
		}
	})();
	if (valid === null) {
		return `entry ${entry.id} has an unknown kind ${JSON.stringify(entry.kind)}.`;
	}
	return valid
		? null
		: `entry ${entry.id} (${String(entry.kind)}) is missing or has an invalid payload.`;
};

/**
 * Structural check of the current shape: every field readers rely on,
 * including each entry's payload for its kind, so a file that passes can
 * be listed, resolved and reverted without surprises.
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
	if (!isRecord(value.snapshot) || !isScope(value.snapshot)) {
		return "snapshot must be an object with the branch and worktree path.";
	}
	if (
		value.snapshot.variants !== undefined &&
		!(
			isRecord(value.snapshot.variants) &&
			Object.values(value.snapshot.variants).every(
				(entry) => typeof entry === "string",
			)
		)
	) {
		return "snapshot.variants must map variant axes to values.";
	}
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
	if (!Array.isArray(value.entries)) return "entries must be a list.";
	for (const entry of value.entries) {
		const problem = describeEntryProblem(entry);
		if (problem) return problem;
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
