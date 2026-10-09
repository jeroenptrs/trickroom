import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	readlink,
	realpath,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	ExportDestinationError,
	resolveExportDestinationDir,
} from "../export/write-export-artifacts";
import { findDesignSystem } from "../utils/design-system-store";
import {
	readSystemComponentManifest,
	SystemComponentManifestServiceError,
} from "../utils/system-component-manifest-service";
import { loadDerivedTwMerge } from "../utils/tailwind-merge-derive";
import type { ResolvedCodegenConfig } from "./config";
import {
	FORMATTER_CONCURRENCY,
	mapWithConcurrency,
	runCodegenFormatter,
} from "./formatter";
import {
	type CodegenDiagnosticCode,
	type CodegenHeader,
	type CodegenSource,
	type GeneratedVariantsFile,
	generateVariantsFiles,
	parseCodegenHeader,
} from "./generate";
import { parseTwMergeHeader, type TwMergeCodegenHeader } from "./header";
import {
	type GeneratedTwMergeFile,
	generateTwMergeFile,
} from "./tw-merge-file";

/**
 * Connects the pure generator to the filesystem, for `trickroom codegen` and
 * `design_export({ format: "variants" })`. Generates in memory, formats,
 * compares with disk and, in write mode, writes only what differs. Never
 * prints; the result is JSON-serialisable and documented in docs/codegen.md.
 *
 * Check mode changes nothing on disk: the system and component manifests are
 * read with `readOnly`, and nothing is written, renamed or created.
 */

export type CodegenMode = "write" | "check";
export type CodegenComponentStatus = "ok" | "missing" | "stale" | "error";
/**
 * Why a file is stale: the component moved on since it was generated
 * (`source-changed`), the body was edited or reformatted (`body-edited`), or
 * the file has no Trickroom header (`not-generated`).
 */
export type CodegenStaleReason =
	| "source-changed"
	| "body-edited"
	| "not-generated";

export type CodegenRunDiagnosticCode =
	| CodegenDiagnosticCode
	| "NO_SYSTEM"
	| "SYSTEM_NOT_FOUND"
	| "INVALID_COMPONENT_MANIFEST"
	| "COMPONENT_MANIFEST_DIAGNOSTIC"
	| "OUT_DIR_OUTSIDE_PROJECT"
	| "OUT_DIR_NOT_A_FOLDER"
	| "TARGET_OUTSIDE_PROJECT"
	| "TARGET_NOT_A_FILE"
	| "FORMATTER_FAILED"
	| "REFUSED_OVERWRITE"
	| "WRITE_FAILED"
	| "TW_MERGE_NO_CSS"
	| "TW_MERGE_CSS_FAILED";

export type CodegenRunDiagnostic = {
	code: CodegenRunDiagnosticCode;
	severity: "error" | "warning";
	message: string;
	slug?: string;
	componentId?: string;
	path?: string;
	/** REFUSED_OVERWRITE: the files without a Trickroom header. */
	paths?: string[];
};

export type CodegenComponentResult = {
	slug: string;
	componentId: string;
	/** Output path, relative to the project root, with `/` separators. */
	file: string;
	status: CodegenComponentStatus;
	/** What the generated file was built from; `draft` only with source draft. */
	source: CodegenSource;
	shape: "flat" | "slots";
	publishedVersion: string | null;
	sourceHash: string;
	/** The header of the file on disk; null when missing or not ours. */
	onDisk: {
		publishedVersion: string | null;
		sourceHash: string;
		source: CodegenSource;
	} | null;
	reason?: CodegenStaleReason;
	message?: string;
};

/** The generated tailwind-merge config file (`codegen.twMerge`). */
export type CodegenTwMergeResult = {
	/** Output path, relative to the project root, with `/` separators. */
	file: string;
	status: CodegenComponentStatus;
	/** Hash of the config derived from the system's Tailwind CSS. */
	sourceHash: string;
	/** The header of the file on disk; null when missing or not ours. */
	onDisk: { sourceHash: string } | null;
	reason?: CodegenStaleReason;
	message?: string;
};

