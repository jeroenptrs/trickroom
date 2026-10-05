import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TrickroomCodegenConfig } from "../types";
import { type ResolvedCodegenConfig, resolveCodegenConfig } from "./config";
import { parseCodegenHeader } from "./generate";
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

const configured = (
	codegen: TrickroomCodegenConfig,
): Extract<ResolvedCodegenConfig, { status: "configured" }> => {
	const resolved = resolveCodegenConfig({
		name: "Codegen Test",
		defaultSystemId: CODEGEN_TEST_SYSTEM_ID,
		codegen,
	});
	if (resolved.status !== "configured") throw new Error("unconfigured");
	return resolved;
};

const button = publishedComponent("button", flatPayload("px-3 py-2"));
const badge = publishedComponent("badge", flatPayload("rounded px-1"));

const setup = async (codegen: Partial<TrickroomCodegenConfig> = {}) => {
	const block: TrickroomCodegenConfig = {
		version: 1,
		outDir: "src/ui",
		...codegen,
	};
	const project = await createCodegenTestProject({
		codegen: block,
		components: [button, badge],
	});
	projects.push(project);
	const run = (
		mode: RunCodegenInput["mode"],
		extra: Partial<RunCodegenInput> = {},
	) =>
		runCodegen({
			projectRoot: project.root,
			config: configured(block),
			mode,
			...extra,
		});
	return { project, run };
};

const read = (project: CodegenTestProject, file: string) =>
	readFile(project.path(file), "utf8");

// Formatters are tiny node scripts: no shell, args with {file} substituted.
const writeScript = async (
	project: CodegenTestProject,
	name: string,
	body: string,
) => {
	await writeFile(project.path(name), body);
	return { command: process.execPath, args: [name, "{file}"] };
};

const SPACES_FORMATTER = `
if (!process.argv[2].startsWith("src/ui/")) { process.stderr.write("bad path " + process.argv[2]); process.exit(4); }
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => { process.stdout.write(input.replaceAll("\\t", "  ")); });
`;

