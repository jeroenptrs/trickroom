import { describe, expect, it } from "vitest";
import { normalizeTrickroomConfig } from "../project";
import { isTrickroomConfig } from "../server-utils";
import type { TrickroomCodegenConfig } from "../types";
import {
	describeCodegenConfigIssues,
	getCodegenConfigIssues,
	normalizeCodegenConfig,
	resolveCodegenConfig,
} from "./config";

const fullBlock: TrickroomCodegenConfig = {
	version: 1,
	system: "foundation",
	outDir: "design-system/ui/src",
	fileName: "{slug}.variants.ts",
	tvImport: "./tv",
	shape: "auto",
	include: ["toast", "button"],
	exclude: ["topbar"],
	formatter: {
		command: "./node_modules/.bin/biome",
		args: ["format", "--stdin-file-path={file}"],
	},
	twMerge: { fileName: "tw-merge.ts" },
};

describe("codegen config validation", () => {
	it("accepts the full block and the minimal block", () => {
		expect(getCodegenConfigIssues(fullBlock)).toEqual([]);
		expect(getCodegenConfigIssues({ version: 1, outDir: "src/ui" })).toEqual(
			[],
		);
		expect(isTrickroomConfig({ name: "App", codegen: fullBlock })).toBe(true);
	});

	it.each([
		[{ outDir: "src" }, "codegen.version is required"],
		[{ version: 2, outDir: "src" }, "codegen.version 2 is not supported"],
		[{ version: 1 }, "codegen.outDir is required"],
		[{ version: 1, outDir: "  " }, "codegen.outDir must be a non-empty"],
		[{ version: 1, outDir: "/abs/ui" }, "codegen.outDir must be relative"],
		[{ version: 1, outDir: "C:\\ui" }, "codegen.outDir must be relative"],
		[{ version: 1, outDir: "src/../../ui" }, 'contain a ".." segment'],
		[{ version: 1, outDir: "src\\..\\ui" }, 'contain a ".." segment'],
		[{ version: 1, outDir: "src", system: "" }, "codegen.system must be"],
		[{ version: 1, outDir: "src", fileName: "x.ts" }, "contain {slug}"],
		[
			{ version: 1, outDir: "src", fileName: "ui/{slug}.ts" },
			"without a path separator",
		],
		[{ version: 1, outDir: "src", fileName: "{slug}.tsx" }, "end in .ts"],
		[{ version: 1, outDir: "src", tvImport: 3 }, "codegen.tvImport must be"],
		[{ version: 1, outDir: "src", shape: "flat" }, "codegen.shape must be"],
		[{ version: 1, outDir: "src", include: "button" }, "codegen.include must"],
		[{ version: 1, outDir: "src", exclude: ["a", " "] }, "codegen.exclude[1]"],
		[{ version: 1, outDir: "src", formatter: "biome" }, "codegen.formatter"],
		[
			{ version: 1, outDir: "src", formatter: { args: [] } },
			"codegen.formatter.command must be",
		],
		[
			{ version: 1, outDir: "src", formatter: { command: "x", args: "a" } },
			"codegen.formatter.args must be",
		],
		[
			{ version: 1, outDir: "src", formatter: { command: "x", args: [1] } },
			"codegen.formatter.args[0]",
		],
		[{ version: 1, outDir: "src", outdir: "x" }, "codegen.outdir is not"],
		[
			{ version: 1, outDir: "src", formatter: { command: "x", cwd: "." } },
			"codegen.formatter.cwd is not",
		],
		[{ version: 1, outDir: "src", twMerge: true }, "codegen.twMerge must be"],
		[
			{ version: 1, outDir: "src", twMerge: { file: "x.ts" } },
			"codegen.twMerge.file is not",
		],
		[
			{ version: 1, outDir: "src", twMerge: { fileName: " " } },
			"codegen.twMerge.fileName must be a non-empty",
		],
		[
			{ version: 1, outDir: "src", twMerge: { fileName: "lib/tw-merge.ts" } },
			"without a path separator",
		],
		[
			{ version: 1, outDir: "src", twMerge: { fileName: "{slug}.ts" } },
			"cannot contain {slug}",
		],
		[
			{ version: 1, outDir: "src", twMerge: { fileName: "tw-merge.js" } },
			"end in .ts",
		],
	])("reports %j as %s", (block, message) => {
		const issues = getCodegenConfigIssues(block);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain(message);
		expect(isTrickroomConfig({ name: "App", codegen: block })).toBe(false);
	});

	it("names the supported versions for an unsupported one", () => {
		expect(getCodegenConfigIssues({ version: 2, outDir: "src" })).toEqual([
			"codegen.version 2 is not supported; this Trickroom understands codegen version 1.",
		]);
	});

	it("describes only codegen problems of a whole config", () => {
		expect(describeCodegenConfigIssues({ name: "App" })).toBe("");
		expect(
			describeCodegenConfigIssues({ name: "App", codegen: fullBlock }),
		).toBe("");
		expect(
			describeCodegenConfigIssues({
				name: "App",
				codegen: { version: 1, outDir: "src", shape: "flat" },
			}),
		).toBe(' codegen.shape must be "auto" or "slots"; got "flat".');
	});
});

