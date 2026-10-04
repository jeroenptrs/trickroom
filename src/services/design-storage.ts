import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Node, TrickroomDesign } from "../types";
import { DESIGN_FILE_VERSION, orderDesignFileKeys } from "./design-file-schema";

/**
 * On-disk layout of a design.
 *
 * Current (folder) layout, from design file version 2:
 *
 *   designs/<designId>/
 *     design.json            manifest: version, name, systemId, other fields
 *     boards/<boardId>.json  one board: version, order key, board node tree
 *     memory.json            design memory notes
 *
 * The set of boards is the listing of `boards/`, so adding or removing a
 * board touches only that board's file. Legacy layout (versions 0 and 1):
 * one `designs/<designId>.json` holding the whole design. Reads accept both;
 * writes always produce the folder layout.
 */

/** First design file version stored as a folder. */
export const FOLDER_LAYOUT_VERSION = 2;

export const designManifestFileName = "design.json";
export const designBoardsDirectoryName = "boards";
export const designMemoryFileName = "memory.json";
export const designJournalFileName = ".journal.json";
export const designConflictsDirectoryName = "conflicts";

const jsonExtension = ".json";
const legacyMemorySuffix = ".memory.json";

export type DesignPaths = {
	designId: string;
	designsDir: string;
	/** `designs/<id>/` */
	folder: string;
	manifest: string;
	boards: string;
	memory: string;
	journal: string;
	conflicts: string;
	/** `designs/<id>.json`, the legacy single-file layout. */
	legacy: string;
	/** `designs/<id>.memory.json`, legacy design memory. */
	legacyMemory: string;
};

export const getDesignPaths = (
	designsDir: string,
	designId: string,
): DesignPaths => {
	const folder = path.join(designsDir, designId);
	return {
		designId,
		designsDir,
		folder,
		manifest: path.join(folder, designManifestFileName),
		boards: path.join(folder, designBoardsDirectoryName),
		memory: path.join(folder, designMemoryFileName),
		journal: path.join(folder, designJournalFileName),
		conflicts: path.join(folder, designConflictsDirectoryName),
		legacy: path.join(designsDir, `${designId}${jsonExtension}`),
		legacyMemory: path.join(designsDir, `${designId}${legacyMemorySuffix}`),
	};
};

export const getBoardFilePath = (paths: DesignPaths, boardId: string) =>
	path.join(paths.boards, `${boardId}${jsonExtension}`);

/** Path of a design file relative to `designs/`, with forward slashes. */
export const toDesignRelativePath = (paths: DesignPaths, filePath: string) =>
	path.relative(paths.designsDir, filePath).split(path.sep).join("/");

const unsafeFileNameCharacters = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * Board ids name board files, so they must be usable as a file name on every
 * platform: one path segment, no reserved characters, not hidden.
 */
export const isSafeBoardId = (boardId: string) =>
	boardId.length > 0 &&
	boardId.length <= 200 &&
	!boardId.startsWith(".") &&
	!boardId.endsWith(".") &&
	boardId === boardId.trim() &&
	!unsafeFileNameCharacters.test(boardId);

const isBoardFileName = (name: string) =>
	name.endsWith(jsonExtension) &&
	!name.startsWith(".") &&
	isSafeBoardId(name.slice(0, -jsonExtension.length));

export const serializeJson = (value: unknown) =>
	`${JSON.stringify(value, null, "\t")}\n`;

/** `design.json`: every top-level design field except `boards`. */
export const serializeDesignManifest = (design: TrickroomDesign) => {
	const { boards: _boards, ...manifest } = orderDesignFileKeys({
		...design,
		version: DESIGN_FILE_VERSION,
	});
	return serializeJson(manifest);
};

/** `boards/<id>.json`: the version, the order key and the board tree. */
export const serializeBoardFile = (board: Node, order: string) =>
	serializeJson({ version: DESIGN_FILE_VERSION, order, board });

export type StoredFile = {
	name: string;
	contents: string;
	/** Identity of the file read (inode, size, times); changes with its bytes. */
	fingerprint: string;
	/** Whether `fingerprint` is settled (see `isSettledStat`). */
	settled: boolean;
};

export type FolderDesignFiles = {
	layout: "folder";
	manifest: string;
	boards: StoredFile[];
	legacyPresent: boolean;
	modifiedAt: Date;
	fingerprint: string;
};

export type LegacyDesignFiles = {
	layout: "legacy";
	contents: string;
	modifiedAt: Date;
	fingerprint: string;
};

