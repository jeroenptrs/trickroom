import path from "node:path";
import type { TrickroomCodegenConfig, TrickroomConfig } from "../types";

/**
 * The optional `codegen` block of `.trickroom/config.json`: where and how
 * published system Components are emitted as tailwind-variants files. The
 * block carries its own `version`, independent of the project
 * `schemaVersion`, so its shape can migrate without touching the rest.
 */

export const CODEGEN_CONFIG_VERSIONS = [1] as const;

export const DEFAULT_CODEGEN_FILE_NAME = "{slug}.variants.ts";
export const DEFAULT_CODEGEN_TV_IMPORT = "./tv";
export const DEFAULT_CODEGEN_SHAPE = "auto";
export const DEFAULT_CODEGEN_TW_MERGE_FILE_NAME = "tw-merge.ts";

const CODEGEN_KEYS = new Set([
	"version",
	"system",
	"outDir",
	"fileName",
	"tvImport",
	"shape",
	"include",
	"exclude",
	"formatter",
	"twMerge",
]);
const FORMATTER_KEYS = new Set(["command", "args"]);
const TW_MERGE_KEYS = new Set(["fileName", "mergeGroups"]);
const MERGE_GROUP_KEY = /^[A-Za-z0-9_-]+$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const unknownKeyIssues = (
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	prefix: string,
) =>
	Object.keys(value)
		.filter((key) => !allowed.has(key))
		.map(
			(key) =>
				`${prefix}.${key} is not a known key (expected one of ${[...allowed].join(", ")}).`,
		);

const slugListIssues = (value: unknown, field: string): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return [`codegen.${field} must be an array of component slugs.`];
	}
	return value.flatMap((entry, index) =>
		isNonEmptyString(entry)
			? []
			: [`codegen.${field}[${index}] must be a non-empty string.`],
	);
};

const outDirIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return ["codegen.outDir is required when codegen is configured."];
	}
	if (!isNonEmptyString(value)) {
		return ["codegen.outDir must be a non-empty string."];
	}
	const outDir = value.trim();
	if (path.posix.isAbsolute(outDir) || path.win32.isAbsolute(outDir)) {
		return [
			`codegen.outDir must be relative to the project root; got "${outDir}".`,
		];
	}
	if (outDir.split(/[\\/]/u).includes("..")) {
		return [
			`codegen.outDir must stay inside the project and cannot contain a ".." segment; got "${outDir}".`,
		];
	}
	return [];
};

const fileNameIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isNonEmptyString(value)) {
		return ["codegen.fileName must be a non-empty string."];
	}
	const fileName = value.trim();
	const issues: string[] = [];
	if (!fileName.includes("{slug}")) {
		issues.push(`codegen.fileName must contain {slug}; got "${fileName}".`);
	}
	if (/[\\/]/u.test(fileName)) {
		issues.push(
			`codegen.fileName must be a file name without a path separator; got "${fileName}".`,
		);
	}
	if (!fileName.endsWith(".ts")) {
		issues.push(`codegen.fileName must end in .ts; got "${fileName}".`);
	}
	return issues;
};

/**
 * The shape of `codegen.twMerge.mergeGroups`. Whether each pattern matches
 * a utility of the design system is checked when the config is derived.
 */
const mergeGroupsIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return [
			'codegen.twMerge.mergeGroups must be an object of group names to utility patterns, for example { "typography": ["text-title-*", "text-body-*"] }.',
		];
	}
	return Object.entries(value).flatMap(([key, patterns]) => {
		const field = `codegen.twMerge.mergeGroups.${key}`;
		const issues: string[] = [];
		if (!MERGE_GROUP_KEY.test(key)) {
			issues.push(
				`codegen.twMerge.mergeGroups has the group name "${key}"; use letters, digits, "-" and "_".`,
			);
		}
		if (!Array.isArray(patterns) || patterns.length === 0) {
			return [
				...issues,
				`${field} must be a non-empty array of utility patterns.`,
			];
		}
		patterns.forEach((pattern, index) => {
			if (!isNonEmptyString(pattern) || /\s/u.test(pattern.trim())) {
				issues.push(
					`${field}[${index}] must be a utility class or a pattern with "*", without spaces.`,
				);
			}
		});
		return issues;
	});
};

const twMergeIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return [
			'codegen.twMerge must be an object, for example {} or { "fileName": "tw-merge.ts" }.',
		];
	}
	const issues = unknownKeyIssues(value, TW_MERGE_KEYS, "codegen.twMerge");
	issues.push(...mergeGroupsIssues(value.mergeGroups));
	if (value.fileName === undefined) {
		return issues;
	}
	if (!isNonEmptyString(value.fileName)) {
		return [...issues, "codegen.twMerge.fileName must be a non-empty string."];
	}
	const fileName = value.fileName.trim();
	if (/[\\/]/u.test(fileName)) {
		issues.push(
			`codegen.twMerge.fileName must be a file name without a path separator; got "${fileName}".`,
		);
	}
	if (fileName.includes("{slug}")) {
		issues.push(
			`codegen.twMerge.fileName names one file and cannot contain {slug}; got "${fileName}".`,
		);
	}
	if (!fileName.endsWith(".ts")) {
		issues.push(`codegen.twMerge.fileName must end in .ts; got "${fileName}".`);
	}
	return issues;
};

const formatterIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return ["codegen.formatter must be an object with a command."];
	}
	const issues = unknownKeyIssues(value, FORMATTER_KEYS, "codegen.formatter");
	if (!isNonEmptyString(value.command)) {
		issues.push("codegen.formatter.command must be a non-empty string.");
	}
	if (value.args !== undefined) {
		if (!Array.isArray(value.args)) {
			issues.push("codegen.formatter.args must be an array of strings.");
		} else {
			value.args.forEach((arg, index) => {
				if (typeof arg !== "string") {
					issues.push(`codegen.formatter.args[${index}] must be a string.`);
				}
			});
		}
	}
	return issues;
};

/**
 * Every reason a `codegen` block is invalid, each naming the offending field.
 * Empty when the block is valid. Takes the block itself, not the config.
 */
export const getCodegenConfigIssues = (value: unknown): string[] => {
	if (!isRecord(value)) {
		return ["codegen must be an object."];
	}

	const issues = unknownKeyIssues(value, CODEGEN_KEYS, "codegen");
	const supported = CODEGEN_CONFIG_VERSIONS.join(", ");
	if (value.version === undefined) {
		issues.push(
			`codegen.version is required; this Trickroom understands codegen version ${supported}.`,
		);
	} else if (
		!CODEGEN_CONFIG_VERSIONS.includes(
			value.version as (typeof CODEGEN_CONFIG_VERSIONS)[number],
		)
	) {
		issues.push(
			`codegen.version ${JSON.stringify(value.version)} is not supported; this Trickroom understands codegen version ${supported}.`,
		);
	}
	if (value.system !== undefined && !isNonEmptyString(value.system)) {
		issues.push(
			"codegen.system must be a non-empty system id or name when present.",
		);
	}
	issues.push(...outDirIssues(value.outDir));
	issues.push(...fileNameIssues(value.fileName));
	if (value.tvImport !== undefined && !isNonEmptyString(value.tvImport)) {
		issues.push("codegen.tvImport must be a non-empty string when present.");
	}
	if (
		value.shape !== undefined &&
		value.shape !== "auto" &&
		value.shape !== "slots"
	) {
		issues.push(
			`codegen.shape must be "auto" or "slots"; got ${JSON.stringify(value.shape)}.`,
		);
	}
	issues.push(...slugListIssues(value.include, "include"));
	issues.push(...slugListIssues(value.exclude, "exclude"));
	issues.push(...formatterIssues(value.formatter));
	issues.push(...twMergeIssues(value.twMerge));
	return issues;
};

/**
 * The `codegen` reasons a whole config is invalid, as a sentence to append to
 * an "invalid config" message; empty when the block is absent or valid.
 */
