import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	unlink,
} from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "../app-state/home";
import {
	calculateAnnotationRevision,
	migrateAnnotationFileValue,
	serializeAnnotation,
} from "./annotation-file-schema";
import {
	ANNOTATION_FILE_VERSION,
	type Annotation,
	type AnnotationContainer,
	type AnnotationSessionFile,
	type AnnotationTarget,
} from "./annotations.types";
import {
	type DesignFileLockOptions,
	DesignFileLockTimeoutError,
	type FileLockHandle,
	withDesignFileLock,
} from "./design-file-lock";

/**
 * Per-user annotation files:
 *
 * ```text
 * <TRICKROOM_HOME>/annotations/<projectId>/designs/<designId>/<annotationId>.json
 * <TRICKROOM_HOME>/annotations/<projectId>/systems/<systemId>/components/<componentId>/<annotationId>.json
 * <TRICKROOM_HOME>/annotations/<projectId>/sessions/<sessionId>.json
 * ```
 *
 * Keyed by the project id, so every checkout and worktree of a project
 * shares one store. Folders are created 0700 and files 0600. Every write is
 * a read-modify-write of one file under a per-annotation lock (the design
 * file lock mechanism, lockfiles in `<home>/locks/annotations`), replaced
 * with an atomic rename. See docs/project-files.md#annotations.
 */

const directoryMode = 0o700;
const fileMode = 0o600;
const jsonExtension = ".json";

export type AnnotationStoreErrorCode =
	| "INVALID_ID"
	| "ANNOTATION_NOT_FOUND"
	| "ANNOTATION_EXISTS"
	| "INVALID_ANNOTATION_FILE"
	| "UNSUPPORTED_ANNOTATION_VERSION"
	| "ANNOTATION_REVISION_MISMATCH"
	| "ANNOTATION_LOCKED";

export class AnnotationStoreError extends Error {
	readonly code: AnnotationStoreErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: AnnotationStoreErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "AnnotationStoreError";
		this.code = code;
		if (details !== undefined) this.details = details;
	}
}

/** Ids name folders and files: one path segment, no leading dot. */
export const isSafeAnnotationPathSegment = (value: string) =>
	value.length > 0 &&
	value.length <= 200 &&
	value === value.trim() &&
	!value.startsWith(".") &&
	!/[/\\:\0]/u.test(value);

const assertSegment = (value: string, label: string) => {
	if (!isSafeAnnotationPathSegment(value)) {
		throw new AnnotationStoreError(
			"INVALID_ID",
			`${label} must be a single path segment.`,
			{ [label]: value },
		);
	}
	return value;
};

export const getAnnotationsDirectory = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "annotations");

export const getAnnotationLockDirectory = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "locks", "annotations");

export const getAnnotationProjectDirectory = (
	projectId: string,
	trickroomHome = resolveTrickroomHome(),
) =>
	path.join(
		getAnnotationsDirectory(trickroomHome),
		assertSegment(projectId, "projectId"),
	);

/** Relative folder of a container inside the project's annotation folder. */
export const getAnnotationContainerSegments = (
	container: AnnotationContainer,
): string[] =>
	container.kind === "design"
		? ["designs", assertSegment(container.designId, "designId")]
		: [
				"systems",
				assertSegment(container.systemId, "systemId"),
				"components",
				assertSegment(container.componentId, "componentId"),
			];

export const getAnnotationContainer = (
	target: AnnotationTarget,
): AnnotationContainer =>
	target.kind === "componentNode"
		? {
				kind: "component",
				systemId: target.systemId,
				componentId: target.componentId,
			}
		: { kind: "design", designId: target.designId };

export const isSameAnnotationContainer = (
	a: AnnotationContainer,
	b: AnnotationContainer,
) =>
	a.kind === "design"
		? b.kind === "design" && a.designId === b.designId
		: b.kind === "component" &&
			a.systemId === b.systemId &&
			a.componentId === b.componentId;

/**
 * Classifies a path relative to the project's annotation folder: an
 * annotation file with its container, or null (session files, temporary
 * files, anything else).
 */
