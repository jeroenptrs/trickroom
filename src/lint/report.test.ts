import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type LintFinding,
	type LintReport,
	parseLintReport,
	readLintReport,
	serializeLintReport,
	sortLintFindings,
	summarizeFindings,
	writeLintReport,
} from "./report";

const finding = (overrides: Partial<LintFinding>): LintFinding => ({
	rule: "code.variants-file-stale",
	severity: "error",
	side: "code",
	message: "m",
	location: null,
	...overrides,
});

const report = (): LintReport => ({
	version: 1,
	generatedAt: "2026-01-01T00:00:00.000Z",
	system: { id: "sys_1", name: "Core" },
	contract: { hash: "sha256:a", components: 1 },
	config: { present: false },
	status: "pass",
	summary: {
		code: {
			findings: { errors: 1, warnings: 0, info: 0 },
			rules: {},
			scanned: 1,
		},
		design: null,
	},
	findings: [
		finding({
			location: { kind: "code", file: "src/b.tsx", line: 2, column: 1 },
		}),
		finding({
			rule: "code.a",
			severity: "warning",
			location: { kind: "code", file: "src/b.tsx", line: 1, column: 5 },
		}),
		finding({ location: { kind: "code", file: "src/a.tsx", line: 9 } }),
	],
	components: [
		{
			slug: "b",
			componentId: "cmp_b",
			name: "B",
			published: true,
			generated: null,
			bound: null,
			usedInApp: null,
			usedInDesigns: null,
			wrappers: [],
			usages: 0,
		},
		{
			slug: "a",
			componentId: "cmp_a",
			name: "A",
			published: false,
			generated: null,
			bound: null,
			usedInApp: null,
			usedInDesigns: null,
			wrappers: [],
			usages: 0,
		},
	],
	files: [
		{
			file: "src/b.tsx",
			role: null,
			component: null,
			usages: 0,
			findings: { errors: 1, warnings: 1, info: 0 },
		},
		{
			file: "src/a.tsx",
			role: "wrapper",
			component: "a",
			usages: 2,
			findings: { errors: 1, warnings: 0, info: 0 },
		},
	],
	designs: null,
	ratchetBaseline: {
		generatedAt: "2026-01-01T00:00:00.000Z",
		numbers: { "code.warnings": 0, "code.errors": 1 },
	},
});

describe("lint report", () => {
	const temps: string[] = [];
	afterEach(async () => {
		await Promise.all(
			temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("sorts findings by side, rule, location, severity and message", () => {
		const sorted = sortLintFindings([
			finding({
				side: "design",
				rule: "design.x",
				location: { kind: "design", design: "d", board: "b" },
			}),
			finding({ message: "z" }),
			finding({ message: "a" }),
			finding({ location: { kind: "code", file: "src/a.tsx", line: 2 } }),
			finding({
				location: { kind: "code", file: "src/a.tsx", line: 1, column: 3 },
			}),
			finding({ rule: "code.a" }),
		]);
		expect(
			sorted.map(
				(entry) =>
					`${entry.side} ${entry.rule} ${JSON.stringify(entry.location)} ${entry.message}`,
			),
		).toEqual([
			"code code.a null m",
			"code code.variants-file-stale null a",
			"code code.variants-file-stale null z",
			'code code.variants-file-stale {"kind":"code","file":"src/a.tsx","line":1,"column":3} m',
			'code code.variants-file-stale {"kind":"code","file":"src/a.tsx","line":2} m',
			'design design.x {"kind":"design","design":"d","board":"b"} m',
		]);
	});

	it("summarises a side with every enabled rule present", () => {
		const summary = summarizeFindings(
			[
				finding({}),
				finding({ severity: "info" }),
				finding({ rule: "code.b", severity: "warning" }),
				finding({ side: "design", rule: "design.x" }),
			],
			"code",
			["code.variants-file-stale", "code.a"],
			7,
		);
		expect(summary).toEqual({
			findings: { errors: 1, warnings: 1, info: 1 },
			rules: {
				"code.a": { errors: 0, warnings: 0, info: 0 },
				"code.b": { errors: 0, warnings: 1, info: 0 },
				"code.variants-file-stale": { errors: 1, warnings: 0, info: 1 },
			},
			scanned: 7,
		});
	});

	it("serialises in a stable order and parses back", () => {
		const text = serializeLintReport(report());
		const parsed = parseLintReport(JSON.parse(text));
		expect(parsed.issue).toBeNull();
		expect(
			parsed.report?.components.map((component) => component.slug),
		).toEqual(["a", "b"]);
		expect(parsed.report?.files.map((file) => file.file)).toEqual([
			"src/a.tsx",
			"src/b.tsx",
		]);
		expect(
			parsed.report?.findings.map(
				(entry) =>
					`${entry.rule}:${entry.location?.kind === "code" ? entry.location.file : ""}`,
			),
		).toEqual([
			"code.a:src/b.tsx",
			"code.variants-file-stale:src/a.tsx",
			"code.variants-file-stale:src/b.tsx",
		]);
		expect(Object.keys(parsed.report?.ratchetBaseline.numbers ?? {})).toEqual([
			"code.errors",
			"code.warnings",
		]);
		expect(serializeLintReport(parsed.report as LintReport)).toBe(text);
		expect(parseLintReport({ version: 2 }).issue?.code).toBe(
			"UNSUPPORTED_VERSION",
		);
		expect(
			parseLintReport({ ...JSON.parse(text), findings: [{}] }).issue?.code,
		).toBe("INVALID_REPORT");
	});

	it("reads, writes atomically and refuses folders outside .trickroom/systems", async () => {
		const root = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-report-")),
		);
		temps.push(root);
		const systemDir = path.join(root, ".trickroom", "systems", "core");
		await mkdir(systemDir, { recursive: true });
		expect(await readLintReport(systemDir)).toMatchObject({ status: "absent" });

		const written = await writeLintReport(root, systemDir, report());
		expect(written.path).toBe(path.join(systemDir, "lint-report.json"));
		expect(await readFile(written.path, "utf8")).toBe(written.contents);
		expect(await readLintReport(systemDir)).toMatchObject({
			status: "present",
			report: { system: { id: "sys_1" } },
		});

		await writeFile(written.path, "{ nope");
		expect(await readLintReport(systemDir)).toMatchObject({
			status: "invalid",
			issue: { code: "INVALID_REPORT" },
		});

		const outside = path.join(root, "elsewhere");
		await mkdir(outside, { recursive: true });
		await expect(writeLintReport(root, outside, report())).rejects.toThrow(
			"is not a system folder",
		);
		const linked = path.join(root, ".trickroom", "systems", "linked");
		await symlink(outside, linked);
		await expect(writeLintReport(root, linked, report())).rejects.toThrow(
			"is not a system folder",
		);
		await expect(
			writeLintReport(root, path.join(systemDir, "nested"), report()),
		).rejects.toThrow();
	});
});
