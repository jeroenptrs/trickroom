import { stat } from "node:fs/promises";
import path from "node:path";
import {
	createDesignFileService,
	type DesignMigrationResult,
} from "../services/design-file-service";

/**
 * `trickroom migrate [project] [--dry-run] [--json]`: brings every design in
 * a project to the current storage layout in one go, instead of each design
 * converting on its first write. Prints what changed (or would change) per
 * design: counts and sizes, never design contents.
 */

export type MigrateOptions = {
	projectRoot: string;
	dryRun: boolean;
	json: boolean;
};

export const parseMigrateArgs = (
	args: readonly string[],
	cwd = process.cwd(),
): MigrateOptions => {
	const unknown = args.filter(
		(arg) => arg.startsWith("--") && arg !== "--dry-run" && arg !== "--json",
	);
	if (unknown.length > 0) {
		throw new Error(
			`Unknown option ${unknown.join(", ")}. Usage: trickroom migrate [project] [--dry-run] [--json]`,
		);
	}
	const positional = args.filter((arg) => !arg.startsWith("--"));
	if (positional.length > 1) {
		throw new Error(
			"trickroom migrate takes at most one project directory. Usage: trickroom migrate [project] [--dry-run] [--json]",
		);
	}
	return {
		projectRoot: path.resolve(cwd, positional[0] ?? "."),
		dryRun: args.includes("--dry-run"),
		json: args.includes("--json"),
	};
};

const formatBytes = (bytes: number) =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)} KB`
			: `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const describeResult = (result: DesignMigrationResult, dryRun: boolean) => {
	const verb = {
		converted: dryRun ? "convert" : "converted",
		reconciled: dryRun ? "reconcile" : "reconciled",
		current: "current",
		skipped: "skipped",
	}[result.status];
	const parts = [`${verb.padEnd(10)} ${result.designId}`];
	if (result.status === "skipped") {
		parts.push(`(${result.reason})`);
		return parts.join("  ");
	}
	parts.push(`${result.boardCount} boards`);
	if (result.status !== "current") {
		parts.push(
			`${formatBytes(result.bytesBefore)} -> ${formatBytes(result.bytesAfter)}`,
			`${result.filesWritten.length} written, ${result.filesRemoved.length} removed`,
		);
	}
	if (result.addedBoardIds.length > 0) {
		parts.push(`${result.addedBoardIds.length} boards added from the old file`);
	}
	if (result.conflictFiles.length > 0) {
		parts.push(`${result.conflictFiles.length} conflicts saved`);
	}
	if (result.verified === false) {
		parts.push("READ-BACK MISMATCH");
	}
	return parts.join("  ");
};

export const runMigrate = async (
	args: readonly string[],
	io: { stdout: (line: string) => void; stderr: (line: string) => void } = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
): Promise<number> => {
	let options: MigrateOptions;
	try {
		options = parseMigrateArgs(args);
	} catch (error) {
		io.stderr(error instanceof Error ? error.message : String(error));
		return 1;
	}

	const trickroomDir = path.join(options.projectRoot, ".trickroom");
	const exists = await stat(trickroomDir).then(
		(entry) => entry.isDirectory(),
		() => false,
	);
	if (!exists) {
		io.stderr(
			`No Trickroom project at ${options.projectRoot} (.trickroom is missing).`,
		);
		return 1;
	}

	const startedAt = performance.now();
	const service = createDesignFileService(options.projectRoot);
	const results: DesignMigrationResult[] = [];
	for (const designId of await service.listDesignIds()) {
		let result: DesignMigrationResult;
		try {
			result = await service.migrateDesign(designId, {
				dryRun: options.dryRun,
			});
		} catch (error) {
			result = {
				designId,
				status: "skipped",
				reason: error instanceof Error ? error.message : String(error),
				name: designId,
				boardCount: 0,
				bytesBefore: 0,
				bytesAfter: 0,
				filesWritten: [],
				filesRemoved: [],
				addedBoardIds: [],
				conflictFiles: [],
			};
		}
		results.push(result);
		if (!options.json) {
			io.stdout(describeResult(result, options.dryRun));
		}
	}

	const count = (status: DesignMigrationResult["status"]) =>
		results.filter((result) => result.status === status).length;
	const summary = {
		projectRoot: options.projectRoot,
		dryRun: options.dryRun,
		designs: results.length,
		converted: count("converted"),
		reconciled: count("reconciled"),
		current: count("current"),
		skipped: count("skipped"),
		filesWritten: results.reduce(
			(total, result) => total + result.filesWritten.length,
			0,
		),
		filesRemoved: results.reduce(
			(total, result) => total + result.filesRemoved.length,
			0,
		),
		conflictFiles: results.reduce(
			(total, result) => total + result.conflictFiles.length,
			0,
		),
		bytesBefore: results.reduce(
			(total, result) => total + result.bytesBefore,
			0,
		),
		bytesAfter: results.reduce((total, result) => total + result.bytesAfter, 0),
		readBackMismatches: results.filter((result) => result.verified === false)
			.length,
		durationMs: Math.round(performance.now() - startedAt),
	};

	if (options.json) {
		io.stdout(JSON.stringify({ summary, designs: results }, null, "\t"));
	} else {
		io.stdout(
			[
				`${summary.designs} ${summary.designs === 1 ? "design" : "designs"}${options.dryRun ? " (dry run, nothing written)" : ""}:`,
				`${summary.converted} ${options.dryRun ? "to convert" : "converted"},`,
				`${summary.reconciled} ${options.dryRun ? "to reconcile" : "reconciled"},`,
				`${summary.current} already current,`,
				`${summary.skipped} skipped.`,
				`Files: ${summary.filesWritten} ${options.dryRun ? "to write" : "written"}, ${summary.filesRemoved} ${options.dryRun ? "to remove" : "removed"}${summary.conflictFiles > 0 ? `, ${summary.conflictFiles} conflict files` : ""}.`,
				`${formatBytes(summary.bytesBefore)} -> ${formatBytes(summary.bytesAfter)} in ${summary.durationMs} ms.`,
			].join(" "),
		);
	}
	return summary.skipped > 0 || summary.readBackMismatches > 0 ? 2 : 0;
};

/** Entry for `bin/trickroom.js migrate`. */
export const main = (args: readonly string[]) => runMigrate(args);
