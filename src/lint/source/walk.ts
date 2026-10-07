import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SOURCE_EXTENSIONS } from "../config";
import { compileGlobs, globStaticPrefix } from "./glob";

/**
 * The files the code side scans: every regular file under the project root
 * with a source extension (`SOURCE_EXTENSIONS`), matching the include globs
 * and no exclude glob. `node_modules`, `dist`, `.trickroom` and every dot
 * folder are never entered, and symlinks are skipped so the walk cannot
 * leave the project. A glob as broad as `src/**` still takes only the files
 * the parser reads, not the CSS, Markdown or HTML next to them. Sorted,
 * project-relative, `/` separators.
 *
 * A folder that cannot be read is never taken for an empty one: it is
 * listed in `unreadable`, and the caller decides (a lint run fails, since
 * fewer files means fewer findings and would read as an improvement). An
 * include root that does not exist is only listed in `missingRoots`.
 */

export const ALWAYS_SKIPPED_FOLDERS = new Set(["node_modules", "dist"]);

const SOURCE_EXTENSION_SET: ReadonlySet<string> = new Set(SOURCE_EXTENSIONS);

const hasSourceExtension = (name: string) => {
	const dot = name.lastIndexOf(".");
	return dot > 0 && SOURCE_EXTENSION_SET.has(name.slice(dot + 1));
};

export type WalkSourceFilesOptions = {
	include: readonly string[];
	exclude: readonly string[];
	/** Stop after this many files; the result reports that it was cut. */
	maxFiles?: number;
};

export type WalkedSourceFiles = {
	files: string[];
	truncated: boolean;
	/** Static folders of the include globs that do not exist, sorted. */
	missingRoots: string[];
	/** Folders the walk could not read (`.` for the project root). */
	unreadable: Array<{ path: string; code: string | null; message: string }>;
};

const errorCode = (error: unknown): string | null => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : null;
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
	const unreadable: WalkedSourceFiles["unreadable"] = [];
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
		} catch (error) {
			unreadable.push({
				path: relativeDir || ".",
				code: errorCode(error),
				message: error instanceof Error ? error.message : String(error),
			});
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
			if (!entry.isFile() || !hasSourceExtension(entry.name)) continue;
			if (!include(relative) || exclude(relative)) continue;
			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
			files.push(relative);
		}
	};
	await visit("");

	// The walk only descends into folders it lists, so a root that is not
	// there never comes up: check each one. Other failures to reach a root
	// are the walk's to report, at the folder it could not read.
	const missingRoots: string[] = [];
	for (const root of [...new Set(prefixes)].sort()) {
		if (root === "") continue;
		try {
			await stat(path.join(projectRoot, ...root.split("/")));
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT" || code === "ENOTDIR") missingRoots.push(root);
		}
	}
	return { files, truncated, missingRoots, unreadable };
}
