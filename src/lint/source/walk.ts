import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { compileGlobs, globStaticPrefix } from "./glob";

/**
 * The files the code side scans: every regular file under the project root
 * matching the include globs and no exclude glob. `node_modules`, `dist`,
 * `.trickroom` and every dot folder are never entered, and symlinks are
 * skipped so the walk cannot leave the project. Sorted, project-relative,
 * `/` separators.
 */

export const ALWAYS_SKIPPED_FOLDERS = new Set(["node_modules", "dist"]);

export type WalkSourceFilesOptions = {
	include: readonly string[];
	exclude: readonly string[];
	/** Stop after this many files; the result reports that it was cut. */
	maxFiles?: number;
};

export type WalkedSourceFiles = {
	files: string[];
	truncated: boolean;
};

const DEFAULT_MAX_FILES = 50_000;

export async function walkSourceFiles(
	projectRoot: string,
	options: WalkSourceFilesOptions,
): Promise<WalkedSourceFiles> {
	const include = compileGlobs(options.include);
	const exclude = compileGlobs(options.exclude);
	const prefixes = options.include.map(globStaticPrefix);
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const files: string[] = [];
	let truncated = false;

	const mayContainMatches = (relativeDir: string) =>
		prefixes.some(
			(prefix) =>
				prefix === "" ||
				prefix === relativeDir ||
				prefix.startsWith(`${relativeDir}/`) ||
				relativeDir.startsWith(`${prefix}/`),
		);

	const visit = async (relativeDir: string): Promise<void> => {
		if (truncated) return;
		const absolute = path.join(
			projectRoot,
			...relativeDir.split("/").filter(Boolean),
		);
		let entries: Dirent[];
		try {
			entries = await readdir(absolute, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		);
		for (const entry of entries) {
			if (truncated) return;
			const relative = relativeDir
				? `${relativeDir}/${entry.name}`
				: entry.name;
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				if (
					entry.name.startsWith(".") ||
					ALWAYS_SKIPPED_FOLDERS.has(entry.name)
				)
					continue;
				if (!mayContainMatches(relative)) continue;
				await visit(relative);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!include(relative) || exclude(relative)) continue;
			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
			files.push(relative);
		}
	};
	await visit("");
	return { files, truncated };
}
