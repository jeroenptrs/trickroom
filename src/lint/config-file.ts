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
 * can refuse to overwrite an edit it has not seen.
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
