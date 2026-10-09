import { mkdir, readFile, writeFile } from "node:fs/promises";
// biome-ignore lint/style/noRestrictedImports: the integration test runs createTV against the emitted tw-merge module, not component styling.
import { createTV, type TWMConfig } from "tailwind-variants";
import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomCodegenConfig } from "../types";
import { resolveCodegenConfig } from "./config";
import { parseCodegenHeader, parseTwMergeHeader } from "./header";
import { type RunCodegenInput, runCodegen } from "./run-codegen";
import {
	CODEGEN_TEST_SYSTEM_ID,
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "./test-support";

const projects: CodegenTestProject[] = [];
afterEach(async () => {
	await Promise.all(projects.splice(0).map((project) => project.cleanup()));
});

const THEME_CSS = [
	"@theme {",
	"\t--color-*: initial;",
	"\t--color-royal-9: oklch(54% 0.22 263);",
	"\t--db-label-sm: 0.875rem;",
	"\t--db-label-lg: 1.125rem;",
	"}",
	"@utility text-label-* {",
	"\tfont-size: --value(--db-label-*);",
	"\tline-height: 1.25;",
	"}",
	"",
].join("\n");

const label = publishedComponent(
	"label",
	flatPayload("text-label-sm text-royal-9"),
);

const writeSystem = (project: CodegenTestProject, cssPath?: string) =>
	writeFile(
		project.path(".trickroom", "systems", "core", "system.json"),
		`${JSON.stringify({ version: 1, systemId: CODEGEN_TEST_SYSTEM_ID, systemName: "Core", ...(cssPath ? { cssPath } : {}) }, null, "\t")}\n`,
	);

const setup = async (
	codegen: Partial<TrickroomCodegenConfig> = {},
	options: { css?: boolean; parent?: string } = {},
) => {
	const block: TrickroomCodegenConfig = {
		version: 1,
		outDir: "src/ui",
		twMerge: {},
		...codegen,
	};
	const project = await createCodegenTestProject({
		codegen: block,
		components: [label],
		...(options.parent ? { parent: options.parent } : {}),
	});
	projects.push(project);
	if (options.css !== false) {
		await mkdir(project.path("src"), { recursive: true });
		await writeFile(project.path("src/theme.css"), THEME_CSS);
		await writeSystem(project, "src/theme.css");
	}
	const run = (
		mode: RunCodegenInput["mode"],
		extra: Partial<RunCodegenInput> & {
			codegen?: TrickroomCodegenConfig;
		} = {},
	) => {
		const resolved = resolveCodegenConfig({
			name: "Codegen Test",
			defaultSystemId: CODEGEN_TEST_SYSTEM_ID,
			codegen: extra.codegen ?? block,
		});
		if (resolved.status !== "configured") throw new Error("unconfigured");
		return runCodegen({
			projectRoot: project.root,
			config: resolved,
			mode,
			...extra,
		});
	};
	return { project, run };
};

const read = (project: CodegenTestProject, file: string) =>
	readFile(project.path(file), "utf8");

describe("runCodegen with codegen.twMerge", () => {
	it("writes the derived config next to the variants files, then checks ok", async () => {
		const { project, run } = await setup();
		const missing = await run("check");
		expect(missing.status).toBe("drift");
		expect(missing.twMerge).toMatchObject({
			file: "src/ui/tw-merge.ts",
			status: "missing",
			onDisk: null,
		});

		const written = await run("write");
		expect(written.status).toBe("ok");
		expect(written.written).toEqual([
			"src/ui/label.variants.ts",
			"src/ui/tw-merge.ts",
		]);
		const contents = await read(project, "src/ui/tw-merge.ts");
		const header = parseTwMergeHeader(contents);
		expect(header).toEqual({
			version: 1,
			kind: "tw-merge",
			systemId: CODEGEN_TEST_SYSTEM_ID,
			sourceHash: written.twMerge?.sourceHash,
		});
		expect(parseCodegenHeader(contents)).toBeNull();
		expect(contents).toContain(
			'import { extendTailwindMerge } from "tailwind-merge";',
		);
		expect(contents).toContain("export const twMergeConfig = {");
		expect(contents).toContain(
			[
				"\t\tclassGroups: {",
				'\t\t\t"@utility text-label-*": [',
				'\t\t\t\t"text-label-lg",',
				'\t\t\t\t"text-label-sm",',
				"\t\t\t],",
				"\t\t},",
				"\t\tconflictingClassGroups: {",
				'\t\t\t"@utility text-label-*": [',
				'\t\t\t\t"font-size",',
				"\t\t\t],",
				"\t\t},",
			].join("\n"),
		);
		expect(contents).toContain(
			"export const twMerge = extendTailwindMerge<string>(twMergeConfig);",
		);

		const checked = await run("check");
		expect(checked.status).toBe("ok");
		expect(checked.twMerge).toMatchObject({
			status: "ok",
			onDisk: { sourceHash: written.twMerge?.sourceHash },
		});
		expect(checked.orphaned).toEqual([]);
		expect((await run("write")).written).toEqual([]);
	});

	it("emits a module whose twMerge and twMergeConfig merge like the design system, also through createTV", async () => {
		// Inside the repository, so the module resolves tailwind-merge.
		const { project, run } = await setup({}, { parent: process.cwd() });
		await writeFile(
			project.path("src/theme.css"),
			[
				THEME_CSS,
				"@theme { --text-sm: 0.875rem; --color-pale-9: oklch(50% 0 0); }",
				"@utility bg-royal-ui { @apply bg-royal-9 hover:bg-pale-9; }",
				"@utility bg-mixed { background-color: blue !important; background-color: red; }",
				"@utility heading { font-size: 20px; line-height: 2; }",
				"",
			].join("\n"),
		);
		expect((await run("write")).status).toBe("ok");
		const generated = (await import(
			/* @vite-ignore */ project.path("src/ui/tw-merge.ts")
		)) as {
			twMerge: (...classes: string[]) => string;
			twMergeConfig: TWMConfig["twMergeConfig"];
		};
		const { twMerge, twMergeConfig } = generated;
		expect(twMerge("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		expect(twMerge("text-sm text-label-sm")).toBe("text-label-sm");
		expect(twMerge("text-label-sm text-sm")).toBe("text-label-sm text-sm");
		expect(twMerge("bg-royal-ui bg-pale-9")).toBe("bg-royal-ui bg-pale-9");
		expect(twMerge("bg-pale-9 bg-royal-ui")).toBe("bg-royal-ui");
		// The !important declaration is the one CSS applies.
		expect(twMerge("bg-mixed bg-[green]")).toBe("bg-mixed bg-[green]");
		// The arbitrary property reads the --tw-leading leading-8 sets.
		expect(twMerge("leading-8 heading [font-size:var(--tw-leading)]")).toBe(
			"leading-8 heading [font-size:var(--tw-leading)]",
		);

		const tv = createTV({ twMergeConfig });
		const tag = tv({
			base: "text-label-sm text-royal-9 bg-pale-9",
			variants: {
				size: { lg: "text-label-lg" },
				tone: { ui: "bg-royal-ui" },
			},
		});
		expect(tag()).toBe("text-label-sm text-royal-9 bg-pale-9");
		expect(tag({ size: "lg", tone: "ui" })).toBe(
			"text-royal-9 text-label-lg bg-royal-ui",
		);
		expect(tag({ class: "text-label-lg" })).toBe(
			"text-royal-9 bg-pale-9 text-label-lg",
		);
		const panel = tv({
			base: "bg-mixed leading-8",
			variants: { tone: { green: "bg-[green] heading" } },
		});
		expect(
			panel({ tone: "green", class: "[font-size:var(--tw-leading)]" }),
		).toBe(
			"bg-mixed leading-8 bg-[green] heading [font-size:var(--tw-leading)]",
		);
		// Stock tailwind-variants takes the size for a colour and drops one.
		expect(createTV({})({ base: "text-label-sm text-royal-9" })()).toBe(
			"text-royal-9",
		);
	});

	it("emits a project's merge groups, where the last member wins in twMerge and createTV", async () => {
		const { project, run } = await setup(
			{
				twMerge: {
					mergeGroups: { typography: ["text-title-*", "text-label-*"] },
				},
			},
			{ parent: process.cwd() },
		);
		await writeFile(
			project.path("src/theme.css"),
			[
				"@theme {",
				"\t--color-royal-9: oklch(54% 0.22 263);",
				"\t--db-label-sm: 0.875rem;",
				"\t--db-title-lg: 1.5rem;",
				"\t--db-caption-sm: 0.75rem;",
				"}",
				"@utility text-label-* { --label--size: --value(--db-label-*); font-size: var(--label--size); line-height: 1.25; }",
				"@utility text-title-* { --title--size: --value(--db-title-*); font-size: var(--title--size); line-height: 1.1; }",
				"@utility text-caption-* { --caption--size: --value(--db-caption-*); font-size: var(--caption--size); line-height: 1.2; }",
				"",
			].join("\n"),
		);
		expect((await run("write")).status).toBe("ok");
		const contents = await read(project, "src/ui/tw-merge.ts");
		expect(contents).toContain(
			'\t\t\t"mergeGroups.typography": [\n\t\t\t\t"text-label-sm",\n\t\t\t\t"text-title-lg",\n\t\t\t],',
		);
		const { twMerge, twMergeConfig } = (await import(
			/* @vite-ignore */ project.path("src/ui/tw-merge.ts")
		)) as {
			twMerge: (...classes: string[]) => string;
			twMergeConfig: TWMConfig["twMergeConfig"];
		};
		expect(twMerge("text-label-sm text-title-lg")).toBe("text-title-lg");
		expect(twMerge("text-title-lg text-label-sm")).toBe("text-label-sm");
		expect(twMerge("text-caption-sm text-title-lg")).toBe(
			"text-caption-sm text-title-lg",
		);

		const tv = createTV({ twMergeConfig });
		const heading = tv({
			base: "text-label-sm text-royal-9",
			variants: { level: { one: "text-title-lg" } },
		});
		expect(heading({ level: "one" })).toBe("text-royal-9 text-title-lg");
		expect(heading({ level: "one", class: "text-label-sm" })).toBe(
			"text-royal-9 text-label-sm",
		);
		// A non-member stays protected from members, but it overrides all a
		// member sets except the member's private properties, which the
		// merge group declares plumbing: a later caption replaces the label.
		expect(heading({ class: "text-caption-sm" })).toBe(
			"text-royal-9 text-caption-sm",
		);
	});

	it("emits modifier forms with postfix lookup, so twMerge and createTV keep what the form adds", async () => {
		const { project, run } = await setup({}, { parent: process.cwd() });
		await writeFile(
			project.path("src/theme.css"),
			[
				"@theme { --text-sm: 14px; --text-lg: 20px; --color-blue: blue; }",
				"@utility badge-* {",
				"\tfont-size: --value(--text-*);",
				"\tbackground-color: --modifier(--color-*);",
				"}",
				"",
			].join("\n"),
		);
		expect((await run("write")).status).toBe("ok");
		expect(await read(project, "src/ui/tw-merge.ts")).toContain(
			'\t\tpostfixLookupClassGroups: [\n\t\t\t"@utility badge-*",\n\t\t],',
		);
		const { twMerge, twMergeConfig } = (await import(
			/* @vite-ignore */ project.path("src/ui/tw-merge.ts")
		)) as {
			twMerge: (...classes: string[]) => string;
			twMergeConfig: TWMConfig["twMergeConfig"];
		};
		expect(twMerge("badge-sm/blue badge-lg")).toBe("badge-sm/blue badge-lg");
		expect(twMerge("badge-lg badge-sm/blue")).toBe("badge-sm/blue");
		expect(twMerge("badge-sm badge-lg")).toBe("badge-lg");

		const badge = createTV({ twMergeConfig })({
			base: "badge-sm/blue",
			variants: { size: { lg: "badge-lg" } },
		});
		expect(badge({ size: "lg" })).toBe("badge-sm/blue badge-lg");
		expect(badge({ class: "badge-lg" })).toBe("badge-sm/blue badge-lg");
		// Stock tailwind-variants knows no badge-*: it keeps both too.
		expect(
			createTV({})({
				base: "badge-sm/blue",
				variants: { size: { lg: "badge-lg" } },
			})({
				size: "lg",
			}),
		).toBe("badge-sm/blue badge-lg");
	});

	it("fails on a utility with open-ended modifiers that a class group claims, in --check too", async () => {
		const { project, run } = await setup();
		await writeFile(
			project.path("src/theme.css"),
			"@theme { --color-blue: blue; }\n@utility text-ink-* { color: --value(--color-*); background-color: --modifier([color]); }\n",
		);
		for (const mode of ["check", "write"] as const) {
			const result = await run(mode);
			expect(result.status).toBe("error");
			expect(result.diagnostics).toEqual([
				expect.objectContaining({
					code: "TW_MERGE_OPEN_MODIFIER",
					severity: "error",
					message: expect.stringContaining(
						'text-ink-* takes open-ended modifiers, so tailwind-merge would merge "text-ink-blue/[…]" through "text-ink-blue"',
					),
				}),
			]);
		}
	});

	it("rejects merge groups the design system cannot honour, in --check too", async () => {
		const { run } = await setup({
			twMerge: {
				mergeGroups: { typography: ["text-label-*", "text-headline-*"] },
			},
		});
		for (const mode of ["check", "write"] as const) {
			const result = await run(mode);
			expect(result.status).toBe("error");
			expect(result.diagnostics).toEqual([
				{
					code: "TW_MERGE_GROUP_INVALID",
					severity: "error",
					message:
						'codegen.twMerge.mergeGroups does not fit the design system: codegen.twMerge.mergeGroups.typography: "text-headline-*" matches no custom utility of the design system.',
				},
			]);
			expect(result.written).toEqual([]);
		}
	});

	it("reports a CSS change as source-changed and an edited body as body-edited", async () => {
		const { project, run } = await setup();
		await run("write");
		const file = project.path("src/ui/tw-merge.ts");
		const original = await readFile(file, "utf8");
		await writeFile(file, original.replace('"text-label-lg",\n', ""));
		expect((await run("check")).twMerge).toMatchObject({
			status: "stale",
			reason: "body-edited",
		});

		await writeFile(file, original);
		await writeFile(
			project.path("src/theme.css"),
			THEME_CSS.replace(
				"\t--db-label-lg: 1.125rem;\n",
				"\t--db-label-lg: 1.125rem;\n\t--db-label-xl: 1.25rem;\n",
			),
		);
		const changed = await run("check");
		expect(changed.status).toBe("drift");
		expect(changed.twMerge).toMatchObject({
			status: "stale",
			reason: "source-changed",
			onDisk: { sourceHash: parseTwMergeHeader(original)?.sourceHash },
		});
		expect(changed.twMerge?.sourceHash).not.toBe(
			parseTwMergeHeader(original)?.sourceHash,
		);
		await run("write");
		expect(await read(project, "src/ui/tw-merge.ts")).toContain(
			'"text-label-xl",',
		);
	});

	it("takes over a hand-written file only with --force", async () => {
		const { project, run } = await setup();
		await mkdir(project.path("src/ui"), { recursive: true });
		const handWritten =
			'import { extendTailwindMerge } from "tailwind-merge";\nexport const twMergeConfig = {};\nexport const twMerge = extendTailwindMerge(twMergeConfig);\n';
		await writeFile(project.path("src/ui/tw-merge.ts"), handWritten);

		expect((await run("check")).twMerge).toMatchObject({
			status: "stale",
			reason: "not-generated",
		});
		const refused = await run("write");
		expect(refused.status).toBe("error");
		expect(refused.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "REFUSED_OVERWRITE",
				paths: ["src/ui/tw-merge.ts"],
			}),
		);
		expect(await read(project, "src/ui/tw-merge.ts")).toBe(handWritten);

		const forced = await run("write", { force: true });
		expect(forced.status).toBe("ok");
		expect(
			parseTwMergeHeader(await read(project, "src/ui/tw-merge.ts")),
		).not.toBeNull();
	});

	it("lists the file as orphaned once codegen.twMerge is removed or renamed", async () => {
		const { run } = await setup();
		await run("write");
		const without = await run("check", {
			codegen: { version: 1, outDir: "src/ui" },
		});
		expect(without.twMerge).toBeNull();
		expect(without.orphaned).toEqual(["src/ui/tw-merge.ts"]);

		const renamed = await run("check", {
			codegen: {
				version: 1,
				outDir: "src/ui",
				twMerge: { fileName: "merge.ts" },
			},
		});
		expect(renamed.twMerge).toMatchObject({
			file: "src/ui/merge.ts",
			status: "missing",
		});
		expect(renamed.orphaned).toEqual(["src/ui/tw-merge.ts"]);
	});

	it("runs the formatter on the file like on variants files", async () => {
		const { project, run } = await setup();
		await writeFile(
			project.path("spaces.js"),
			'let input = "";\nprocess.stdin.on("data", (c) => { input += c; });\nprocess.stdin.on("end", () => { process.stdout.write(input.replaceAll("\\t", "  ")); });\n',
		);
		const codegen: TrickroomCodegenConfig = {
			version: 1,
			outDir: "src/ui",
			twMerge: {},
			formatter: { command: process.execPath, args: ["spaces.js"] },
		};
		expect((await run("write", { codegen })).status).toBe("ok");
		expect(await read(project, "src/ui/tw-merge.ts")).toContain(
			'  extend: {\n    theme: {\n      color: [\n        "royal-9",',
		);
		expect((await run("check", { codegen })).status).toBe("ok");
	});

	it("fails when the formatter changes the header, even to another valid one", async () => {
		const { project, run } = await setup();
		await writeFile(
			project.path("rehash.js"),
			'let input = "";\nprocess.stdin.on("data", (c) => { input += c; });\nprocess.stdin.on("end", () => { process.stdout.write(input.replace(/sha256:[0-9a-f]+/, "sha256:0")); });\n',
		);
		const result = await run("check", {
			codegen: {
				version: 1,
				outDir: "src/ui",
				twMerge: {},
				formatter: { command: process.execPath, args: ["rehash.js"] },
			},
		});
		expect(result.status).toBe("error");
		expect(result.twMerge).toMatchObject({ status: "error" });
		expect(
			result.diagnostics.filter((entry) => entry.code === "FORMATTER_FAILED"),
		).toHaveLength(2);
	});

	it("fails without a system cssPath and on a name clash with a variants file", async () => {
		const { run } = await setup({}, { css: false });
		const noCss = await run("check");
		expect(noCss.status).toBe("error");
		expect(noCss.diagnostics).toEqual([
			expect.objectContaining({ code: "TW_MERGE_NO_CSS", severity: "error" }),
		]);

		const { run: runClash } = await setup({
			twMerge: { fileName: "label.variants.ts" },
		});
		const clash = await runClash("check");
		expect(clash.status).toBe("error");
		expect(clash.diagnostics).toEqual([
			expect.objectContaining({ code: "DUPLICATE_FILE_NAME", slug: "label" }),
		]);
	});

	it("fails when the system CSS does not compile", async () => {
		const { project, run } = await setup();
		await writeFile(
			project.path("src/theme.css"),
			"@utility broken { @apply not-a-utility; }\n",
		);
		const result = await run("check");
		expect(result.status).toBe("error");
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ code: "TW_MERGE_CSS_FAILED" }),
		]);
	});
});
