import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Delay reading chosen stylesheets, so imports finish loading out of order.
const delayedFiles = new Map<string, number>();
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		readFile: (async (...args: Parameters<typeof actual.readFile>) => {
			const delay = delayedFiles.get(path.basename(String(args[0])));
			if (delay) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
			return actual.readFile(...args);
		}) as typeof actual.readFile,
	};
});

const { loadTailwindDesignSystem } = await import(
	"./tailwind-design-system-loader"
);

describe("loaded stylesheets", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-loader-order-test-"),
		);
		await mkdir(path.join(projectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "core.css"),
			[
				'@import "tailwindcss";',
				"@layer components {",
				'  @import "./a.css";',
				"}",
				'@reference "./b.css";',
				'@import "./c.css";',
				"",
			].join("\n"),
		);
		await writeFile(
			path.join(projectRoot, "src", "a.css"),
			"@theme { --color-a-500: #111; }\n",
		);
		await writeFile(
			path.join(projectRoot, "src", "b.css"),
			"@theme { --color-b-500: #222; }\n",
		);
		await writeFile(
			path.join(projectRoot, "src", "c.css"),
			"@theme { --color-c-500: #333; }\n",
		);
	});

	afterEach(async () => {
		delayedFiles.clear();
		await rm(projectRoot, { force: true, recursive: true });
	});

	const projectOrder = async () => {
		const loaded = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/core.css",
		});
		return loaded.stylesheets
			.map((stylesheet) => path.relative(projectRoot, stylesheet.path))
			.filter((relative) => !relative.includes("node_modules"));
	};

	it("come in source order, nested imports included, however loads complete", async () => {
		const expected = ["src/core.css", "src/a.css", "src/b.css", "src/c.css"];

		delayedFiles.set("a.css", 60);
		expect(await projectOrder()).toEqual(expected);

		delayedFiles.clear();
		delayedFiles.set("c.css", 60);
		delayedFiles.set("b.css", 30);
		expect(await projectOrder()).toEqual(expected);
	});
});
