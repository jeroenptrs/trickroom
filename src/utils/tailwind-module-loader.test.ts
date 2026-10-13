import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalizeCache } from "./tailwind-canonicalize-cache";
import {
	compileTailwindCss,
	loadCanvasTailwindDesignSystem,
} from "./tailwind-design-system";
import {
	loadCachedTailwindDesignSystem,
	loadTrackedTailwindDesignSystem,
} from "./tailwind-design-system-loader";
import {
	findTailwindModuleError,
	type TailwindModuleError,
} from "./tailwind-module-loader";
import { getTailwindSourceFiles } from "./tailwind-source-files";
import { extractTailwindTokens } from "./tailwind-token-domains";

// Inside the repository, so `tailwindcss` and `tailwindcss/plugin` resolve
// from its node_modules like a project's own would.
let projectRoot: string;

const write = async (relativePath: string, content: string) => {
	const filePath = path.join(projectRoot, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content, "utf8");
	return filePath;
};

/** Rewrites a file with a later mtime, so stamp checks see the change. */
const rewrite = async (relativePath: string, content: string) => {
	const filePath = await write(relativePath, content);
	const later = new Date(Date.now() + 5_000);
	await utimes(filePath, later, later);
};

const entry = (...directives: string[]) =>
	['@import "tailwindcss";', ...directives, ""].join("\n");

const cssFor = async (cssPath: string, candidates: string[]) => {
	const { designSystem } = await loadTrackedTailwindDesignSystem({
		projectRoot,
		cssPath,
	});
	return designSystem.candidatesToCss(candidates);
};

const loadError = async (cssPath: string) => {
	const error = await loadTrackedTailwindDesignSystem({
		projectRoot,
		cssPath,
	}).then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).not.toBeNull();
	const moduleError = findTailwindModuleError(error);
	expect(moduleError).not.toBeNull();
	return moduleError as TailwindModuleError;
};

beforeEach(async () => {
	projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-trickroom-tailwind-modules-test-"),
	);
});

afterEach(async () => {
	await rm(projectRoot, { force: true, recursive: true });
});

