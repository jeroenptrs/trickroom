import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	listConfiguredTailwindSystems,
	loadTailwindDesignSystem,
	loadTailwindDesignSystemFromConfig,
	resolveConfiguredTailwindSystemTarget,
	resolveTailwindCssPath,
	sanitizeSpacingThemeToken,
	TailwindSystemResolutionError,
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
		tempProjectRoots
			.splice(0)
			.map((projectRoot) => rm(projectRoot, { force: true, recursive: true })),
	);
});

describe("sanitizeSpacingThemeToken", () => {
	it("returns safe spacing values unchanged", () => {
		expect(sanitizeSpacingThemeToken("0.25rem")).toBe("0.25rem");
	});

	it("rejects unsafe characters with the default fallback", () => {
		expect(sanitizeSpacingThemeToken("0.25rem; } evil")).toBe("0.25rem");
		expect(sanitizeSpacingThemeToken("")).toBe("0.25rem");
	});
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

	it("loads token sources that clear --spacing while using Tailwind's spacing function", async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-tailwind-design-system-"),
		);
		tempProjectRoots.push(projectRoot);

		await mkdir(path.join(projectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(projectRoot, "src", "index.css"),
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --spacing: initial;",
				"  --spacing-content: 12px;",
				"}",
				".card { margin: --spacing(4); }",
				"",
			].join("\n"),
			"utf8",
		);

		const { designSystem } = await loadTailwindDesignSystem({
			projectRoot,
			cssPath: "src/index.css",
		});

		expect(designSystem.theme.values.get("--spacing")?.value).toBe("0.25rem");
		expect(designSystem.theme.values.get("--spacing-content")?.value).toBe(
			"12px",
		);
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
			JSON.stringify({
				name: "test-no-style",
				version: "0.0.0",
				main: "index.js",
			}),
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
		).rejects.toThrow(
			'Package "test-no-style" does not expose a stylesheet entrypoint',
		);
	});
});

describe("loadTailwindDesignSystemFromConfig", () => {
	it("returns null when the config has no systems", async () => {
		const projectRoot = await createFixtureProject();

		await expect(
			loadTailwindDesignSystemFromConfig(projectRoot, {
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
	it("preserves config order and trims values", async () => {
		const projectRoot = path.join(process.cwd(), "test-project");

		await expect(
			listConfiguredTailwindSystems(projectRoot, {
				name: "Test Project",
				systems: {
					" Core ": " ./src/index.css ",
					" Marketing ": " src/marketing.css ",
				},
			}),
		).resolves.toEqual([
			{
				systemId: "Core",
				systemName: "Core",
				cssPath: "./src/index.css",
				normalizedCssPath: path.join(projectRoot, "src", "index.css"),
			},
			{
				systemId: "Marketing",
				systemName: "Marketing",
				cssPath: "src/marketing.css",
				normalizedCssPath: path.join(projectRoot, "src", "marketing.css"),
			},
		]);
	});

	it("throws when system names collide after safe-key normalization", async () => {
		await expect(
			listConfiguredTailwindSystems(path.join(process.cwd(), "test-project"), {
				name: "Test Project",
				systems: {
					"My System": "src/index.css",
					"my-system": "src/marketing.css",
				},
			}),
		).rejects.toThrow(/duplicate storage keys/i);
	});

	it("throws when a system name cannot produce a safe storage key", async () => {
		await expect(
			listConfiguredTailwindSystems(path.join(process.cwd(), "test-project"), {
				name: "Test Project",
				systems: {
					"@@@": "src/index.css",
				},
			}),
		).rejects.toThrow(/safe storage key/i);
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

	it("resolves by system name", async () => {
		await expect(
			resolveConfiguredTailwindSystemTarget(projectRoot, config, {
				systemName: " Core ",
			}),
		).resolves.toEqual({
			systemId: "Core",
			systemName: "Core",
			cssPath: "./src/index.css",
			normalizedCssPath: path.join(projectRoot, "src", "index.css"),
		});
	});

	it("resolves by css path using normalized matching", async () => {
		await expect(
			resolveConfiguredTailwindSystemTarget(projectRoot, config, {
				cssPath: "src/index.css",
			}),
		).resolves.toEqual({
			systemId: "Core",
			systemName: "Core",
			cssPath: "./src/index.css",
			normalizedCssPath: path.join(projectRoot, "src", "index.css"),
		});
	});

	it("resolves absolute css paths inside the project root", async () => {
		await expect(
			resolveConfiguredTailwindSystemTarget(projectRoot, config, {
				cssPath: path.join(projectRoot, "src", "index.css"),
			}),
		).resolves.toMatchObject({
			systemId: "Core",
			systemName: "Core",
			cssPath: "./src/index.css",
		});
	});

	it("throws unknown system error", async () => {
		expect.assertions(2);

		await expect(
			resolveConfiguredTailwindSystemTarget(projectRoot, config, {
				systemName: "Unknown",
			}),
		).rejects.toThrowError(TailwindSystemResolutionError);

		try {
			await resolveConfiguredTailwindSystemTarget(projectRoot, config, {
				systemName: "Unknown",
			});
		} catch (error) {
			expect((error as TailwindSystemResolutionError).code).toBe(
				"UNKNOWN_SYSTEM",
			);
		}
	});

	it("throws ambiguous css path error", async () => {
		expect.assertions(2);

		await expect(
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
		).rejects.toThrowError(TailwindSystemResolutionError);

		try {
			await resolveConfiguredTailwindSystemTarget(
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

	it("throws duplicate system key errors from configured systems", async () => {
		expect.assertions(2);

		await expect(
			resolveConfiguredTailwindSystemTarget(
				projectRoot,
				{
					name: "Test Project",
					systems: {
						"My System": "./src/index.css",
						"my-system": "src/marketing.css",
					},
				},
				{ systemName: "My System" },
			),
		).rejects.toThrowError(TailwindSystemResolutionError);

		try {
			await resolveConfiguredTailwindSystemTarget(
				projectRoot,
				{
					name: "Test Project",
					systems: {
						"My System": "./src/index.css",
						"my-system": "src/marketing.css",
					},
				},
				{ systemName: "My System" },
			);
		} catch (error) {
			expect((error as TailwindSystemResolutionError).code).toBe(
				"DUPLICATE_SYSTEM_KEY",
			);
		}
	});
});