export type CodegenRunResult = {
	status: "ok" | "drift" | "error";
	mode: CodegenMode;
	source: CodegenSource;
	system: { id: string; name: string } | null;
	/** Relative to the project root, with `/` separators. */
	outDir: string;
	components: CodegenComponentResult[];
	/** Files in outDir with this system's header that no selected component generates. */
	orphaned: string[];
	/** The tailwind-merge config file; null when `codegen.twMerge` is not set. */
	twMerge: CodegenTwMergeResult | null;
	diagnostics: CodegenRunDiagnostic[];
	/** Files this run wrote; always empty in check mode. */
	written: string[];
};

export type RunCodegenInput = {
	projectRoot: string;
	config: Extract<ResolvedCodegenConfig, { status: "configured" }>;
	mode: CodegenMode;
	source?: CodegenSource;
	/** Overwrite files at target paths that have no Trickroom header. */
	force?: boolean;
	formatterTimeoutMs?: number;
};

/** The smallest block that turns codegen on, for "not configured" messages. */
export const MINIMAL_CODEGEN_BLOCK = `"codegen": { "version": 1, "outDir": "src/components/ui" }`;

export const describeUnconfiguredCodegen = (configPath: string) =>
	`Codegen is not configured for this project. Add a codegen block to ${configPath}, for example ${MINIMAL_CODEGEN_BLOCK}; "outDir" is where the files go, relative to the project root, and "system" (a system id or name) defaults to the project's default system. See docs/codegen.md.`;

const HEADER_PEEK_BYTES = 4096;

const toPosix = (relative: string) => relative.split(path.sep).join("/");

const normalizeNewlines = (text: string) => text.replace(/\r\n/gu, "\n");

const isInside = (root: string, target: string) =>
	target === root || target.startsWith(`${root}${path.sep}`);

const errnoCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/**
 * The real path of `target`, or of its nearest existing ancestor joined with
 * the rest. A dangling symlink resolves to where it points, since writing
 * through it would create the file there.
 */
const realpathOfNearest = async (
	target: string,
	depth = 0,
): Promise<string> => {
	try {
		return await realpath(target);
	} catch (error) {
		if (errnoCode(error) !== "ENOENT" || depth > 32) {
			throw error;
		}
		const parent = await realpathOfNearest(path.dirname(target), depth + 1);
		if (parent === target) {
			return target;
		}
		const link = await readlink(target).catch(() => null);
		return link === null
			? path.join(parent, path.basename(target))
			: realpathOfNearest(path.resolve(parent, link), depth + 1);
	}
};

const readIfExists = async (filePath: string): Promise<string | null> => {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (errnoCode(error) === "ENOENT") {
			return null;
		}
		throw error;
	}
};

/**
 * The header in the first bytes of a file, enough for the two header
 * lines: a variants file's or the tailwind-merge config's.
 */
const peekHeader = async (
	filePath: string,
): Promise<CodegenHeader | TwMergeCodegenHeader | null> => {
	const handle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(HEADER_PEEK_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, HEADER_PEEK_BYTES, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		return parseCodegenHeader(text) ?? parseTwMergeHeader(text);
	} finally {
		await handle.close();
	}
};

const sameSource = (left: CodegenHeader, right: CodegenHeader) =>
	left.systemId === right.systemId &&
	left.componentId === right.componentId &&
	left.source === right.source &&
	left.publishedVersion === right.publishedVersion &&
	left.templateHash === right.templateHash &&
	left.variantSchemaHash === right.variantSchemaHash &&
	left.sourceHash === right.sourceHash;

