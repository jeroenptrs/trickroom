import { randomUUID } from "node:crypto";
import { realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Atomic writes of the lint files (`lint-report.json`, `lint.json`) into a
 * system folder. With symlinks followed, `.trickroom/systems` must be exactly
 * that folder under the real project root (not a link elsewhere) and the
 * system folder a direct child of it, so nothing is ever written outside the
 * project. `refuse` builds the error thrown when the folder does not qualify.
 */

const isInside = (root: string, target: string) =>
	target === root || target.startsWith(`${root}${path.sep}`);

/**
 * The real path of a system folder that lint files may be written into, or
 * the error `refuse` builds. Also where the report's lockfile goes.
 */
export async function resolveWritableSystemDir({
	projectRoot,
	systemDir,
	fileName,
	refuse,
}: {
	projectRoot: string;
	systemDir: string;
	fileName: string;
	refuse: (message: string) => Error;
}): Promise<string> {
	const realRoot = await realpath(projectRoot);
	const systemsDir = path.join(realRoot, ".trickroom", "systems");
	const realSystemsDir = await realpath(systemsDir);
	if (realSystemsDir !== systemsDir) {
		throw refuse(
			`Refusing to write ${fileName}: ${systemsDir} resolves to ${realSystemsDir} (through a symlink); the systems folder must be a real folder inside the project.`,
		);
	}
	const realSystemDir = await realpath(systemDir);
	if (
		!isInside(realRoot, realSystemDir) ||
		path.dirname(realSystemDir) !== realSystemsDir
	) {
		throw refuse(
			`Refusing to write ${fileName}: ${systemDir} is not a system folder under ${systemsDir}.`,
		);
	}
	return realSystemDir;
}

/**
 * Writes a temp sibling and renames it into place, so a crash never leaves
 * the target half-written (at most a `.tmp` file next to it).
 */
export async function writeSystemFileAtomic({
	projectRoot,
	systemDir,
	fileName,
	contents,
	refuse,
}: {
	projectRoot: string;
	systemDir: string;
	fileName: string;
	contents: string;
	refuse: (message: string) => Error;
}): Promise<{ path: string; contents: string }> {
	const realSystemDir = await resolveWritableSystemDir({
		projectRoot,
		systemDir,
		fileName,
		refuse,
	});
	const filePath = path.join(realSystemDir, fileName);
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, contents, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
	return { path: filePath, contents };
}
