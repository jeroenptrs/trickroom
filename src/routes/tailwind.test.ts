import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultTailwindColorTokens,
	defaultTailwindTokensVersion,
} from "../utils/default-tailwind-tokens";

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

	it("reports how component classes merge for a design's system", async () => {
		await mkdir(path.join(tempProjectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(tempProjectRoot, "src/core.css"),
			"@theme { --color-royal-9: oklch(54% 0.22 263); }\n",
			"utf8",
		);
		const systemId = "sys_00000000-0000-4000-8000-0000000000c1";
		await mkdir(path.join(tempProjectRoot, ".trickroom/systems/core"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom/systems/core/system.json"),
			JSON.stringify({
				version: 1,
				systemId,
				systemName: "Core",
				cssPath: "src/core.css",
			}),
			"utf8",
		);
		await writeFile(
			path.join(tempProjectRoot, ".trickroom/config.json"),
			JSON.stringify({
				schemaVersion: 1,
				projectId: "proj_class_merge",
				name: "Test Project",
				defaultSystemId: systemId,
			}),
			"utf8",
		);
		const app = await importTestServer();
		const read = async (query: string) => {
			const response = await app.request(
				`/api/trickroom/tailwind/class-merge${query}`,
			);
			expect(response.status).toBe(200);
			return response.json();
		};

		expect(await read(`?systemId=${systemId}`)).toEqual({
			systemId,
			mode: "stock",
			components: { systemId, table: {} },
		});
		expect(await read("")).toEqual({ systemId: null, mode: "none" });
		expect(await read("?systemId=Missing")).toEqual({
			systemId: "Missing",
			mode: "none",
		});
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
			tailwindBaselineVersion: defaultTailwindTokensVersion,
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
				tailwindBaselineVersion: defaultTailwindTokensVersion,
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
			tailwindBaselineVersion: defaultTailwindTokensVersion,
			tokens: initialStored?.domains.color.tokens ?? {},
			overrides: ["--color-brand-500"],
			baselineDiff: initialStored?.domains.color.baselineDiff ?? {
				added: [],
				overridden: [],
				removed: [],
			},
			authored: initialStored?.authored,
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

describe("tailwind sync reviews only the project's own changes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;
	let cssPath: string;

	const themeCss = (extra: string[] = []) =>
		[
			'@import "tailwindcss";',
			"@theme {",
			"  --color-*: initial;",
			"  --color-brand-500: #123456;",
			"  --color-blue-500: #0011ff;",
			...extra,
			"}",
			"",
		].join("\n");

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-review-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(cssPath, themeCss(), "utf8");
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
		const sync = async () => {
			const response = await app.request(
				"/api/trickroom/tailwind/sync-tokens",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ systemName: "Core" }),
				},
			);
			expect(response.status).toBe(200);
			return response.json();
		};
		const confirm = async () => {
			const stored = await store.readDomainTokens(tempProjectRoot, "Core");
			const response = await app.request(
				"/api/trickroom/tailwind/systems/Core/tokens",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						domains: { color: { overrides: stored?.domains.color.overrides } },
					}),
				},
			);
			expect(response.status).toBe(200);
			return response.json();
		};
		const getStored = async () => {
			const response = await app.request(
				"/api/trickroom/tailwind/systems/Core/tokens",
			);
			expect(response.status).toBe(200);
			return response.json();
		};
		/**
		 * Rewrite the stored snapshot as an older Tailwind release would have
		 * synced it: an older baseline version and other default values on the
		 * removed and overridden entries. Optionally as a v3 file (no confirmed
		 * state).
		 */
		const rewriteAsOlderTailwind = async ({
			version = "4.2.4",
			reviewRequired,
			asV3 = false,
			membership = false,
		}: {
			version?: string;
			reviewRequired?: boolean;
			/** As an older Trickroom wrote it: no confirmed or authored data. */
			asV3?: boolean;
			/**
			 * Other default *names*: two defaults the theme's reset removes did
			 * not exist yet, and one that no longer exists did.
			 */
			membership?: boolean;
		}) => {
			const snapshotPath = store.resolveTokenSnapshotPath(
				tempProjectRoot,
				"Core",
			);
			const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
			snapshot.metadata.tailwindBaselineVersion = version;
			if (reviewRequired !== undefined) {
				snapshot.metadata.reviewRequired = reviewRequired;
			}
			const color = snapshot.domains.color.baselineDiff;
			for (const entry of [...color.removed, ...color.overridden].slice(
				0,
				14,
			)) {
				entry.defaultValue = `${entry.defaultValue} /* older */`;
			}
			if (membership) {
				const dropped = { name: "retired-500", defaultValue: "#000" };
				color.removed = [
					...color.removed.slice(2),
					{ ...dropped, domain: "color" },
				];
				if (snapshot.confirmed?.domains.color) {
					snapshot.confirmed.domains.color.removed = [
						...snapshot.confirmed.domains.color.removed.slice(2),
						dropped.name,
					];
				}
			}
			if (asV3) {
				delete snapshot.confirmed;
				delete snapshot.authored;
				for (const utility of snapshot.customUtilities) {
					delete utility.definition;
				}
			}
			await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
		};

		return { store, sync, confirm, getStored, rewriteAsOlderTailwind };
	};

	it("confirming a review records the confirmed project definition", async () => {
		const { store, sync, confirm } = await setup();

		const first = await sync();
		expect(first.reviewRequired).toBe(true);
		expect(first.changes).toBe("project");
		expect(first.reviewChanges).toBeNull();

		const confirmed = await confirm();
		expect(confirmed.reviewRequired).toBe(false);
		expect(confirmed.reviewChanges).toMatchObject({
			tokens: { added: [], changed: [], removed: [] },
		});
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.confirmed?.domains.color?.tokens).toEqual({
			"blue-500": "#0011ff",
			"brand-500": "#123456",
		});
	});

	it("a Tailwind version-only change updates the snapshot without review", async () => {
		const { store, sync, confirm } = await setup();
		await sync();
		await confirm();
		const snapshotPath = store.resolveTokenSnapshotPath(
			tempProjectRoot,
			"Core",
		);
		const before = JSON.parse(await readFile(snapshotPath, "utf8"));
		before.metadata.tailwindBaselineVersion = "4.2.4";
		await writeFile(snapshotPath, JSON.stringify(before), "utf8");

		const json = await sync();

		expect(json.status).toBe("updated");
		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
		expect(json.tailwindBaselineVersion).toBe(defaultTailwindTokensVersion);
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.metadata.tailwindBaselineVersion).toBe(
			defaultTailwindTokensVersion,
		);
		expect(stored?.metadata.reviewRequired).toBe(false);
	});

	it("Tailwind default-value-only changes update the snapshot without review", async () => {
		const { store, sync, confirm, rewriteAsOlderTailwind } = await setup();
		await sync();
		await confirm();
		await rewriteAsOlderTailwind({ version: defaultTailwindTokensVersion });

		const json = await sync();

		expect(json.status).toBe("updated");
		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(
			stored?.domains.color.baselineDiff.removed.some((entry) =>
				entry.defaultValue.includes("older"),
			),
		).toBe(false);
	});

	it("a Tailwind upgrade of a confirmed v3 snapshot needs no review", async () => {
		const { store, sync, confirm, rewriteAsOlderTailwind } = await setup();
		await sync();
		await confirm();
		await rewriteAsOlderTailwind({ reviewRequired: false, asV3: true });

		const json = await sync();

		expect(json.status).toBe("updated");
		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.version).toBe(3);
		expect(stored?.metadata.tailwindBaselineVersion).toBe(
			defaultTailwindTokensVersion,
		);
		expect(stored?.confirmed?.tailwindBaselineVersion).toBe("4.2.4");
	});

	it("a Tailwind upgrade that adds and removes defaults beneath a reset needs no review", async () => {
		const { store, sync, confirm, rewriteAsOlderTailwind } = await setup();
		await sync();
		await confirm();
		await rewriteAsOlderTailwind({ membership: true });

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(
			stored?.domains.color.baselineDiff.removed.some(
				(entry) => entry.name === "retired-500",
			),
		).toBe(false);
	});

	it("an older Trickroom's snapshot with a default Tailwind since dropped needs no review", async () => {
		const { sync, confirm, rewriteAsOlderTailwind, store } = await setup();
		await sync();
		await confirm();
		// No authored theme to compare: the resolved tokens are compared, and
		// a removed name that is no longer a default is not a project change.
		await rewriteAsOlderTailwind({ asV3: true, reviewRequired: false });
		const snapshotPath = store.resolveTokenSnapshotPath(
			tempProjectRoot,
			"Core",
		);
		const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
		snapshot.domains.color.baselineDiff.removed.push({
			name: "retired-500",
			defaultValue: "#000",
			domain: "color",
		});
		await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
	});

	it("a real token change requires review and reports only the delta", async () => {
		const { sync, confirm, getStored, rewriteAsOlderTailwind } = await setup();
		await sync();
		await confirm();
		// A Tailwind upgrade and a project change in the same sync.
		await rewriteAsOlderTailwind({});
		await writeFile(
			cssPath,
			themeCss(["  --color-brand-100: #abcdef;"]).replace(
				"--color-brand-500: #123456",
				"--color-brand-500: #654321",
			),
			"utf8",
		);

		const json = await sync();

		expect(json.status).toBe("updated");
		expect(json.changes).toBe("project");
		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges.tokens).toEqual({
			added: [{ domain: "color", name: "brand-100", value: "#abcdef" }],
			changed: [
				{
					domain: "color",
					name: "brand-500",
					previousValue: "#123456",
					value: "#654321",
				},
			],
			removed: [],
		});
		// The full theme-vs-Tailwind diff is still there for the secondary view.
		expect(json.baselineDiff.removed.length).toBeGreaterThan(200);

		const stored = await getStored();
		expect(stored.reviewRequired).toBe(true);
		expect(stored.reviewChanges.tokens.added).toHaveLength(1);
		expect(stored.reviewChanges.tokens.changed).toHaveLength(1);
	});

	it("a pending review stays pending through a Tailwind-only sync", async () => {
		const { store, sync, confirm } = await setup();
		await sync();
		await confirm();
		await writeFile(cssPath, themeCss(["  --color-brand-100: #abcdef;"]));
		const pending = await sync();
		expect(pending.reviewRequired).toBe(true);

		const snapshotPath = store.resolveTokenSnapshotPath(
			tempProjectRoot,
			"Core",
		);
		const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
		snapshot.metadata.tailwindBaselineVersion = "4.2.4";
		await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges.tokens.added).toEqual([
			{ domain: "color", name: "brand-100", value: "#abcdef" },
		]);
	});

	it("a pending first review stays pending through a Tailwind-only sync", async () => {
		const { store, sync, rewriteAsOlderTailwind } = await setup();
		await sync();
		await rewriteAsOlderTailwind({ reviewRequired: true, asV3: true });

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges).toBeNull();
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.confirmed).toBeNull();
	});

	it("reads an old tokens.json pending review without a confirmed state as a first review", async () => {
		const { sync, getStored, rewriteAsOlderTailwind } = await setup();
		await sync();
		await rewriteAsOlderTailwind({ reviewRequired: true, asV3: true });

		const stored = await getStored();

		expect(stored.reviewRequired).toBe(true);
		expect(stored.reviewChanges).toBeNull();
		expect(stored.domains.color.baselineDiff.removed.length).toBeGreaterThan(
			200,
		);
	});

	it("reverting a project change clears the pending review", async () => {
		const { sync, confirm } = await setup();
		await sync();
		await confirm();
		await writeFile(cssPath, themeCss(["  --color-brand-100: #abcdef;"]));
		expect((await sync()).reviewRequired).toBe(true);

		await writeFile(cssPath, themeCss());
		const json = await sync();

		expect(json.changes).toBe("project");
		expect(json.reviewRequired).toBe(false);
	});
});

