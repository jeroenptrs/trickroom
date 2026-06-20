import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTailwindColorTokens } from "../utils/default-tailwind-tokens";

describe("tailwind sync endpoint validation", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}

		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	it("returns 400 when request body is missing both targets", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when request body provides both targets", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core", cssPath: "src/index.css" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when no systems are configured", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 404 for unknown system name", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Other" }),
		});

		expect(response.status).toBe(404);
	});

	it("returns 404 for unknown css path", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cssPath: "src/unknown.css" }),
		});

		expect(response.status).toBe(404);
	});

	it("returns 400 for css paths outside the project root", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cssPath: "../outside.css" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 409 for ambiguous normalized css path targets", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "./src/index.css", "Core Alias": "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cssPath: "src/index.css" }),
		});

		expect(response.status).toBe(409);
	});

	it("returns 409 for systems that collide after storage key normalization", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { "My System": "src/index.css", "my-system": "src/other.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "My System" }),
		});

		expect(response.status).toBe(409);
	});

	it("returns 400 for invalid config file shape", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: " " },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns a deterministic preview with baseline diff metadata for the targeted system", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css", Marketing: "src/marketing.css" },
			}),
			"utf8",
		);

		const coreCssPath = path.join(tempProjectRoot, "src", "core.css");
		const coreCss = [
			'@import "tailwindcss";',
			"@theme {",
			"  --color-*: initial;",
			"  --color-brand-500: #123456;",
			"  --color-brand-100: #abcdef;",
			"  --spacing-content: 12px;",
			"}",
			"",
		].join("\n");
		await mkdir(path.dirname(coreCssPath), { recursive: true });
		await writeFile(coreCssPath, coreCss, "utf8");
		await writeFile(
			path.join(tempProjectRoot, "src", "marketing.css"),
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-marketing-500: #654321;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json).toMatchObject({
			status: "updated",
			systemName: "Core",
			cssPath: "src/core.css",
			tailwindBaselineVersion: "4.2.4",
			tokens: [
				{ name: "brand-100", value: "#abcdef", domain: "color" },
				{ name: "brand-500", value: "#123456", domain: "color" },
				{ name: "content", value: "12px", domain: "spacing" },
			],
			baselineDiff: {
				added: [
					{ name: "brand-100", value: "#abcdef", domain: "color" },
					{ name: "brand-500", value: "#123456", domain: "color" },
				],
				overridden: [],
				unchanged: [],
			},
		});
		expect(json).not.toHaveProperty("acknowledgedMissingDefaultTokenNames");
		expect(json).not.toHaveProperty("colorTokens");
		expect(json.tokens).not.toContainEqual(
			expect.objectContaining({ name: "marketing-500" }),
		);
		expect(json.tokens).not.toContainEqual(
			expect.objectContaining({ name: "spacing-content" }),
		);
		expect(json.tokens.map((token: { name: string }) => token.name)).toEqual([
			"brand-100",
			"brand-500",
			"content",
		]);
		expect(json.baselineDiff.removed).toContainEqual(
			expect.objectContaining({ name: "blue-500", domain: "color" }),
		);
		expect(json.baselineDiff.missingDefaultTokenNames).toContain("blue-500");
		expect(json.baselineDiff.missingDefaultTokenNames).toEqual(
			json.baselineDiff.removed.map((token: { name: string }) => token.name),
		);
	});

	it("does not modify the target css file when previewing sync tokens", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		const initialCss = [
			'@import "tailwindcss";',
			"@theme {",
			"  --color-*: initial;",
			"  --color-brand-500: #123456;",
			"}",
			"",
		].join("\n");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(cssPath, initialCss, "utf8");
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(200);
		expect(await readFile(cssPath, "utf8")).toBe(initialCss);
	});

	it("does not persist unchanged default tokens while preserving custom/overridden values", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const [unchangedTokenName, unchangedTokenValue] = Object.entries(
			defaultTailwindColorTokens,
		)[0] ?? ["blue-500", "#0000ff"];

		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		const css = [
			'@import "tailwindcss";',
			"@theme {",
			"  --color-*: initial;",
			`  --color-${unchangedTokenName}: ${unchangedTokenValue};`,
			"  --color-red-500: #ff0000;",
			"}",
			"",
		].join("\n");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(cssPath, css, "utf8");
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.status).toBe("updated");

		const { readDomainTokens, resolveTokenSnapshotPath } = await import(
			"../utils/tailwind-token-store"
		);
		const stored = await readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.domains.color.tokens).toEqual({
			"red-500": "#ff0000",
		});
		expect(stored?.domains.color.tokens).not.toHaveProperty(unchangedTokenName);

		const snapshotPath = resolveTokenSnapshotPath(tempProjectRoot, "Core");
		const parsedSnapshot = JSON.parse(
			await readFile(snapshotPath, "utf8"),
		) as Record<string, unknown>;
		expect(parsedSnapshot).not.toHaveProperty(
			"domains.color.baselineDiff.unchanged",
		);
		expect(parsedSnapshot).not.toHaveProperty(
			"domains.color.baselineDiff.missingDefaultTokenNames",
		);
	});

	it("returns status: updated when no stored file exists", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-brand-500: #123456;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.status).toBe("updated");
		expect(json.reviewRequired).toBe(true);
		expect(json.syncedAt).toEqual(expect.any(String));

		const { readDomainTokens, resolveTokenSnapshotPath } = await import(
			"../utils/tailwind-token-store"
		);
		const stored = await readDomainTokens(tempProjectRoot, "Core");
		const snapshotPath = resolveTokenSnapshotPath(tempProjectRoot, "Core");
		const rawSnapshot = await readFile(snapshotPath, "utf8");
		const parsedSnapshot = JSON.parse(rawSnapshot) as Record<string, unknown>;

		expect(stored).toMatchObject({
			metadata: {
				cssPath: "src/core.css",
				tailwindBaselineVersion: "4.2.4",
				reviewRequired: true,
			},
			domains: {
				color: {
					tokens: {
						"brand-500": "#123456",
					},
					overrides: [],
					baselineDiff: {
						added: [{ name: "brand-500", value: "#123456", domain: "color" }],
						overridden: [],
						removed: expect.any(Array),
					},
				},
			},
		});
		expect(stored?.metadata.syncedAt).toEqual(expect.any(String));
		expect(snapshotPath).toBe(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"core",
				"tokens.json",
			),
		);
		expect(parsedSnapshot).not.toHaveProperty(
			"domains.color.baselineDiff.unchanged",
		);
		expect(parsedSnapshot).not.toHaveProperty(
			"domains.color.baselineDiff.missingDefaultTokenNames",
		);
	});

	it("stores snapshots in normalized safe-system-name directories", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { "My System": "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-brand-500: #123456;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();
		const { resolveTokenSnapshotPath } = await import(
			"../utils/tailwind-token-store"
		);

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "My System" }),
		});

		expect(response.status).toBe(200);
		const snapshotPath = resolveTokenSnapshotPath(tempProjectRoot, "My System");
		await expect(readFile(snapshotPath, "utf8")).resolves.toEqual(
			expect.any(String),
		);
		expect(snapshotPath).toBe(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"my-system",
				"tokens.json",
			),
		);
	});

	it("returns status: ok without rewriting when the canonical snapshot is unchanged", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-brand-500: #123456;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const { readDomainTokens, resolveTokenSnapshotPath, storeDomainTokens } =
			await import("../utils/tailwind-token-store");
		const app = await importTestServer();
		const initialResponse = await app.request(
			"/api/trickroom/tailwind/sync-tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ systemName: "Core" }),
			},
		);
		expect(initialResponse.status).toBe(200);
		const initialStored = await readDomainTokens(tempProjectRoot, "Core");
		expect(initialStored).not.toBeNull();
		const previousSyncedAt = "2026-05-03T10:00:00.000Z";
		await storeDomainTokens({
			projectRoot: tempProjectRoot,
			systemName: "Core",
			cssPath: "./src/core.css",
			tailwindBaselineVersion: "4.2.4",
			tokens: initialStored?.domains.color.tokens ?? {},
			overrides: ["--color-brand-500"],
			baselineDiff: initialStored?.domains.color.baselineDiff ?? {
				added: [],
				overridden: [],
				removed: [],
			},
			reviewRequired: false,
			syncedAt: previousSyncedAt,
		});
		const snapshotPath = resolveTokenSnapshotPath(tempProjectRoot, "Core");
		const snapshotContentsBefore = await readFile(snapshotPath, "utf8");

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.status).toBe("ok");
		expect(json.cssPath).toBe("src/core.css");
		expect(json.syncedAt).toBe(previousSyncedAt);
		expect(json.reviewRequired).toBe(false);
		expect(await readFile(snapshotPath, "utf8")).toBe(snapshotContentsBefore);
	});

	it("returns status: updated and preserves overrides when the canonical snapshot changes", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-brand-500: #123456;",
				"  --color-brand-100: #abcdef;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const previousSyncedAt = "2026-05-03T10:00:00.000Z";
		const { readDomainTokens, storeDomainTokens } = await import(
			"../utils/tailwind-token-store"
		);
		await storeDomainTokens({
			projectRoot: tempProjectRoot,
			systemName: "Core",
			cssPath: "src/core.css",
			tailwindBaselineVersion: "4.2.4",
			tokens: { "brand-500": "#123456" },
			overrides: ["--color-*"],
			baselineDiff: {
				added: [{ name: "brand-500", value: "#123456", domain: "color" }],
				overridden: [],
				removed: [],
			},
			reviewRequired: false,
			syncedAt: previousSyncedAt,
		});
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.status).toBe("updated");
		expect(json.reviewRequired).toBe(true);
		expect(json.syncedAt).not.toBe(previousSyncedAt);

		const stored = await readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.metadata.reviewRequired).toBe(true);
		expect(stored?.domains.color.overrides).toEqual(["--color-*"]);
		expect(stored?.domains.color.tokens).toEqual({
			"brand-100": "#abcdef",
			"brand-500": "#123456",
		});
	});

	it("returns status: ok when synced tokens include overridden default color tokens", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme {",
				"  --color-*: initial;",
				"  --color-blue-500: #123456;",
				"}",
				"",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();

		const firstResponse = await app.request(
			"/api/trickroom/tailwind/sync-tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ systemName: "Core" }),
			},
		);
		expect(firstResponse.status).toBe(200);
		const firstJson = await firstResponse.json();
		expect(firstJson.status).toBe("updated");

		const response = await app.request("/api/trickroom/tailwind/sync-tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core" }),
		});
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.status).toBe("ok");
		expect(json.baselineDiff.overridden).toContainEqual(
			expect.objectContaining({ name: "blue-500", value: "#123456" }),
		);
	});
});

