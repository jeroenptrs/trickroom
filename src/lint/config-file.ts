import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	getLintConfigIssues,
	LINT_CONFIG_FILE_NAME,
	type LintConfig,
	serializeLintConfig,
} from "./config";
import { writeSystemFileAtomic } from "./system-file";

/**
 * `lint.json` on disk: reading it with its issues, and writing it the way
 * the dashboard saves it (validated, `serializeLintConfig`, atomic, only
 * inside a system folder). The revision is a hash of the file text so a save
 * can refuse to overwrite an edit it has not seen; `saveLintConfigFile`
 * checks it and writes inside one queued section per file.
 */

export type LintConfigFileRead =
	| { status: "absent"; path: string; revision: null }
	| {
			status: "invalid";
			path: string;
			revision: string;
			text: string;
			issues: string[];
	  }
	| {
			status: "present";
			path: string;
			revision: string;
			text: string;
			config: LintConfig;
	  };

export const lintConfigRevision = (text: string) =>
	`sha256:${createHash("sha256").update(text).digest("hex")}`;

/** The stored config of a system folder; `knownRuleIds` catches unknown kinds. */
export async function readLintConfigFile(
	systemDir: string,
	knownRuleIds: ReadonlySet<string> | null,
): Promise<LintConfigFileRead> {
	const configPath = path.join(systemDir, LINT_CONFIG_FILE_NAME);
	let text: string;
	try {
		text = await readFile(configPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "absent", path: configPath, revision: null };
		}
		throw error;
	}
	const revision = lintConfigRevision(text);
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			status: "invalid",
			path: configPath,
			revision,
			text,
			issues: [
				`${LINT_CONFIG_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
	const issues = getLintConfigIssues(value, knownRuleIds);
	return issues.length > 0
		? { status: "invalid", path: configPath, revision, text, issues }
		: {
				status: "present",
				path: configPath,
				revision,
				text,
				config: value as LintConfig,
			};
}

export class LintConfigWriteError extends Error {
	readonly code: "CONFIG_PATH_OUTSIDE_SYSTEMS";
	constructor(message: string) {
		super(message);
		this.name = "LintConfigWriteError";
		this.code = "CONFIG_PATH_OUTSIDE_SYSTEMS";
	}
}

/** Writes a valid config as `serializeLintConfig` text; returns its revision. */
export async function writeLintConfigFile(
	projectRoot: string,
	systemDir: string,
	config: LintConfig,
): Promise<{ path: string; text: string; revision: string }> {
	const written = await writeSystemFileAtomic({
		projectRoot,
		systemDir,
		fileName: LINT_CONFIG_FILE_NAME,
		contents: serializeLintConfig(config),
		refuse: (message) => new LintConfigWriteError(message),
	});
	return {
		path: written.path,
		text: written.contents,
		revision: lintConfigRevision(written.contents),
	};
}

const configSaveQueues = new Map<string, Promise<unknown>>();

/** Runs saves of one `lint.json` one after another, in arrival order. */
async function runExclusiveConfigSave<T>(
	configPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = configSaveQueues.get(configPath);
	const queued = previous
		? previous.catch(() => undefined).then(operation)
		: operation();
	configSaveQueues.set(configPath, queued);
	const release = () => {
		if (configSaveQueues.get(configPath) === queued) {
			configSaveQueues.delete(configPath);
		}
	};
	queued.then(release, release);
	return queued;
}

export type LintConfigSaveResult =
	| { status: "conflict"; current: LintConfigFileRead }
	| { status: "written"; read: LintConfigFileRead };

/**
 * The dashboard's save: compare the file's revision with the one the edit
 * started from (`undefined` skips the check, null expects no file), write,
 * and read the result back, all in one critical section per file so two
 * saves from the same revision cannot both win. Saves from other processes
 * (an editor, a CLI) are not serialized; the revision check still catches
 * them when they land before this save reads the file.
 */
export async function saveLintConfigFile({
	projectRoot,
	systemDir,
	config,
	expectedRevision,
	knownRuleIds,
}: {
	projectRoot: string;
	systemDir: string;
	config: LintConfig;
	expectedRevision: string | null | undefined;
	knownRuleIds: ReadonlySet<string> | null;
}): Promise<LintConfigSaveResult> {
	const configPath = path.resolve(systemDir, LINT_CONFIG_FILE_NAME);
	return runExclusiveConfigSave(configPath, async () => {
		const current = await readLintConfigFile(systemDir, knownRuleIds);
		if (
			expectedRevision !== undefined &&
			expectedRevision !== current.revision
		) {
			return { status: "conflict", current };
		}
		await writeLintConfigFile(projectRoot, systemDir, config);
		return {
			status: "written",
			read: await readLintConfigFile(systemDir, knownRuleIds),
		};
	});
}
