import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
	access,
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "../app-state/home";
import {
	writeJsonFileAtomically,
	writeJsonFileExclusivelyAtomically,
} from "../server-file-utils";
import { isTrickroomDesign, readTrickroomDesignValue } from "../server-utils";
import type { DesignFileDiagnostic, Node, TrickroomDesign } from "../types";
import {
	type DesignFileLockOptions,
	DesignFileLockTimeoutError,
	withDesignFileLock,
} from "./design-file-lock";
import {
	DESIGN_FILE_VERSION,
	getDesignFileVersion,
	migrateDesignFileValue,
	orderDesignFileKeys,
	unsupportedDesignVersionMessage,
} from "./design-file-schema";
import type {
	DesignFileRevision,
	DesignFileSummary,
} from "./design-file-service.types";

export type DesignFileServiceErrorCode =
	| "INVALID_DESIGN_FILE_PATH"
	| "INVALID_DESIGN_UUID"
	| "INVALID_DESIGN_PAYLOAD"
	| "UNSUPPORTED_DESIGN_VERSION"
	| "DESIGN_FILE_ALREADY_EXISTS"
	| "DESIGN_FILE_LOCKED"
	| "REVISION_MISMATCH";

export class DesignFileServiceError extends Error {
	readonly code: DesignFileServiceErrorCode;

	constructor(code: DesignFileServiceErrorCode, message: string) {
		super(message);
		this.name = "DesignFileServiceError";
		this.code = code;
	}
}

export type {
	DesignFileRevision,
	DesignFileSummary,
} from "./design-file-service.types";

export type DesignJsonFileRead = {
	/** The design id. */
	uuid: string;
	/**
	 * Where the design is stored, relative to `.trickroom/designs`. Informational
	 * only: callers address designs by id.
	 */
	file: string;
	path: string;
	value: unknown;
	revision: DesignFileRevision;
};

export type DesignFileRead = Omit<DesignJsonFileRead, "value"> & {
	/**
	 * The design migrated in memory to the current schema. Like every
	 * in-memory design it has no `version`; writes stamp it.
	 */
	design: TrickroomDesign;
	/**
	 * Version stored on disk (0 for files without one). When it is older than
	 * `DESIGN_FILE_VERSION`, `revision` still hashes the unmigrated bytes and
	 * the next write persists the current shape.
	 */
	storedVersion: number;
	migrated: boolean;
};

export type DesignFileWrite = {
	file: string;
	path: string;
	uuid: string;
	/** The written design in its in-memory shape (without `version`). */
	design: TrickroomDesign;
	revision: DesignFileRevision;
};

export type RevisionCheck = {
	expectedRevision?: DesignFileRevision;
};

const skippedDesignUpdate = Symbol("skippedDesignUpdate");

/** Returned by an `updateDesignFile` mutation to end it without writing. */
export type DesignUpdateSkip<Value> = { [skippedDesignUpdate]: Value };

export const skipDesignUpdate = <Value>(
	value: Value,
): DesignUpdateSkip<Value> => ({ [skippedDesignUpdate]: value });

export type DesignFileUpdate<
	Result extends { design: TrickroomDesign },
	Skip,
> = {
	/** The revision the caller based its change on. */
	expectedRevision: string;
	/**
	 * Applies the change to a fresh read. Runs again on a fresh read when
	 * another writer wins the race between the read and the write, so it must
	 * not have side effects.
	 */
	mutate: (read: DesignFileRead) => Promise<Result | DesignUpdateSkip<Skip>>;
	/** Turns the mutated design into the one to store (for example canonicalising its system reference). */
	prepare?: (design: TrickroomDesign) => Promise<TrickroomDesign>;
	/** Reads the design; defaults to `readDesignFile`. */
	read?: () => Promise<DesignFileRead>;
};

export type DesignFileUpdateOutcome<Result, Skip> =
	| {
			status: "written";
			read: DesignFileRead;
			result: Result;
			write: DesignFileWrite;
	  }
	| { status: "skipped"; read: DesignFileRead; value: Skip }
	| {
			status: "revision-mismatch";
			expectedRevision: string;
			currentRevision: DesignFileRevision;
	  };