describe("tailwind GET /systems/:systemName/tokens", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-get-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}

		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	it("returns 404 when tokens not stored", async () => {
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/nonexistent/tokens",
			{
				method: "GET",
				headers: { "content-type": "application/json" },
			},
		);

		expect(response.status).toBe(404);
	});

	it("returns 400 for system names with invalid storage keys", async () => {
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/%40%40%40/tokens",
			{
				method: "GET",
				headers: { "content-type": "application/json" },
			},
		);

		expect(response.status).toBe(400);
	});

	it("renders stored tokens as static HTML", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens.html",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const html = await response.text();
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("core");
		expect(html).toContain("brand-500");
		expect(html).toContain("#123456");
		expect(html).not.toContain("<script");
	});

	it("marks static token HTML as downloadable when requested", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens.html?download=1",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toMatch(
			/^attachment; filename=".+-tokens\.html"$/,
		);
	});

	it("retrieves stored tokens and empty overrides", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456", "brand-100": "#abcdef" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "GET",
				headers: { "content-type": "application/json" },
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json).toMatchObject({
			ok: true,
			systemName: "core",
			cssPath: "src/theme.css",
			tailwindBaselineVersion: "4.2.4",
			reviewRequired: false,
			domains: {
				color: {
					tokens: {
						"brand-100": "#abcdef",
						"brand-500": "#123456",
					},
					overrides: [],
				},
			},
		});
		expect(json).not.toHaveProperty("tokens");
		expect(json).not.toHaveProperty("overrides");
		expect(json.syncedAt).toBeDefined();
	});

	it("retrieves stored tokens with overrides", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			["--color-brand-500"],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "GET",
				headers: { "content-type": "application/json" },
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.overrides).toEqual(["--color-brand-500"]);
		expect(json).not.toHaveProperty("overrides");
	});

	it("canonicalizes stale stored tokens before returning them", async () => {
		const { resolveTokenSnapshotPath } = await import(
			"../utils/tailwind-token-store"
		);
		const snapshotPath = resolveTokenSnapshotPath(tempProjectRoot, "core");
		await mkdir(path.dirname(snapshotPath), { recursive: true });
		await writeFile(
			snapshotPath,
			JSON.stringify(
				{
					version: 2,
					metadata: {
						systemName: "core",
						cssPath: "src/theme.css",
						syncedAt: "2026-05-02T12:00:00.000Z",
						tailwindBaselineVersion: "4.2.4",
						reviewRequired: false,
					},
					domains: {
						color: {
							tokens: {
								"brand-500": "#123456",
								"blue-500": defaultTailwindColorTokens["blue-500"],
							},
							overrides: [],
							baselineDiff: {
								added: [
									{ name: "brand-500", value: "#123456", domain: "color" },
								],
								overridden: [],
								removed: [],
							},
						},
					},
				},
				null,
				"\t",
			),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "GET",
				headers: { "content-type": "application/json" },
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.tokens).toEqual({ "brand-500": "#123456" });
		expect(
			JSON.parse(await readFile(snapshotPath, "utf8")).domains.color.tokens,
		).toEqual({ "brand-500": "#123456" });
	});
});