const describeStale = (
	reason: CodegenStaleReason,
	expected: CodegenHeader,
	onDisk: CodegenHeader | null,
) => {
	if (reason === "not-generated") {
		return NOT_GENERATED_MESSAGE;
	}
	if (reason === "body-edited") {
		return BODY_EDITED_MESSAGE;
	}
	if (onDisk && onDisk.source !== expected.source) {
		return `Generated from the ${onDisk.source} source; this run uses the ${expected.source} source.`;
	}
	if (onDisk && onDisk.publishedVersion !== expected.publishedVersion) {
		return `Generated from published version ${onDisk.publishedVersion ?? "none"}; the component is at ${expected.publishedVersion ?? "its draft"}.`;
	}
	return "The component changed since the file was generated.";
};

const NOT_GENERATED_MESSAGE =
	"The file has no Trickroom codegen header, so Trickroom did not generate it.";
const BODY_EDITED_MESSAGE =
	"The file body differs from the generated output (edited by hand or reformatted); its header matches.";

type PlannedCommon = {
	absolutePath: string;
	relativePath: string;
	expected: string | null;
	onDisk: string | null;
};

/**
 * A file this run generates: a component's variants file or the
 * tailwind-merge config. Both go through the same path checks, formatter,
 * comparison, ownership rule and write; the header decides the rest.
 */
type PlanSource =
	| { kind: "component"; file: GeneratedVariantsFile }
	| { kind: "tw-merge"; file: GeneratedTwMergeFile };

type Planned = PlannedCommon &
	(
		| {
				kind: "component";
				file: GeneratedVariantsFile;
				onDiskHeader: CodegenHeader | null;
				result: CodegenComponentResult;
		  }
		| {
				kind: "tw-merge";
				file: GeneratedTwMergeFile;
				onDiskHeader: TwMergeCodegenHeader | null;
				result: CodegenTwMergeResult;
		  }
	);

/** Whether `text` starts with exactly the header this run generated. */
const keepsHeader = (entry: Planned, text: string) => {
	if (entry.kind === "component") {
		const header = parseCodegenHeader(text);
		return (
			header !== null &&
			header.slug === entry.file.header.slug &&
			sameSource(header, entry.file.header)
		);
	}
	const header = parseTwMergeHeader(text);
	return (
		header !== null &&
		header.systemId === entry.file.header.systemId &&
		header.sourceHash === entry.file.header.sourceHash
	);
};

/** What diagnostics about the file name. */
const ownerOf = (entry: PlanSource) =>
	entry.kind === "component"
		? {
				slug: entry.file.header.slug,
				componentId: entry.file.header.componentId,
			}
		: {};

/** Why the file on disk, which differs from the expected output, is stale. */
const staleOf = (
	entry: Planned,
): { reason: CodegenStaleReason; message: string } => {
	if (entry.kind === "component") {
		const reason: CodegenStaleReason = !entry.onDiskHeader
			? "not-generated"
			: sameSource(entry.onDiskHeader, entry.file.header)
				? "body-edited"
				: "source-changed";
		return {
			reason,
			message: describeStale(reason, entry.file.header, entry.onDiskHeader),
		};
	}
	if (!entry.onDiskHeader) {
		return { reason: "not-generated", message: NOT_GENERATED_MESSAGE };
	}
	return entry.onDiskHeader.systemId === entry.file.header.systemId &&
		entry.onDiskHeader.sourceHash === entry.file.header.sourceHash
		? { reason: "body-edited", message: BODY_EDITED_MESSAGE }
		: {
				reason: "source-changed",
				message:
					"The design system's Tailwind CSS changed since the file was generated.",
			};
};

/** Records `header` (on disk, or just written) in the entry's result. */
const recordOnDisk = (entry: Planned, written: boolean) => {
	if (entry.kind === "component") {
		const header = written ? entry.file.header : entry.onDiskHeader;
		if (header) {
			entry.result.onDisk = {
				publishedVersion: header.publishedVersion,
				sourceHash: header.sourceHash,
				source: header.source,
			};
		}
		return;
	}
	const header = written ? entry.file.header : entry.onDiskHeader;
	if (header) {
		entry.result.onDisk = { sourceHash: header.sourceHash };
	}
};