export const classifyAnnotationFile = (
	relativeFile: string,
): { container: AnnotationContainer; annotationId: string } | null => {
	const segments = relativeFile.split(/[/\\]/u);
	const file = segments.at(-1) ?? "";
	if (!file.endsWith(jsonExtension) || file.startsWith(".")) return null;
	const annotationId = file.slice(0, -jsonExtension.length);
	if (!isSafeAnnotationPathSegment(annotationId)) return null;
	if (segments.length === 3 && segments[0] === "designs") {
		const designId = segments[1] ?? "";
		return isSafeAnnotationPathSegment(designId)
			? { container: { kind: "design", designId }, annotationId }
			: null;
	}
	if (
		segments.length === 5 &&
		segments[0] === "systems" &&
		segments[2] === "components"
	) {
		const systemId = segments[1] ?? "";
		const componentId = segments[3] ?? "";
		return isSafeAnnotationPathSegment(systemId) &&
			isSafeAnnotationPathSegment(componentId)
			? {
					container: { kind: "component", systemId, componentId },
					annotationId,
				}
			: null;
	}
	return null;
};

export type StoredAnnotation = {
	annotation: Annotation;
	revision: string;
	/** The stored version was older and migrated in memory. */
	migrated: boolean;
};

/** A file `list` could not read; it is skipped, never rewritten. */
export type AnnotationReadProblem = {
	annotationId: string;
	code: "INVALID_ANNOTATION_FILE" | "UNSUPPORTED_ANNOTATION_VERSION";
	message: string;
};

export type AnnotationStoreOptions = {
	projectId: string;
	/** Defaults to `TRICKROOM_HOME` or `~/.trickroom`. */
	trickroomHome?: string;
	lock?: Partial<DesignFileLockOptions>;
};

/**
 * What an `update` mutation returns: the next annotation to store, or
 * `null` to leave the file as it is.
 */
export type AnnotationMutation<Result> = (
	current: StoredAnnotation,
) =>
	| { annotation: Annotation | null; result: Result }
	| Promise<{ annotation: Annotation | null; result: Result }>;

const parseStored = (
	contents: string,
	annotationId: string,
): StoredAnnotation => {
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		throw new AnnotationStoreError(
			"INVALID_ANNOTATION_FILE",
			`Annotation ${annotationId} is not valid JSON.`,
			{ annotationId },
		);
	}
	const migrated = migrateAnnotationFileValue(value);
	if (!migrated.ok) {
		throw new AnnotationStoreError(migrated.code, migrated.message, {
			annotationId,
		});
	}
	if (migrated.value.id !== annotationId) {
		throw new AnnotationStoreError(
			"INVALID_ANNOTATION_FILE",
			`Annotation file ${annotationId} holds annotation ${migrated.value.id}.`,
			{ annotationId },
		);
	}
	return {
		annotation: migrated.value,
		revision: calculateAnnotationRevision(migrated.value),
		migrated: migrated.migrated,
	};
};

/**
 * `realpath` of the nearest existing ancestor, with the rest of the path
 * appended: the same answer for every alias of a path, whether or not the
 * path exists yet.
 */