describe("tailwind POST /systems/:systemName/tokens", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-patch-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}

		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	it("returns 404 when tokens not stored", async () => {
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/nonexistent/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ domains: { color: { overrides: [] } } }),
			},
		);

		expect(response.status).toBe(404);
	});

	it("returns 400 for system names with invalid storage keys", async () => {
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/%40%40%40/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ domains: { color: { overrides: [] } } }),
			},
		);

		expect(response.status).toBe(400);
	});

	it("rejects invalid override patterns", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: { color: { overrides: ["invalid-pattern"] } },
				}),
			},
		);

		expect(response.status).toBe(400);
		const json = await response.json();
		expect(String(json.error)).toContain("--color-");
	});

	it("updates overrides without modifying tokens", async () => {
		const { storeDomainTokens, readDomainTokens } = await import(
			"../utils/tailwind-token-store"
		);
		const tokens = {
			"brand-100": "#abcdef",
			"brand-500": "#123456",
		};
		const syncedAt = "2026-05-03T10:00:00.000Z";
		const baselineDiff = {
			added: [
				{
					name: "blue-500",
					value: "#0000ff",
					domain: "color",
				},
			],
			overridden: [
				{
					name: "green-500",
					value: "#00ff00",
					defaultValue: "#0f0f0f",
					domain: "color",
				},
			],
			removed: [
				{
					name: "red-500",
					defaultValue: "#ff0000",
					domain: "color",
				},
			],
		};
		await storeDomainTokens({
			projectRoot: tempProjectRoot,
			systemName: "core",
			tokens,
			overrides: [],
			tailwindBaselineVersion: "4.2.4",
			cssPath: "src/theme.css",
			baselineDiff,
			reviewRequired: true,
			syncedAt,
		});
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: {
						color: {
							overrides: ["--color-brand-500", "--color-brand-100"],
						},
					},
				}),
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.syncedAt).toBe(syncedAt);
		expect(json.reviewRequired).toBe(false);
		expect(json.domains.color.tokens).toEqual(tokens);
		expect(json.domains.color.baselineDiff).toEqual(baselineDiff);
		// Overrides are sorted by the store
		expect(json.domains.color.overrides).toEqual([
			"--color-brand-100",
			"--color-brand-500",
		]);
		expect(json).not.toHaveProperty("tokens");
		expect(json).not.toHaveProperty("overrides");

		// Verify persisted
		const stored = await readDomainTokens(tempProjectRoot, "core");
		expect(stored?.metadata.syncedAt).toBe(syncedAt);
		expect(stored?.domains.color.tokens).toEqual(tokens);
		expect(stored?.metadata.reviewRequired).toBe(false);
		expect(stored?.domains.color.baselineDiff).toEqual(baselineDiff);
		expect(stored?.domains.color.overrides).toEqual([
			"--color-brand-100",
			"--color-brand-500",
		]);
	});

	it("clears overrides when empty array provided", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		const tokens = { "brand-500": "#123456" };
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			tokens,
			["--color-brand-500"],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ domains: { color: { overrides: [] } } }),
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.overrides).toEqual([]);
	});

	it("validates all overrides as non-empty strings", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ domains: { color: { overrides: [123] } } }),
			},
		);

		expect(response.status).toBe(400);
	});

	it("accepts case-insensitive color patterns", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: { color: { overrides: ["--COLOR-Brand-500"] } },
				}),
			},
		);

		expect(response.status).toBe(200);
	});

	it("accepts wildcard color patterns", async () => {
		const { storeDomainTokens } = await import("../utils/tailwind-token-store");
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			[],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: { color: { overrides: ["--color-*", "--color-brand-*"] } },
				}),
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.overrides).toEqual([
			"--color-*",
			"--color-brand-*",
		]);
	});

	it("accepts non-color domain override patterns including namespace defaults", async () => {
		const { storeDomainTokens, readDomainTokens } = await import(
			"../utils/tailwind-token-store"
		);
		await storeDomainTokens(
			tempProjectRoot,
			"core",
			{ "brand-500": "#123456" },
			["--color-brand-500"],
			"4.2.4",
			"src/theme.css",
		);
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: {
						spacing: { overrides: ["--spacing", "--spacing-card"] },
					},
				}),
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.overrides).toEqual(["--color-brand-500"]);
		expect(json.domains.spacing.overrides).toEqual([
			"--spacing",
			"--spacing-card",
		]);

		const read = await readDomainTokens(tempProjectRoot, "core");
		expect(read?.domains.spacing.overrides).toEqual([
			"--spacing",
			"--spacing-card",
		]);
	});

	it("round-trips granular red family and token overrides", async () => {
		const { storeDomainTokens, readDomainTokens } = await import(
			"../utils/tailwind-token-store"
		);
		await storeDomainTokens({
			projectRoot: tempProjectRoot,
			systemName: "core",
			tokens: { "brand-500": "#123456" },
			overrides: [],
			tailwindBaselineVersion: "4.2.4",
			cssPath: "src/theme.css",
			baselineDiff: {
				added: [{ name: "brand-500", value: "#123456", domain: "color" }],
				overridden: [],
				removed: [],
			},
			reviewRequired: true,
		});
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/tailwind/systems/core/tokens",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					domains: {
						color: { overrides: ["--color-red-50", "--color-red-*"] },
					},
				}),
			},
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.domains.color.overrides).toEqual([
			"--color-red-*",
			"--color-red-50",
		]);
		expect(json.domains.color.tokens).toEqual({ "brand-500": "#123456" });

		const read = await readDomainTokens(tempProjectRoot, "core");
		expect(read?.domains.color.overrides).toEqual([
			"--color-red-*",
			"--color-red-50",
		]);
	});

	it("compiles a full stylesheet for the given candidates", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		const cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(
			cssPath,
			[
				'@import "tailwindcss";',
				"@theme { --color-brand: oklch(0.6 0.2 280); }",
				"",
			].join("\n"),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/compile", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				systemName: "Core",
				candidates: ["flex", "bg-brand", "grid"],
			}),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.candidateCount).toBe(3);
		expect(json.css).toContain("box-sizing"); // preflight
		expect(json.css).toContain("--color-brand"); // theme var
		expect(json.css).toContain("display: flex");
		expect(json.css).toContain(".bg-brand");
	});

	it("compiles baseline Tailwind when no system target is given", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Test Project" }),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/compile", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ candidates: ["flex", "p-4"] }),
		});

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.systemId).toBeNull();
		expect(json.css).toContain("box-sizing"); // preflight
		expect(json.css).toContain("display: flex");
		expect(json.css).toContain(".p-4");
	});

	it("rejects a compile request with non-string candidates", async () => {
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/tailwind/compile", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ systemName: "Core", candidates: [42] }),
		});

		expect(response.status).toBe(400);
	});
});
