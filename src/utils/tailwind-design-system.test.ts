import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	TailwindSystemResolutionError,
	listConfiguredTailwindSystems,
	loadTailwindDesignSystem,
	loadTailwindDesignSystemFromConfig,
	resolveConfiguredTailwindSystemTarget,
	resolveTailwindCssPath,
} from "./tailwind-design-system";

const tempProjectRoots: string[] = [];

async function createFixtureProject() {
	const projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-tailwind-design-system-"),
	);
	tempProjectRoots.push(projectRoot);

	const srcDir = path.join(projectRoot, "src");
	const packageDir = path.join(
		projectRoot,
		"node_modules",
		"test-tailwind-package",
	);
	const packageDistDir = path.join(packageDir, "dist");
	await mkdir(srcDir);
	await mkdir(packageDistDir, { recursive: true });
	await writeFile(
		path.join(packageDir, "package.json"),
		JSON.stringify({ name: "test-tailwind-package", version: "0.0.0" }),
		"utf8",
	);
	await writeFile(
		path.join(packageDistDir, "index.css"),
		['@import "./colors.css";', ""].join("\n"),
		"utf8",
	);
	await writeFile(
		path.join(packageDistDir, "colors.css"),
		["@theme {", "  --color-package-1: #123456;", "}", ""].join("\n"),
		"utf8",
	);
	await writeFile(
		path.join(srcDir, "index.css"),
		[
			'@import "tailwindcss";',
			'@import "./reset.css";',
			'@import "test-tailwind-package/dist/index.css";',
			"",
			"@theme static {",
			"  --color-test: var(--color-package-1);",
			"}",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		path.join(srcDir, "reset.css"),
		["@theme {", "  --color-*: initial;", "}", ""].join("\n"),
		"utf8",
	);

	return projectRoot;
}

afterEach(async () => {
	await Promise.all(
		tempProjectRoots.splice(0).map((projectRoot) =>
			rm(projectRoot, { force: true, recursive: true }),
		),
	);
});

describe("resolveTailwindCssPath", () => {
	it("resolves css paths relative to the project root", () => {
		const projectRoot = path.join(process.cwd(), "test-project");

		expect(resolveTailwindCssPath(projectRoot, "src/index.css")).toBe(
			path.join(projectRoot, "src", "index.css"),
		);
	});

	it("rejects css paths outside the project root", () => {
		expect(() =>
			resolveTailwindCssPath(path.join(process.cwd(), "test-project"), "../x"),
		).toThrow("Tailwind CSS path must be inside the project root");
	});
});

describe("loadTailwindDesignSystem", () => {
	it("loads root, local, and package stylesheets", async () => {
		const projectRoot = await createFixtureProject();

		const { designSystem, rootPath } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/index.css",
		});

		expect(rootPath).toBe(path.join(projectRoot, "src", "index.css"));
		expect(designSystem.theme.values.get("--color-test")?.value).toBe(
			"var(--color-package-1)",
		);
		expect(designSystem.theme.values.get("--color-package-1")?.value).toBe(
			"#123456",
		);
		expect(designSystem.theme.values.has("--color-blue-50")).toBe(false);
	});

	it("throws when a package import has no stylesheet entrypoint", async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-tailwind-design-system-"),
		);
		tempProjectRoots.push(projectRoot);

		await mkdir(path.join(projectRoot, "src"), { recursive: true });
		await mkdir(path.join(projectRoot, "node_modules", "test-no-style"), {
			recursive: true,
		});
		await writeFile(
			path.join(projectRoot, "node_modules", "test-no-style", "package.json"),
			JSON.stringify({ name: "test-no-style", version: "0.0.0", main: "index.js" }),
			"utf8",
		);
		await writeFile(
			path.join(projectRoot, "node_modules", "test-no-style", "index.js"),
			"export default {};\n",
			"utf8",
		);
		await writeFile(
			path.join(projectRoot, "src", "index.css"),
			['@import "tailwindcss";', '@import "test-no-style";', ""].join("\n"),
			"utf8",
		);

		await expect(
			loadTailwindDesignSystem({
				projectRoot,
				cssPath: "src/index.css",
			}),
		).rejects.toThrow('Package "test-no-style" does not expose a stylesheet entrypoint');
	});
});