export const describeCodegenConfigIssues = (config: unknown): string => {
	if (!isRecord(config) || config.codegen === undefined) {
		return "";
	}
	const issues = getCodegenConfigIssues(config.codegen);
	return issues.length > 0 ? ` ${issues.join(" ")}` : "";
};

export const isTrickroomCodegenConfig = (
	value: unknown,
): value is TrickroomCodegenConfig =>
	getCodegenConfigIssues(value).length === 0;

/**
 * Trimmed copy in the documented key order, keeping only the keys that were
 * set: defaults are applied by `resolveCodegenConfig`, never written back.
 */
export const normalizeCodegenConfig = (
	config: TrickroomCodegenConfig,
): TrickroomCodegenConfig => ({
	version: config.version,
	...(config.system ? { system: config.system.trim() } : {}),
	outDir: config.outDir.trim(),
	...(config.fileName ? { fileName: config.fileName.trim() } : {}),
	...(config.tvImport ? { tvImport: config.tvImport.trim() } : {}),
	...(config.shape ? { shape: config.shape } : {}),
	...(config.include
		? { include: config.include.map((slug) => slug.trim()) }
		: {}),
	...(config.exclude
		? { exclude: config.exclude.map((slug) => slug.trim()) }
		: {}),
	...(config.formatter
		? {
				formatter: {
					command: config.formatter.command.trim(),
					...(config.formatter.args
						? { args: [...config.formatter.args] }
						: {}),
				},
			}
		: {}),
	...(config.twMerge
		? {
				twMerge: {
					...(config.twMerge.fileName
						? { fileName: config.twMerge.fileName.trim() }
						: {}),
					...(config.twMerge.mergeGroups
						? {
								mergeGroups: Object.fromEntries(
									Object.entries(config.twMerge.mergeGroups).map(
										([key, patterns]) => [
											key,
											patterns.map((pattern) => pattern.trim()),
										],
									),
								),
							}
						: {}),
				},
			}
		: {}),
});

export type ResolvedCodegenConfig =
	| { status: "unconfigured" }
	| {
			status: "configured";
			version: TrickroomCodegenConfig["version"];
			/**
			 * The configured system handle (id, name or storage key, as
			 * `findDesignSystem` accepts), else the project's default system id;
			 * null when neither is set.
			 */
			system: string | null;
			outDir: string;
			fileName: string;
			tvImport: string;
			shape: NonNullable<TrickroomCodegenConfig["shape"]>;
			/** Null when every published Component is included. */
			include: string[] | null;
			exclude: string[];
			formatter: { command: string; args: string[] } | null;
			/** The generated tailwind-merge config file; null when not enabled. */
			twMerge: {
				fileName: string;
				/** The project's merge groups; empty without any. */
				mergeGroups: Record<string, string[]>;
			} | null;
	  };

/** The block with its defaults applied, or `unconfigured` without one. */
export const resolveCodegenConfig = (
	config: TrickroomConfig,
): ResolvedCodegenConfig => {
	if (!config.codegen) {
		return { status: "unconfigured" };
	}

	const codegen = normalizeCodegenConfig(config.codegen);
	return {
		status: "configured",
		version: codegen.version,
		system: codegen.system ?? (config.defaultSystemId?.trim() || null),
		outDir: codegen.outDir,
		fileName: codegen.fileName ?? DEFAULT_CODEGEN_FILE_NAME,
		tvImport: codegen.tvImport ?? DEFAULT_CODEGEN_TV_IMPORT,
		shape: codegen.shape ?? DEFAULT_CODEGEN_SHAPE,
		include: codegen.include ?? null,
		exclude: codegen.exclude ?? [],
		formatter: codegen.formatter
			? {
					command: codegen.formatter.command,
					args: codegen.formatter.args ?? [],
				}
			: null,
		twMerge: codegen.twMerge
			? {
					fileName:
						codegen.twMerge.fileName ?? DEFAULT_CODEGEN_TW_MERGE_FILE_NAME,
					mergeGroups: codegen.twMerge.mergeGroups ?? {},
				}
			: null,
	};
};
