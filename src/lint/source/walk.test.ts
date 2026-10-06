import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkSourceFiles } from "./walk";

describe("walkSourceFiles", () => {
	const temps: string[] = [];
	afterEach(async () => {
		await Promise.all(
			temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("lists matching files in order, skipping ignored folders and symlinks", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-walk-"));
		temps.push(root);
		const outside = await mkdtemp(
			path.join(os.tmpdir(), "trickroom-lint-walk-outside-"),
		);
		temps.push(outside);
		const files = [
			"src/b.tsx",
			"src/a.ts",
			"src/types.d.ts",
			"src/nested/c.jsx",
			"src/nested/skip.css",
			"src/node_modules/dep/index.ts",
			"src/dist/out.js",
			"src/.hidden/h.ts",
			".trickroom/x.ts",
			"other/d.ts",
			"README.md",
		];
		for (const file of files) {
			await mkdir(path.join(root, path.dirname(file)), { recursive: true });
			await writeFile(path.join(root, file), "export {};\n");
		}
		await writeFile(path.join(outside, "e.ts"), "export {};\n");
		await symlink(outside, path.join(root, "src", "linked"));
		await symlink(path.join(outside, "e.ts"), path.join(root, "src", "e.ts"));

		const result = await walkSourceFiles(root, {
			include: ["src/**/*.{ts,tsx,jsx}"],
			exclude: ["**/*.d.ts"],
		});
		expect(result).toEqual({
			files: ["src/a.ts", "src/b.tsx", "src/nested/c.jsx"],
			truncated: false,
		});

		expect(
			(await walkSourceFiles(root, { include: ["**/*.ts"], exclude: [] }))
				.files,
		).toEqual(["other/d.ts", "src/a.ts", "src/types.d.ts"]);
		expect(
			await walkSourceFiles(root, {
				include: ["src/**/*.ts"],
				exclude: [],
				maxFiles: 1,
			}),
		).toEqual({ files: ["src/a.ts"], truncated: true });
		expect(
			(
				await walkSourceFiles(root, {
					include: ["missing/**/*.ts"],
					exclude: [],
				})
			).files,
		).toEqual([]);
	});
});