describe("loadTailwindDesignSystemFromConfig", () => {
	it("returns null when the config has no systems", async () => {
		await expect(
			loadTailwindDesignSystemFromConfig(process.cwd(), {
				name: "Test Project",
			}),
		).resolves.toBeNull();
	});

	it("loads the first configured system", async () => {
		const projectRoot = await createFixtureProject();

		const loaded = await loadTailwindDesignSystemFromConfig(projectRoot, {
			name: "Test Project",
			systems: {
				" Core ": " src/index.css ",
			},
		});

		expect(loaded?.rootPath).toBe(path.join(projectRoot, "src", "index.css"));
		expect(loaded?.systemName).toBe("Core");
		expect(loaded?.designSystem.theme.values.has("--color-test")).toBe(true);
	});
});

describe("listConfiguredTailwindSystems", () => {
	it("preserves config order and trims values", () => {
		const projectRoot = path.join(process.cwd(), "test-project");

		expect(
			listConfiguredTailwindSystems(
				projectRoot,
				{
					name: "Test Project",
					systems: {
						" Core ": " ./src/index.css ",
						" Marketing ": " src/marketing.css ",
					},
				},
			),
		).toEqual([
			{
				name: "Core",
				cssPath: "./src/index.css",
				normalizedCssPath: path.join(projectRoot, "src", "index.css"),
			},
			{
				name: "Marketing",
				cssPath: "src/marketing.css",
				normalizedCssPath: path.join(projectRoot, "src", "marketing.css"),
			},
		]);
	});
});

describe("resolveConfiguredTailwindSystemTarget", () => {
	const projectRoot = path.join(process.cwd(), "test-project");
	const config = {
		name: "Test Project",
		systems: {
			Core: "./src/index.css",
			Marketing: "src/marketing.css",
		},
	};

	it("resolves by system name", () => {
		expect(
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{
					systemName: " Core ",
				},
			),
		).toEqual({
			systemName: "Core",
			cssPath: "./src/index.css",
			normalizedCssPath: path.join(projectRoot, "src", "index.css"),
		});
	});

	it("resolves by css path using normalized matching", () => {
		expect(
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{
					cssPath: "src/index.css",
				},
			),
		).toEqual({
			systemName: "Core",
			cssPath: "./src/index.css",
			normalizedCssPath: path.join(projectRoot, "src", "index.css"),
		});
	});

	it("resolves absolute css paths inside the project root", () => {
		expect(
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{
					cssPath: path.join(projectRoot, "src", "index.css"),
				},
			),
		).toMatchObject({
			systemName: "Core",
			cssPath: "./src/index.css",
		});
	});

	it("throws unknown system error", () => {
		expect(() =>
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{
					systemName: "Unknown",
				},
			),
		).toThrowError(TailwindSystemResolutionError);

		try {
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{ systemName: "Unknown" },
			);
		} catch (error) {
			expect((error as TailwindSystemResolutionError).code).toBe("UNKNOWN_SYSTEM");
		}
	});

	it("throws ambiguous css path error", () => {
		expect(() =>
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				{
					name: "Test Project",
					systems: {
						Core: "./src/index.css",
						"Core Alias": "src/index.css",
					},
				},
				{ cssPath: "src/index.css" },
			),
		).toThrowError(TailwindSystemResolutionError);

		try {
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				{
					name: "Test Project",
					systems: {
						Core: "./src/index.css",
						"Core Alias": "src/index.css",
					},
				},
				{ cssPath: "src/index.css" },
			);
		} catch (error) {
			expect((error as TailwindSystemResolutionError).code).toBe(
				"AMBIGUOUS_CSS_PATH",
			);
		}
	});
});