export type DesignFiles = FolderDesignFiles | LegacyDesignFiles;

const statOrNull = async (filePath: string) => {
	try {
		return await stat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
};

const readdirOrEmpty = async (directory: string) => {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return [];
		}
		throw error;
	}
};

const describeStat = (name: string, fileStat: Stats | null) =>
	fileStat
		? `${name}:${fileStat.ino}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`
		: `${name}:-`;

/**
 * How long after its last change a file's identity (inode, size, times) is
 * trusted to change with its bytes. File times have a granularity (from a
 * few milliseconds up to two seconds, depending on the file system), and an
 * atomic rename can reuse a just-freed inode, so a file replaced within one
 * tick by one of the same size can look identical. Once a file is older
 * than the coarsest granularity at the time it is observed, any later change
 * gets a later time.
 */
export const settledFileAgeMs = 2_000;

/**
 * Whether a file observed at `observedAt` (taken before the stat) is old
 * enough that its fingerprint identifies its contents (see
 * `settledFileAgeMs`). Caches keyed on a fingerprint only take settled
 * observations.
 */
export const isSettledStat = (fileStat: Stats, observedAt: number) =>
	observedAt - Math.max(fileStat.mtimeMs, fileStat.ctimeMs) > settledFileAgeMs;

export type DesignStorageState = {
	/** `design.json` exists, so the folder layout applies. */
	folder: boolean;
	/** A multi-file write was interrupted (or is in progress). */
	journal: boolean;
	legacy: boolean;
	boardFiles: string[];
	/** Fingerprint per entry of `boardFiles`. */
	boardFingerprints: string[];
	/** Whether each entry of `boardFiles` is settled (see `isSettledStat`). */
	boardSettled: boolean[];
	modifiedAt: Date;
	/**
	 * Changes whenever any file of the design is replaced or edited (atomic
	 * renames change the inode). Used to detect torn reads and to key caches.
	 */
	fingerprint: string;
};

export const inspectDesignStorage = async (
	paths: DesignPaths,
): Promise<DesignStorageState> => {
	const observedAt = Date.now();
	const [manifestStat, journalStat, legacyStat, boardEntries] =
		await Promise.all([
			statOrNull(paths.manifest),
			statOrNull(paths.journal),
			statOrNull(paths.legacy),
			readdirOrEmpty(paths.boards),
		]);
	const boardFiles = boardEntries
		.filter((entry) => entry.isFile() && isBoardFileName(entry.name))
		.map((entry) => entry.name)
		.sort();
	const boardStats = await Promise.all(
		boardFiles.map((name) => statOrNull(path.join(paths.boards, name))),
	);
	const stats = [manifestStat, legacyStat, ...boardStats].filter(
		(entry): entry is Stats => entry !== null,
	);
	const boardFingerprints = boardFiles.map((name, index) =>
		describeStat(name, boardStats[index] ?? null),
	);
	return {
		folder: manifestStat !== null,
		journal: journalStat !== null,
		legacy: legacyStat !== null,
		boardFiles,
		boardFingerprints,
		boardSettled: boardStats.map(
			(boardStat) => boardStat !== null && isSettledStat(boardStat, observedAt),
		),
		modifiedAt: new Date(Math.max(0, ...stats.map((entry) => entry.mtimeMs))),
		fingerprint: [
			describeStat(designManifestFileName, manifestStat),
			describeStat(designJournalFileName, journalStat),
			describeStat("legacy", legacyStat),
			...boardFingerprints,
		].join("|"),
	};
};

export class DesignStorageBusyError extends Error {
	constructor() {
		super("Design files kept changing while being read");
		this.name = "DesignStorageBusyError";
	}
}

/** Thrown when an interrupted multi-file write must be replayed first. */
export class DesignJournalPendingError extends Error {
	constructor() {
		super("Design has an unfinished multi-file write");
		this.name = "DesignJournalPendingError";
	}
}

const notFound = (paths: DesignPaths) =>
	Object.assign(new Error(`Design "${paths.designId}" not found`), {
		code: "ENOENT",
	});

const maxConsistentReadAttempts = 5;

const maxCachedBoardLength = 32 * 1024 * 1024;
/**
 * Contents of settled board files by path, valid while the file keeps the
 * fingerprint it had when read. Strings are immutable, so a cached file is
 * as good as a fresh read; only parsing it remains.
 */
const boardContentsCache = new Map<
	string,
	{ fingerprint: string; contents: string }
>();
let cachedBoardLength = 0;

