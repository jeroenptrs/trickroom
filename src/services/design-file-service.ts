import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isTrickroomDesign, writeJsonFileAtomically } from "../server-utils";
import type { TrickroomDesign, TrickroomDesignSummary } from "../types";

export type DesignFileServiceErrorCode =
	| "INVALID_DESIGN_FILE_PATH"
	| "INVALID_DESIGN_UUID"
	| "INVALID_DESIGN_PAYLOAD"
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

export class DesignFileService {
	readonly projectRoot: string;
	readonly designsDir: string;
	readonly designsGitkeepPath: string;

	constructor(projectRoot: string) {
		this.projectRoot = path.resolve(projectRoot);
		this.designsDir = path.join(this.projectRoot, ".trickroom", "designs");
		this.designsGitkeepPath = path.join(this.designsDir, ".gitkeep");
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

	async listDesignSummaries(): Promise<DesignFileSummary[]> {
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
				try {
					const read = await this.readDesignFile(file);
					const uuid = read.uuid;
					if (!uuid) {
						return null;
					}

					return {
						uuid,
						file,
						name: read.design.name,
						...(read.design.systemName !== undefined
							? { systemName: read.design.systemName }
							: {}),
						revision: read.revision,
					} satisfies DesignFileSummary;
				} catch {
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

		const contents = await writeJsonFileAtomically(designPath, design);
		return {
			file,
			path: designPath,
			uuid: this.getUuidFromFile(file),
			design,
			revision: calculateDesignFileRevision(contents),
		};
	}
}

export const createDesignFileService = (projectRoot: string) =>
	new DesignFileService(projectRoot);
