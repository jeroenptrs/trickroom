import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveTrickroomHome } from "../app-state/home";
import {
	isSerializedElement,
	isTrickroomDesign,
	readTrickroomDesignValue,
} from "../server-utils";
import type {
	DesignFileDiagnostic,
	DesignStorageWarning,
	Node,
	TrickroomDesign,
} from "../types";
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
import {
	commitDesignOperations,
	type DesignJournalHooks,
	replayDesignJournal,
} from "./design-journal";
import {
	type DesignWriteConflict,
	type DesignWritePlan,
	insertAfterPredecessors,
	planDesignWrite,
} from "./design-merge";
import {
	assignOrderKeys,
	compareStoredBoardOrder,
	generateOrderKeysBetween,
	isValidOrderKey,
} from "./design-order";
import {
	calculateBoardRevision,
	calculateDesignRevision,
	calculateManifestRevision,
	type DesignBoardRevision,
	decodeDesignRevision,
	decodeDesignRevisionParts,
	encodeDesignRevision,
	getDesignRevisionParts,
} from "./design-revision";
import {
	type DesignFileOperations,
	type DesignFiles,
	DesignJournalPendingError,
	type DesignPaths,
	DesignStorageBusyError,
	designConflictsDirectoryName,
	ensureDesignFolders,
	FOLDER_LAYOUT_VERSION,
	getBoardFilePath,
	getBoardIdFromFileName,
	getDesignPaths,
	inspectDesignStorage,
	isSafeBoardId,
	readDesignFiles,
	serializeBoardFile,
	serializeDesignManifest,
	serializeJson,
	toDesignRelativePath,
	unlinkIfPresent,
} from "./design-storage";

export type DesignFileServiceErrorCode =
	| "INVALID_DESIGN_FILE_PATH"
	| "INVALID_DESIGN_UUID"
	| "INVALID_DESIGN_PAYLOAD"
	| "UNSUPPORTED_DESIGN_VERSION"
	| "DESIGN_FILE_ALREADY_EXISTS"
	| "DESIGN_FILE_LOCKED"
	| "REVISION_MISMATCH";

/** Why a revision-checked write was refused. */
export type DesignRevisionMismatch = DesignWriteConflict & {
	/** The revision on disk when the write was refused. */
	currentRevision: DesignFileRevision;
};

export class DesignFileServiceError extends Error {
	readonly code: DesignFileServiceErrorCode;
	/** Set for `REVISION_MISMATCH`. */
	readonly mismatch?: DesignRevisionMismatch;

	constructor(
		code: DesignFileServiceErrorCode,
		message: string,
		mismatch?: DesignRevisionMismatch,
	) {
		super(message);
		this.name = "DesignFileServiceError";
		this.code = code;
		if (mismatch) {
			this.mismatch = mismatch;
		}
	}
}

const revisionMismatchMessage = (mismatch: DesignRevisionMismatch) => {
	const parts = [
		...(mismatch.staleBoardIds.length > 0
			? [`board ${mismatch.staleBoardIds.join(", ")}`]
			: []),
		...(mismatch.manifest ? ["design name or settings"] : []),
		...(mismatch.order ? ["board order"] : []),
	];
	return parts.length > 0
		? `Design file revision does not match the expected revision: ${parts.join("; ")} changed since it was read`
		: "Design file revision does not match the expected revision";
};

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
	/** Storage problems that do not stop the design from being read. */
	warnings?: DesignStorageWarning[];
};

export type DesignBoardRevisionEntry = {
	id: string;
	revision: DesignBoardRevision;
};

export type DesignFileRead = Omit<DesignJsonFileRead, "value"> & {
	/**
	 * The design migrated in memory to the current schema. Like every
	 * in-memory design it has no `version`; writes stamp it.
	 */
	design: TrickroomDesign;
	/** Each board's revision, in board order. */
	boards: DesignBoardRevisionEntry[];
	/**
	 * Version stored on disk (0 for files without one). When it is older than
	 * `DESIGN_FILE_VERSION`, the next write persists the current shape.
	 */
	storedVersion: number;
	migrated: boolean;
};

export type DesignFileWrite = {
	file: string;
	path: string;
	uuid: string;
	/**
	 * The stored design in its in-memory shape (without `version`). Other
	 * writers' changes to boards the caller did not touch are kept, so this can
	 * differ from the design that was written (see `merged`).
	 */
	design: TrickroomDesign;
	revision: DesignFileRevision;
	boards: DesignBoardRevisionEntry[];
	/** Whether `design` includes changes the caller's design did not have. */
	merged: boolean;
	/** Boards whose content changed (including new boards). */
	changedBoardIds: string[];
	deletedBoardIds: string[];
};

export type RevisionCheck = {
	/**
	 * The revision the caller read. Boards (and the manifest) the caller
	 * changed must be unchanged on disk since then; other boards may have
	 * changed and keep their current content.
	 */
	expectedRevision?: DesignFileRevision;
	/**
	 * A fresher revision the written design was derived from, when the caller
	 * re-read the design and applied its change to that read (as
	 * `updateDesignFile` does). Changes are detected against it, while
	 * `expectedRevision` still decides which boards the caller may change.
	 */
	baseRevision?: DesignFileRevision;
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
	 * Applies the change to a fresh read. The read may be newer than
	 * `expectedRevision`: changes to boards the caller did not touch are fine,
	 * changes to boards it does touch are a mismatch.
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
			/** Boards the caller changed that changed since its read. */
			staleBoardIds: string[];
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
	/** Test hooks run between the steps of a journaled write. */
	journalHooks?: DesignJournalHooks;
};

