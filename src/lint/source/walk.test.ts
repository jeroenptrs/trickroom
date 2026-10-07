import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walkSourceFiles } from "./walk";

/** Absolute directory path -> the error code `readdir` fails with. */
const readdirFailures = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		readdir: (async (...args: Parameters<typeof actual.readdir>) => {
			const code = readdirFailures.get(String(args[0]));
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

describe("walkSourceFiles", () => {
	const temps: string[] = [];
	afterEach(async () => {
		readdirFailures.clear();
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
			missingRoots: [],
			unreadable: [],
		});

		expect(
			(await walkSourceFiles(root, { include: ["**/*.ts"], exclude: [] }))
				.files,
		).toEqual(["other/d.ts", "src/a.ts", "src/types.d.ts"]);
		// A glob without an extension takes the source files only: the CSS
		// next to them is never parsed as TypeScript.
		expect(
			(await walkSourceFiles(root, { include: ["**"], exclude: [] })).files,
		).toEqual([
			"other/d.ts",
			"src/a.ts",
			"src/b.tsx",
			"src/nested/c.jsx",
			"src/types.d.ts",
		]);
		expect(
			await walkSourceFiles(root, {
				include: ["src/**/*.ts"],
				exclude: [],
				maxFiles: 1,
			}),
		).toMatchObject({ files: ["src/a.ts"], truncated: true });
	});

	it("reports an include root that does not exist, and every folder it could not read", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "trickroom-lint-walk-"));
		temps.push(root);
		for (const file of ["src/a.ts", "src/nested/b.ts", "src/other/c.ts"]) {
			await mkdir(path.join(root, path.dirname(file)), { recursive: true });
			await writeFile(path.join(root, file), "export {};\n");
		}

		// A configured root that is not there is not an error: nothing to scan.
		expect(
			await walkSourceFiles(root, {
				include: ["missing/**/*.ts", "src/**/*.ts", "src/gone/x/*.ts"],
				exclude: [],
			}),
		).toEqual({
			files: ["src/a.ts", "src/nested/b.ts", "src/other/c.ts"],
			truncated: false,
			missingRoots: ["missing", "src/gone/x"],
			unreadable: [],
		});

		// A folder that cannot be read is not an empty folder: the caller has
		// to know the file list is incomplete.
		readdirFailures.set(path.join(root, "src", "nested"), "EACCES");
		const denied = await walkSourceFiles(root, {
			include: ["src/**"],
			exclude: [],
		});
		expect(denied.files).toEqual(["src/a.ts", "src/other/c.ts"]);
		expect(denied.unreadable).toEqual([
			{
				path: "src/nested",
				code: "EACCES",
				message: expect.stringContaining("EACCES"),
			},
		]);

		// So is the project root, and an include root that fails other than
		// by not existing.
		readdirFailures.clear();
		readdirFailures.set(root, "EACCES");
		expect(
			(await walkSourceFiles(root, { include: ["**"], exclude: [] }))
				.unreadable,
		).toEqual([{ path: ".", code: "EACCES", message: expect.any(String) }]);
	});
});