export const canonicalizePath = async (filePath: string): Promise<string> => {
	const absolute = path.resolve(filePath);
	const tail: string[] = [];
	let current = absolute;
	for (;;) {
		try {
			return path.join(await realpath(current), ...tail.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return absolute;
			tail.push(path.basename(current));
			current = parent;
		}
	}
};

const readDirectoryEntries = async (directory: string): Promise<Dirent[]> => {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
};

const ensureDirectory = async (directory: string) => {
	await mkdir(directory, { recursive: true, mode: directoryMode });
};

/**
 * Writes `contents` to a dot-prefixed temporary sibling (0600) and renames
 * it over `filePath`, after `fence` confirms the lock is still held.
 */
const writeFileAtomic = async (
	filePath: string,
	contents: string,
	fence: () => Promise<void>,
) => {
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		const handle = await open(tempPath, "wx", fileMode);
		try {
			await handle.writeFile(contents, "utf8");
		} finally {
			await handle.close();
		}
		// The umask may have narrowed the mode; never widened it.
		await chmod(tempPath, fileMode);
		await fence();
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
};

/** `updateMany`'s mutation: the current annotations by id in, the ones to write out. */
export type AnnotationManyMutation<Result> = (
	current: ReadonlyMap<string, StoredAnnotation>,
) => Promise<{ annotations: readonly Annotation[]; result: Result }>;

export class AnnotationStore {
	readonly projectId: string;
	readonly trickroomHome: string;
	/** `<home>/annotations/<projectId>`. */
	readonly projectDirectory: string;
	private readonly lockOptions: DesignFileLockOptions;

	constructor(options: AnnotationStoreOptions) {
		this.trickroomHome = options.trickroomHome ?? resolveTrickroomHome();
		this.projectId = assertSegment(options.projectId, "projectId");
		this.projectDirectory = getAnnotationProjectDirectory(
			this.projectId,
			this.trickroomHome,
		);
		this.lockOptions = {
			label: "annotation",
			...options.lock,
			lockDirectory:
				options.lock?.lockDirectory ??
				getAnnotationLockDirectory(this.trickroomHome),
		};
	}

	getContainerDirectory(container: AnnotationContainer) {
		return path.join(
			this.projectDirectory,
			...getAnnotationContainerSegments(container),
		);
	}

	getAnnotationPath(container: AnnotationContainer, annotationId: string) {
		return path.join(
			this.getContainerDirectory(container),
			`${assertSegment(annotationId, "annotationId")}${jsonExtension}`,
		);
	}

	getSessionPath(sessionId: string) {
		return path.join(
			this.projectDirectory,
			"sessions",
			`${assertSegment(sessionId, "sessionId")}${jsonExtension}`,
		);
	}

	/**
	 * Locks one annotation file. The lock's identity is canonical: the file
	 * path and the lock folder go through `realpath` (of their nearest
	 * existing ancestor), so processes that reach the Trickroom home through
	 * different paths (a symlink, a relative `TRICKROOM_HOME`) take the same
	 * lockfile, and in-process callers share one queue.
	 */
	private async withLock<T>(
		filePath: string,
		operation: (lock: FileLockHandle) => Promise<T>,
	): Promise<T> {
		const [lockTarget, lockDirectory] = await Promise.all([
			canonicalizePath(filePath),
			canonicalizePath(this.lockOptions.lockDirectory),
		]);
		try {
			return await withDesignFileLock(lockTarget, operation, {
				...this.lockOptions,
				lockDirectory,
			});
		} catch (error) {
			if (error instanceof DesignFileLockTimeoutError) {
				throw new AnnotationStoreError("ANNOTATION_LOCKED", error.message);
			}
			throw error;
		}
	}

	/** One annotation, or null when there is no such file. */
	async read(
		container: AnnotationContainer,
		annotationId: string,
	): Promise<StoredAnnotation | null> {
		const filePath = this.getAnnotationPath(container, annotationId);
		let contents: string;
		try {
			contents = await readFile(filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		return parseStored(contents, annotationId);
	}

	/**
	 * Every readable annotation of a container, oldest first. Files that
	 * cannot be read (invalid, or from a newer Trickroom) are reported in
	 * `problems` and left alone.
	 */
	async list(container: AnnotationContainer): Promise<{
		annotations: StoredAnnotation[];
		problems: AnnotationReadProblem[];
	}> {
		const directory = this.getContainerDirectory(container);
		const entries = await readDirectoryEntries(directory);
		const annotations: StoredAnnotation[] = [];
		const problems: AnnotationReadProblem[] = [];
		await Promise.all(
			entries.map(async (entry) => {
				if (
					!entry.isFile() ||
					entry.name.startsWith(".") ||
					!entry.name.endsWith(jsonExtension)
				) {
					return;
				}
				const annotationId = entry.name.slice(0, -jsonExtension.length);
				if (!isSafeAnnotationPathSegment(annotationId)) return;
				try {
					const stored = await this.read(container, annotationId);
					if (stored) annotations.push(stored);
				} catch (error) {
					if (
						error instanceof AnnotationStoreError &&
						(error.code === "INVALID_ANNOTATION_FILE" ||
							error.code === "UNSUPPORTED_ANNOTATION_VERSION")
					) {
						problems.push({
							annotationId,
							code: error.code,
							message: error.message,
						});
						return;
					}
					throw error;
				}
			}),
		);
		annotations.sort(
			(a, b) =>
				a.annotation.createdAt.localeCompare(b.annotation.createdAt) ||
				a.annotation.id.localeCompare(b.annotation.id),
		);
		problems.sort((a, b) => a.annotationId.localeCompare(b.annotationId));
		return { annotations, problems };
	}

	/** Every container that has an annotation folder. */
	async listContainers(): Promise<AnnotationContainer[]> {
		const containers: AnnotationContainer[] = [];
		for (const entry of await readDirectoryEntries(
			path.join(this.projectDirectory, "designs"),
		)) {
			if (entry.isDirectory() && isSafeAnnotationPathSegment(entry.name)) {
				containers.push({ kind: "design", designId: entry.name });
			}
		}
		for (const system of await readDirectoryEntries(
			path.join(this.projectDirectory, "systems"),
		)) {
			if (!system.isDirectory() || !isSafeAnnotationPathSegment(system.name)) {
				continue;
			}
			for (const component of await readDirectoryEntries(
				path.join(this.projectDirectory, "systems", system.name, "components"),
			)) {
				if (
					component.isDirectory() &&
					isSafeAnnotationPathSegment(component.name)
				) {
					containers.push({
						kind: "component",
						systemId: system.name,
						componentId: component.name,
					});
				}
			}
		}
		return containers;
	}

	/**
	 * Finds the container of an annotation by id. `hint` is checked first;
	 * otherwise every container folder is looked in.
	 */
	async locate(
		annotationId: string,
		hint?: AnnotationContainer,
	): Promise<AnnotationContainer | null> {
		assertSegment(annotationId, "annotationId");
		const exists = async (container: AnnotationContainer) => {
			try {
				const handle = await open(
					this.getAnnotationPath(container, annotationId),
					"r",
				);
				await handle.close();
				return true;
			} catch {
				return false;
			}
		};
		if (hint && (await exists(hint))) return hint;
		for (const container of await this.listContainers()) {
			if (await exists(container)) return container;
		}
		return null;
	}

	/** Stores a new annotation; fails when one with its id exists. */
	async create(annotation: Annotation): Promise<StoredAnnotation> {
		if (annotation.projectId !== this.projectId) {
			throw new AnnotationStoreError(
				"INVALID_ID",
				`Annotation belongs to project ${annotation.projectId}, not ${this.projectId}.`,
			);
		}
		const container = getAnnotationContainer(annotation.target);
		const filePath = this.getAnnotationPath(container, annotation.id);
		const stored: Annotation = {
			...annotation,
			version: ANNOTATION_FILE_VERSION,
		};
		await ensureDirectory(path.dirname(filePath));
		return this.withLock(filePath, async (lock) => {
			if (await this.read(container, annotation.id)) {
				throw new AnnotationStoreError(
					"ANNOTATION_EXISTS",
					`Annotation ${annotation.id} already exists.`,
				);
			}
			await writeFileAtomic(filePath, serializeAnnotation(stored), () =>
				lock.assertHeld(),
			);
			return {
				annotation: stored,
				revision: calculateAnnotationRevision(stored),
				migrated: false,
			};
		});
	}

	/**
	 * Read-modify-write of one annotation under its lock. `expectedRevision`,
	 * when given, must match the stored revision. The mutation returns the
	 * next annotation (or null to write nothing) and a result.
	 */
	async update<Result>(
		container: AnnotationContainer,
		annotationId: string,
		mutate: AnnotationMutation<Result>,
		{ expectedRevision }: { expectedRevision?: string } = {},
	): Promise<{ stored: StoredAnnotation; written: boolean; result: Result }> {
		const filePath = this.getAnnotationPath(container, annotationId);
		return this.withLock(filePath, async (lock) => {
			const current = await this.read(container, annotationId);
			if (!current) {
				throw new AnnotationStoreError(
					"ANNOTATION_NOT_FOUND",
					`Annotation ${annotationId} does not exist.`,
					{ annotationId },
				);
			}
			if (
				expectedRevision !== undefined &&
				expectedRevision !== current.revision
			) {
				throw new AnnotationStoreError(
					"ANNOTATION_REVISION_MISMATCH",
					`Annotation ${annotationId} changed since revision ${expectedRevision}.`,
					{ annotationId, currentRevision: current.revision },
				);
			}
			const { annotation, result } = await mutate(current);
			if (!annotation) {
				return { stored: current, written: false, result };
			}
			const next: Annotation = {
				...annotation,
				version: ANNOTATION_FILE_VERSION,
			};
			const target = getAnnotationContainer(next.target);
			if (
				!isSameAnnotationContainer(target, container) ||
				next.id !== annotationId
			) {
				throw new AnnotationStoreError(
					"INVALID_ID",
					"An update cannot move an annotation to another design or component.",
				);
			}
			await writeFileAtomic(filePath, serializeAnnotation(next), () =>
				lock.assertHeld(),
			);
			return {
				stored: {
					annotation: next,
					revision: calculateAnnotationRevision(next),
					migrated: false,
				},
				written: true,
				result,
			};
		});
	}

	/**
	 * Read-modify-write of several annotations of one container under all of
	 * their locks. The locks are taken in id order, so two such writers
	 * cannot deadlock, and held until every write is done. A lock that cannot
	 * be taken fails with `ANNOTATION_LOCKED` naming the annotation, before
	 * `mutate` runs; so does a missing annotation (`ANNOTATION_NOT_FOUND`).
	 * `mutate` sees the current annotations by id and returns the ones to
	 * write. With `allowMissing`, a missing annotation is left out of the
	 * map instead.
	 */
	async updateMany<Result>(
		container: AnnotationContainer,
		annotationIds: readonly string[],
		mutate: AnnotationManyMutation<Result>,
		{ allowMissing = false }: { allowMissing?: boolean } = {},
	): Promise<{ stored: Map<string, StoredAnnotation>; result: Result }> {
		const ids = [...new Set(annotationIds)].sort();
		const locks = new Map<string, FileLockHandle>();
		const run = async () => {
			const current = new Map<string, StoredAnnotation>();
			for (const annotationId of ids) {
				const stored = await this.read(container, annotationId);
				if (!stored && allowMissing) continue;
				if (!stored) {
					throw new AnnotationStoreError(
						"ANNOTATION_NOT_FOUND",
						`Annotation ${annotationId} does not exist.`,
						{ annotationId },
					);
				}
				current.set(annotationId, stored);
			}
			const { annotations, result } = await mutate(current);
			const stored = new Map<string, StoredAnnotation>();
			for (const annotation of annotations) {
				const lock = locks.get(annotation.id);
				if (
					!lock ||
					!isSameAnnotationContainer(
						getAnnotationContainer(annotation.target),
						container,
					)
				) {
					throw new AnnotationStoreError(
						"INVALID_ID",
						"An update can write only the annotations it locked, in their own container.",
					);
				}
				const next: Annotation = {
					...annotation,
					version: ANNOTATION_FILE_VERSION,
				};
				await this.writeLocked(container, next, lock);
				stored.set(annotation.id, {
					annotation: next,
					revision: calculateAnnotationRevision(next),
					migrated: false,
				});
			}
			return { stored, result };
		};
		const acquire = async (
			index: number,
		): Promise<{ stored: Map<string, StoredAnnotation>; result: Result }> => {
			const annotationId = ids[index];
			if (annotationId === undefined) return run();
			try {
				return await this.withLock(
					this.getAnnotationPath(container, annotationId),
					async (lock) => {
						locks.set(annotationId, lock);
						return acquire(index + 1);
					},
				);
			} catch (error) {
				// Name the annotation whose lock could not be taken (once: an
				// inner failure passes through the outer locks).
				if (
					error instanceof AnnotationStoreError &&
					error.code === "ANNOTATION_LOCKED" &&
					error.details?.annotationId === undefined
				) {
					throw new AnnotationStoreError(
						"ANNOTATION_LOCKED",
						`Annotation ${annotationId} is locked by another writer; try again.`,
						{ annotationId },
					);
				}
				throw error;
			}
		};
		return acquire(0);
	}

	/**
	 * One file of an `updateMany` batch, written while every lock of the
	 * batch is held. Tests override it to pause between two files.
	 */
	protected async writeLocked(
		container: AnnotationContainer,
		annotation: Annotation,
		lock: FileLockHandle,
	) {
		await writeFileAtomic(
			this.getAnnotationPath(container, annotation.id),
			serializeAnnotation(annotation),
			() => lock.assertHeld(),
		);
	}

	/**
	 * Deletes an annotation under its lock when `shouldDelete` approves the
	 * current contents. False when it was missing or kept.
	 */
	async remove(
		container: AnnotationContainer,
		annotationId: string,
		shouldDelete: (current: StoredAnnotation) => boolean = () => true,
	): Promise<boolean> {
		const filePath = this.getAnnotationPath(container, annotationId);
		return this.withLock(filePath, async (lock) => {
			const current = await this.read(container, annotationId);
			if (!current || !shouldDelete(current)) return false;
			await lock.assertHeld();
			await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
			return true;
		});
	}

	/** Records an MCP session's last tool call (the acknowledgement expiry clock). */
	async writeSession(sessionId: string, lastCallAt: Date) {
		const filePath = this.getSessionPath(sessionId);
		const value: AnnotationSessionFile = {
			version: 1,
			sessionId,
			lastCallAt: lastCallAt.toISOString(),
		};
		await ensureDirectory(path.dirname(filePath));
		// One writer per session file (its own MCP process): no lock needed,
		// and the rename keeps readers from seeing half a file.
		await writeFileAtomic(
			filePath,
			`${JSON.stringify(value, null, 2)}\n`,
			async () => undefined,
		);
	}

	/** When a session last made a tool call, or null when unknown. */
	async readSessionLastCall(sessionId: string): Promise<Date | null> {
		if (!isSafeAnnotationPathSegment(sessionId)) return null;
		try {
			const value = JSON.parse(
				await readFile(this.getSessionPath(sessionId), "utf8"),
			) as Partial<AnnotationSessionFile>;
			if (value.version !== 1 || typeof value.lastCallAt !== "string") {
				return null;
			}
			const time = new Date(value.lastCallAt);
			return Number.isNaN(time.getTime()) ? null : time;
		} catch {
			return null;
		}
	}
}

export const createAnnotationStore = (options: AnnotationStoreOptions) =>
	new AnnotationStore(options);
