import { stat } from "node:fs/promises";
import path from "node:path";
import { resolveCodegenConfig } from "../codegen/config";
import {
	type CodegenRunResult,
	describeUnconfiguredCodegen,
	runCodegen,
} from "../codegen/run-codegen";
import { readProjectConfigReadOnly } from "../project";

/**
 * `trickroom codegen [project] [--check] [--json] [--source draft|published]
 * [--force]`: writes (or checks) the tailwind-variants files configured by
 * the project's codegen block. Exit codes: 0 current or written, 1 drift in
 * check mode, 2 for configuration errors, generation errors, formatter
 * failures and refused overwrites.
 */

const USAGE =
	"Usage: trickroom codegen [project] [--check] [--json] [--source published|draft] [--force]";

export type CodegenCliOptions = {
	projectRoot: string;
	check: boolean;
	json: boolean;
	source: "published" | "draft";
	force: boolean;
};

export const parseCodegenArgs = (
	args: readonly string[],
	cwd = process.cwd(),
): CodegenCliOptions => {
	const positional: string[] = [];
	const options: Omit<CodegenCliOptions, "projectRoot"> = {
		check: false,
		json: false,
		source: "published",
		force: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const [flag, inline] = arg.includes("=")
			? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
			: [arg, undefined];
		switch (flag) {
			case "--check":
				options.check = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--force":
				options.force = true;
				break;
			case "--source": {
				const value = inline ?? args[++index];
				if (value !== "published" && value !== "draft") {
					throw new Error(
						`--source must be "published" or "draft"${value === undefined ? "" : `; got ${JSON.stringify(value)}`}. ${USAGE}`,
					);
				}
				options.source = value;
				break;
			}
			default:
				throw new Error(`Unknown option ${arg}. ${USAGE}`);
		}
	}
	if (positional.length > 1) {
		throw new Error(
			`trickroom codegen takes at most one project directory. ${USAGE}`,
		);
	}
	if (options.check && options.force) {
		throw new Error(
			`--force only applies when writing, not with --check. ${USAGE}`,
		);
	}
	return { projectRoot: path.resolve(cwd, positional[0] ?? "."), ...options };
};

const plural = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const describeResult = (result: CodegenRunResult): string[] => {
	const lines: string[] = [];
	for (const component of result.components) {
		if (component.status === "ok") {
			continue;
		}
		lines.push(
			[
				component.status.padEnd(8),
				component.file,
				component.message ? `  ${component.message}` : "",
			].join(" "),
		);
	}
	for (const file of result.orphaned) {
		lines.push(
			`${"orphaned".padEnd(8)} ${file}  Generated for this system, but no selected component generates it (renamed, deleted or excluded). Delete it once nothing imports it.`,
		);
	}
	for (const diagnostic of result.diagnostics) {
		if (diagnostic.code === "FORMATTER_FAILED") {
			continue; // Already on the component's line.
		}
		lines.push(`${diagnostic.severity}: ${diagnostic.message}`);
	}

	const count = (status: string) =>
		result.components.filter((component) => component.status === status).length;
	const where = `${result.system ? `system "${result.system.name}"` : "codegen"} -> ${result.outDir}${result.source === "draft" ? " (draft source)" : ""}`;
	if (result.mode === "check") {
		const parts = [
			`${count("ok")} ok`,
			...(["stale", "missing", "error"] as const)
				.filter((status) => count(status) > 0)
				.map((status) => `${count(status)} ${status}`),
			...(result.orphaned.length > 0
				? [`${result.orphaned.length} orphaned`]
				: []),
		];
		lines.push(
			`Checked ${plural(result.components.length, "component")} for ${where}: ${parts.join(", ")}.${result.status === "drift" ? ` Run "trickroom codegen${result.source === "draft" ? " --source draft" : ""}" to update.` : ""}`,
		);
	} else if (result.status === "error") {
		lines.push(`Nothing written for ${where}.`);
	} else {
		lines.push(
			`Wrote ${plural(result.written.length, "file")} for ${where}; ${result.components.length - result.written.length} already current.${result.orphaned.length > 0 ? ` ${plural(result.orphaned.length, "orphaned file")} left in place.` : ""}`,
		);
	}
	return lines;
};

type Io = { stdout: (line: string) => void; stderr: (line: string) => void };

export const runCodegenCli = async (
	args: readonly string[],
	io: Io = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
	cwd = process.cwd(),
): Promise<number> => {
	let options: CodegenCliOptions;
	try {
		options = parseCodegenArgs(args, cwd);
	} catch (error) {
		io.stderr(error instanceof Error ? error.message : String(error));
		return 2;
	}

	const configError = (code: string, message: string) => {
		if (options.json) {
			io.stdout(JSON.stringify({ status: "error", code, message }, null, "\t"));
		}
		io.stderr(message);
		return 2;
	};

	const exists = await stat(path.join(options.projectRoot, ".trickroom")).then(
		(entry) => entry.isDirectory(),
		() => false,
	);
	if (!exists) {
		return configError(
			"NOT_A_PROJECT",
			`No Trickroom project at ${options.projectRoot} (.trickroom is missing).`,
		);
	}

	// Read-only for writes too: codegen writes its output files and nothing
	// else, so it never migrates the project config.
	let read: Awaited<ReturnType<typeof readProjectConfigReadOnly>>;
	try {
		read = await readProjectConfigReadOnly(options.projectRoot);
	} catch (error) {
		return configError(
			"INVALID_CONFIG",
			error instanceof Error ? error.message : String(error),
		);
	}
	const config = resolveCodegenConfig(read.config);
	if (config.status === "unconfigured") {
		return configError(
			"CODEGEN_NOT_CONFIGURED",
			describeUnconfiguredCodegen(
				path.relative(options.projectRoot, read.configPath) || read.configPath,
			),
		);
	}

	const result = await runCodegen({
		projectRoot: options.projectRoot,
		config,
		mode: options.check ? "check" : "write",
		source: options.source,
		force: options.force,
	});

	if (options.json) {
		io.stdout(JSON.stringify(result, null, "\t"));
	} else {
		const lines = describeResult(result);
		(result.status === "error" ? io.stderr : io.stdout)(lines.join("\n"));
	}
	return result.status === "ok" ? 0 : result.status === "drift" ? 1 : 2;
};

/** Entry for `bin/trickroom.js codegen`. */
export const main = (args: readonly string[]) => runCodegenCli(args);
