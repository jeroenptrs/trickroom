import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Tailwind routes on a system whose stylesheet loads `@plugin` and
 * `@config` modules: they load, their project-owned files gate reviews like
 * the project's stylesheets, and a missing or failing module is a 422 that
 * names it.
 */
describe("tailwind routes with @plugin and @config", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	const writeProjectFile = async (relativePath: string, content: string) => {
		const filePath = path.join(tempProjectRoot, relativePath);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, content, "utf8");
		// A later mtime, so every stamp check sees the edit.
		const later = new Date(Date.now() + 5_000);
		await utimes(filePath, later, later);
	};

	const thirdPartyPlugin = (color: string) =>
		`module.exports = ({ addUtilities }) => addUtilities({ ".acme-panel": { color: "${color}" } });\n`;
	const localPlugin = (radius: string) =>
		[
			'import plugin from "tailwindcss/plugin";',
			'import { radius } from "./brand-radius.js";',
			'export default plugin(({ addUtilities }) => addUtilities({ ".brand-card": { "border-radius": radius } }));',
			`// ${radius}`,
			"",
		].join("\n");

	beforeEach(async () => {
		// Inside the repository, so `tailwindcss` resolves from its node_modules.
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-plugins-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeProjectFile(
			"trickroom.config.json",
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/app.css" },
			}),
		);
		await writeProjectFile(
			"node_modules/acme-ui/package.json",
			JSON.stringify({ name: "acme-ui", main: "index.js" }),
		);
		await writeProjectFile(
			"node_modules/acme-ui/index.js",
			thirdPartyPlugin("green"),
		);
		await writeProjectFile("src/brand.js", localPlugin("first"));
		await writeProjectFile(
			"src/brand-radius.js",
			'export const radius = "12px";\n',
		);
		await writeProjectFile(
			"tailwind.config.cjs",
			'module.exports = { theme: { extend: { colors: { brand: { 500: "#0ea5e9" } } } } };\n',
		);
		await writeProjectFile(
			"src/app.css",
			[
				'@import "tailwindcss";',
				'@plugin "acme-ui";',
				'@plugin "./brand.js";',
				'@config "../tailwind.config.cjs";',
				"",
			].join("\n"),
		);
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const setup = async () => {
		const { default: app } = await import("../server");
		const store = await import("../utils/tailwind-token-store");
		const post = (route: string, body: unknown) =>
			app.request(`/api/trickroom/tailwind/${route}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		const sync = async () => {
			const response = await post("sync-tokens", { systemName: "Core" });
			expect(response.status).toBe(200);
			return response.json();
		};
		const confirmed = async () => {
			await sync();
			const response = await post("systems/Core/tokens", { domains: {} });
			expect(response.status).toBe(200);
		};
		const read = () => store.readDomainTokens(tempProjectRoot, "Core");
		return { app, post, sync, confirmed, read };
	};

	it("syncs the tokens a @config adds and fingerprints the project's own module files", async () => {
		const { sync, read } = await setup();

		const json = await sync();

		expect(json.status).toBe("updated");
		expect(json.tokens).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "brand-500", value: "#0ea5e9" }),
			]),
		);
		const stored = await read();
		// The stylesheet, then the module files by path; acme-ui is third-party.
		expect(stored?.stylesheets?.files.map((file) => file.path)).toEqual([
			"src/app.css",
			"src/brand-radius.js",
			"src/brand.js",
			"tailwind.config.cjs",
		]);
	});

	it("an edit to a local plugin or a file it imports requires review and names the file", async () => {
		const { sync, confirmed } = await setup();
		await confirmed();

		await writeProjectFile("src/brand.js", localPlugin("second"));
		const plugin = await sync();
		expect(plugin.changes).toBe("project");
		expect(plugin.reviewRequired).toBe(true);
		expect(plugin.reviewChanges.stylesheets).toEqual({
			added: [],
			changed: ["src/brand.js"],
			removed: [],
		});

		await writeProjectFile("src/brand.js", localPlugin("first"));
		expect((await sync()).reviewRequired).toBe(false);

		await writeProjectFile(
			"src/brand-radius.js",
			'export const radius = "14px";\n',
		);
		const imported = await sync();
		expect(imported.reviewRequired).toBe(true);
		expect(imported.reviewChanges.stylesheets.changed).toEqual([
			"src/brand-radius.js",
		]);
	});

	it("a third-party plugin change needs no review unless it changes the definition", async () => {
		const { sync, confirmed } = await setup();
		await confirmed();

		await writeProjectFile(
			"node_modules/acme-ui/index.js",
			thirdPartyPlugin("lime"),
		);
		const utilities = await sync();
		expect(utilities.reviewRequired).toBe(false);

		// A third-party config that changes a token the project uses does.
		await writeProjectFile(
			"node_modules/acme-preset/package.json",
			JSON.stringify({ name: "acme-preset", main: "index.js" }),
		);
		await writeProjectFile(
			"node_modules/acme-preset/index.js",
			'module.exports = { theme: { extend: { colors: { accent: "#ff0000" } } } };\n',
		);
		await writeProjectFile(
			"src/app.css",
			[
				'@import "tailwindcss";',
				'@plugin "acme-ui";',
				'@plugin "./brand.js";',
				'@config "../tailwind.config.cjs";',
				'@config "acme-preset";',
				"",
			].join("\n"),
		);
		const { confirmed: confirmAgain, sync: syncAgain } = await setup();
		await confirmAgain();
		await writeProjectFile(
			"node_modules/acme-preset/index.js",
			'module.exports = { theme: { extend: { colors: { accent: "#00ff00" } } } };\n',
		);
		const preset = await syncAgain();
		expect(preset.reviewRequired).toBe(true);
		expect(preset.reviewChanges.stylesheets).toEqual({
			added: [],
			changed: [],
			removed: [],
		});
		expect(JSON.stringify(preset.reviewChanges.tokens.changed)).toContain(
			"accent",
		);
	});

	it("compiles plugin output for the canvas and lists plugin classes", async () => {
		const { app, post, sync } = await setup();
		const { systemId } = await sync();

		const compiled = await post("compile", {
			systemName: "Core",
			candidates: ["acme-panel", "brand-card", "bg-brand-500"],
		});
		expect(compiled.status).toBe(200);
		const { css } = await compiled.json();
		expect(css).toMatch(/\.acme-panel \{\s*color: green;/u);
		expect(css).toMatch(/\.brand-card \{\s*border-radius: 12px;/u);
		expect(css).toContain(".bg-brand-500");

		const catalog = await app.request(
			`/api/trickroom/tailwind/class-catalog?systemId=${systemId}`,
		);
		expect(catalog.status).toBe(200);
		expect(JSON.stringify(await catalog.json())).toContain('"brand-card"');
	});

	it("a missing or failing module is a 422 naming the directive and module", async () => {
		const { app, post, sync: syncOk } = await setup();
		const { systemId } = await syncOk();
		await writeProjectFile(
			"src/app.css",
			['@import "tailwindcss";', '@plugin "@acme/forms";', ""].join("\n"),
		);

		const sync = await post("sync-tokens", { systemName: "Core" });
		expect(sync.status).toBe(422);
		expect(await sync.json()).toEqual({
			error:
				'@plugin "@acme/forms": cannot find module "@acme/forms" from src; is it installed in the project?',
			code: "TAILWIND_MODULE_NOT_FOUND",
			directive: "@plugin",
			module: "@acme/forms",
		});

		const compile = await post("compile", {
			systemName: "Core",
			candidates: ["flex"],
		});
		expect(compile.status).toBe(422);
		const catalog = await app.request(
			`/api/trickroom/tailwind/class-catalog?systemId=${systemId}`,
		);
		expect(catalog.status).toBe(422);

		await writeProjectFile(
			"src/brand.js",
			'export default () => { throw new Error("plugin exploded"); };\n',
		);
		await writeProjectFile(
			"src/app.css",
			['@import "tailwindcss";', '@plugin "./brand.js";', ""].join("\n"),
		);
		const throwing = await post("sync-tokens", { systemName: "Core" });
		expect(throwing.status).toBe(422);
		expect(await throwing.json()).toMatchObject({
			error: '@plugin "./brand.js" (src/brand.js) threw: plugin exploded',
			code: "TAILWIND_MODULE_FAILED",
		});
	});
});
