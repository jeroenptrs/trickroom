import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import {
	canonicalizePath,
	getAnnotationLockDirectory,
} from "../services/annotation-store";
import { getDesignFileLockPath } from "../services/design-file-lock";

/**
 * Writes the lockfile of an annotation file as another live process on this
 * host holds it (the parent process's pid), so this process's lock waits
 * and times out instead of queueing in-process. Returns the lockfile's
 * path; remove it to release.
 */
export const holdForeignAnnotationLock = async (
	trickroomHome: string,
	annotationPath: string,
) => {
	const lockDirectory = await canonicalizePath(
		getAnnotationLockDirectory(trickroomHome),
	);
	await mkdir(lockDirectory, { recursive: true });
	const lockFile = getDesignFileLockPath(
		lockDirectory,
		await canonicalizePath(annotationPath),
	);
	await writeFile(
		lockFile,
		JSON.stringify({
			pid: process.ppid,
			hostname: os.hostname(),
			token: "foreign",
			acquiredAt: Date.now(),
			designPath: annotationPath,
		}),
		{ flag: "wx" },
	);
	return lockFile;
};