describe("@plugin and @config modules", () => {
	it("loads an npm-style plugin from the project's node_modules", async () => {
		await write(
			"node_modules/acme-plugin/package.json",
			JSON.stringify({ name: "acme-plugin", main: "index.js" }),
		);
		await write(
			"node_modules/acme-plugin/index.js",
			'module.exports = ({ addUtilities }) => addUtilities({ ".acme": { color: "green" } });\n',
		);
		await write("src/app.css", entry('@plugin "acme-plugin";'));

		const [css] = await cssFor("src/app.css", ["acme"]);
		expect(css).toContain("color: green");

		const loaded = await loadTrackedTailwindDesignSystem({
			projectRoot,
			cssPath: "src/app.css",
		});
		expect(loaded.modules).toEqual([
			{
				directive: "@plugin",
				id: "acme-plugin",
				path: path.join(projectRoot, "node_modules/acme-plugin/index.js"),
				files: [path.join(projectRoot, "node_modules/acme-plugin/index.js")],
			},
		]);
	});

	it("loads local ESM, CommonJS and TypeScript plugins with their imports", async () => {
		await write(
			"src/plugins/esm.js",
			[
				'import plugin from "tailwindcss/plugin";',
				'import { color } from "./esm-color.js";',
				'export default plugin(({ addUtilities }) => addUtilities({ ".esm": { color } }));',
				"",
			].join("\n"),
		);
		await write("src/plugins/esm-color.js", 'export const color = "red";\n');
		await write(
			"src/plugins/cjs.cjs",
			[
				'const plugin = require("tailwindcss/plugin");',
				'const { color } = require("./cjs-color.cjs");',
				'module.exports = plugin(({ addUtilities }) => addUtilities({ ".cjs": { color } }));',
				"",
			].join("\n"),
		);
		await write("src/plugins/cjs-color.cjs", 'exports.color = "blue";\n');
		await write(
			"src/plugins/typed.ts",
			[
				'import type { PluginAPI } from "tailwindcss/plugin";',
				'enum Tone { Ink = "black" }',
				'export default ({ addUtilities }: PluginAPI) => addUtilities({ ".typed": { color: Tone.Ink } });',
				"",
			].join("\n"),
		);
		await write(
			"src/app.css",
			entry(
				'@plugin "./plugins/esm.js";',
				'@plugin "./plugins/cjs.cjs";',
				'@plugin "./plugins/typed.ts";',
			),
		);

		const css = await cssFor("src/app.css", ["esm", "cjs", "typed"]);
		expect(css[0]).toContain("color: red");
		expect(css[1]).toContain("color: blue");
		expect(css[2]).toContain("color: black");

		const loaded = await loadTrackedTailwindDesignSystem({
			projectRoot,
			cssPath: "src/app.css",
		});
		const relative = (file: string) => path.relative(projectRoot, file);
		expect(loaded.modules.map((module) => module.files.map(relative))).toEqual([
			["src/plugins/cjs.cjs", "src/plugins/cjs-color.cjs"],
			["src/plugins/esm.js", "src/plugins/esm-color.js"],
			["src/plugins/typed.ts"],
		]);
		// Stamped for the caches, recorded for the file watcher.
		for (const module of loaded.modules) {
			for (const file of module.files) {
				expect(loaded.fileStamps.get(file)).toEqual(expect.any(String));
				expect(getTailwindSourceFiles()).toContain(file);
			}
		}
	});

	it("passes plugin options to plugin.withOptions", async () => {
		await write(
			"src/options.js",
			[
				'import plugin from "tailwindcss/plugin";',
				"export default plugin.withOptions((options) => ({ addUtilities }) =>",
				'  addUtilities({ ["." + options.name]: { color: "teal" } }));',
				"",
			].join("\n"),
		);
		await write(
			"src/app.css",
			entry('@plugin "./options.js" {', "  name: chosen;", "}"),
		);

		const [css] = await cssFor("src/app.css", ["chosen"]);
		expect(css).toContain("color: teal");
	});

	it("reads theme extensions from @config as tokens", async () => {
		await write(
			"tailwind.config.js",
			[
				"module.exports = {",
				'  theme: { extend: { colors: { brand: { 500: "#0ea5e9" } }, spacing: { gutter: "18px" } } },',
				"};",
				"",
			].join("\n"),
		);
		await write("src/app.css", entry('@config "../tailwind.config.js";'));

		const loaded = await loadTrackedTailwindDesignSystem({
			projectRoot,
			cssPath: "src/app.css",
		});
		const tokens = extractTailwindTokens(loaded.designSystem);
		expect(tokens.color["brand-500"]).toBe("#0ea5e9");
		expect(tokens.spacing.gutter).toBe("18px");
		expect(loaded.modules.map((module) => module.directive)).toEqual([
			"@config",
		]);
	});

	it("names the directive and module when a local module is missing", async () => {
		await write("src/app.css", entry('@plugin "./missing.js";'));

		const error = await loadError("src/app.css");
		expect(error.code).toBe("TAILWIND_MODULE_NOT_FOUND");
		expect(error.directive).toBe("@plugin");
		expect(error.module).toBe("./missing.js");
		expect(error.message).toBe(
			'@plugin "./missing.js": no module at src/missing.js',
		);
		// Watched while missing, so creating it can recover.
		expect(getTailwindSourceFiles()).toContain(
			path.join(projectRoot, "src/missing.js"),
		);
	});

	it("names the directive and package when a package is not installed", async () => {
		await write("src/app.css", entry('@config "@acme/not-installed";'));

		const error = await loadError("src/app.css");
		expect(error.code).toBe("TAILWIND_MODULE_NOT_FOUND");
		expect(error.directive).toBe("@config");
		expect(error.message).toBe(
			'@config "@acme/not-installed": cannot find module "@acme/not-installed" from src; is it installed in the project?',
		);
	});

	it("names the directive and module when a plugin throws as it runs", async () => {
		await write(
			"src/throws.js",
			'export default () => { throw new Error("plugin exploded"); };\n',
		);
		await write("src/app.css", entry('@plugin "./throws.js";'));

		const error = await loadError("src/app.css");
		expect(error.code).toBe("TAILWIND_MODULE_FAILED");
		expect(error.message).toBe(
			'@plugin "./throws.js" (src/throws.js) threw: plugin exploded',
		);
	});

	it("names the directive and module when a plugin built with plugin() throws", async () => {
		await write(
			"src/throws.cjs",
			[
				'const plugin = require("tailwindcss/plugin");',
				'module.exports = plugin(() => { throw new TypeError("bad handler"); });',
				"",
			].join("\n"),
		);
		await write(
			"src/config.cjs",
			'module.exports = { plugins: [() => { throw new Error("config plugin"); }] };\n',
		);
		await write("src/plugin.css", entry('@plugin "./throws.cjs";'));
		await write("src/config.css", entry('@config "./config.cjs";'));

		expect((await loadError("src/plugin.css")).message).toBe(
			'@plugin "./throws.cjs" (src/throws.cjs) threw: bad handler',
		);
		expect((await loadError("src/config.css")).message).toBe(
			'@config "./config.cjs" (src/config.cjs) threw: config plugin',
		);
	});

	it("names the directive and module when a module fails to evaluate", async () => {
		await write("src/broken.js", "export default {\n");
		await write("src/top-level.js", 'throw new Error("at import");\n');
		await write("src/broken.css", entry('@plugin "./broken.js";'));
		await write("src/top-level.css", entry('@plugin "./top-level.js";'));

		const broken = await loadError("src/broken.css");
		expect(broken.code).toBe("TAILWIND_MODULE_FAILED");
		expect(broken.message).toMatch(
			/^@plugin "\.\/broken\.js" \(src\/broken\.js\) failed to load: /u,
		);
		expect((await loadError("src/top-level.css")).message).toBe(
			'@plugin "./top-level.js" (src/top-level.js) failed to load: at import',
		);
	});
});