const forgetBoardContents = (filePath: string) => {
	const cached = boardContentsCache.get(filePath);
	if (cached) {
		boardContentsCache.delete(filePath);
		cachedBoardLength -= cached.contents.length;
	}
};

const rememberBoardContents = (
	filePath: string,
	fingerprint: string,
	contents: string,
) => {
	forgetBoardContents(filePath);
	if (contents.length > maxCachedBoardLength / 4) {
		return;
	}
	// Oldest first: Map iteration follows insertion order.
	for (const [cachedPath, cached] of boardContentsCache) {
		if (cachedBoardLength + contents.length <= maxCachedBoardLength) {
			break;
		}
		boardContentsCache.delete(cachedPath);
		cachedBoardLength -= cached.contents.length;
	}
	boardContentsCache.set(filePath, { fingerprint, contents });
	cachedBoardLength += contents.length;
};

/**
 * A board file's contents: from the cache when the file still has the
 * settled fingerprint it was cached with, from disk otherwise. Returns what
 * to cache once the read proves consistent.
 */
const readBoardContents = async (
	filePath: string,
	fingerprint: string,
	settled: boolean,
) => {
	const cached = boardContentsCache.get(filePath);
	if (cached?.fingerprint === fingerprint) {
		// Refresh its place in the eviction order.
		boardContentsCache.delete(filePath);
		boardContentsCache.set(filePath, cached);
		return { contents: cached.contents, remember: null };
	}
	const contents = await readFile(filePath, "utf8");
	return {
		contents,
		remember: settled ? { filePath, fingerprint, contents } : null,
	};
};

/**
 * Reads every file of a design as one consistent snapshot without taking the
 * design lock: the files are inspected before and after reading, and the read
 * is retried when anything changed in between. A pending journal is reported
 * so the caller can replay it under the lock first.
 */
export const readDesignFiles = async (
	paths: DesignPaths,
): Promise<DesignFiles> => {
	for (let attempt = 0; attempt < maxConsistentReadAttempts; attempt += 1) {
		const before = await inspectDesignStorage(paths);
		if (before.journal) {
			throw new DesignJournalPendingError();
		}
		if (!before.folder && !before.legacy) {
			throw notFound(paths);
		}

		let files: DesignFiles;
		const remember: {
			filePath: string;
			fingerprint: string;
			contents: string;
		}[] = [];
		try {
			files = before.folder
				? {
						layout: "folder",
						manifest: await readFile(paths.manifest, "utf8"),
						boards: await Promise.all(
							before.boardFiles.map(async (name, index) => {
								const fingerprint = before.boardFingerprints[index] as string;
								const settled = before.boardSettled[index] === true;
								const read = await readBoardContents(
									path.join(paths.boards, name),
									fingerprint,
									settled,
								);
								if (read.remember) remember.push(read.remember);
								return { name, contents: read.contents, fingerprint, settled };
							}),
						),
						legacyPresent: before.legacy,
						modifiedAt: before.modifiedAt,
						fingerprint: before.fingerprint,
					}
				: {
						layout: "legacy",
						contents: await readFile(paths.legacy, "utf8"),
						modifiedAt: before.modifiedAt,
						fingerprint: before.fingerprint,
					};
		} catch (error) {
			// A file disappeared mid-read: another writer is at work.
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				continue;
			}
			throw error;
		}

		const after = await inspectDesignStorage(paths);
		if (after.fingerprint === before.fingerprint) {
			// Cache only what this consistent snapshot read: a file replaced
			// between the stat and the read would otherwise be cached under
			// the fingerprint of the file it replaced.
			for (const entry of remember) {
				rememberBoardContents(
					entry.filePath,
					entry.fingerprint,
					entry.contents,
				);
			}
			return files;
		}
	}
	throw new DesignStorageBusyError();
};

/** Board id stored in a board file name. */
export const getBoardIdFromFileName = (name: string) =>
	name.slice(0, -jsonExtension.length);

/** Writes a file through a temporary file and an atomic rename. */
export const writeFileAtomically = async (
	filePath: string,
	contents: string,
) => {
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
};

export const unlinkIfPresent = async (filePath: string) => {
	try {
		await unlink(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
};

export type DesignFileOperations = {
	/** Absolute path to new contents, applied in order. */
	writes: { path: string; contents: string }[];
	unlinks: string[];
};

/** Creates the folders the operations write into. */
export const ensureDesignFolders = async (paths: DesignPaths) => {
	await mkdir(paths.boards, { recursive: true });
};
