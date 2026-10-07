import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CodegenTestProject,
	createCodegenTestProject,
	flatPayload,
	publishedComponent,
} from "../codegen/test-support";
import { variantsFileStaleRule } from "./rules/code/variants-file";
import { createLintRuleRegistry } from "./rules/registry";
import { type RunLintInput, runLint as runLintWithEveryKind } from "./run-lint";

/**
 * What a lint run does when the filesystem misbehaves under it: folders it
 * cannot read. The failures are injected, since a test running as root cannot take its own
 * read permission away.
 */

const injected = vi.hoisted(() => ({
	/** Absolute directory path -> the error code `readdir` fails with. */
	readdirFailures: new Map<string, string>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		readdir: (async (...args: Parameters<typeof actual.readdir>) => {
			const code = injected.readdirFailures.get(String(args[0]));
			if (code) {
				throw Object.assign(
					new Error(`${code}: injected, scandir '${String(args[0])}'`),
					{ code },
				);
			}
			return actual.readdir(...args);
		}) as typeof actual.readdir,
	};
});

const registry = createLintRuleRegistry([variantsFileStaleRule]);
const runLint = (input: RunLintInput) =>
	runLintWithEveryKind({ registry, ...input });

const REPORT = ".trickroom/systems/core/lint-report.json";

describe("runLint on a misbehaving filesystem", () => {
	const projects: CodegenTestProject[] = [];
	afterEach(async () => {
		injected.readdirFailures.clear();
		await Promise.all(projects.splice(0).map((project) => project.cleanup()));
	});

	const setup = async () => {
		const project = await createCodegenTestProject({
			components: [publishedComponent("button", flatPayload("px-3"))],
		});
		projects.push(project);
		await mkdir(project.path("src/ui"), { recursive: true });
		await writeFile(
			project.path("src/ui/button.tsx"),
			"export const Button = () => <button />;\n",
		);
		await writeFile(
			project.path("src/app.tsx"),
			'import { Button } from "./ui/button";\nexport const App = () => <Button />;\n',
		);
		return project;
	};

	it("fails the run, writing nothing, when a source folder or the designs folder cannot be read", async () => {
		const project = await setup();
		const first = await runLint({ projectRoot: project.root });
		expect(first.written).toBe(true);
		const committed = await readFile(project.path(REPORT), "utf8");

		injected.readdirFailures.set(project.path("src/ui"), "EACCES");
		const sources = await runLint({ projectRoot: project.root });
		expect(sources).toMatchObject({
			status: "error",
			written: false,
			report: null,
		});
		expect(sources.diagnostics).toEqual([
			{
				code: "SOURCES_UNREADABLE",
				severity: "error",
				message: expect.stringContaining("src/ui"),
				path: "src/ui",
			},
		]);
		expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);

		injected.readdirFailures.clear();
		injected.readdirFailures.set(project.path(".trickroom/designs"), "EACCES");
		const designs = await runLint({ projectRoot: project.root });
		expect(designs).toMatchObject({ status: "error", written: false });
		expect(designs.diagnostics).toEqual([
			{
				code: "DESIGNS_UNREADABLE",
				severity: "error",
				message: expect.stringContaining("EACCES"),
				path: ".trickroom/designs",
			},
		]);
		expect(await readFile(project.path(REPORT), "utf8")).toBe(committed);
	});

	it("warns about an include root that does not exist", async () => {
		const project = await setup();
		await writeFile(
			project.path(".trickroom/systems/core/lint.json"),
			JSON.stringify({
				version: 1,
				source: { include: ["src/**", "packages/app/src/**"] },
			}),
		);
		const result = await runLint({ projectRoot: project.root, check: true });
		expect(result.status).toBe("pass");
		expect(result.diagnostics).toEqual([
			{
				code: "SOURCE_ROOT_MISSING",
				severity: "warning",
				message: expect.stringContaining("packages/app/src does not exist"),
				path: "packages/app/src",
			},
		]);
	});
});
