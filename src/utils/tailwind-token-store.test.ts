import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import type { TailwindColorTokenBaselineDiff } from "./tailwind-color-tokens";
import {
	areTokenStoragesEquivalent,
	normalizeCssPath,
	normalizeTokenStorageForComparison,
	readDomainTokens,
	resolveTokenSnapshotPath,
	storeDomainTokens,
	systemNameToSafeKey,
	type TailwindTokenStorageV2,
} from "./tailwind-token-store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, ".test-tailwind-token-store");

const baselineDiff: TailwindColorTokenBaselineDiff = {
	added: [
		{ name: "brand-500", value: "#123456", domain: "color" },
		{ name: "brand-100", value: "#abcdef", domain: "color" },
	],
	overridden: [
		{
			name: "blue-500",
			value: "#0011ff",
			defaultValue: "#0000ff",
			domain: "color",
		},
	],
	unchanged: [
		{
			name: "red-500",
			value: "#ff0000",
			defaultValue: "#ff0000",
			domain: "color",
		},
	],
	removed: [{ name: "slate-500", defaultValue: "#64748b", domain: "color" }],
	missingDefaultTokenNames: ["slate-500"],
};

describe("tailwind-token-store", () => {
	beforeEach(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("systemNameToSafeKey", () => {
		it("lowercases and replaces spaces with dashes", () => {
			expect(systemNameToSafeKey("My System")).toBe("my-system");
		});

		it("removes invalid characters", () => {
			expect(systemNameToSafeKey("my@system#name")).toBe("mysystemname");
		});

		it("allows dashes, underscores, and dots", () => {
			expect(systemNameToSafeKey("my-system_v1.0")).toBe("my-system_v1.0");
		});

		it("strips leading and trailing dashes", () => {
			expect(systemNameToSafeKey("-my-system-")).toBe("my-system");
		});
	});

	describe("resolveTokenSnapshotPath", () => {
		it("stores snapshots under the safe system directory", () => {
			const snapshotPath = resolveTokenSnapshotPath("/project", "My System");

			expect(snapshotPath).toBe(
				path.join(
					"/project",
					".trickroom",
					"systems",
					"my-system",
					"tokens.json",
				),
			);
		});
	});

	describe("normalizeCssPath", () => {
		it("makes absolute paths relative to project root", () => {
			const cssPath = path.join(testDir, "src", "theme.css");

			expect(normalizeCssPath(cssPath, testDir)).toBe("src/theme.css");
		});

		it("treats dot-relative and relative paths equivalently", () => {
			expect(normalizeCssPath("./src/core.css", testDir)).toBe("src/core.css");
			expect(normalizeCssPath("src/core.css", testDir)).toBe("src/core.css");
		});
	});

	describe("storeDomainTokens and readDomainTokens", () => {
		it("stores and retrieves the current v2 domain-nested model", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: {
					"brand-500": "#123456",
					"brand-100": "#abcdef",
				},
				overrides: ["--color-brand-500"],
				tailwindBaselineVersion: "4.2.4",
				cssPath: "./src/theme.css",
				baselineDiff,
				reviewRequired: true,
				syncedAt: "2026-05-02T12:00:00.000Z",
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read).toMatchObject({
				version: 2,
				metadata: {
					cssPath: "src/theme.css",
					syncedAt: "2026-05-02T12:00:00.000Z",
					tailwindBaselineVersion: "4.2.4",
					reviewRequired: true,
				},
				domains: {
					color: {
						tokens: {
							"brand-100": "#abcdef",
							"brand-500": "#123456",
						},
						overrides: ["--color-brand-500"],
						baselineDiff: {
							added: [
								{ name: "brand-100", value: "#abcdef", domain: "color" },
								{ name: "brand-500", value: "#123456", domain: "color" },
							],
							overridden: [
								{
									name: "blue-500",
									value: "#0011ff",
									defaultValue: "#0000ff",
									domain: "color",
								},
							],
							removed: [
								{
									name: "slate-500",
									defaultValue: "#64748b",
									domain: "color",
								},
							],
						},
					},
				},
			});
			expect(read?.domains.spacing).toEqual({
				tokens: {},
				overrides: [],
				baselineDiff: { added: [], overridden: [], removed: [] },
			});
		});

		it("normalizes cssPath before persistence", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#123456" },
				overrides: [],
				tailwindBaselineVersion: "4.2.4",
				cssPath: "./src/../src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read).not.toBeNull();
			expect(read?.metadata.cssPath).toBe("src/theme.css");
		});

		it("does not persist unchanged or missing default token diff data", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#123456" },
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff,
				reviewRequired: false,
			});

			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
			const contents = await readFile(snapshotPath, "utf8");
			const data = JSON.parse(contents) as Record<string, unknown>;
			const color = (data.domains as Record<string, unknown>).color as Record<
				string,
				unknown
			>;

			expect(color.baselineDiff).not.toHaveProperty("unchanged");
			expect(color.baselineDiff).not.toHaveProperty("missingDefaultTokenNames");
		});

		it("does not persist unchanged default color tokens", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: {
					"brand-500": "#123456",
					"blue-500": defaultTailwindColorTokens["blue-500"],
					"red-500": "#ff0000",
				},
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: {
					added: [{ name: "brand-500", value: "#123456", domain: "color" }],
					overridden: [
						{
							name: "red-500",
							value: "#ff0000",
							defaultValue: defaultTailwindColorTokens["red-500"],
							domain: "color",
						},
					],
					removed: [],
				},
				reviewRequired: false,
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read?.domains.color.tokens).toEqual({
				"brand-500": "#123456",
				"red-500": "#ff0000",
			});
		});

		it("canonicalizes stale snapshots that contain unchanged default color tokens", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
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

			const read = await readDomainTokens(testDir, "core");
			const persisted = JSON.parse(await readFile(snapshotPath, "utf8")) as {
				domains: { color: { tokens: Record<string, string> } };
			};

			expect(read?.domains.color.tokens).toEqual({ "brand-500": "#123456" });
			expect(persisted.domains.color.tokens).toEqual({
				"brand-500": "#123456",
			});
		});

		it("normalizes token and override order", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: {
					"z-token": "#aaa",
					"a-token": "#bbb",
					"m-token": "#ccc",
				},
				overrides: ["--color-z", "--color-a"],
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
			});

			const read = await readDomainTokens(testDir, "core");

			expect(Object.keys(read?.domains.color.tokens ?? {})).toEqual([
				"a-token",
				"m-token",
				"z-token",
			]);
			expect(read?.domains.color.overrides).toEqual(["--color-a", "--color-z"]);
		});

		it("persists granular overrides through round-trip and normalizes their sort order", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#123456" },
				overrides: ["--color-red-50", "--color-*", "--color-red-*"],
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: {
					added: [{ name: "brand-500", value: "#123456", domain: "color" }],
					overridden: [],
					removed: [],
				},
				reviewRequired: false,
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read?.domains.color.overrides).toEqual([
				"--color-*",
				"--color-red-*",
				"--color-red-50",
			]);
		});

		it("returns null for missing storage", async () => {
			await expect(
				readDomainTokens(testDir, "nonexistent"),
			).resolves.toBeNull();
		});

		it("rejects legacy v2 storage without required metadata", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
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
							tailwindVersion: "4.2.4",
						},
						domains: {
							color: {
								tokens: { "brand-500": "#123456" },
								overrides: [],
							},
						},
					},
					null,
					"\t",
				),
				"utf8",
			);

			await expect(readDomainTokens(testDir, "core")).resolves.toBeNull();
		});

		it("does not leave temp files after a successful atomic write", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#123456" },
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
			});

			const files = await readdir(
				path.dirname(resolveTokenSnapshotPath(testDir, "core")),
			);

			expect(files.filter((file) => file.endsWith(".tmp"))).toHaveLength(0);
		});

		it("creates a system manifest next to stored tokens", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#123456" },
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
			});

			const manifestPath = path.join(
				path.dirname(resolveTokenSnapshotPath(testDir, "core")),
				"system.json",
			);

			await expect(
				readFile(manifestPath, "utf8").then(JSON.parse),
			).resolves.toMatchObject({
				version: 1,
				systemId: expect.stringMatching(/^sys_/),
				systemName: "core",
			});
		});

		it("returns null when required reviewRequired metadata is missing", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
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
							// Intentionally omitted reviewRequired to verify strict schema acceptance.
						},
						domains: {
							color: {
								tokens: { "brand-500": "#123456" },
								overrides: [],
								baselineDiff: { added: [], overridden: [], removed: [] },
							},
						},
					},
					null,
					"\t",
				),
				"utf8",
			);

			await expect(readDomainTokens(testDir, "core")).resolves.toBeNull();
		});
	});

	describe("canonical comparison helpers", () => {
		const createStorage = (
			overrides: string[],
			metadata: TailwindTokenStorageV2["metadata"],
		): TailwindTokenStorageV2 => ({
			version: 2,
			metadata,
			domains: {
				color: {
					tokens: { "brand-500": "#123456" },
					overrides,
					baselineDiff: {
						added: [{ name: "brand-500", value: "#123456", domain: "color" }],
						overridden: [],
						removed: [],
					},
				},
			},
		});

		it("ignores overrides, syncedAt, and reviewRequired", () => {
			const left = createStorage(["--color-brand-500"], {
				cssPath: "./src/theme.css",
				syncedAt: "2026-05-02T12:00:00.000Z",
				tailwindBaselineVersion: "4.2.4",
				reviewRequired: true,
			});
			const right = createStorage([], {
				cssPath: "src/theme.css",
				syncedAt: "2026-05-03T12:00:00.000Z",
				tailwindBaselineVersion: "4.2.4",
				reviewRequired: false,
			});

			expect(areTokenStoragesEquivalent(left, right)).toBe(true);
			expect(normalizeTokenStorageForComparison(left)).toEqual(
				normalizeTokenStorageForComparison(right),
			);
		});

		it("includes normalized css path, baseline version, tokens, and diff data", () => {
			const left = createStorage([], {
				cssPath: "src/theme.css",
				syncedAt: "2026-05-02T12:00:00.000Z",
				tailwindBaselineVersion: "4.2.4",
				reviewRequired: false,
			});
			const right = createStorage([], {
				cssPath: "src/other.css",
				syncedAt: "2026-05-02T12:00:00.000Z",
				tailwindBaselineVersion: "4.2.5",
				reviewRequired: false,
			});

			expect(areTokenStoragesEquivalent(left, right)).toBe(false);
		});
	});

	it("does not export legacy v1 snapshot APIs", async () => {
		const tokenStore = await import("./tailwind-token-store");

		expect("storeTokenSnapshot" in tokenStore).toBe(false);
		expect("readTokenSnapshot" in tokenStore).toBe(false);
	});
});