describe("module edge cases", () => {
	it("tracks two require()s on one line, and a symlinked import, and reloads them", async () => {
		await write(
			"src/compact.cjs",
			[
				'const a = require("./a.cjs"), b = require("./link.cjs");',
				'module.exports = ({ addUtilities }) => addUtilities({ ".compact": { color: a, "background-color": b } });',
				"",
			].join("\n"),
		);
		await write("src/a.cjs", 'module.exports = "red";\n');
		await write("src/real/b.cjs", 'module.exports = "white";\n');
		await symlink(
			path.join(projectRoot, "src/real/b.cjs"),
			path.join(projectRoot, "src/link.cjs"),
		);
		await write("src/app.css", entry('@plugin "./compact.cjs";'));
		const options = { projectRoot, cssPath: "src/app.css" };
		const first = await loadCachedTailwindDesignSystem(options);
		expect(
			first.modules[0]?.files.map((file) => path.relative(projectRoot, file)),
		).toEqual(["src/compact.cjs", "src/a.cjs", "src/link.cjs"]);
		const css = (loaded: typeof first) =>
			loaded.designSystem.candidatesToCss(["compact"])[0] ?? "";
		expect(css(first)).toContain("color: red");
		expect(css(first)).toContain("background-color: white");

		await rewrite("src/a.cjs", 'module.exports = "blue";\n');
		await rewrite("src/real/b.cjs", 'module.exports = "black";\n');

		const second = await loadCachedTailwindDesignSystem(options);
		expect(css(second)).toContain("color: blue");
		expect(css(second)).toContain("background-color: black");
	});

	it("names the directive and module when a theme callback or a nested plugin throws", async () => {
		await write(
			"src/theme-callback.cjs",
			'module.exports = { theme: { extend: { colors: () => { throw new Error("theme boom"); } } } };\n',
		);
		await write(
			"src/nested.cjs",
			[
				'const plugin = require("tailwindcss/plugin");',
				'module.exports = plugin(() => {}, { plugins: [() => { throw new Error("nested boom"); }] });',
				"",
			].join("\n"),
		);
		await write("src/theme.css", entry('@config "./theme-callback.cjs";'));
		await write("src/nested.css", entry('@plugin "./nested.cjs";'));

		expect((await loadError("src/theme.css")).message).toBe(
			'@config "./theme-callback.cjs" (src/theme-callback.cjs) threw: theme boom',
		);
		expect((await loadError("src/nested.css")).message).toBe(
			'@plugin "./nested.cjs" (src/nested.cjs) threw: nested boom',
		);
	});

	it("loads frozen plugins and configs", async () => {
		await write(
			"src/frozen-plugin.cjs",
			'module.exports = Object.freeze({ handler: ({ addUtilities }) => addUtilities({ ".frozen": { color: "red" } }) });\n',
		);
		await write(
			"src/frozen-config.cjs",
			'module.exports = Object.freeze({ plugins: Object.freeze([({ addUtilities }) => addUtilities({ ".frozen-config": { color: "blue" } })]), theme: Object.freeze({ extend: Object.freeze({ colors: Object.freeze({ ice: "#e0f2fe" }) }) }) });\n',
		);
		await write(
			"src/app.css",
			entry('@plugin "./frozen-plugin.cjs";', '@config "./frozen-config.cjs";'),
		);

		const css = await cssFor("src/app.css", [
			"frozen",
			"frozen-config",
			"bg-ice",
		]);
		expect(css[0]).toContain("color: red");
		expect(css[1]).toContain("color: blue");
		expect(css[2]).toContain("#e0f2fe");
	});
});