describe("tailwind sync compares what the CSS authors", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;
	let cssPath: string;

	const blue500Default = defaultTailwindColorTokens["blue-500"];
	const themeCss = ({
		reset = true,
		utilityColor = "#123456",
		extra = [],
	}: {
		reset?: boolean;
		utilityColor?: string;
		extra?: string[];
	} = {}) =>
		[
			'@import "tailwindcss";',
			"@theme {",
			...(reset ? ["  --color-*: initial;"] : []),
			"  --color-brand-500: #123456;",
			`  --color-blue-500: ${blue500Default};`,
			...extra,
			"}",
			`@utility bg-app { background-color: ${utilityColor}; }`,
			"",
		].join("\n");

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-tailwind-authored-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/core.css" },
			}),
			"utf8",
		);
		cssPath = path.join(tempProjectRoot, "src", "core.css");
		await mkdir(path.dirname(cssPath), { recursive: true });
		await writeFile(cssPath, themeCss(), "utf8");
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
		const snapshotPath = store.resolveTokenSnapshotPath(
			tempProjectRoot,
			"Core",
		);
		const sync = async () => {
			const response = await app.request(
				"/api/trickroom/tailwind/sync-tokens",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ systemName: "Core" }),
				},
			);
			expect(response.status).toBe(200);
			return response.json();
		};
		const confirm = async () => {
			const response = await app.request(
				"/api/trickroom/tailwind/systems/Core/tokens",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ domains: {} }),
				},
			);
			expect(response.status).toBe(200);
			return response.json();
		};
		// biome-ignore lint/suspicious/noExplicitAny: edits the raw snapshot JSON
		const editSnapshot = async (edit: (snapshot: any) => void) => {
			const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
			edit(snapshot);
			await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
		};
		return { store, sync, confirm, editSnapshot };
	};

	it("records the authored theme, its resets and the utility definitions", async () => {
		const { store, sync } = await setup();
		await sync();

		const stored = await store.readDomainTokens(tempProjectRoot, "Core");

		expect(stored?.authored?.domains.color).toEqual({
			tokens: { "blue-500": blue500Default, "brand-500": "#123456" },
			resets: ["--color-*"],
		});
		// Equal to the default: not a resolved override, still authored.
		expect(stored?.domains.color.tokens).toEqual({ "brand-500": "#123456" });
		expect(stored?.customUtilities).toEqual([
			expect.objectContaining({
				root: "bg-app",
				definition: "@utility bg-app { background-color: #123456; }",
			}),
		]);
	});

	it("a utility body change requires review", async () => {
		const { sync, confirm } = await setup();
		await sync();
		await confirm();
		await writeFile(cssPath, themeCss({ utilityColor: "#654321" }), "utf8");

		const json = await sync();

		expect(json.changes).toBe("project");
		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges.customUtilities).toEqual({
			added: [],
			changed: ["bg-app"],
			removed: [],
		});
	});

	it("an older snapshot without utility definitions needs no review, then records them", async () => {
		const { store, sync, confirm, editSnapshot } = await setup();
		await sync();
		await confirm();
		await editSnapshot((snapshot) => {
			delete snapshot.confirmed;
			delete snapshot.authored;
			for (const utility of snapshot.customUtilities) {
				delete utility.definition;
			}
		});

		const first = await sync();
		expect(first.changes).toBe("none");
		expect(first.reviewRequired).toBe(false);
		const stored = await store.readDomainTokens(tempProjectRoot, "Core");
		expect(stored?.confirmed?.authored).toEqual(stored?.authored);
		expect(stored?.confirmed?.customUtilities[0]?.definition).toBe(
			"@utility bg-app { background-color: #123456; }",
		);

		await writeFile(cssPath, themeCss({ utilityColor: "#654321" }), "utf8");
		expect((await sync()).reviewRequired).toBe(true);
	});

	it("an override that a new default caught up with is no review", async () => {
		const { sync, confirm, editSnapshot } = await setup();
		await sync();
		// Confirmed under an older Tailwind where blue-500 had another default:
		// then it resolved to an override, now it equals the default.
		await editSnapshot((snapshot) => {
			snapshot.metadata.tailwindBaselineVersion = "4.2.4";
			snapshot.domains.color.tokens["blue-500"] = blue500Default;
			snapshot.domains.color.baselineDiff.overridden.push({
				name: "blue-500",
				value: blue500Default,
				defaultValue: "oklch(62% 0.2 260)",
				domain: "color",
			});
		});
		await confirm();

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);

		// With another change pending, blue-500 is not listed.
		await writeFile(
			cssPath,
			themeCss({ extra: ["  --color-brand-100: #abcdef;"] }),
			"utf8",
		);
		const pending = await sync();
		expect(pending.reviewRequired).toBe(true);
		expect(pending.reviewChanges.tokens).toEqual({
			added: [{ domain: "color", name: "brand-100", value: "#abcdef" }],
			changed: [],
			removed: [],
		});
	});

	it("defaults added or removed beneath an unchanged reset are no review", async () => {
		const { sync, confirm, editSnapshot } = await setup();
		await sync();
		await confirm();
		await editSnapshot((snapshot) => {
			snapshot.metadata.tailwindBaselineVersion = "4.2.4";
			const removed = snapshot.domains.color.baselineDiff.removed;
			// Two defaults did not exist yet, one that no longer exists did.
			snapshot.domains.color.baselineDiff.removed = [
				...removed.slice(2),
				{ name: "retired-500", defaultValue: "#000", domain: "color" },
			];
			snapshot.confirmed.domains.color.removed = [
				...snapshot.confirmed.domains.color.removed.slice(2),
				"retired-500",
			];
		});

		const json = await sync();

		expect(json.changes).toBe("tailwind");
		expect(json.reviewRequired).toBe(false);
	});

	it("removing a reset is a real change", async () => {
		const { sync, confirm } = await setup();
		await sync();
		await confirm();
		await writeFile(cssPath, themeCss({ reset: false }), "utf8");

		const json = await sync();

		expect(json.changes).toBe("project");
		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges.resets).toEqual({
			added: [],
			removed: [{ domain: "color", pattern: "--color-*" }],
		});
		expect(json.reviewChanges.tokens).toEqual({
			added: [],
			changed: [],
			removed: [],
		});
	});

	it("adding a reset is a real change", async () => {
		await writeFile(cssPath, themeCss({ reset: false }), "utf8");
		const { sync, confirm } = await setup();
		await sync();
		await confirm();
		await writeFile(cssPath, themeCss(), "utf8");

		const json = await sync();

		expect(json.reviewRequired).toBe(true);
		expect(json.reviewChanges.resets).toEqual({
			added: [{ domain: "color", pattern: "--color-*" }],
			removed: [],
		});
	});
});
