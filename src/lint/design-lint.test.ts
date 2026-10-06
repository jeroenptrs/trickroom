import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDesignSystemStorage,
	type DesignSystemRecord,
	findDesignSystem,
} from "../utils/design-system-store";
import { loadDesignLintSetup } from "./design-lint";

describe("design lint setup", () => {
	let projectRoot: string;

	beforeEach(async () => {
		// Inside the repo so `@import "tailwindcss"` resolves from node_modules.
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-lint-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	const setupSystem = async (): Promise<DesignSystemRecord> => {
		await writeFile(
			path.join(projectRoot, "app.css"),
			'@import "tailwindcss";\n@import "./theme.css";\n',
		);
		await writeFile(
			path.join(projectRoot, "theme.css"),
			"@theme {\n\t--color-brand-500: #2563eb;\n}\n",
		);
		const { systemId } = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "app.css",
		});
		const system = await findDesignSystem(projectRoot, systemId, {
			readOnly: true,
		});
		if (!system) throw new Error("no system");
		return system;
	};

	const inspectorOf = async (system: DesignSystemRecord) =>
		(await loadDesignLintSetup({ projectRoot, system })).inspector();

	/** Rewrite a file and move its mtime, as an editor save would. */
	const rewrite = async (file: string, contents: string, seconds: number) => {
		await writeFile(path.join(projectRoot, file), contents);
		const time = new Date(Date.now() + seconds * 1000);
		await utimes(path.join(projectRoot, file), time, time);
	};

	it("reuses the compiled Tailwind system across validation calls while the CSS is unchanged", async () => {
		const system = await setupSystem();
		const first = await inspectorOf(system);
		expect(first?.inspect("bg-brand-500").supported).toBe(true);
		// Identity, compared as booleans: the inspector has an `inspect`
		// method that the matcher's formatter would call.
		expect((await inspectorOf(system)) === first).toBe(true);
		expect((await inspectorOf(system)) === first).toBe(true);
	});

	it("compiles again when the entry CSS or a file it imports changes", async () => {
		const system = await setupSystem();
		const first = await inspectorOf(system);
		expect(first?.inspect("bg-fresh-500").supported).toBe(false);

		await rewrite(
			"theme.css",
			"@theme {\n\t--color-brand-500: #2563eb;\n\t--color-fresh-500: #16a34a;\n}\n",
			5,
		);
		const afterImport = await inspectorOf(system);
		expect(afterImport === first).toBe(false);
		expect(afterImport?.inspect("bg-fresh-500").supported).toBe(true);

		await rewrite(
			"app.css",
			'@import "tailwindcss";\n@import "./theme.css";\n@theme {\n\t--color-late-500: #000;\n}\n',
			10,
		);
		const afterEntry = await inspectorOf(system);
		expect(afterEntry === afterImport).toBe(false);
		expect(afterEntry?.inspect("bg-late-500").supported).toBe(true);
		expect((await inspectorOf(system)) === afterEntry).toBe(true);
	});
});