export const getDesignLockDirectory = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "locks", "designs");

/** What `migrateDesign` did (or, in a dry run, would do) to one design. */
export type DesignMigrationResult = {
	designId: string;
	/**
	 * `converted`: legacy file to folder. `reconciled`: folder and legacy file
	 * merged, legacy file removed. `current`: nothing to do. `skipped`: the
	 * design cannot be read (see `reason`) and was left alone.
	 */
	status: "converted" | "reconciled" | "current" | "skipped";
	reason?: string;
	name: string;
	boardCount: number;
	bytesBefore: number;
	bytesAfter: number;
	/** Paths relative to `designs/`. */
	filesWritten: string[];
	filesRemoved: string[];
	addedBoardIds: string[];
	conflictFiles: string[];
	/** Whether the design read back identical in memory (not in dry runs). */
	verified?: boolean;
};

/** One board read on its own, for callers that reload a single board. */
export type DesignBoardRead = {
	designId: string;
	board: Node;
	revision: DesignBoardRevision;
};

type DesignFileSummaryCacheEntry = {
	fingerprint: string;
	updatedAt: number;
	summary: DesignFileSummary;
};

const maxSummaryCacheAgeMs = 30 * 60 * 1000;

/** Hash of exact bytes, for designs that cannot be parsed into a design. */
export const calculateDesignFileRevision = (
	contents: string,
): DesignFileRevision =>
	`sha256:${createHash("sha256").update(contents).digest("hex")}`;

export const isSafeDesignId = (designId: string) =>
	designId.trim().length > 0 &&
	designId === designId.trim() &&
	designId !== "." &&
	designId !== ".." &&
	!designId.startsWith(".") &&
	!designId.includes("/") &&
	!designId.includes("\\");

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
 * Board ids name board files: each must be a safe file name, and no two may
 * differ only in case (they would share a file on case-insensitive disks).
 */
const assertStorableBoardIds = (design: TrickroomDesign) => {
	const seen = new Set<string>();
	for (const board of design.boards) {
		if (!isSafeBoardId(board.id)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_PAYLOAD",
				`Board id "${board.id}" cannot be used as a file name: use letters, digits, "-", "_" or "." (not first or last).`,
			);
		}
		const folded = board.id.toLowerCase();
		if (seen.has(folded)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_PAYLOAD",
				`Board id "${board.id}" is used by more than one board.`,
			);
		}
		seen.add(folded);
	}
};

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

	const prepared = orderDesignFileKeys(migration.value);
	assertStorableBoardIds(prepared);
	return prepared;
};

const withoutStorageVersion = ({
	version: _version,
	...design
}: TrickroomDesign): TrickroomDesign => design;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const toDesignFileDiagnostic = (
	error: unknown,
	version: number | null,
): DesignFileDiagnostic | null => {
	if (error instanceof SyntaxError) {
		return {
			code: "INVALID_DESIGN_JSON",
			message: `Design file is not valid JSON: ${error.message}`,
		};
	}
	if (
		error instanceof DesignFileServiceError &&
		(error.code === "UNSUPPORTED_DESIGN_VERSION" ||
			error.code === "INVALID_DESIGN_PAYLOAD")
	) {
		return {
			code: error.code,
			message: error.message,
			...(version !== null ? { version } : {}),
		};
	}

	return null;
};

export const countDesignLayers = (design: TrickroomDesign) =>
	design.boards.reduce(
		(count, board) => count + countDescendantLayers(board),
		0,
	);

const legacyDesignFileWarning = (designId: string): DesignStorageWarning => ({
	code: "LEGACY_DESIGN_FILE_PRESENT",
	message: `Both designs/${designId}/ and the older designs/${designId}.json exist (for example after a git merge). The folder is used; run "trickroom migrate" to reconcile and remove the old file.`,
});

/** A design's stored files, parsed and checked, before migration. */
type ParsedDesignFiles = {
	layout: "folder" | "legacy";
	/** The stored value assembled as one design object (with `version`). */
	value: unknown;
	/** Order key per board id (folder layout); null when missing or invalid. */
	orders: Map<string, string | null>;
	/** The highest version declared by any of the design's files. */
	version: number | null;
	/** Hash of every stored byte, for designs that cannot be read. */
	fallbackRevision: DesignFileRevision;
	/** Why the files do not form a design (before schema validation). */
	problem: DesignFileServiceError | null;
};

