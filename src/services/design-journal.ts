import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	type DesignFileOperations,
	type DesignPaths,
	isSafeBoardId,
	serializeJson,
	unlinkIfPresent,
	writeFileAtomically,
} from "./design-storage";

/**
 * Write-ahead journal for writes that change more than one file of a design.
 *
 * Under the design lock, the writer first stores `<id>/.journal.json` with
 * the full new contents of every file it will write and every file it will
 * remove, then applies them one by one, then deletes the journal. The
 * journal is written through a temporary file and an atomic rename, so it is
 * either absent (nothing was applied: the old state stands) or complete (it
 * can be applied again: the new state). Every lock-taker and every reader
 * that finds a journal replays it before doing anything else. Replaying is
 * idempotent.
 */

export const DESIGN_JOURNAL_VERSION = 1;

type DesignJournal = {
	version: typeof DESIGN_JOURNAL_VERSION;
	designId: string;
	/** Paths are relative to `designs/` with forward slashes. */
	writes: { path: string; contents: string }[];
	unlinks: string[];
};

/** Called between steps, so tests can interrupt a write at each point. */
export type DesignJournalHooks = {
	afterJournalWritten?: () => void | Promise<void>;
	afterStep?: (step: number) => void | Promise<void>;
};

const toJournalPath = (paths: DesignPaths, filePath: string) =>
	path.relative(paths.designsDir, filePath).split(path.sep).join("/");

/**
 * Resolves a journal path, accepting only files that belong to the design:
 * its folder's manifest, memory and board files, and its legacy files.
 */
const resolveJournalPath = (paths: DesignPaths, journalPath: string) => {
	const id = paths.designId;
	const segments = journalPath.split("/");
	const allowed =
		journalPath === `${id}.json` ||
		journalPath === `${id}.memory.json` ||
		journalPath === `${id}/design.json` ||
		journalPath === `${id}/memory.json` ||
		(segments.length === 3 &&
			segments[0] === id &&
			segments[1] === "boards" &&
			(segments[2] ?? "").endsWith(".json") &&
			isSafeBoardId((segments[2] ?? "").slice(0, -".json".length))) ||
		(segments.length === 3 &&
			segments[0] === id &&
			segments[1] === "conflicts" &&
			(segments[2] ?? "").endsWith(".json") &&
			isSafeBoardId((segments[2] ?? "").slice(0, -".json".length)));
	if (!allowed) {
		throw new Error(
			`Design journal for "${id}" names a file outside the design: ${journalPath}`,
		);
	}
	return path.join(paths.designsDir, ...segments);
};

const applyJournal = async (
	paths: DesignPaths,
	journal: DesignJournal,
	hooks: DesignJournalHooks = {},
) => {
	let step = 0;
	for (const write of journal.writes) {
		const filePath = resolveJournalPath(paths, write.path);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFileAtomically(filePath, write.contents);
		step += 1;
		await hooks.afterStep?.(step);
	}
	for (const unlinkPath of journal.unlinks) {
		await unlinkIfPresent(resolveJournalPath(paths, unlinkPath));
		step += 1;
		await hooks.afterStep?.(step);
	}
};

const isJournal = (
	value: unknown,
	designId: string,
): value is DesignJournal => {
	if (typeof value !== "object" || value === null) return false;
	const journal = value as Record<string, unknown>;
	return (
		journal.version === DESIGN_JOURNAL_VERSION &&
		journal.designId === designId &&
		Array.isArray(journal.writes) &&
		journal.writes.every(
			(write) =>
				typeof write === "object" &&
				write !== null &&
				typeof (write as Record<string, unknown>).path === "string" &&
				typeof (write as Record<string, unknown>).contents === "string",
		) &&
		Array.isArray(journal.unlinks) &&
		journal.unlinks.every((entry) => typeof entry === "string")
	);
};

/**
 * Applies a leftover journal and removes it. Must run under the design
 * lock. Returns whether there was one.
 */
export const replayDesignJournal = async (paths: DesignPaths) => {
	let contents: string;
	try {
		contents = await readFile(paths.journal, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}

	let journal: unknown;
	try {
		journal = JSON.parse(contents);
	} catch {
		journal = null;
	}
	// The journal is renamed into place complete, so one that does not parse
	// was never committed by Trickroom: nothing of it was applied.
	if (isJournal(journal, paths.designId)) {
		await applyJournal(paths, journal);
	}
	await unlinkIfPresent(paths.journal);
	return true;
};

/**
 * Applies file operations for a design: directly when only one file
 * changes (an atomic rename), through the journal otherwise. Writes go
 * before unlinks; the manifest is written after the board files so a new
 * folder only becomes a design once its boards exist. Must run under the
 * design lock.
 *
 * A `stamp` (a manifest that changes only its `updatedAt`) joins the
 * journal when the other operations need one. When they change a single
 * file, it is written on its own right after that file instead: journaling
 * it would write the changed board a second time (into the journal) on
 * every save, for a timestamp an interrupted write may lose without harm.
 */
export const commitDesignOperations = async (
	paths: DesignPaths,
	{ stamp, ...content }: DesignFileOperations,
	hooks: DesignJournalHooks = {},
) => {
	const contentSteps = content.writes.length + content.unlinks.length;
	if (stamp && contentSteps <= 1) {
		await commitDesignOperations(paths, content, hooks);
		await writeFileAtomically(stamp.path, stamp.contents);
		return;
	}
	const operations: DesignFileOperations = stamp
		? { ...content, writes: [...content.writes, stamp] }
		: content;
	const journal: DesignJournal = {
		version: DESIGN_JOURNAL_VERSION,
		designId: paths.designId,
		writes: [
			...operations.writes.filter((write) => write.path !== paths.manifest),
			...operations.writes.filter((write) => write.path === paths.manifest),
		].map((write) => ({
			path: toJournalPath(paths, write.path),
			contents: write.contents,
		})),
		unlinks: operations.unlinks.map((unlinkPath) =>
			toJournalPath(paths, unlinkPath),
		),
	};
	const stepCount = journal.writes.length + journal.unlinks.length;
	if (stepCount === 0) {
		return;
	}
	if (stepCount === 1) {
		await applyJournal(paths, journal, hooks);
		return;
	}

	await mkdir(paths.folder, { recursive: true });
	await writeFileAtomically(paths.journal, serializeJson(journal));
	await hooks.afterJournalWritten?.();
	await applyJournal(paths, journal, hooks);
	await unlinkIfPresent(paths.journal);
};
