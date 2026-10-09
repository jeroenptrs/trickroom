import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { parseCodegenArgs, runCodegenCli } from "./codegen";

describe("trickroom codegen", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	const setup = async () => {
		const project = await createCodegenTestProject({
			codegen: { version: 1, outDir: "src/ui" },
			components: [
				publishedComponent("button", flatPayload("px-3")),
				publishedComponent("badge", flatPayload("px-1")),
			],
		});
		projects.push(project);
		return project;
	};

	const run = async (args: string[]) => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runCodegenCli(args, {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});
		return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	};

	it("parses its options", () => {
		expect(
			parseCodegenArgs(["app", "--check", "--json", "--source=draft"], "/work"),
		).toEqual({
			projectRoot: "/work/app",
			check: true,
			json: true,
			source: "draft",
			force: false,
		});
		expect(
			parseCodegenArgs(["--source", "published", "--force"], "/work"),
		).toMatchObject({ projectRoot: "/work", source: "published", force: true });
		expect(() => parseCodegenArgs(["--source", "latest"])).toThrow(
			'--source must be "published" or "draft"',
		);
		expect(() => parseCodegenArgs(["--formatter", "x"])).toThrow(
			"Unknown option --formatter",
		);
		expect(() => parseCodegenArgs(["a", "b"])).toThrow("at most one project");
		expect(() => parseCodegenArgs(["--check", "--force"])).toThrow(
			"--force only applies when writing",
		);
	});

	it("exits 0 after writing and on a current check, 1 on drift", async () => {
		const project = await setup();
		const drift = await run([project.root, "--check"]);
		expect(drift.code).toBe(1);
		expect(drift.stdout).toContain("missing  src/ui/button.variants.ts");
		expect(drift.stdout).toContain("2 missing");
		expect(drift.stdout).toContain('Run "trickroom codegen" to update.');

		const written = await run([project.root]);
		expect(written.code).toBe(0);
		expect(written.stdout).toContain("Wrote 2 files");

		const checked = await run([project.root, "--check"]);
		expect(checked.code).toBe(0);
		expect(checked.stdout).toBe(
			'Checked 2 components for system "Core" -> src/ui: 2 ok.',
		);
	});

	it("counts the tailwind-merge config among the checked files", async () => {
		const project = await createCodegenTestProject({
			codegen: { version: 1, outDir: "src/ui", twMerge: {} },
			components: [publishedComponent("button", flatPayload("px-3"))],
		});
		projects.push(project);
		await mkdir(project.path("src"), { recursive: true });
		await writeFile(
			project.path("src/theme.css"),
			"@utility card-padding { padding: 1rem; }\n",
		);
		await writeFile(
			project.path(".trickroom/systems/core/system.json"),
			`${JSON.stringify({ version: 1, systemId: CODEGEN_TEST_SYSTEM_ID, systemName: "Core", cssPath: "src/theme.css" })}\n`,
		);
		const drift = await run([project.root, "--check"]);
		expect(drift.code).toBe(1);
		expect(drift.stdout).toContain("missing  src/ui/tw-merge.ts");
		expect(drift.stdout).toContain(
			'Checked 2 files (1 component and the tailwind-merge config) for system "Core" -> src/ui: 0 ok, 2 missing.',
		);
		expect((await run([project.root])).stdout).toContain("Wrote 2 files");
		expect((await run([project.root, "--check"])).stdout).toBe(
			'Checked 2 files (1 component and the tailwind-merge config) for system "Core" -> src/ui: 2 ok.',
		);
	});

	it("prints the result JSON alone with --json", async () => {
		const project = await setup();
		const { code, stdout, stderr } = await run([project.root, "--json"]);
		expect(code).toBe(0);
		expect(stderr).toBe("");
		const result = JSON.parse(stdout);
		expect(result).toMatchObject({
			status: "ok",
			mode: "write",
			source: "published",
			outDir: "src/ui",
			orphaned: [],
			diagnostics: [],
		});
		expect(result.written).toHaveLength(2);

		await writeFile(
			project.path("src/ui/badge.variants.ts"),
			`${await readFile(project.path("src/ui/badge.variants.ts"), "utf8")}// edit\n`,
		);
		const drift = await run([project.root, "--check", "--json"]);
		expect(drift.code).toBe(1);
		expect(JSON.parse(drift.stdout).components).toContainEqual(
			expect.objectContaining({
				slug: "badge",
				status: "stale",
				reason: "body-edited",
			}),
		);
	});

	it("exits 2 for an unconfigured project, showing a minimal block", async () => {
		const project = await setup();
		await project.writeCodegen(undefined);
		const { code, stderr } = await run([project.root, "--check"]);
		expect(code).toBe(2);
		expect(stderr).toContain("Codegen is not configured");
		expect(stderr).toContain('"codegen": { "version": 1, "outDir": ');

		const json = await run([project.root, "--json"]);
		expect(json.code).toBe(2);
		expect(JSON.parse(json.stdout)).toMatchObject({
			status: "error",
			code: "CODEGEN_NOT_CONFIGURED",
		});
	});

	it("exits 2 for an invalid block, a missing project and bad arguments", async () => {
		const project = await setup();
		await writeFile(
			project.path(".trickroom/config.json"),
			JSON.stringify({ name: "x", codegen: { version: 1, outDir: "/abs" } }),
		);
		const invalid = await run([project.root, "--check"]);
		expect(invalid.code).toBe(2);
		expect(invalid.stderr).toContain("codegen.outDir must be relative");

		expect((await run([project.path("src")])).code).toBe(2);
		expect((await run(["--nope"])).code).toBe(2);
	});

	it("exits 2 when the formatter fails", async () => {
		const project = await setup();
		await writeFile(
			project.path("fail.mjs"),
			'process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write("cannot format"); process.exit(1); });',
		);
		await project.writeCodegen({
			version: 1,
			outDir: "src/ui",
			formatter: { command: process.execPath, args: ["fail.mjs"] },
		});
		const { code, stderr } = await run([project.root]);
		expect(code).toBe(2);
		expect(stderr).toContain("cannot format");
		expect(stderr).toContain("Nothing written");
	});

	it("exits 2 on a refused overwrite and 0 with --force", async () => {
		const project = await setup();
		await run([project.root]);
		await writeFile(project.path("src/ui/button.variants.ts"), "// mine\n");
		const refused = await run([project.root]);
		expect(refused.code).toBe(2);
		expect(refused.stderr).toContain("Refusing to overwrite a file");
		expect(refused.stderr).toContain("--force");
		const forced = await run([project.root, "--force"]);
		expect(forced.code).toBe(0);
		expect(forced.stdout).toContain("Wrote 1 file");
	});

	it("checks without migrating the project config", async () => {
		const project = await setup();
		// No projectId: the migrating reader would add one and rewrite the file.
		await writeFile(
			project.path(".trickroom/config.json"),
			JSON.stringify({
				name: "Legacy",
				codegen: { version: 1, outDir: "src/ui", system: "Core" },
			}),
		);
		const before = await project.snapshotMtimes();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect((await run([project.root, "--check"])).code).toBe(1);
		expect(await project.snapshotMtimes()).toEqual(before);
	});
});