describe("module dependencies and getters", () => {
	it("tracks a JSON require without extension and a TypeScript import of ./x.js", async () => {
		await write(
			"tailwind.config.cjs",
			'module.exports = { theme: { extend: { colors: require("./colors") } } };\n',
		);
		await write("colors.json", '{ "brand": "#111111" }\n');
		await write(
			"src/typed.ts",
			[
				'import { color } from "./typed-color.js";',
				'export default ({ addUtilities }: { addUtilities: (u: object) => void }) => addUtilities({ ".typed": { color } });',
				"",
			].join("\n"),
		);
		await write("src/typed-color.ts", 'export const color: string = "red";\n');
		await write(
			"src/app.css",
			entry('@config "../tailwind.config.cjs";', '@plugin "./typed.ts";'),
		);
		const options = { projectRoot, cssPath: "src/app.css" };
		const first = await loadCachedTailwindDesignSystem(options);
		expect(
			first.modules.flatMap((module) =>
				module.files.map((file) => path.relative(projectRoot, file)),
			),
		).toEqual([
			"src/typed.ts",
			"src/typed-color.ts",
			"tailwind.config.cjs",
			"colors.json",
		]);

		await rewrite("colors.json", '{ "brand": "#222222" }\n');
		await rewrite(
			"src/typed-color.ts",
			'export const color: string = "blue";\n',
		);

		const second = await loadCachedTailwindDesignSystem(options);
		const css = second.designSystem.candidatesToCss(["bg-brand", "typed"]);
		expect(css[0]).toContain("#222222");
		expect(css[1]).toContain("color: blue");
	});

	it("reads a frozen config lazily: unused getters do not run, non-enumerable keys still read", async () => {
		await write(
			"src/frozen.cjs",
			[
				"const config = {",
				'  get unused() { throw new Error("never read"); },',
				"};",
				'Object.defineProperty(config, "theme", { enumerable: false, value: { extend: { colors: { ice: "#e0f2fe" } } } });',
				"module.exports = Object.freeze(config);",
				"",
			].join("\n"),
		);
		await write("src/app.css", entry('@config "./frozen.cjs";'));

		const [css] = await cssFor("src/app.css", ["bg-ice"]);
		expect(css).toContain("#e0f2fe");
	});

	it("runs getters on the object itself and names the module when one throws", async () => {
		await write(
			"src/self.cjs",
			[
				"const extend = {",
				'  get colors() { return { brand: this === extend ? "#ff0000" : "#0000ff" }; },',
				"};",
				"module.exports = { theme: { extend } };",
				"",
			].join("\n"),
		);
		await write(
			"src/throwing-getter.cjs",
			'module.exports = { get theme() { throw new Error("getter boom"); } };\n',
		);
		await write("src/self.css", entry('@config "./self.cjs";'));
		await write("src/throwing.css", entry('@config "./throwing-getter.cjs";'));

		const [css] = await cssFor("src/self.css", ["bg-brand"]);
		expect(css).toContain("#ff0000");
		expect((await loadError("src/throwing.css")).message).toBe(
			'@config "./throwing-getter.cjs" (src/throwing-getter.cjs) threw: getter boom',
		);
	});
});