export type DesignFileServiceOptions = {
	/**
	 * Trickroom home holding write lockfiles (`<home>/locks/designs`), outside
	 * the project so locks are never committed or watched. Defaults to
	 * `TRICKROOM_HOME` or `~/.trickroom`; every process writing the same
	 * project must resolve the same home.
	 */
	trickroomHome?: string;
	lock?: Partial<DesignFileLockOptions>;
};

export const getDesignLockDirectory = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "locks", "designs");

type DesignFileSummaryCacheEntry = {
	mtimeMs: number;
	size: number;
	updatedAt: number;
	summary: DesignFileSummary;
};

const maxSummaryCacheAgeMs = 30 * 60 * 1000;

const getLegacyDesignFileName = (designId: string) => `${designId}.json`;

export const calculateDesignFileRevision = (
	contents: string,
): DesignFileRevision =>
	`sha256:${createHash("sha256").update(contents).digest("hex")}`;

export const isSafeDesignId = (designId: string) =>
	designId.trim().length > 0 &&
	designId === designId.trim() &&
	designId !== "." &&
	designId !== ".." &&
	!designId.includes("/") &&
	!designId.includes("\\");

const isPathInsideDirectory = (filePath: string, directoryPath: string) => {
	const allowedPrefix = `${directoryPath}${path.sep}`;
	return filePath.startsWith(allowedPrefix);
};

const countDescendantLayers = (node: Node): number => {
	if (!Array.isArray(node.children)) {
		return 0;
	}

	const stack = [...node.children];
	let count = 0;
	while (stack.length > 0) {
		const child = stack.pop();
		if (!child) {
			continue;
		}

		count += 1;
		if (Array.isArray(child.children)) {
			stack.push(...child.children);
		}
	}

	return count;
};

/** Summaries with a diagnostic describe files that cannot be opened. */
export const isReadableDesignSummary = <T extends { diagnostic?: unknown }>(
	summary: T,
) => summary.diagnostic === undefined;

/**
 * Validates a design handed to a writer and returns the exact object to store:
 * migrated to the current version (a missing `version` means the caller
 * already holds the current shape), with deterministic key order.
 */
export const prepareDesignForStorage = (design: unknown): TrickroomDesign => {
	const migration = migrateDesignFileValue(design, {
		missingVersion: DESIGN_FILE_VERSION,
	});
	if (!migration.ok) {
		throw new DesignFileServiceError(migration.code, migration.message);
	}
	if (!isTrickroomDesign(migration.value)) {
		throw new DesignFileServiceError(
			"INVALID_DESIGN_PAYLOAD",
			"Invalid trickroom design payload",
		);
	}

	return orderDesignFileKeys(migration.value);
};

const withoutStorageVersion = ({
	version: _version,
	...design
}: TrickroomDesign): TrickroomDesign => design;

