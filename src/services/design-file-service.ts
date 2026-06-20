import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
	access,
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
} from "node:fs/promises";
import path from "node:path";
import {
	isTrickroomDesign,
	writeJsonFileAtomically,
	writeJsonFileExclusivelyAtomically,
} from "../server-utils";
import type { Node, TrickroomDesign, TrickroomDesignSummary } from "../types";

export type DesignFileServiceErrorCode =
	| "INVALID_DESIGN_FILE_PATH"
	| "INVALID_DESIGN_UUID"
	| "INVALID_DESIGN_PAYLOAD"
	| "DESIGN_FILE_ALREADY_EXISTS"
	| "REVISION_MISMATCH";

export class DesignFileServiceError extends Error {
	readonly code: DesignFileServiceErrorCode;

	constructor(code: DesignFileServiceErrorCode, message: string) {
		super(message);
		this.name = "DesignFileServiceError";
		this.code = code;
	}
}

export type DesignFileRevision = `sha256:${string}`;

export type DesignJsonFileRead = {
	file: string;
	path: string;
	value: unknown;
	revision: DesignFileRevision;
};

export type DesignFileRead = Omit<DesignJsonFileRead, "value"> & {
	uuid: string | null;
	design: TrickroomDesign;
};

export type DesignFileWrite = {
	file: string;
	path: string;
	uuid: string | null;
	design: TrickroomDesign;
	revision: DesignFileRevision;
};

export type RevisionCheck = {
	expectedRevision?: DesignFileRevision;
};

export type DesignFileSummary = TrickroomDesignSummary & {
	revision: DesignFileRevision;
};

type DesignFileSummaryCacheEntry = {
	mtimeMs: number;
	size: number;
	updatedAt: number;
	summary: DesignFileSummary;
};

const maxSummaryCacheAgeMs = 30 * 60 * 1000;

export const getDesignFileForUuid = (uuid: string) => `${uuid}.json`;

export const getDesignUuidFromFile = (file: string) => {
	if (!file.endsWith(".json")) {
		return null;
	}

	return file.slice(0, -".json".length);
};

export const calculateDesignFileRevision = (
	contents: string,
): DesignFileRevision =>
	`sha256:${createHash("sha256").update(contents).digest("hex")}`;

const isSafeDesignUuid = (uuid: string) =>
	uuid.trim().length > 0 &&
	uuid === uuid.trim() &&
	uuid !== "." &&
	uuid !== ".." &&
	!uuid.includes("/") &&
	!uuid.includes("\\");

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

	constructor(projectRoot: string) {
		this.projectRoot = path.resolve(projectRoot);
		this.designsDir = path.join(this.projectRoot, ".trickroom", "designs");
		this.designsGitkeepPath = path.join(this.designsDir, ".gitkeep");
		void DesignFileService.pruneSummaryCache().catch(() => {});
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

	getFileForUuid(uuid: string) {
		if (!isSafeDesignUuid(uuid)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_UUID",
				"Design UUID must be a single path segment",
			);
		}

		return getDesignFileForUuid(uuid);
	}

	getUuidFromFile(file: string) {
		return getDesignUuidFromFile(file);
	}

	resolveDesignFilePath(file: string) {
		const resolvedDesignPath = path.resolve(this.designsDir, file);
		if (!isPathInsideDirectory(resolvedDesignPath, this.designsDir)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_FILE_PATH",
				"Design file path must be inside .trickroom/designs",
			);
		}

		return resolvedDesignPath;
	}

	async readJsonFile(file: string): Promise<DesignJsonFileRead> {
		const designPath = this.resolveDesignFilePath(file);
		const contents = await readFile(designPath, "utf8");

		return {
			file,
			path: designPath,
			value: JSON.parse(contents),
			revision: calculateDesignFileRevision(contents),
		};
	}

	async readDesignFile(file: string): Promise<DesignFileRead> {
		const read = await this.readJsonFile(file);
		if (!isTrickroomDesign(read.value)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_PAYLOAD",
				"Invalid trickroom design payload",
			);
		}

		return {
			file: read.file,
			path: read.path,
			uuid: this.getUuidFromFile(file),
			design: read.value,
			revision: read.revision,
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

		const designFiles = directoryEntries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name)
			.sort();

		const summaries = await Promise.all(
			designFiles.map(async (file) => {
				let designPath: string | null = null;
				try {
					designPath = this.resolveDesignFilePath(file);
					const fileStat = await stat(designPath);
					const cachedSummary = this.getCachedSummary(designPath, fileStat);
					if (cachedSummary) {
						return cachedSummary;
					}

					const read = await this.readDesignFile(file);
					const uuid = read.uuid;
					if (!uuid) {
						return null;
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
		file: string,
		design: unknown,
		revisionCheck: RevisionCheck = {},
	): Promise<DesignFileWrite> {
		const designPath = this.resolveDesignFilePath(file);
		if (!isTrickroomDesign(design)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_PAYLOAD",
				"Invalid trickroom design payload",
			);
		}

		if (revisionCheck.expectedRevision !== undefined) {
			const currentContents = await readFile(designPath, "utf8");
			const currentRevision = calculateDesignFileRevision(currentContents);
			if (currentRevision !== revisionCheck.expectedRevision) {
				throw new DesignFileServiceError(
					"REVISION_MISMATCH",
					"Design file revision does not match the expected revision",
				);
			}
		}

		await mkdir(this.designsDir, { recursive: true });
		const contents = await writeJsonFileAtomically(designPath, design);
		this.deleteCachedSummary(designPath);
		await DesignFileService.pruneSummaryCache();
		return {
			file,
			path: designPath,
			uuid: this.getUuidFromFile(file),
			design,
			revision: calculateDesignFileRevision(contents),
		};
	}

	async createDesignFile(
		file: string,
		design: unknown,
	): Promise<DesignFileWrite> {
		const designPath = this.resolveDesignFilePath(file);
		if (!isTrickroomDesign(design)) {
			throw new DesignFileServiceError(
				"INVALID_DESIGN_PAYLOAD",
				"Invalid trickroom design payload",
			);
		}

		await mkdir(this.designsDir, { recursive: true });
		let contents: string;
		try {
			contents = await writeJsonFileExclusivelyAtomically(designPath, design);
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
			file,
			path: designPath,
			uuid: this.getUuidFromFile(file),
			design,
			revision: calculateDesignFileRevision(contents),
		};
	}

	async deleteDesignFile(file: string) {
		const designPath = this.resolveDesignFilePath(file);
		await unlink(designPath);
		this.deleteCachedSummary(designPath);
		await DesignFileService.pruneSummaryCache();
	}
}

export const createDesignFileService = (projectRoot: string) =>
	new DesignFileService(projectRoot);