describe("caches over plugin files", () => {
	const writePlugin = () =>
		Promise.all([
			write(
				"src/brand.js",
				[
					'import plugin from "tailwindcss/plugin";',
					'import { radius } from "./brand-radius.js";',
					'export default plugin(({ addUtilities }) => addUtilities({ ".brand-card": { "border-radius": radius } }));',
					"",
				].join("\n"),
			),
			write("src/brand-radius.js", 'export const radius = "12px";\n'),
			write("src/app.css", entry('@plugin "./brand.js";')),
		]);

	it("the cached design system loads again when a local plugin's import changes", async () => {
		await writePlugin();
		const options = { projectRoot, cssPath: "src/app.css" };
		const first = await loadCachedTailwindDesignSystem(options);
		expect(await loadCachedTailwindDesignSystem(options)).toBe(first);
		expect(first.designSystem.candidatesToCss(["brand-card"])[0]).toContain(
			"12px",
		);

		await rewrite("src/brand-radius.js", 'export const radius = "20px";\n');

		const second = await loadCachedTailwindDesignSystem(options);
		expect(second).not.toBe(first);
		expect(second.designSystem.candidatesToCss(["brand-card"])[0]).toContain(
			"20px",
		);
	});

	it("the compiled canvas stylesheet compiles again when a local plugin changes", async () => {
		await writePlugin();
		const compile = () =>
			compileTailwindCss({
				projectRoot,
				cssPath: "src/app.css",
				candidates: ["brand-card"],
			});
		expect(await compile()).toMatch(/\.brand-card \{\s*border-radius: 12px;/u);

		await rewrite("src/brand-radius.js", 'export const radius = "20px";\n');
		expect(await compile()).toMatch(/\.brand-card \{\s*border-radius: 20px;/u);

		await rewrite(
			"src/brand.js",
			'export default () => { throw new Error("now broken"); };\n',
		);
		await expect(compile()).rejects.toThrow(
			'@plugin "./brand.js" (src/brand.js) threw: now broken',
		);
	});

	it("the class catalog's design system reports plugin files", async () => {
		await writePlugin();
		const { fileMtimes } = await loadCanvasTailwindDesignSystem({
			projectRoot,
			cssPath: "src/app.css",
		});
		expect([...fileMtimes.keys()]).toEqual(
			expect.arrayContaining([
				path.join(projectRoot, "src/brand.js"),
				path.join(projectRoot, "src/brand-radius.js"),
			]),
		);
	});

	it("the canonicalization cache keeps systems with the same stylesheets but other plugins apart", async () => {
		let modulesKey = "a";
		let loads = 0;
		const cache = createCanonicalizeCache<string, string>({
			warmSystems: 4,
			paths: 4,
			load: async (rootPath) => {
				loads += 1;
				return {
					system: `${rootPath}:${modulesKey}`,
					cssSource: "@plugin './brand.js';",
					modulesKey,
					fileStamps: new Map(),
				};
			},
			isFresh: async () => false,
			canonicalize: (system, candidate) => `${system}:${candidate}`,
		});

		expect(await cache.canonicalize("/a/app.css", ["x"])).toEqual([
			"/a/app.css:a:x",
		]);
		modulesKey = "b";
		expect(await cache.canonicalize("/b/app.css", ["x"])).toEqual([
			"/b/app.css:b:x",
		]);
		expect(loads).toBe(2);
	});
});