const parseJson = (contents: string, label: string): unknown => {
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new SyntaxError(
			`${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const parseDesignFiles = (
	designId: string,
	files: DesignFiles,
): ParsedDesignFiles => {
	if (files.layout === "legacy") {
		const value = parseJson(files.contents, `${designId}.json`);
		return {
			layout: "legacy",
			value,
			orders: new Map(),
			version: isRecord(value) ? getDesignFileVersion(value) : null,
			fallbackRevision: calculateDesignFileRevision(files.contents),
			problem: null,
		};
	}

	const fallbackRevision = calculateDesignFileRevision(
		[
			files.manifest,
			...files.boards.flatMap((board) => [board.name, board.contents]),
		].join("\u0000"),
	);
	const manifest = parseJson(files.manifest, `${designId}/design.json`);
	let problem: DesignFileServiceError | null = null;
	const invalid = (message: string) => {
		problem ??= new DesignFileServiceError("INVALID_DESIGN_PAYLOAD", message);
	};
	if (!isRecord(manifest)) {
		invalid(`${designId}/design.json must contain a JSON object.`);
	}
	const manifestVersion = isRecord(manifest)
		? getDesignFileVersion(manifest)
		: null;
	let version = manifestVersion;

	const boards: { id: string; order: unknown; node: unknown }[] = [];
	for (const file of files.boards) {
		const boardId = getBoardIdFromFileName(file.name);
		const label = `${designId}/boards/${file.name}`;
		const value = parseJson(file.contents, label);
		if (!isRecord(value) || !isRecord(value.board)) {
			invalid(`${label} must contain { version, order, board }.`);
			boards.push({ id: boardId, order: null, node: value });
			continue;
		}
		const boardVersion = getDesignFileVersion(value);
		if (boardVersion !== null && (version === null || boardVersion > version)) {
			version = boardVersion;
		}
		if (value.board.id !== boardId) {
			invalid(`${label} holds board "${String(value.board.id)}".`);
		}
		boards.push({ id: boardId, order: value.order, node: value.board });
	}

	if (version !== null && version > DESIGN_FILE_VERSION) {
		problem = new DesignFileServiceError(
			"UNSUPPORTED_DESIGN_VERSION",
			unsupportedDesignVersionMessage(version),
		);
	} else if (
		manifestVersion === null ||
		manifestVersion < FOLDER_LAYOUT_VERSION
	) {
		invalid(
			`${designId}/design.json must declare a version of at least ${FOLDER_LAYOUT_VERSION}.`,
		);
	}

	boards.sort(compareStoredBoardOrder);
	return {
		layout: "folder",
		value: {
			...(isRecord(manifest) ? manifest : {}),
			boards: boards.map((board) => board.node),
		},
		orders: new Map(
			boards.map((board) => [
				board.id,
				isValidOrderKey(board.order) ? board.order : null,
			]),
		),
		version,
		fallbackRevision,
		problem,
	};
};

type StoredDesign = {
	files: DesignFiles;
	parsed: ParsedDesignFiles;
	design: TrickroomDesign;
	storedVersion: number;
	migrated: boolean;
};

const toStoredDesign = (designId: string, files: DesignFiles): StoredDesign => {
	const parsed = parseDesignFiles(designId, files);
	if (parsed.problem) {
		throw parsed.problem;
	}
	const read = readTrickroomDesignValue(parsed.value);
	if (!read.ok) {
		throw new DesignFileServiceError(read.code, read.message);
	}
	return {
		files,
		parsed,
		design: read.design,
		storedVersion: read.fromVersion,
		migrated: read.migrated,
	};
};

export class DesignFileService {
	private static readonly summaryCache = new Map<
		string,
		DesignFileSummaryCacheEntry
	>();

	readonly projectRoot: string;
	readonly designsDir: string;
	readonly designsGitkeepPath: string;
	private readonly lockOptions: DesignFileLockOptions;
	private readonly journalHooks: DesignJournalHooks;
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
		this.journalHooks = options.journalHooks ?? {};
		DesignFileService.pruneSummaryCache();
	}

	/**
	 * Runs `operation` while holding the design's in-process queue and
	 * cross-process lock, which covers every file of the design (manifest,
	 * boards, memory and journal). The lock key resolves the project root
	 * through `realpath` so processes that reach the project through different
	 * symlinks still share one lock. It is derived from the legacy
	 * `designs/<id>.json` path, so it is the same lock older Trickroom
	 * versions take for the design. A journal left by an interrupted write is
	 * replayed before `operation` runs.
	 */
	async withDesignLock<T>(
		designId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const paths = this.getDesignPaths(designId);
		this.canonicalProjectRoot ??= realpath(this.projectRoot).catch(
			() => this.projectRoot,
		);
		const canonicalPath = path.join(
			await this.canonicalProjectRoot,
			path.relative(this.projectRoot, paths.legacy),
		);

		try {
			return await withDesignFileLock(
				canonicalPath,
				async () => {
					await replayDesignJournal(paths);
					return operation();
				},
				this.lockOptions,
			);
		} catch (error) {
			if (error instanceof DesignFileLockTimeoutError) {
				throw new DesignFileServiceError("DESIGN_FILE_LOCKED", error.message);
			}
			throw error;
		}
	}

	private static pruneSummaryCache(maxAgeMs = maxSummaryCacheAgeMs) {
		const staleBefore = Date.now() - maxAgeMs;
		for (const [key, entry] of DesignFileService.summaryCache) {
			if (entry.updatedAt < staleBefore) {
				DesignFileService.summaryCache.delete(key);
			}
		}
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

	/** Every path of a design's files. Only the service should use them. */
	getDesignPaths(designId: string): DesignPaths {
		return getDesignPaths(this.designsDir, this.assertDesignId(designId));
	}

	private describeLocation(paths: DesignPaths, layout: "folder" | "legacy") {
		return layout === "folder"
			? {
					file: toDesignRelativePath(paths, paths.manifest),
					path: paths.folder,
				}
			: { file: toDesignRelativePath(paths, paths.legacy), path: paths.legacy };
	}

	/**
	 * Reads a design's files as one consistent snapshot. When the lock-free
	 * read cannot get one (a multi-file write is in progress or was
	 * interrupted), it takes the design lock and reads again.
	 */
	private async loadDesignFiles(paths: DesignPaths): Promise<DesignFiles> {
		try {
			return await readDesignFiles(paths);
		} catch (error) {
			if (
				!(error instanceof DesignJournalPendingError) &&
				!(error instanceof DesignStorageBusyError)
			) {
				throw error;
			}
		}
		return this.withDesignLock(paths.designId, () =>
			this.readDesignFilesLocked(paths),
		);
	}

	/** Reads a design's files while holding its lock. */
	private async readDesignFilesLocked(paths: DesignPaths) {
		return readDesignFiles(paths);
	}

	/** The raw stored value of a design, before migration and validation. */
	async readRawDesign(designId: string): Promise<DesignJsonFileRead> {
		const paths = this.getDesignPaths(designId);
		const files = await this.loadDesignFiles(paths);
		const parsed = parseDesignFiles(designId, files);
		const design = parsed.problem
			? null
			: readTrickroomDesignValue(parsed.value);

		return {
			uuid: designId,
			...this.describeLocation(paths, files.layout),
			value: parsed.value,
			// Designs that cannot be read fall back to a hash of the stored bytes,
			// which still lets a caller replace exactly what it saw.
			revision: design?.ok
				? calculateDesignRevision(design.design)
				: parsed.fallbackRevision,
			...(files.layout === "folder" && files.legacyPresent
				? { warnings: [legacyDesignFileWarning(designId)] }
				: {}),
		};
	}

	/** @deprecated Use `readRawDesign`. */
	readJsonFile(designId: string) {
		return this.readRawDesign(designId);
	}

	async readDesignFile(designId: string): Promise<DesignFileRead> {
		const paths = this.getDesignPaths(designId);
		const stored = toStoredDesign(designId, await this.loadDesignFiles(paths));
		return this.toDesignFileRead(paths, stored);
	}

	private toDesignFileRead(
		paths: DesignPaths,
		stored: StoredDesign,
	): DesignFileRead {
		const parts = getDesignRevisionParts(stored.design);
		return {
			uuid: paths.designId,
			...this.describeLocation(paths, stored.files.layout),
			design: stored.design,
			revision: encodeDesignRevision(parts),
			boards: parts.boards,
			storedVersion: stored.storedVersion,
			migrated: stored.migrated,
			...(stored.files.layout === "folder" && stored.files.legacyPresent
				? { warnings: [legacyDesignFileWarning(paths.designId)] }
				: {}),
		};
	}

	/**
	 * Reads one board with its revision. In the folder layout only that
	 * board's file is read.
	 */
	async readDesignBoard(
		designId: string,
		boardId: string,
	): Promise<DesignBoardRead | null> {
		const paths = this.getDesignPaths(designId);
		if (!isSafeBoardId(boardId)) {
			return null;
		}
		const state = await inspectDesignStorage(paths);
		if (state.folder && !state.journal) {
			let contents: string;
			try {
				contents = await readFile(getBoardFilePath(paths, boardId), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				throw error;
			}
			const value = parseJson(contents, `${designId}/boards/${boardId}.json`);
			const boardVersion = isRecord(value) ? getDesignFileVersion(value) : null;
			if (boardVersion !== null && boardVersion > DESIGN_FILE_VERSION) {
				throw new DesignFileServiceError(
					"UNSUPPORTED_DESIGN_VERSION",
					unsupportedDesignVersionMessage(boardVersion),
				);
			}
			if (
				!isRecord(value) ||
				!isSerializedElement(value.board) ||
				value.board.id !== boardId
			) {
				throw new DesignFileServiceError(
					"INVALID_DESIGN_PAYLOAD",
					`${designId}/boards/${boardId}.json does not hold board "${boardId}".`,
				);
			}
			return {
				designId,
				board: value.board,
				revision: calculateBoardRevision(value.board),
			};
		}

		const read = await this.readDesignFile(designId);
		const board = read.design.boards.find((entry) => entry.id === boardId);
		return board
			? { designId, board, revision: calculateBoardRevision(board) }
			: null;
	}

	private getCachedSummary(key: string, fingerprint: string) {
		const cached = DesignFileService.summaryCache.get(key);
		if (cached?.fingerprint === fingerprint) {
			cached.updatedAt = Date.now();
			return cached.summary;
		}
		return null;
	}

	private setCachedSummary(
		key: string,
		fingerprint: string,
		summary: DesignFileSummary,
	) {
		DesignFileService.summaryCache.set(key, {
			fingerprint,
			updatedAt: Date.now(),
			summary,
		});
	}

	private deleteCachedSummary(paths: DesignPaths) {
		DesignFileService.summaryCache.delete(paths.folder);
	}

	/** Ids of every design in `designs/`, in either layout, readable or not. */
	async listDesignIds() {
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

		const ids = new Set<string>();
		for (const entry of directoryEntries) {
			if (entry.name.startsWith(".")) {
				continue;
			}
			if (entry.isDirectory()) {
				ids.add(entry.name);
			} else if (
				entry.isFile() &&
				entry.name.endsWith(".json") &&
				!entry.name.endsWith(".memory.json")
			) {
				ids.add(entry.name.slice(0, -".json".length));
			}
		}
		return [...ids].filter(isSafeDesignId).sort();
	}

	async listDesignSummaries(): Promise<DesignFileSummary[]> {
		DesignFileService.pruneSummaryCache();
		const designIds = await this.listDesignIds();

		const summaries = await Promise.all(
			designIds.map(async (uuid) => {
				const paths = this.getDesignPaths(uuid);
				try {
					const state = await inspectDesignStorage(paths);
					if (!state.folder && !state.legacy && !state.journal) {
						// A folder without design files (for example leftover
						// conflicts) is not a design.
						return null;
					}
					if (!state.journal) {
						const cached = this.getCachedSummary(
							paths.folder,
							state.fingerprint,
						);
						if (cached) {
							return cached;
						}
					}

					const files = await this.loadDesignFiles(paths);
					const summary = this.summarizeDesignFiles(paths, files);
					this.setCachedSummary(paths.folder, files.fingerprint, summary);
					return summary;
				} catch {
					this.deleteCachedSummary(paths);
					return null;
				}
			}),
		);

		return summaries.filter((summary) => summary !== null);
	}

	private summarizeDesignFiles(
		paths: DesignPaths,
		files: DesignFiles,
	): DesignFileSummary {
		const location = this.describeLocation(paths, files.layout);
		const modifiedAt = files.modifiedAt.toISOString();
		const warnings =
			files.layout === "folder" && files.legacyPresent
				? { warnings: [legacyDesignFileWarning(paths.designId)] }
				: {};
		let parsed: ParsedDesignFiles | null = null;
		try {
			parsed = parseDesignFiles(paths.designId, files);
			const stored = toStoredDesign(paths.designId, files);
			const read = this.toDesignFileRead(paths, stored);
			return {
				uuid: paths.designId,
				file: location.file,
				name: read.design.name,
				...(read.design.systemId !== undefined
					? { systemId: read.design.systemId }
					: {}),
				...(read.design.systemName !== undefined
					? { systemName: read.design.systemName }
					: {}),
				boardsCount: read.design.boards.length,
				layersCount: countDesignLayers(read.design),
				modifiedAt,
				revision: read.revision,
				...warnings,
			};
		} catch (error) {
			// Unreadable designs stay listed with the reason, so a design from a
			// newer Trickroom does not silently disappear.
			const diagnostic = toDesignFileDiagnostic(error, parsed?.version ?? null);
			if (!diagnostic) {
				throw error;
			}
			const raw = isRecord(parsed?.value) ? parsed.value : {};
			return {
				uuid: paths.designId,
				file: location.file,
				name: typeof raw.name === "string" ? raw.name : paths.designId,
				boardsCount: Array.isArray(raw.boards) ? raw.boards.length : 0,
				layersCount: 0,
				modifiedAt,
				revision:
					parsed?.fallbackRevision ??
					calculateDesignFileRevision(
						files.layout === "legacy" ? files.contents : files.manifest,
					),
				diagnostic,
				...warnings,
			};
		}
	}

	/**
	 * Reads the design for a write, holding the lock. Returns null when the
	 * design does not exist.
	 */
	private async readForWrite(paths: DesignPaths) {
		let files: DesignFiles;
		try {
			files = await this.readDesignFilesLocked(paths);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
		const parsed = parseDesignFiles(paths.designId, files);
		// Never down-convert a design written by a newer Trickroom.
		if (parsed.version !== null && parsed.version > DESIGN_FILE_VERSION) {
			throw new DesignFileServiceError(
				"UNSUPPORTED_DESIGN_VERSION",
				unsupportedDesignVersionMessage(parsed.version),
			);
		}
		const read = parsed.problem ? null : readTrickroomDesignValue(parsed.value);
		return {
			files,
			parsed,
			design: read?.ok ? read.design : null,
		};
	}

	async writeDesignFile(
		designId: string,
		design: unknown,
		revisionCheck: RevisionCheck = {},
	): Promise<DesignFileWrite> {
		const paths = this.getDesignPaths(designId);
		const incoming = withoutStorageVersion(prepareDesignForStorage(design));

		const written = await this.withDesignLock(designId, async () => {
			const current = await this.readForWrite(paths);
			if (!current && revisionCheck.expectedRevision !== undefined) {
				// Revision-checked writes target an existing design.
				throw notFoundError(designId);
			}

			let plan: DesignWritePlan | null = null;
			if (current?.design) {
				plan = this.planWrite(current.design, incoming, revisionCheck);
			} else if (
				current &&
				revisionCheck.expectedRevision !== undefined &&
				revisionCheck.expectedRevision !== current.parsed.fallbackRevision
			) {
				// A design that cannot be read can only be replaced by a caller
				// that saw exactly these bytes.
				throw new DesignFileServiceError(
					"REVISION_MISMATCH",
					"Design file revision does not match the expected revision",
					{
						currentRevision: current.parsed.fallbackRevision,
						staleBoardIds: [],
						manifest: false,
						order: false,
					},
				);
			}

			const next = plan?.design ?? incoming;
			await this.storeDesign(paths, current, next, plan);
			return { design: next, plan };
		});
		this.deleteCachedSummary(paths);
		const parts = getDesignRevisionParts(written.design);
		return {
			...this.describeLocation(paths, "folder"),
			uuid: designId,
			design: written.design,
			revision: encodeDesignRevision(parts),
			boards: parts.boards,
			merged: written.plan?.merged ?? false,
			changedBoardIds:
				written.plan?.changedBoardIds ??
				written.design.boards.map((board) => board.id),
			deletedBoardIds: written.plan?.deletedBoardIds ?? [],
		};
	}

	/**
	 * Merges a write into the stored design. Revision-checked writes throw
	 * `REVISION_MISMATCH` naming what the caller changed that is stale;
	 * unconditional writes replace the design, compared against what is
	 * stored only to find which files change.
	 */
	private planWrite(
		current: TrickroomDesign,
		incoming: TrickroomDesign,
		{ expectedRevision, baseRevision }: RevisionCheck,
	) {
		if (expectedRevision === undefined) {
			return planDesignWrite({
				current,
				incoming,
				base: decodeDesignRevisionParts(getDesignRevisionParts(current)),
			});
		}

		const expected = decodeDesignRevision(expectedRevision);
		const plan = planDesignWrite({
			current,
			incoming,
			...(baseRevision !== undefined
				? { base: decodeDesignRevision(baseRevision), expected }
				: { base: expected }),
		});
		if (plan.conflict) {
			const mismatch = {
				...plan.conflict,
				currentRevision: calculateDesignRevision(current),
			};
			throw new DesignFileServiceError(
				"REVISION_MISMATCH",
				revisionMismatchMessage(mismatch),
				mismatch,
			);
		}
		return plan;
	}

	/**
	 * Writes `next` in the folder layout, touching only the files that change:
	 * the manifest when a top-level field changed, a board file when its board
	 * or its order key changed, and an unlink per deleted board. A design still
	 * in the legacy layout (or one that could not be read) is written in full
	 * and its legacy file removed. Must run under the design lock.
	 */
	private async storeDesign(
		paths: DesignPaths,
		current: Awaited<ReturnType<DesignFileService["readForWrite"]>>,
		next: TrickroomDesign,
		plan: DesignWritePlan | null,
	) {
		await this.applyOperations(
			paths,
			await this.buildStoreOperations(paths, current, next, plan),
		);
	}

	private async buildStoreOperations(
		paths: DesignPaths,
		current: Awaited<ReturnType<DesignFileService["readForWrite"]>>,
		next: TrickroomDesign,
		plan: DesignWritePlan | null,
	): Promise<DesignFileOperations> {
		const operations: DesignFileOperations = { writes: [], unlinks: [] };
		const incremental =
			current !== null &&
			current.files.layout === "folder" &&
			current.design !== null &&
			plan !== null;

		if (incremental) {
			const changed = new Set(plan.changedBoardIds);
			const keys = assignOrderKeys(
				next.boards.map((board) => ({
					id: board.id,
					key: current.parsed.orders.get(board.id) ?? null,
				})),
			);
			for (const board of next.boards) {
				const key = keys.get(board.id) as string;
				if (
					changed.has(board.id) ||
					current.parsed.orders.get(board.id) !== key
				) {
					operations.writes.push({
						path: getBoardFilePath(paths, board.id),
						contents: serializeBoardFile(board, key),
					});
				}
			}
			if (
				plan.manifestChanged ||
				current.parsed.version !== DESIGN_FILE_VERSION
			) {
				operations.writes.push({
					path: paths.manifest,
					contents: serializeDesignManifest(next),
				});
			}
			for (const boardId of plan.deletedBoardIds) {
				operations.unlinks.push(getBoardFilePath(paths, boardId));
			}
		} else {
			const keys = generateOrderKeysBetween(null, null, next.boards.length);
			next.boards.forEach((board, index) => {
				operations.writes.push({
					path: getBoardFilePath(paths, board.id),
					contents: serializeBoardFile(board, keys[index] as string),
				});
			});
			operations.writes.push({
				path: paths.manifest,
				contents: serializeDesignManifest(next),
			});
			// Board files of an earlier, unreadable or half-written folder.
			const kept = new Set(
				next.boards.map((board) => getBoardFilePath(paths, board.id)),
			);
			const state = await inspectDesignStorage(paths);
			for (const name of state.boardFiles) {
				const boardPath = path.join(paths.boards, name);
				if (!kept.has(boardPath)) {
					operations.unlinks.push(boardPath);
				}
			}
			if (current?.files.layout === "legacy") {
				operations.unlinks.push(paths.legacy);
			}
		}

		return operations;
	}

	private async applyOperations(
		paths: DesignPaths,
		operations: DesignFileOperations,
	) {
		if (operations.writes.length > 0) {
			await ensureDesignFolders(paths);
		}
		await commitDesignOperations(paths, operations, this.journalHooks);
	}

	/**
	 * The read-check-write every caller that changes an existing design goes
	 * through: reads the design, applies `mutate` to that read, prepares the
	 * result for storage and writes it checked against the caller's
	 * `expectedRevision` at board level. A change to a board (or the manifest,
	 * or the order) that another writer changed since the caller's revision is
	 * reported as a revision mismatch carrying the revision now on disk.
	 */
	async updateDesignFile<
		Result extends { design: TrickroomDesign },
		Skip = never,
	>(
		designId: string,
		update: DesignFileUpdate<Result, Skip>,
	): Promise<DesignFileUpdateOutcome<Result, Skip>> {
		const read = await (update.read?.() ?? this.readDesignFile(designId));
		const result = await update.mutate(read);
		if (skippedDesignUpdate in result) {
			return { status: "skipped", read, value: result[skippedDesignUpdate] };
		}

		const design = update.prepare
			? await update.prepare(result.design)
			: result.design;
		try {
			const write = await this.writeDesignFile(designId, design, {
				expectedRevision: update.expectedRevision,
				baseRevision: read.revision,
			});
			return { status: "written", read, result, write };
		} catch (error) {
			if (
				!(error instanceof DesignFileServiceError) ||
				error.code !== "REVISION_MISMATCH"
			) {
				throw error;
			}
			// A board this write changes was changed by another writer after the
			// caller's revision (possibly after this read): the caller re-reads.
			// Retrying cannot help, because the caller's revision stays stale for
			// that board.
			return {
				status: "revision-mismatch",
				expectedRevision: update.expectedRevision,
				currentRevision:
					error.mismatch?.currentRevision ??
					(await this.readRawDesign(designId)).revision,
				staleBoardIds: error.mismatch?.staleBoardIds ?? [],
			};
		}
	}

	/**
	 * Brings one design to the current layout: converts a legacy single-file
	 * design to the folder layout, or reconciles a folder that coexists with
	 * an older single file (for example after a git merge). Reconciling adds
	 * boards that only the old file has, saves boards that differ to
	 * `<id>/conflicts/<boardId>.json` (and differing top-level fields to
	 * `conflicts/design.json`) and removes the old file. The folder's version
	 * of everything wins. With `dryRun` nothing is written. Every write is one
	 * journaled operation, and the design is read back and compared.
	 */
	async migrateDesign(
		designId: string,
		{ dryRun = false }: { dryRun?: boolean } = {},
	): Promise<DesignMigrationResult> {
		const paths = this.getDesignPaths(designId);
		const run = async (): Promise<DesignMigrationResult> => {
			const files = await readDesignFiles(paths);
			const result: DesignMigrationResult = {
				designId,
				status: "current",
				name: designId,
				boardCount: 0,
				bytesBefore: await this.measureDesignBytes(paths),
				bytesAfter: 0,
				filesWritten: [],
				filesRemoved: [],
				addedBoardIds: [],
				conflictFiles: [],
			};
			let stored: StoredDesign;
			try {
				stored = toStoredDesign(designId, files);
			} catch (error) {
				return {
					...result,
					status: "skipped",
					reason: error instanceof Error ? error.message : String(error),
					bytesAfter: result.bytesBefore,
				};
			}
			result.name = stored.design.name;
			result.boardCount = stored.design.boards.length;

			let operations: DesignFileOperations;
			let expected: TrickroomDesign;
			if (files.layout === "legacy") {
				result.status = "converted";
				expected = stored.design;
				operations = await this.buildStoreOperations(
					paths,
					{ files, parsed: stored.parsed, design: stored.design },
					stored.design,
					null,
				);
			} else if (files.legacyPresent) {
				const reconciled = await this.planReconcile(paths, stored);
				if ("reason" in reconciled) {
					return {
						...result,
						status: "skipped",
						reason: reconciled.reason,
						bytesAfter: result.bytesBefore,
					};
				}
				result.status = "reconciled";
				result.addedBoardIds = reconciled.addedBoardIds;
				expected = reconciled.design;
				operations = reconciled.operations;
			} else {
				return { ...result, bytesAfter: result.bytesBefore };
			}

			result.filesWritten = operations.writes.map((write) =>
				toDesignRelativePath(paths, write.path),
			);
			result.filesRemoved = operations.unlinks.map((unlinkPath) =>
				toDesignRelativePath(paths, unlinkPath),
			);
			result.conflictFiles = result.filesWritten.filter((file) =>
				file.startsWith(`${designId}/${designConflictsDirectoryName}/`),
			);
			result.boardCount = expected.boards.length;
			if (dryRun) {
				result.bytesAfter =
					result.bytesBefore +
					operations.writes.reduce(
						(total, write) => total + Buffer.byteLength(write.contents),
						0,
					) -
					(await this.measureFiles(operations.unlinks));
				return result;
			}

			await this.applyOperations(paths, operations);
			this.deleteCachedSummary(paths);
			const after = toStoredDesign(designId, await readDesignFiles(paths));
			result.verified = isDeepStrictEqual(after.design, expected);
			result.bytesAfter = await this.measureDesignBytes(paths);
			return result;
		};

		return dryRun ? run() : this.withDesignLock(designId, run);
	}

	/**
	 * Reconciles a folder design with the legacy file next to it (see
	 * `migrateDesign`).
	 */
	private async planReconcile(paths: DesignPaths, folder: StoredDesign) {
		let legacy: TrickroomDesign;
		try {
			const value = parseJson(
				await readFile(paths.legacy, "utf8"),
				`${paths.designId}.json`,
			);
			const read = readTrickroomDesignValue(value);
			if (!read.ok) {
				return {
					reason: `The old ${paths.designId}.json cannot be read: ${read.message}`,
				};
			}
			legacy = read.design;
		} catch (error) {
			return {
				reason: error instanceof Error ? error.message : String(error),
			};
		}

		const folderIds = new Set<string>();
		for (const board of folder.design.boards) {
			collectNodeIds(board, folderIds);
		}
		const folderBoards = new Map(
			folder.design.boards.map((board) => [board.id, board]),
		);
		const added: Node[] = [];
		const conflicts: Node[] = [];
		for (const board of legacy.boards) {
			const existing = folderBoards.get(board.id);
			if (existing) {
				if (
					calculateBoardRevision(existing) !== calculateBoardRevision(board)
				) {
					conflicts.push(board);
				}
				continue;
			}
			// A board whose ids already exist elsewhere in the folder (for
			// example demoted to a layer on the other branch) cannot be added.
			const ids = collectNodeIds(board, new Set());
			if (
				!isSafeBoardId(board.id) ||
				[...ids].some((id) => folderIds.has(id))
			) {
				conflicts.push(board);
				continue;
			}
			for (const id of ids) folderIds.add(id);
			added.push(board);
		}

		const addedIds = added.map((board) => board.id);
		const sequence = insertAfterPredecessors(
			folder.design.boards.map((board) => board.id),
			addedIds,
			legacy.boards.map((board) => board.id),
		);
		const addedById = new Map(added.map((board) => [board.id, board]));
		const design: TrickroomDesign = {
			...folder.design,
			boards: sequence.map(
				(id) => (folderBoards.get(id) ?? addedById.get(id)) as Node,
			),
		};
		const operations = await this.buildStoreOperations(
			paths,
			{ files: folder.files, parsed: folder.parsed, design: folder.design },
			design,
			planDesignWrite({
				current: folder.design,
				incoming: design,
				base: decodeDesignRevisionParts(getDesignRevisionParts(folder.design)),
			}),
		);

		const existingConflicts = new Set(
			(await readdir(paths.conflicts).catch(() => [] as string[])).map(
				(name) => name,
			),
		);
		const conflictPath = (name: string) => {
			let candidate = `${name}.json`;
			for (let index = 2; existingConflicts.has(candidate); index += 1) {
				candidate = `${name}.${index}.json`;
			}
			existingConflicts.add(candidate);
			return path.join(paths.conflicts, candidate);
		};
		for (const board of conflicts) {
			operations.writes.push({
				path: conflictPath(isSafeBoardId(board.id) ? board.id : "board"),
				contents: serializeJson({
					version: DESIGN_FILE_VERSION,
					source: `${paths.designId}.json`,
					board,
				}),
			});
		}
		if (
			calculateManifestRevision(legacy) !==
			calculateManifestRevision(folder.design)
		) {
			operations.writes.push({
				path: conflictPath("design"),
				contents: serializeDesignManifest(legacy),
			});
		}
		operations.unlinks.push(paths.legacy);
		return { design, operations, addedBoardIds: addedIds };
	}

	private async measureFiles(filePaths: readonly string[]) {
		const sizes = await Promise.all(
			filePaths.map((filePath) =>
				stat(filePath).then(
					(fileStat) => fileStat.size,
					() => 0,
				),
			),
		);
		return sizes.reduce((total, size) => total + size, 0);
	}

	/** Bytes of a design's files: the legacy file, manifest and boards. */
	private async measureDesignBytes(paths: DesignPaths) {
		const state = await inspectDesignStorage(paths);
		return this.measureFiles([
			paths.legacy,
			paths.manifest,
			...state.boardFiles.map((name) => path.join(paths.boards, name)),
		]);
	}

	async createDesignFile(
		designId: string,
		design: unknown,
	): Promise<DesignFileWrite> {
		const paths = this.getDesignPaths(designId);
		const created = withoutStorageVersion(prepareDesignForStorage(design));

		await this.withDesignLock(designId, async () => {
			const state = await inspectDesignStorage(paths);
			if (state.folder || state.journal || state.legacy) {
				throw new DesignFileServiceError(
					"DESIGN_FILE_ALREADY_EXISTS",
					`Design "${designId}" already exists`,
				);
			}
			await this.storeDesign(paths, null, created, null);
		});

		this.deleteCachedSummary(paths);
		const parts = getDesignRevisionParts(created);
		return {
			...this.describeLocation(paths, "folder"),
			uuid: designId,
			design: created,
			revision: encodeDesignRevision(parts),
			boards: parts.boards,
			merged: false,
			changedBoardIds: created.boards.map((board) => board.id),
			deletedBoardIds: [],
		};
	}

	async deleteDesignFile(designId: string) {
		const paths = this.getDesignPaths(designId);
		await this.withDesignLock(designId, async () => {
			const state = await inspectDesignStorage(paths);
			if (!state.folder && !state.legacy && !state.journal) {
				throw notFoundError(designId);
			}
			// The legacy file goes first and the folder disappears in one rename,
			// so an interrupted delete leaves a whole design, never part of one.
			await unlinkIfPresent(paths.legacy);
			const trash = path.join(
				this.designsDir,
				`.${designId}.deleted-${randomUUID()}`,
			);
			try {
				await rename(paths.folder, trash);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
				return;
			}
			await rm(trash, { recursive: true, force: true });
		});
		this.deleteCachedSummary(paths);
	}
}

const collectNodeIds = (node: Node, ids: Set<string>) => {
	const stack = [node];
	while (stack.length > 0) {
		const current = stack.pop() as Node;
		ids.add(current.id);
		if (Array.isArray(current.children)) {
			stack.push(...current.children);
		}
	}
	return ids;
};

const notFoundError = (designId: string) =>
	Object.assign(new Error(`Design "${designId}" not found`), {
		code: "ENOENT",
	});

export const createDesignFileService = (
	projectRoot: string,
	options?: DesignFileServiceOptions,
) => new DesignFileService(projectRoot, options);
