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
import type { LintComponentLocation } from "./rules/types";

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
	ratchet: {
		status: "pass",
		baseline: {
			generatedAt: "2025-12-01T00:00:00.000Z",
			numbers: { "code.warnings": 1, "code.errors": 2 },
		},
		regressions: [],
		breaches: [
			{ metric: "rule.code.b", kind: "max", limit: 0, current: 1 },
			{ metric: "code.errors", kind: "max", limit: 0, current: 1 },
		],
		adopted: [
			{ metric: "rule.code.b", current: 1, reason: "explicit", baseline: 0 },
			{ metric: "rule.code.a", current: 0, reason: "new-kind" },
		],
		numbers: { "code.warnings": 0, "code.errors": 1 },
	},
	ratchetBaseline: {
		generatedAt: "2026-01-01T00:00:00.000Z",
		numbers: { "code.warnings": 0, "code.errors": 1 },
		kinds: ["code.b", "code.a"],
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

	it("orders component locations after code and before design locations", () => {
		const component = (componentLocation: Partial<LintComponentLocation>) =>
			finding({
				side: "design",
				rule: "design.x",
				location: null,
				componentLocation: {
					componentId: "cmp_a",
					version: "1",
					...componentLocation,
				},
			});
		const sorted = sortLintFindings([
			finding({
				side: "design",
				rule: "design.x",
				location: { kind: "design", design: "d" },
			}),
			component({ path: "root", compound: 0 }),
			component({ path: "root", axis: "tone", value: "loud" }),
			component({ path: "root", slot: "children" }),
			component({ path: "root" }),
			component({ version: "2", path: "label" }),
			component({ componentId: "cmp_0", version: "3" }),
			finding({ side: "design", rule: "design.x", location: null }),
		]);
		expect(
			sorted.map((entry) =>
				entry.componentLocation
					? `${entry.componentLocation.componentId}@${entry.componentLocation.version} ${entry.componentLocation.path ?? ""} ${entry.componentLocation.slot ?? ""} ${entry.componentLocation.axis ?? ""} ${entry.componentLocation.compound ?? ""}`
					: String(entry.location?.kind ?? null),
			),
		).toEqual([
			"null",
			"cmp_0@3    ",
			"cmp_a@1 root   ",
			"cmp_a@1 root   0",
			"cmp_a@1 root  tone ",
			"cmp_a@1 root children  ",
			"cmp_a@2 label   ",
			"design",
		]);
	});

	const located: LintFinding = {
		rule: "design.non-canonical-class",
		severity: "warning",
		side: "design",
		message: "m",
		component: "badge",
		location: null,
		componentLocation: {
			componentId: "cmp_a",
			version: "1",
			path: "root",
			axis: "tone",
			value: "loud",
		},
	};

	it("reads reports with and without component locations", () => {
		// A report written before component locations existed reads as it was.
		const old = JSON.parse(serializeLintReport(report()));
		old.findings.push({
			rule: "design.non-canonical-class",
			severity: "warning",
			side: "design",
			message: "m",
			location: {
				kind: "design",
				design: "d",
				board: "b",
				element: "e",
				path: "boards[0].props.className",
			},
		});
		expect(parseLintReport(old).issue).toBeNull();

		const text = serializeLintReport({
			...report(),
			findings: [...report().findings, located],
		});
		const parsed = parseLintReport(JSON.parse(text));
		expect(parsed.issue).toBeNull();
		expect(parsed.report?.findings.at(-1)).toEqual(located);
		expect(serializeLintReport(parsed.report as LintReport)).toBe(text);
		// A slot default child's location keeps its slot.
		const slotted: LintFinding = {
			...located,
			componentLocation: {
				componentId: "cmp_a",
				version: "1",
				slot: "children",
				path: "label",
			},
		};
		const withSlot = parseLintReport(
			JSON.parse(serializeLintReport({ ...report(), findings: [slotted] })),
		);
		expect(withSlot.report?.findings).toEqual([slotted]);
		// The id and version are required.
		expect(
			parseLintReport({
				...JSON.parse(text),
				findings: [{ ...located, componentLocation: { version: "1" } }],
			}).issue?.code,
		).toBe("INVALID_REPORT");
	});

	it("keeps a report with component findings readable by readers from before them", async () => {
		// The finding check of the report reader before `componentLocation`
		// (src/lint/report.ts as of e622f3f, PR #18): a location kind it does not
		// know made the whole report unusable, and the run started a new
		// baseline, enforcing nothing. Frozen here so the persisted shape
		// stays inside what it accepts.
		const isRecord = (value: unknown): value is Record<string, unknown> =>
			typeof value === "object" && value !== null && !Array.isArray(value);
		const legacyIsLocation = (value: unknown) =>
			value === null ||
			(isRecord(value) &&
				((value.kind === "code" && typeof value.file === "string") ||
					(value.kind === "design" && typeof value.design === "string")));
		const legacyIsFinding = (value: unknown) =>
			isRecord(value) &&
			typeof value.rule === "string" &&
			(value.severity === "error" ||
				value.severity === "warning" ||
				value.severity === "info") &&
			(value.side === "code" || value.side === "design") &&
			typeof value.message === "string" &&
			legacyIsLocation(value.location);

		const written = JSON.parse(
			serializeLintReport({
				...report(),
				findings: [...report().findings, located],
			}),
		) as { findings: unknown[] };
		expect(written.findings).toHaveLength(4);
		expect(
			legacyIsFinding({
				...located,
				componentLocation: { ...located.componentLocation, slot: "children" },
			}),
		).toBe(true);
		expect(written.findings.every(legacyIsFinding)).toBe(true);
		// And so is this repository's committed report.
		const committed = JSON.parse(
			await readFile(
				path.join(
					process.cwd(),
					".trickroom/systems/trickroom/lint-report.json",
				),
				"utf8",
			),
		) as { findings: Array<{ componentLocation?: unknown }> };
		expect(committed.findings.some((entry) => entry.componentLocation)).toBe(
			true,
		);
		expect(committed.findings.every(legacyIsFinding)).toBe(true);
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
		expect(parsed.report?.ratchet).toEqual({
			status: "pass",
			baseline: {
				generatedAt: "2025-12-01T00:00:00.000Z",
				numbers: { "code.errors": 2, "code.warnings": 1 },
			},
			regressions: [],
			breaches: [
				{ metric: "code.errors", kind: "max", limit: 0, current: 1 },
				{ metric: "rule.code.b", kind: "max", limit: 0, current: 1 },
			],
			adopted: [
				{ metric: "rule.code.a", current: 0, reason: "new-kind" },
				{ metric: "rule.code.b", current: 1, reason: "explicit", baseline: 0 },
			],
			numbers: { "code.errors": 1, "code.warnings": 0 },
		});
		expect(parsed.report?.ratchetBaseline.kinds).toEqual(["code.a", "code.b"]);
		expect(
			parseLintReport({
				...JSON.parse(text),
				ratchetBaseline: { generatedAt: "x", numbers: {}, kinds: [1] },
			}).issue?.code,
		).toBe("INVALID_REPORT");
		expect(
			parseLintReport({ ...JSON.parse(text), ratchet: { status: "pass" } })
				.issue?.code,
		).toBe("INVALID_REPORT");
		const withAdoption = (entry: Record<string, unknown>) =>
			parseLintReport({
				...JSON.parse(text),
				ratchet: { ...JSON.parse(text).ratchet, adopted: [entry] },
			}).issue?.code;
		expect(
			withAdoption({ metric: "rule.code.a", current: 0, reason: "all" }),
		).toBe("INVALID_REPORT");
		expect(
			withAdoption({ metric: "rule.code.a", current: 0, baseline: "1" }),
		).toBe("INVALID_REPORT");
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

	it("reads a report written before kinds and adoptions were recorded", () => {
		const { adopted: _adopted, ...ratchet } = report().ratchet;
		const legacy = {
			...JSON.parse(serializeLintReport(report())),
			ratchet,
			ratchetBaseline: {
				generatedAt: "2026-01-01T00:00:00.000Z",
				numbers: { "code.warnings": 0, "code.errors": 1 },
			},
		};
		const parsed = parseLintReport(legacy);
		expect(parsed.issue).toBeNull();
		expect(parsed.report?.ratchet.adopted).toEqual([]);
		expect(parsed.report?.ratchetBaseline).toEqual({
			generatedAt: "2026-01-01T00:00:00.000Z",
			numbers: { "code.errors": 1, "code.warnings": 0 },
		});
		expect(parsed.report?.ratchetBaseline).not.toHaveProperty("kinds");
	});

	it("reads adoptions written before they had a reason as new kinds", () => {
		const legacy = JSON.parse(serializeLintReport(report()));
		legacy.ratchet.adopted = [{ metric: "rule.code.a", current: 2 }];
		const parsed = parseLintReport(legacy);
		expect(parsed.issue).toBeNull();
		expect(parsed.report?.ratchet.adopted).toEqual([
			{ metric: "rule.code.a", current: 2, reason: "new-kind" },
		]);
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

	it("refuses a systems folder that is a symlink out of the project", async () => {
		const root = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-report-")),
		);
		temps.push(root);
		const elsewhere = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-elsewhere-")),
		);
		temps.push(elsewhere);
		await mkdir(path.join(elsewhere, "core"), { recursive: true });
		await mkdir(path.join(root, ".trickroom"), { recursive: true });
		await symlink(elsewhere, path.join(root, ".trickroom", "systems"));
		const systemDir = path.join(root, ".trickroom", "systems", "core");
		await expect(writeLintReport(root, systemDir, report())).rejects.toThrow(
			"through a symlink",
		);
		await expect(
			readFile(path.join(elsewhere, "core", "lint-report.json"), "utf8"),
		).rejects.toThrow();

		const linkedRoot = path.join(root, "link-to-trickroom");
		await symlink(path.join(root, ".trickroom"), linkedRoot);
		await expect(
			writeLintReport(root, path.join(linkedRoot, "systems", "core"), report()),
		).rejects.toThrow("through a symlink");
	});
});