export async function runCodegen(
	input: RunCodegenInput,
): Promise<CodegenRunResult> {
	const { config, mode } = input;
	const source = input.source ?? "published";
	const projectRoot = path.resolve(input.projectRoot);
	const diagnostics: CodegenRunDiagnostic[] = [];
	const result: CodegenRunResult = {
		status: "error",
		mode,
		source,
		system: null,
		outDir: toPosix(path.normalize(config.outDir)),
		components: [],
		orphaned: [],
		twMerge: null,
		diagnostics,
		written: [],
	};
	const fail = (diagnostic: Omit<CodegenRunDiagnostic, "severity">) => {
		diagnostics.push({ ...diagnostic, severity: "error" });
		return result;
	};

	// System and components, read without migrating anything.
	if (!config.system) {
		return fail({
			code: "NO_SYSTEM",
			message:
				'No system to generate from: set "system" in the codegen block or a defaultSystemId for the project.',
		});
	}
	const system = await findDesignSystem(projectRoot, config.system, {
		readOnly: true,
	});
	if (!system) {
		return fail({
			code: "SYSTEM_NOT_FOUND",
			message: `No design system matches codegen.system "${config.system}" (id, name or storage key) under .trickroom/systems.`,
		});
	}
	const systemId = system.manifest.systemId;
	result.system = { id: systemId, name: system.manifest.systemName };

	let manifestRead: Awaited<ReturnType<typeof readSystemComponentManifest>>;
	try {
		manifestRead = await readSystemComponentManifest(projectRoot, systemId, {
			readOnly: true,
		});
	} catch (error) {
		if (error instanceof SystemComponentManifestServiceError) {
			return fail({
				code: "INVALID_COMPONENT_MANIFEST",
				message: [
					error.message,
					...error.diagnostics.map((diagnostic) => diagnostic.message),
				].join(" "),
			});
		}
		throw error;
	}
	for (const diagnostic of manifestRead.diagnostics) {
		diagnostics.push({
			code: "COMPONENT_MANIFEST_DIAGNOSTIC",
			severity: "warning",
			message: diagnostic.message,
			...(diagnostic.path ? { path: diagnostic.path } : {}),
		});
	}

	const generated = generateVariantsFiles({
		manifest: manifestRead.manifest,
		systemId,
		source,
		shape: config.shape,
		fileName: config.fileName,
		tvImport: config.tvImport,
		include: config.include ?? undefined,
		exclude: config.exclude,
	});
	diagnostics.push(...generated.diagnostics);
	if (generated.diagnostics.some((entry) => entry.severity === "error")) {
		return result;
	}

	// The tailwind-merge config, derived from the system's Tailwind CSS.
	let twMergeFile: GeneratedTwMergeFile | null = null;
	if (config.twMerge) {
		const cssPath = system.manifest.cssPath?.trim();
		if (!cssPath) {
			return fail({
				code: "TW_MERGE_NO_CSS",
				message: `codegen.twMerge derives ${config.twMerge.fileName} from the system's Tailwind CSS, but system "${system.manifest.systemName}" has no cssPath.`,
			});
		}
		try {
			twMergeFile = generateTwMergeFile({
				derived: await loadDerivedTwMerge({ projectRoot, cssPath }),
				systemId,
				fileName: config.twMerge.fileName,
			});
		} catch (error) {
			return fail({
				code: "TW_MERGE_CSS_FAILED",
				message: `codegen.twMerge could not load the system's Tailwind CSS (${cssPath}): ${error instanceof Error ? error.message : String(error)}`,
			});
		}
		const clash = generated.files.find(
			(file) => file.fileName === twMergeFile?.fileName,
		);
		if (clash) {
			return fail({
				code: "DUPLICATE_FILE_NAME",
				message: `codegen.twMerge.fileName "${twMergeFile.fileName}" is also the variants file of component "${clash.header.slug}". Choose another file name for one of them.`,
				slug: clash.header.slug,
				componentId: clash.header.componentId,
			});
		}
	}

	// Paths: outDir and every target must stay inside the project, symlinks
	// followed.
	let outDirPath: string;
	try {
		outDirPath = resolveExportDestinationDir(projectRoot, config.outDir);
	} catch (error) {
		if (error instanceof ExportDestinationError) {
			return fail({
				code: "OUT_DIR_OUTSIDE_PROJECT",
				message: `codegen.outDir "${config.outDir}" must stay inside the project root.`,
			});
		}
		throw error;
	}
	const realRoot = await realpath(projectRoot);
	const realOutDir = await realpathOfNearest(outDirPath);
	if (!isInside(realRoot, realOutDir)) {
		return fail({
			code: "OUT_DIR_OUTSIDE_PROJECT",
			message: `codegen.outDir "${config.outDir}" resolves to ${realOutDir}, outside the project root ${realRoot} (through a symlink).`,
		});
	}
	const outDirStat = await lstat(realOutDir).catch((error) => {
		if (errnoCode(error) === "ENOENT") return null;
		throw error;
	});
	if (outDirStat && !outDirStat.isDirectory()) {
		return fail({
			code: "OUT_DIR_NOT_A_FOLDER",
			message: `codegen.outDir "${config.outDir}" is a file, not a folder.`,
		});
	}

	const toPlan: PlanSource[] = [
		...generated.files.map((file) => ({ kind: "component" as const, file })),
		...(twMergeFile ? [{ kind: "tw-merge" as const, file: twMergeFile }] : []),
	];
	const planned: Planned[] = [];
	for (const next of toPlan) {
		const absolutePath = path.join(outDirPath, next.file.fileName);
		const relativePath = toPosix(path.relative(projectRoot, absolutePath));
		const owner = ownerOf(next);
		const realTarget = await realpathOfNearest(absolutePath);
		if (!isInside(realRoot, realTarget)) {
			fail({
				code: "TARGET_OUTSIDE_PROJECT",
				message: `${relativePath} resolves to ${realTarget}, outside the project root (through a symlink).`,
				...owner,
				path: relativePath,
			});
			continue;
		}
		const targetStat = await lstat(realTarget).catch((error) => {
			if (errnoCode(error) === "ENOENT") return null;
			throw error;
		});
		if (targetStat && !targetStat.isFile()) {
			fail({
				code: "TARGET_NOT_A_FILE",
				message: `${relativePath} exists and is not a file.`,
				...owner,
				path: relativePath,
			});
			continue;
		}
		const onDisk = targetStat ? await readIfExists(realTarget) : null;
		const common = { absolutePath, relativePath, expected: null, onDisk };
		if (next.kind === "component") {
			const { file } = next;
			planned.push({
				...common,
				kind: "component",
				file,
				onDiskHeader: onDisk === null ? null : parseCodegenHeader(onDisk),
				result: {
					slug: file.header.slug,
					componentId: file.header.componentId,
					file: relativePath,
					status: "ok",
					source: file.header.source,
					shape: file.shape,
					publishedVersion: file.header.publishedVersion,
					sourceHash: file.header.sourceHash,
					onDisk: null,
				},
			});
		} else {
			planned.push({
				...common,
				kind: "tw-merge",
				file: next.file,
				onDiskHeader: onDisk === null ? null : parseTwMergeHeader(onDisk),
				result: {
					file: relativePath,
					status: "ok",
					sourceHash: next.file.header.sourceHash,
					onDisk: null,
				},
			});
		}
	}
	if (diagnostics.some((entry) => entry.severity === "error")) {
		return result;
	}

	// Format everything before comparing, so a formatted file on disk is ok.
	const formatter = config.formatter;
	await mapWithConcurrency(planned, FORMATTER_CONCURRENCY, async (entry) => {
		if (!formatter) {
			entry.expected = entry.file.contents;
			return;
		}
		const formatted = await runCodegenFormatter(formatter, {
			projectRoot,
			file: entry.relativePath,
			contents: entry.file.contents,
			timeoutMs: input.formatterTimeoutMs,
		});
		if (!formatted.ok) {
			entry.result.status = "error";
			entry.result.message = formatted.message;
			return;
		}
		if (!keepsHeader(entry, formatted.contents)) {
			entry.result.status = "error";
			entry.result.message = `Formatter "${formatter.command}" changed the two Trickroom header lines of ${entry.relativePath}; they must stay the first two lines, unchanged.`;
			return;
		}
		entry.expected = formatted.contents;
	});

	for (const entry of planned) {
		const { result: file } = entry;
		recordOnDisk(entry, false);
		if (file.status === "error") {
			diagnostics.push({
				code: "FORMATTER_FAILED",
				severity: "error",
				message: file.message ?? "Formatter failed.",
				...ownerOf(entry),
				path: entry.relativePath,
			});
			continue;
		}
		if (entry.onDisk === null) {
			file.status = "missing";
			continue;
		}
		if (
			normalizeNewlines(entry.onDisk) ===
			normalizeNewlines(entry.expected ?? "")
		) {
			continue;
		}
		const stale = staleOf(entry);
		file.status = "stale";
		file.reason = stale.reason;
		file.message = stale.message;
	}

	// Orphans: this system's generated files that no selected component owns.
	const targets = new Set(planned.map((entry) => entry.file.fileName));
	if (outDirStat) {
		const entries = await readdir(realOutDir, { withFileTypes: true });
		for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!dirent.isFile() || targets.has(dirent.name)) {
				continue;
			}
			const header = await peekHeader(path.join(realOutDir, dirent.name)).catch(
				() => null,
			);
			if (header?.systemId === systemId) {
				result.orphaned.push(
					toPosix(
						path.relative(projectRoot, path.join(outDirPath, dirent.name)),
					),
				);
			}
		}
	}

	const hasErrors = () =>
		diagnostics.some((entry) => entry.severity === "error");
	result.components = planned.flatMap((entry) =>
		entry.kind === "component" ? [entry.result] : [],
	);
	result.twMerge =
		planned.find((entry) => entry.kind === "tw-merge")?.result ?? null;

	if (mode === "check" || hasErrors()) {
		result.status = hasErrors()
			? "error"
			: planned.some((entry) => entry.result.status !== "ok") ||
					result.orphaned.length > 0
				? "drift"
				: "ok";
		return result;
	}

	// Write mode. Ownership: a file without our header is not ours to replace.
	const foreign = planned.filter(
		(entry) => entry.result.reason === "not-generated",
	);
	if (foreign.length > 0 && !input.force) {
		const paths = foreign.map((entry) => entry.relativePath);
		for (const entry of foreign) {
			entry.result.status = "error";
		}
		fail({
			code: "REFUSED_OVERWRITE",
			message: `Refusing to overwrite ${paths.length === 1 ? "a file" : `${paths.length} files`} without a Trickroom codegen header: ${paths.join(", ")}. Trickroom only replaces files it generated. To hand ${paths.length === 1 ? "this file" : "these files"} over to Trickroom (for example from an older generator), review ${paths.length === 1 ? "it" : "them"} and run "trickroom codegen --force" once; later runs recognise the header.`,
			paths,
		});
		return result;
	}

	const pending = planned.filter((entry) => entry.result.status !== "ok");
	if (pending.length > 0) {
		await mkdir(outDirPath, { recursive: true });
	}
	for (const entry of pending) {
		try {
			// writeFile follows a symlinked target, which was checked above.
			await writeFile(entry.absolutePath, entry.expected ?? "", "utf8");
		} catch (error) {
			entry.result.status = "error";
			entry.result.message = `Could not write ${entry.relativePath}: ${error instanceof Error ? error.message : String(error)}`;
			fail({
				code: "WRITE_FAILED",
				message: entry.result.message,
				...ownerOf(entry),
				path: entry.relativePath,
			});
			continue;
		}
		result.written.push(entry.relativePath);
		entry.result.status = "ok";
		delete entry.result.reason;
		delete entry.result.message;
		recordOnDisk(entry, true);
	}
	result.status = hasErrors() ? "error" : "ok";
	return result;
}