const parseStoredVersion = (contents: string) => {
	try {
		const value: unknown = JSON.parse(contents);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? getDesignFileVersion(value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
};

const toDesignFileDiagnostic = (
	error: unknown,
	value: unknown,
): DesignFileDiagnostic | null => {
	if (error instanceof SyntaxError) {
		return {
			code: "INVALID_DESIGN_JSON",
			message: `Design file is not valid JSON: ${error.message}`,
		};
	}
	if (error instanceof DesignFileServiceError) {
		const version =
			typeof value === "object" && value !== null && !Array.isArray(value)
				? getDesignFileVersion(value as Record<string, unknown>)
				: null;
		if (error.code === "UNSUPPORTED_DESIGN_VERSION") {
			return {
				code: "UNSUPPORTED_DESIGN_VERSION",
				message: error.message,
				...(version !== null ? { version } : {}),
			};
		}
		if (error.code === "INVALID_DESIGN_PAYLOAD") {
			return {
				code: "INVALID_DESIGN_PAYLOAD",
				message: error.message,
				...(version !== null ? { version } : {}),
			};
		}
	}

	return null;
};

export const countDesignLayers = (design: TrickroomDesign) =>
	design.boards.reduce(
		(count, board) => count + countDescendantLayers(board),
		0,
	);

export class DesignFileService {
	private static readonly summaryCache = new Map<
		string,
		DesignFileSummaryCacheEntry
	>();

	readonly projectRoot: string;
	readonly designsDir: string;
	readonly designsGitkeepPath: string;
	private readonly lockOptions: DesignFileLockOptions;
	private canonicalProjectRoot: Promise<string> | null = null;

	constructor(projectRoot: string, options: DesignFileServiceOptions = {}) {
		this.projectRoot = path.resolve(projectRoot);
		this.designsDir = path.join(this.projectRoot, ".trickroom", "designs");
		this.designsGitkeepPath = path.join(this.designsDir, ".gitkeep");
		this.lockOptions = {
			...options.lock,
			lockDirectory:
				options.lock?.lockDirectory ??
				getDesignLockDirectory(options.trickroomHome),
		};
		void DesignFileService.pruneSummaryCache().catch(() => {});
	}

	/**
	 * Runs a read-check-write sequence on one design while holding its
	 * in-process queue and cross-process lock. The lock key resolves the project
	 * root through `realpath` so processes that reach the project through
	 * different symlinks still share one lock.
	 */
	private async withWriteLock<T>(
		designPath: string,
		operation: () => Promise<T>,
	): Promise<T> {
		this.canonicalProjectRoot ??= realpath(this.projectRoot).catch(
			() => this.projectRoot,
		);
		const canonicalPath = path.join(
			await this.canonicalProjectRoot,
			path.relative(this.projectRoot, designPath),
		);

		try {
			return await withDesignFileLock(
				canonicalPath,
				operation,
				this.lockOptions,
			);
		} catch (error) {
			if (error instanceof DesignFileLockTimeoutError) {
				throw new DesignFileServiceError("DESIGN_FILE_LOCKED", error.message);
			}
			throw error;
		}
	}

	private static async pruneSummaryCache(maxAgeMs = maxSummaryCacheAgeMs) {
		const staleBefore = Date.now() - maxAgeMs;
		const entries = Array.from(DesignFileService.summaryCache.entries());

		await Promise.all(
			entries.map(async ([designPath, entry]) => {
				if (entry.updatedAt < staleBefore) {
					DesignFileService.summaryCache.delete(designPath);
					return;
				}

				try {
					await access(designPath);
				} catch {
					DesignFileService.summaryCache.delete(designPath);
				}
			}),
		);
	}

	/** Creates `.trickroom/designs` with a `.gitkeep` so it survives commits. */
	async initializeDesignsDirectory() {
		await mkdir(this.designsDir, { recursive: true });
		await writeFile(this.designsGitkeepPath, "", { flag: "a" });
	}

	/**
	 * Validates a design id: designs are addressed by id, and the id is a single
	 * path segment inside `.trickroom/designs`.
	 */
	assertDesignId(designId: string) {
		if (!isSafeDesignId(designId)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_UUID",
				"Design id must be a single path segment",
			);
		}

		return designId;
	}

	/**
	 * @deprecated Designs are addressed by id; this returns the validated id.
	 * Kept so callers that still pass `getFileForUuid(id)` keep working.
	 */
	getFileForUuid(designId: string) {
		return this.assertDesignId(designId);
	}

	private getLegacyDesignPath(designId: string) {
		const designPath = path.resolve(
			this.designsDir,
			getLegacyDesignFileName(this.assertDesignId(designId)),
		);
		if (!isPathInsideDirectory(designPath, this.designsDir)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_UUID",
				"Design id must be a single path segment",
			);
		}

		return designPath;
	}

	/** The raw stored value of a design, before migration and validation. */
	async readRawDesign(designId: string): Promise<DesignJsonFileRead> {
		const designPath = this.getLegacyDesignPath(designId);
		const contents = await readFile(designPath, "utf8");

		return {
			uuid: designId,
			file: getLegacyDesignFileName(designId),
			path: designPath,
			value: JSON.parse(contents),
			revision: calculateDesignFileRevision(contents),
		};
	}

	/** @deprecated Use `readRawDesign`. */
	readJsonFile(designId: string) {
		return this.readRawDesign(designId);
	}

	async readDesignFile(designId: string): Promise<DesignFileRead> {
		const read = await this.readRawDesign(designId);
		return this.toDesignFileRead(read);
	}

	private toDesignFileRead(read: DesignJsonFileRead): DesignFileRead {
		const design = readTrickroomDesignValue(read.value);
		if (!design.ok) {
			throw new DesignFileServiceError(design.code, design.message);
		}

		return {
			uuid: read.uuid,
			file: read.file,
			path: read.path,
			design: design.design,
			revision: read.revision,
			storedVersion: design.fromVersion,
			migrated: design.migrated,
		};
	}

	private getCachedSummary(
		designPath: string,
		fileStat: Stats,
	): DesignFileSummary | null {
		const cached = DesignFileService.summaryCache.get(designPath);
		if (
			cached &&
			cached.mtimeMs === fileStat.mtimeMs &&
			cached.size === fileStat.size
		) {
			cached.updatedAt = Date.now();
			return cached.summary;
		}

		return null;
	}

	private setCachedSummary(
		designPath: string,
		fileStat: Stats,
		summary: DesignFileSummary,
	) {
		DesignFileService.summaryCache.set(designPath, {
			mtimeMs: fileStat.mtimeMs,
			size: fileStat.size,
			updatedAt: Date.now(),
			summary,
		});
	}

	private deleteCachedSummary(designPath: string) {
		DesignFileService.summaryCache.delete(designPath);
	}

	async listDesignSummaries(): Promise<DesignFileSummary[]> {
		await DesignFileService.pruneSummaryCache();

		let directoryEntries: Dirent<string>[];
		try {
			directoryEntries = await readdir(this.designsDir, {
				withFileTypes: true,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return [];
			}

			throw error;
		}

		const designIds = directoryEntries
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith(".json") &&
					!entry.name.endsWith(".memory.json"),
			)
			.map((entry) => entry.name.slice(0, -".json".length))
			.filter(isSafeDesignId)
			.sort();

		const summaries = await Promise.all(
			designIds.map(async (uuid) => {
				let designPath: string | null = null;
				try {
					const file = getLegacyDesignFileName(uuid);
					designPath = this.getLegacyDesignPath(uuid);
					const fileStat = await stat(designPath);
					const cachedSummary = this.getCachedSummary(designPath, fileStat);
					if (cachedSummary) {
						return cachedSummary;
					}

					const contents = await readFile(designPath, "utf8");
					const revision = calculateDesignFileRevision(contents);
					let value: unknown;
					let read: DesignFileRead;
					try {
						value = JSON.parse(contents);
						read = this.toDesignFileRead({
							uuid,
							file,
							path: designPath,
							value,
							revision,
						});
					} catch (error) {
						// Unreadable designs stay listed with the reason, so a file
						// from a newer Trickroom does not silently disappear.
						const diagnostic = toDesignFileDiagnostic(error, value);
						if (!diagnostic) {
							throw error;
						}
						const raw =
							typeof value === "object" && value !== null
								? (value as Record<string, unknown>)
								: {};
						const summary = {
							uuid,
							file,
							name: typeof raw.name === "string" ? raw.name : uuid,
							boardsCount: Array.isArray(raw.boards) ? raw.boards.length : 0,
							layersCount: 0,
							modifiedAt: fileStat.mtime.toISOString(),
							revision,
							diagnostic,
						} satisfies DesignFileSummary;
						this.setCachedSummary(designPath, fileStat, summary);
						return summary;
					}

					const summary = {
						uuid,
						file,
						name: read.design.name,
						...(read.design.systemId !== undefined
							? { systemId: read.design.systemId }
							: {}),
						...(read.design.systemName !== undefined
							? { systemName: read.design.systemName }
							: {}),
						boardsCount: read.design.boards.length,
						layersCount: countDesignLayers(read.design),
						modifiedAt: fileStat.mtime.toISOString(),
						revision: read.revision,
					} satisfies DesignFileSummary;
					this.setCachedSummary(designPath, fileStat, summary);
					return summary;
				} catch {
					if (designPath) {
						this.deleteCachedSummary(designPath);
					}
					return null;
				}
			}),
		);

		return summaries.filter((summary) => summary !== null);
	}

	async writeDesignFile(
		designId: string,
		design: unknown,
		revisionCheck: RevisionCheck = {},
	): Promise<DesignFileWrite> {
		const designPath = this.getLegacyDesignPath(designId);
		const storedDesign = prepareDesignForStorage(design);

		await mkdir(this.designsDir, { recursive: true });
		const contents = await this.withWriteLock(designPath, async () => {
			let currentContents: string | null = null;
			try {
				currentContents = await readFile(designPath, "utf8");
			} catch (error) {
				// Unconditional writes may create the file; revision-checked writes
				// target an existing design and report it missing.
				if (
					revisionCheck.expectedRevision !== undefined ||
					(error as NodeJS.ErrnoException).code !== "ENOENT"
				) {
					throw error;
				}
			}

			if (
				revisionCheck.expectedRevision !== undefined &&
				currentContents !== null &&
				calculateDesignFileRevision(currentContents) !==
					revisionCheck.expectedRevision
			) {
				throw new DesignFileServiceError(
					"REVISION_MISMATCH",
					"Design file revision does not match the expected revision",
				);
			}

			// Never down-convert a design written by a newer Trickroom.
			const currentVersion =
				currentContents === null ? null : parseStoredVersion(currentContents);
			if (currentVersion !== null && currentVersion > DESIGN_FILE_VERSION) {
				throw new DesignFileServiceError(
					"UNSUPPORTED_DESIGN_VERSION",
					unsupportedDesignVersionMessage(currentVersion),
				);
			}

			return writeJsonFileAtomically(designPath, storedDesign);
		});
		this.deleteCachedSummary(designPath);
		await DesignFileService.pruneSummaryCache();
		return {
			file: getLegacyDesignFileName(designId),
			path: designPath,
			uuid: designId,
			design: withoutStorageVersion(storedDesign),
			revision: calculateDesignFileRevision(contents),
		};
	}

	/**
	 * The read-check-write every caller that changes an existing design goes
	 * through: reads the design, rejects a stale `expectedRevision`, applies
	 * `mutate`, prepares the result for storage and writes it guarded by the
	 * revision. A write that loses the race against another writer is reported
	 * as a revision mismatch carrying the revision now on disk.
	 */
	async updateDesignFile<
		Result extends { design: TrickroomDesign },
		Skip = never,
	>(
		designId: string,
		update: DesignFileUpdate<Result, Skip>,
	): Promise<DesignFileUpdateOutcome<Result, Skip>> {
		const read = await (update.read?.() ?? this.readDesignFile(designId));
		if (read.revision !== update.expectedRevision) {
			return {
				status: "revision-mismatch",
				expectedRevision: update.expectedRevision,
				currentRevision: read.revision,
			};
		}

		const result = await update.mutate(read);
		if (skippedDesignUpdate in result) {
			return { status: "skipped", read, value: result[skippedDesignUpdate] };
		}

		const design = update.prepare
			? await update.prepare(result.design)
			: result.design;
		try {
			const write = await this.writeDesignFile(designId, design, {
				expectedRevision: update.expectedRevision as DesignFileRevision,
			});
			return { status: "written", read, result, write };
		} catch (error) {
			if (
				error instanceof DesignFileServiceError &&
				error.code === "REVISION_MISMATCH"
			) {
				const current = await this.readRawDesign(designId);
				return {
					status: "revision-mismatch",
					expectedRevision: update.expectedRevision,
					currentRevision: current.revision,
				};
			}
			throw error;
		}
	}

	async createDesignFile(
		designId: string,
		design: unknown,
	): Promise<DesignFileWrite> {
		const designPath = this.getLegacyDesignPath(designId);
		const storedDesign = prepareDesignForStorage(design);

		await mkdir(this.designsDir, { recursive: true });
		let contents: string;
		try {
			contents = await this.withWriteLock(designPath, () =>
				writeJsonFileExclusivelyAtomically(designPath, storedDesign),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw new DesignFileServiceError(
					"DESIGN_FILE_ALREADY_EXISTS",
					`Design file already exists at ${designPath}`,
				);
			}
			throw error;
		}

		this.deleteCachedSummary(designPath);
		await DesignFileService.pruneSummaryCache();
		return {
			file: getLegacyDesignFileName(designId),
			path: designPath,
			uuid: designId,
			design: withoutStorageVersion(storedDesign),
			revision: calculateDesignFileRevision(contents),
		};
	}

	async deleteDesignFile(designId: string) {
		const designPath = this.getLegacyDesignPath(designId);
		await this.withWriteLock(designPath, () => unlink(designPath));
		this.deleteCachedSummary(designPath);
		await DesignFileService.pruneSummaryCache();
	}
}

export const createDesignFileService = (
	projectRoot: string,
	options?: DesignFileServiceOptions,
) => new DesignFileService(projectRoot, options);