describe("codegen config normalisation", () => {
	it("round-trips the full block in the documented key order", () => {
		const normalized = normalizeTrickroomConfig({
			name: "App",
			codegen: fullBlock,
		});
		expect(normalized.codegen).toEqual(fullBlock);
		expect(Object.keys(normalized.codegen ?? {})).toEqual(
			Object.keys(fullBlock),
		);
		expect(
			JSON.stringify(
				normalizeTrickroomConfig(JSON.parse(JSON.stringify(normalized))),
			),
		).toBe(JSON.stringify(normalized));
	});

	it("trims strings, keeps formatter args verbatim and adds no defaults", () => {
		expect(
			normalizeCodegenConfig({
				formatter: { args: [" --x "], command: " biome " },
				outDir: " src/ui ",
				include: [" button "],
				version: 1,
			}),
		).toEqual({
			version: 1,
			outDir: "src/ui",
			include: ["button"],
			formatter: { command: "biome", args: [" --x "] },
		});
	});

	it("keeps an empty twMerge block, which turns the file on with its default name", () => {
		const block = normalizeCodegenConfig({
			version: 1,
			outDir: "src/ui",
			twMerge: {},
		});
		expect(block).toEqual({ version: 1, outDir: "src/ui", twMerge: {} });
		expect(
			normalizeCodegenConfig({
				version: 1,
				outDir: "src/ui",
				twMerge: { fileName: " merge.ts " },
			}).twMerge,
		).toEqual({ fileName: "merge.ts" });
		expect(resolveCodegenConfig({ name: "App", codegen: block })).toMatchObject(
			{ twMerge: { fileName: "tw-merge.ts" } },
		);
	});

	it("does not add a block to a config without one", () => {
		expect(normalizeTrickroomConfig({ name: "App" })).not.toHaveProperty(
			"codegen",
		);
	});
});

describe("resolveCodegenConfig", () => {
	it("is unconfigured without a block", () => {
		expect(resolveCodegenConfig({ name: "App" })).toEqual({
			status: "unconfigured",
		});
	});

	it("applies defaults, falling back to the project default system", () => {
		expect(
			resolveCodegenConfig({
				name: "App",
				defaultSystemId: "sys_default",
				codegen: { version: 1, outDir: "src/ui" },
			}),
		).toEqual({
			status: "configured",
			version: 1,
			system: "sys_default",
			outDir: "src/ui",
			fileName: "{slug}.variants.ts",
			tvImport: "./tv",
			shape: "auto",
			include: null,
			exclude: [],
			formatter: null,
			twMerge: null,
		});
		expect(
			resolveCodegenConfig({
				name: "App",
				codegen: { version: 1, outDir: "src/ui" },
			}),
		).toMatchObject({ system: null });
	});

	it("keeps configured values over defaults", () => {
		expect(
			resolveCodegenConfig({
				name: "App",
				defaultSystemId: "sys_default",
				codegen: {
					...fullBlock,
					formatter: { command: "prettier" },
					shape: "slots",
				},
			}),
		).toMatchObject({
			system: "foundation",
			shape: "slots",
			include: ["toast", "button"],
			exclude: ["topbar"],
			formatter: { command: "prettier", args: [] },
		});
	});
});
