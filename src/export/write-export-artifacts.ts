import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { ExportDesignResult } from "./export-design";
import { dedupeFilename, makeZipFilename } from "./filenames";

export type ExportDestinationErrorCode =
	| "INVALID_EXPORT_DESTINATION"
	| "EXPORT_WRITE_FAILED";

export class ExportDestinationError extends Error {
	readonly code: ExportDestinationErrorCode;

	constructor(code: ExportDestinationErrorCode, message: string) {
		super(message);
		this.name = "ExportDestinationError";
		this.code = code;
	}
}

export type WrittenExportArtifact = {
	kind: "html" | "zip";
	filename: string;
	/** Absolute path to the written file. */
	path: string;
	bytes: number;
	boardNames: string[];
};

export type WriteExportArtifactsResult = {
	/** Absolute path to the destination directory. */
	destinationDir: string;
	artifacts: WrittenExportArtifact[];
};

export function resolveExportDestinationDir(
	projectRoot: string,
	destinationDir: string,
): string {
	const trimmed = destinationDir.trim();
	if (trimmed.length === 0) {
		throw new ExportDestinationError(
			"INVALID_EXPORT_DESTINATION",
			"destinationDir must be a non-empty folder path.",
		);
	}

	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolved = path.isAbsolute(trimmed)
		? path.resolve(trimmed)
		: path.resolve(resolvedProjectRoot, path.normalize(trimmed));

	if (!path.isAbsolute(trimmed)) {
		if (
			resolved !== resolvedProjectRoot &&
			!resolved.startsWith(`${resolvedProjectRoot}${path.sep}`)
		) {
			throw new ExportDestinationError(
				"INVALID_EXPORT_DESTINATION",
				"Project-relative destinationDir must stay inside the project root.",
			);
		}
	}

	return resolved;
}

async function ensureExportDestinationDir(
	resolvedDir: string,
): Promise<void> {
	try {
		const stats = await stat(resolvedDir);
		if (!stats.isDirectory()) {
			throw new ExportDestinationError(
				"INVALID_EXPORT_DESTINATION",
				`destinationDir must be a folder, not a file: "${resolvedDir}".`,
			);
		}
		return;
	} catch (error) {
		const fsError = error as NodeJS.ErrnoException;
		if (fsError.code !== "ENOENT") {
			if (error instanceof ExportDestinationError) {
				throw error;
			}
			throw new ExportDestinationError(
				"EXPORT_WRITE_FAILED",
				`Failed to access destinationDir "${resolvedDir}".`,
			);
		}
	}

	try {
		await mkdir(resolvedDir, { recursive: true });
	} catch {
		throw new ExportDestinationError(
			"EXPORT_WRITE_FAILED",
			`Failed to create destinationDir "${resolvedDir}".`,
		);
	}
}

export async function writeExportArtifacts(
	projectRoot: string,
	destinationDir: string,
	projectName: string,
	designName: string,
	result: ExportDesignResult,
): Promise<WriteExportArtifactsResult> {
	const resolvedDir = resolveExportDestinationDir(projectRoot, destinationDir);
	await ensureExportDestinationDir(resolvedDir);

	if (result.files.length === 1) {
		const only = result.files[0];
		const filePath = path.join(resolvedDir, only.filename);
		try {
			await writeFile(filePath, only.html, "utf8");
		} catch {
			throw new ExportDestinationError(
				"EXPORT_WRITE_FAILED",
				`Failed to write export file "${filePath}".`,
			);
		}

		return {
			destinationDir: resolvedDir,
			artifacts: [
				{
					kind: "html",
					filename: only.filename,
					path: filePath,
					bytes: Buffer.byteLength(only.html, "utf8"),
					boardNames: [only.name],
				},
			],
		};
	}

	const taken = new Set<string>();
	const zipped = zipSync(
		Object.fromEntries(
			result.files.map((file) => [
				dedupeFilename(file.filename, taken),
				strToU8(file.html),
			]),
		),
	);
	const zipFilename = makeZipFilename(projectName, designName, result.epoch);
	const zipPath = path.join(resolvedDir, zipFilename);
	try {
		await writeFile(zipPath, zipped);
	} catch {
		throw new ExportDestinationError(
			"EXPORT_WRITE_FAILED",
			`Failed to write export file "${zipPath}".`,
		);
	}

	return {
		destinationDir: resolvedDir,
		artifacts: [
			{
				kind: "zip",
				filename: zipFilename,
				path: zipPath,
				bytes: zipped.byteLength,
				boardNames: result.files.map((file) => file.name),
			},
		],
	};
}