describe("runCodegen", () => {
	it("writes every component, then checks ok and rewrites nothing", async () => {
		const { project, run } = await setup();
		const written = await run("write");
		expect(written.status).toBe("ok");
		expect(written.system).toEqual({
			id: CODEGEN_TEST_SYSTEM_ID,
			name: "Core",
		});
		expect(written.outDir).toBe("src/ui");
		expect([...written.written].sort()).toEqual([
			"src/ui/badge.variants.ts",
			"src/ui/button.variants.ts",
		]);
		expect(
			parseCodegenHeader(await read(project, "src/ui/button.variants.ts")),
		).toMatchObject({
			slug: "button",
			source: "published",
			publishedVersion: "1",
		});

		const checked = await run("check");
		expect(checked.status).toBe("ok");
		expect(checked.written).toEqual([]);
		expect(checked.components.map((component) => component.status)).toEqual([
			"ok",
			"ok",
		]);
		expect(checked.components[0]).toMatchObject({
			onDisk: { publishedVersion: "1", source: "published" },
			shape: "flat",
		});

		const again = await run("write");
		expect(again.status).toBe("ok");
		expect(again.written).toEqual([]);
		expect(JSON.parse(JSON.stringify(again))).toEqual(again);
	});

	it("reports a component that moved on as stale with the source-changed reason", async () => {
		const { project, run } = await setup();
		await run("write");
		await project.writeComponents([
			publishedComponent("button", flatPayload("px-4 py-2"), {
				componentId: button.componentId,
				version: "2",
			}),
			badge,
		]);
		const checked = await run("check");
		expect(checked.status).toBe("drift");
		const stale = checked.components.find((entry) => entry.slug === "button");
		expect(stale).toMatchObject({
			status: "stale",
			reason: "source-changed",
			publishedVersion: "2",
			onDisk: { publishedVersion: "1" },
		});
		expect(stale?.message).toContain("published version 1");
	});

	it("reports an edited body as stale with the body-edited reason", async () => {
		const { project, run } = await setup();
		await run("write");
		const file = project.path("src/ui/badge.variants.ts");
		await writeFile(
			file,
			(await readFile(file, "utf8")).replace("rounded", "rounded-lg"),
		);
		const checked = await run("check");
		expect(
			checked.components.find((entry) => entry.slug === "badge"),
		).toMatchObject({
			status: "stale",
			reason: "body-edited",
		});
	});

	it("reports missing files and writes them", async () => {
		const { run } = await setup();
		const checked = await run("check");
		expect(checked.status).toBe("drift");
		expect(
			checked.components.every((entry) => entry.status === "missing"),
		).toBe(true);
		expect(checked.components[0].onDisk).toBeNull();
	});

	it("reports orphans without deleting them", async () => {
		const { project, run } = await setup();
		await run("write");
		await project.writeComponents([button]);
		const checked = await run("check");
		expect(checked.status).toBe("drift");
		expect(checked.orphaned).toEqual(["src/ui/badge.variants.ts"]);
		expect(checked.components.map((entry) => entry.slug)).toEqual(["button"]);

		const written = await run("write");
		expect(written.status).toBe("ok");
		expect(written.orphaned).toEqual(["src/ui/badge.variants.ts"]);
		await expect(
			stat(project.path("src/ui/badge.variants.ts")),
		).resolves.toBeTruthy();
	});

	it("ignores files of other systems and without a header when looking for orphans", async () => {
		const { project, run } = await setup();
		await run("write");
		const contents = await read(project, "src/ui/badge.variants.ts");
		await writeFile(
			project.path("src/ui/other.variants.ts"),
			contents.replace(CODEGEN_TEST_SYSTEM_ID, "sys_other"),
		);
		await writeFile(
			project.path("src/ui/tv.ts"),
			"export { tv } from 'tailwind-variants';\n",
		);
		expect((await run("check")).orphaned).toEqual([]);
	});

	it("treats CRLF line endings on disk as current", async () => {
		const { project, run } = await setup();
		await run("write");
		const file = project.path("src/ui/button.variants.ts");
		await writeFile(
			file,
			(await readFile(file, "utf8")).replaceAll("\n", "\r\n"),
		);
		const checked = await run("check");
		expect(checked.status).toBe("ok");
	});

	it("formats before comparing, so a formatted file on disk is ok", async () => {
		const { project } = await setup();
		const formatter = await writeScript(project, "fmt.mjs", SPACES_FORMATTER);
		const config = configured({ version: 1, outDir: "src/ui", formatter });
		const written = await runCodegen({
			projectRoot: project.root,
			config,
			mode: "write",
		});
		expect(written.status).toBe("ok");
		const contents = await read(project, "src/ui/button.variants.ts");
		expect(contents).not.toContain("\t");
		expect(contents).toContain("  ");
		expect(
			(await runCodegen({ projectRoot: project.root, config, mode: "check" }))
				.status,
		).toBe("ok");
		// Unformatted output on disk is a reformatted body.
		const unformatted = await runCodegen({
			projectRoot: project.root,
			config: configured({ version: 1, outDir: "src/ui" }),
			mode: "check",
		});
		expect(unformatted.components[0]).toMatchObject({
			status: "stale",
			reason: "body-edited",
		});
	});

	it("fails the run when the formatter fails, writing nothing", async () => {
		const { project } = await setup();
		const formatter = await writeScript(
			project,
			"fail.mjs",
			'process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write("boom: cannot parse"); process.exit(3); });',
		);
		const config = configured({ version: 1, outDir: "src/ui", formatter });
		for (const mode of ["write", "check"] as const) {
			const result = await runCodegen({
				projectRoot: project.root,
				config,
				mode,
			});
			expect(result.status).toBe("error");
			expect(result.components.every((entry) => entry.status === "error")).toBe(
				true,
			);
			expect(result.components[0].message).toContain("boom: cannot parse");
			expect(result.diagnostics[0]).toMatchObject({ code: "FORMATTER_FAILED" });
		}
		await expect(stat(project.path("src/ui"))).rejects.toThrow();
	});

	it("treats empty formatter output, a missing command and a timeout as errors", async () => {
		const { project } = await setup();
		const silent = await writeScript(
			project,
			"silent.mjs",
			"process.stdin.resume();",
		);
		const slow = await writeScript(
			project,
			"slow.mjs",
			"setTimeout(() => {}, 10_000);",
		);
		for (const [formatter, expected] of [
			[silent, "printed nothing"],
			[{ command: "./does-not-exist", args: [] }, "could not start"],
			[slow, "did not finish"],
		] as const) {
			const result = await runCodegen({
				projectRoot: project.root,
				config: configured({
					version: 1,
					outDir: "src/ui",
					formatter: { ...formatter, args: [...formatter.args] },
				}),
				mode: "check",
				formatterTimeoutMs: 500,
			});
			expect(result.status).toBe("error");
			expect(result.components[0].message).toContain(expected);
		}
	});

	it("refuses to overwrite files it did not generate unless forced", async () => {
		const { project, run } = await setup();
		await mkdir(project.path("src/ui"), { recursive: true });
		await writeFile(
			project.path("src/ui/button.variants.ts"),
			"export const old = 1;\n",
		);

		const checked = await run("check");
		expect(
			checked.components.find((entry) => entry.slug === "button"),
		).toMatchObject({
			status: "stale",
			reason: "not-generated",
			onDisk: null,
		});

		const refused = await run("write");
		expect(refused.status).toBe("error");
		expect(refused.written).toEqual([]);
		expect(refused.diagnostics).toEqual([
			expect.objectContaining({
				code: "REFUSED_OVERWRITE",
				paths: ["src/ui/button.variants.ts"],
			}),
		]);
		expect(refused.diagnostics[0].message).toContain("--force");
		expect(await read(project, "src/ui/button.variants.ts")).toBe(
			"export const old = 1;\n",
		);
		await expect(
			stat(project.path("src/ui/badge.variants.ts")),
		).rejects.toThrow();

		const forced = await run("write", { force: true });
		expect(forced.status).toBe("ok");
		expect(forced.written).toHaveLength(2);
		expect((await run("check")).status).toBe("ok");
	});

	it("refuses an outDir that escapes the project through .. or a symlink", async () => {
		const { project } = await setup();
		const outside = await createCodegenTestProject();
		projects.push(outside);

		const dotdot = await runCodegen({
			projectRoot: project.root,
			// The config validator rejects "..": call the service directly.
			config: {
				...configured({ version: 1, outDir: "src/ui" }),
				outDir: "../escape",
			},
			mode: "write",
		});
		expect(dotdot.status).toBe("error");
		expect(dotdot.diagnostics[0].code).toBe("OUT_DIR_OUTSIDE_PROJECT");

		await mkdir(project.path("src"), { recursive: true });
		await symlink(outside.root, project.path("src/linked"));
		const linked = await runCodegen({
			projectRoot: project.root,
			config: configured({ version: 1, outDir: "src/linked/ui" }),
			mode: "write",
		});
		expect(linked.status).toBe("error");
		expect(linked.diagnostics[0].code).toBe("OUT_DIR_OUTSIDE_PROJECT");
		await expect(stat(path.join(outside.root, "ui"))).rejects.toThrow();

		await mkdir(project.path("src/ui"), { recursive: true });
		await symlink(
			path.join(outside.root, "button.variants.ts"),
			project.path("src/ui/button.variants.ts"),
		);
		const target = await runCodegen({
			projectRoot: project.root,
			config: configured({ version: 1, outDir: "src/ui" }),
			mode: "write",
		});
		expect(target.status).toBe("error");
		expect(target.diagnostics[0]).toMatchObject({
			code: "TARGET_OUTSIDE_PROJECT",
			path: "src/ui/button.variants.ts",
		});
		await expect(
			stat(path.join(outside.root, "button.variants.ts")),
		).rejects.toThrow();
	});

	it("changes nothing on disk in check mode, even when system files would be normalised", async () => {
		const { project, run } = await setup();
		await run("write");
		// A system.json the normal read path rewrites (trimmed name, cssPath).
		await writeFile(
			project.path(".trickroom/systems/core/system.json"),
			JSON.stringify({
				version: 1,
				systemId: CODEGEN_TEST_SYSTEM_ID,
				systemName: " Core ",
				cssPath: "./src/index.css",
			}),
		);
		await writeFile(project.path("src/ui/badge.variants.ts"), "edited\n");
		await project.writeComponents([
			publishedComponent("button", flatPayload("px-5"), {
				componentId: button.componentId,
				version: "2",
			}),
			badge,
			publishedComponent("chip", flatPayload("px-1")),
		]);
		const formatter = await writeScript(project, "fmt.mjs", SPACES_FORMATTER);
		const before = await project.snapshotMtimes();
		await new Promise((resolve) => setTimeout(resolve, 20));

		const result = await runCodegen({
			projectRoot: project.root,
			config: configured({ version: 1, outDir: "src/ui", formatter }),
			mode: "check",
		});
		expect(result.status).toBe("drift");
		expect(result.components.map((entry) => entry.status).sort()).toEqual([
			"missing",
			"stale",
			"stale",
		]);
		expect(await project.snapshotMtimes()).toEqual(before);
	});

	it("marks draft output stale for a later published check", async () => {
		const { project, run } = await setup();
		await project.writeComponents([
			publishedComponent("button", flatPayload("px-3 py-2"), {
				componentId: button.componentId,
				draft: flatPayload("px-3 py-2 font-bold"),
			}),
			badge,
		]);
		const drafted = await run("write", { source: "draft" });
		expect(drafted.status).toBe("ok");
		expect(drafted.source).toBe("draft");
		expect(
			drafted.components.find((entry) => entry.slug === "button")?.source,
		).toBe("draft");
		// Without a draft, the draft run falls back to the published version.
		expect(
			drafted.components.find((entry) => entry.slug === "badge")?.source,
		).toBe("published");
		expect(
			parseCodegenHeader(await read(project, "src/ui/button.variants.ts"))
				?.source,
		).toBe("draft");

		const checked = await run("check");
		expect(checked.status).toBe("drift");
		expect(
			checked.components.find((entry) => entry.slug === "button"),
		).toMatchObject({
			status: "stale",
			reason: "source-changed",
			onDisk: { source: "draft" },
		});
		expect(
			checked.components.find((entry) => entry.slug === "badge")?.status,
		).toBe("ok");
	});

	it("returns generator errors and writes nothing", async () => {
		const { project, run } = await setup({ include: ["button", "nope"] });
		const result = await run("write");
		expect(result.status).toBe("error");
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"UNKNOWN_INCLUDE_SLUG",
		);
		await expect(stat(project.path("src/ui"))).rejects.toThrow();
	});

	it("reports a system that does not exist", async () => {
		const { project } = await setup();
		const result = await runCodegen({
			projectRoot: project.root,
			config: configured({ version: 1, outDir: "src/ui", system: "missing" }),
			mode: "check",
		});
		expect(result).toMatchObject({ status: "error", system: null });
		expect(result.diagnostics[0].code).toBe("SYSTEM_NOT_FOUND");
	});
});
