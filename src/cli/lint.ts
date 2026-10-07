import path from "node:path";
import type { LintFinding, LintReport } from "../lint/report";
import { type LintRunResult, runLint } from "../lint/run-lint";

/**
 * `trickroom lint [project] [--check] [--json] [--system <id>]`: lints the
 * project's design system on both sides and ratchets the result against
 * the committed report. Without `--check` a passing run writes
 * `.trickroom/systems/<id>/lint-report.json`; with it nothing is written.
 * Exit codes: 0 pass, 1 ratchet failure, 2 error (no project, invalid
 * config or lint.json, unknown system, a rule that crashed).
 */

const USAGE =
	"Usage: trickroom lint [project] [--check] [--json] [--system <id|name>]";

export type LintCliOptions = {
	projectRoot: string;
	check: boolean;
	json: boolean;
	system: string | null;
};

export const parseLintArgs = (
	args: readonly string[],
	cwd = process.cwd(),
): LintCliOptions => {
	const positional: string[] = [];
	const options: Omit<LintCliOptions, "projectRoot"> = {
		check: false,
		json: false,
		system: null,
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
			case "--system": {
				const value = inline ?? args[++index];
				if (!value || value.startsWith("--")) {
					throw new Error(`--system needs a system id or name. ${USAGE}`);
				}
				options.system = value;
				break;
			}
			default:
				throw new Error(`Unknown option ${arg}. ${USAGE}`);
		}
	}
	if (positional.length > 1) {
		throw new Error(
			`trickroom lint takes at most one project directory. ${USAGE}`,
		);
	}
	return { projectRoot: path.resolve(cwd, positional[0] ?? "."), ...options };
};

const plural = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const describeLocation = (finding: LintFinding) => {
	const location = finding.location;
	if (!location) return "";
	if (location.kind === "code") {
		return `${location.file}${location.line === undefined ? "" : `:${location.line}${location.column === undefined ? "" : `:${location.column}`}`}`;
	}
	return [
		`design ${location.design}`,
		location.board ? `board ${location.board}` : "",
		location.element ? `#${location.element}` : "",
		location.path ? `path ${location.path}` : "",
	]
		.filter(Boolean)
		.join(" ");
};

const describeReport = (report: LintReport): string[] => {
	const lines: string[] = [];
	for (const side of ["code", "design"] as const) {
		const summary = report.summary[side];
		if (!summary) continue;
		const findings = report.findings.filter((finding) => finding.side === side);
		const { errors, warnings, info } = summary.findings;
		lines.push(
			`${side === "code" ? "Code" : "Designs"} (${plural(summary.scanned, side === "code" ? "file" : "design")} scanned): ${plural(errors, "error")}, ${plural(warnings, "warning")}${info > 0 ? `, ${info} info` : ""}`,
		);
		let currentRule: string | null = null;
		for (const finding of findings) {
			if (finding.rule !== currentRule) {
				currentRule = finding.rule;
				lines.push(`  ${finding.rule}`);
			}
			const where = describeLocation(finding);
			lines.push(
				`    ${finding.severity.padEnd(7)} ${where ? `${where}  ` : ""}${finding.message}`,
			);
		}
	}
	return lines;
};

const describeResult = (result: LintRunResult): string[] => {
	const lines: string[] = [];
	for (const diagnostic of result.diagnostics) {
		lines.push(`${diagnostic.severity}: ${diagnostic.message}`);
	}
	if (!result.report || !result.ratchet) {
		lines.push(
			`Lint did not complete${result.system ? ` for system "${result.system.name}"` : ""}; nothing written.`,
		);
		return lines;
	}
	lines.push(...describeReport(result.report));
	const ratchet = result.ratchet;
	for (const regression of ratchet.regressions) {
		lines.push(
			`worse: ${regression.metric} ${regression.baseline} -> ${regression.current}`,
		);
	}
	for (const breach of ratchet.breaches) {
		lines.push(
			`threshold: ${breach.metric} is ${breach.current}, ${breach.kind === "max" ? "at most" : "at least"} ${breach.limit} allowed`,
		);
	}
	const where = `system "${result.report.system.name}"`;
	if (result.status === "error") {
		lines.push(`Lint did not complete for ${where}; nothing written.`);
	} else if (ratchet.status === "fail") {
		lines.push(
			`Lint failed for ${where}: ${plural(ratchet.regressions.length, "number")} worse than the baseline${ratchet.baseline ? ` of ${ratchet.baseline.generatedAt}` : ""}, ${plural(ratchet.breaches.length, "threshold")} broken.${result.written ? ` Report written to ${result.reportPath}.` : ""}`,
		);
	} else {
		lines.push(
			`Lint passed for ${where}${ratchet.baseline ? ` against the baseline of ${ratchet.baseline.generatedAt}` : " (no baseline yet)"}.${result.written ? ` Report written to ${result.reportPath}.` : result.mode === "check" ? " Nothing written (--check)." : ""}`,
		);
	}
	return lines;
};

type Io = { stdout: (line: string) => void; stderr: (line: string) => void };

export const runLintCli = async (
	args: readonly string[],
	io: Io = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
	cwd = process.cwd(),
): Promise<number> => {
	let options: LintCliOptions;
	try {
		options = parseLintArgs(args, cwd);
	} catch (error) {
		io.stderr(error instanceof Error ? error.message : String(error));
		return 2;
	}

	const result = await runLint({
		projectRoot: options.projectRoot,
		system: options.system,
		check: options.check,
	});

	if (options.json) {
		io.stdout(JSON.stringify(result, null, "\t"));
	} else {
		const lines = describeResult(result);
		(result.status === "error" ? io.stderr : io.stdout)(lines.join("\n"));
	}
	return result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2;
};

/** Entry for `bin/trickroom.js lint`. */
export const main = (args: readonly string[]) => runLintCli(args);
