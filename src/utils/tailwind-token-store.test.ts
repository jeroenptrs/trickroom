import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import type { TailwindColorTokenBaselineDiff } from "./tailwind-color-tokens";
import {
	areProjectTokenDefinitionsEquivalent,
	areTokenStoragesEquivalent,
	createConfirmedTokenState,
	getProjectTokenDefinition,
	normalizeCssPath,
	normalizeTokenStorageForComparison,
	readDomainTokens,
	resolveTokenSnapshotPath,
	storeDomainTokens,
	systemNameToSafeKey,
	type TailwindTokenStorage,
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
		it("stores and retrieves the current v4 domain-nested model", async () => {
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
				version: 4,
				confirmed: null,
				customProperties: {},
				customUtilities: [],
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

		it("persists and round-trips custom properties and custom utilities", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: {},
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
				customProperties: {
					"--db-interaction-sm": "0.875rem",
					"--db-interaction-lg": "1.25rem",
				},
				customUtilities: [
					{
						root: "text-interaction",
						kind: "functional",
						consumedNamespaces: ["--db-interaction"],
						completionValues: ["lg", "sm"],
						domains: ["typography"],
					},
					{
						root: "core-interaction-primary",
						kind: "static",
						consumedNamespaces: [],
						completionValues: [],
						// Unsorted + duplicate to verify normalization.
						domains: ["typography", "color", "color"],
					},
				],
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read?.version).toBe(4);
			expect(read?.customProperties).toEqual({
				"--db-interaction-lg": "1.25rem",
				"--db-interaction-sm": "0.875rem",
			});
			expect(read?.customUtilities).toEqual([
				{
					root: "core-interaction-primary",
					kind: "static",
					consumedNamespaces: [],
					completionValues: [],
					domains: ["color", "typography"],
				},
				{
					root: "text-interaction",
					kind: "functional",
					consumedNamespaces: ["--db-interaction"],
					completionValues: ["lg", "sm"],
					domains: ["typography"],
				},
			]);
		});

		it("backfills kind=functional when reading a legacy v3 utility without kind", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
			await mkdir(path.dirname(snapshotPath), { recursive: true });
			await writeFile(
				snapshotPath,
				JSON.stringify({
					version: 3,
					metadata: {
						cssPath: "src/theme.css",
						syncedAt: "2026-05-02T12:00:00.000Z",
						tailwindBaselineVersion: "4.2.4",
						reviewRequired: false,
					},
					customProperties: {},
					customUtilities: [
						{
							root: "text-interaction",
							consumedNamespaces: ["--db-interaction"],
							completionValues: ["sm"],
						},
					],
					domains: {
						color: {
							tokens: {},
							overrides: [],
							baselineDiff: { added: [], overridden: [], removed: [] },
						},
					},
				}),
				"utf8",
			);

			const read = await readDomainTokens(testDir, "core");
			expect(read?.customUtilities[0]?.kind).toBe("functional");
			expect(read?.customUtilities[0]?.domains).toEqual([]);
		});

		it("migrates a legacy v2 snapshot to v4 with empty custom sections", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
			await mkdir(path.dirname(snapshotPath), { recursive: true });
			await writeFile(
				snapshotPath,
				JSON.stringify(
					{
						version: 2,
						metadata: {
							cssPath: "src/theme.css",
							syncedAt: "2026-05-02T12:00:00.000Z",
							tailwindBaselineVersion: "4.2.4",
							reviewRequired: false,
						},
						domains: {
							color: {
								tokens: { "brand-500": "#123456" },
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

			// Migrated in-memory to v4...
			expect(read?.version).toBe(4);
			expect(read?.customProperties).toEqual({});
			expect(read?.customUtilities).toEqual([]);
			expect(read?.domains.color.tokens).toEqual({ "brand-500": "#123456" });

			// ...and rewritten to disk as v4 (canonicalization upgrades the file).
			const persisted = JSON.parse(await readFile(snapshotPath, "utf8")) as {
				version: number;
				customProperties: Record<string, string>;
				customUtilities: unknown[];
			};
			expect(persisted.version).toBe(4);
			expect(persisted.customProperties).toEqual({});
			expect(persisted.customUtilities).toEqual([]);
		});

		it("treats custom sections as part of snapshot equivalence", async () => {
			const base = {
				projectRoot: testDir,
				systemName: "core",
				tokens: {},
				tailwindBaselineVersion: "4.2.4",
				cssPath: "src/theme.css",
				baselineDiff: { added: [], overridden: [], removed: [] },
				reviewRequired: false,
				syncedAt: "2026-05-02T12:00:00.000Z",
			} as const;

			await storeDomainTokens({
				...base,
				customProperties: { "--db-interaction-sm": "0.875rem" },
				customUtilities: [],
			});
			const first = await readDomainTokens(testDir, "core");

			await storeDomainTokens({
				...base,
				customProperties: { "--db-interaction-sm": "1rem" },
				customUtilities: [],
			});
			const second = await readDomainTokens(testDir, "core");

			expect(first).not.toBeNull();
			expect(second).not.toBeNull();
			if (first && second) {
				expect(areTokenStoragesEquivalent(first, second, testDir)).toBe(false);
			}
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

	describe("confirmed state and the v3 → v4 migration", () => {
		const writeV3Snapshot = async (reviewRequired: boolean) => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
			await mkdir(path.dirname(snapshotPath), { recursive: true });
			await writeFile(
				snapshotPath,
				JSON.stringify({
					version: 3,
					metadata: {
						cssPath: "src/theme.css",
						syncedAt: "2026-06-02T16:33:49.228Z",
						tailwindBaselineVersion: "4.2.4",
						reviewRequired,
					},
					customProperties: { "--db-interaction-sm": "0.875rem" },
					customUtilities: [
						{
							root: "text-interaction",
							kind: "functional",
							consumedNamespaces: ["--db-interaction"],
							completionValues: ["sm"],
							domains: ["typography"],
						},
					],
					domains: {
						color: {
							tokens: { "brand-500": "#123456" },
							overrides: ["--color-*"],
							baselineDiff: {
								added: [
									{ name: "brand-500", value: "#123456", domain: "color" },
								],
								overridden: [],
								removed: [
									{
										name: "neutral-100",
										defaultValue: "oklch(97% 0 0)",
										domain: "color",
									},
								],
							},
						},
					},
				}),
				"utf8",
			);
			return snapshotPath;
		};

		it("migrates a confirmed v3 snapshot to v4 with its own definition as the confirmed state", async () => {
			const snapshotPath = await writeV3Snapshot(false);

			const read = await readDomainTokens(testDir, "core");

			expect(read?.version).toBe(4);
			expect(read?.confirmed).toEqual({
				confirmedAt: "2026-06-02T16:33:49.228Z",
				tailwindBaselineVersion: "4.2.4",
				domains: {
					color: {
						tokens: { "brand-500": "#123456" },
						removed: ["neutral-100"],
					},
				},
				customProperties: { "--db-interaction-sm": "0.875rem" },
				customUtilities: [
					{
						root: "text-interaction",
						kind: "functional",
						consumedNamespaces: ["--db-interaction"],
						completionValues: ["sm"],
						domains: ["typography"],
					},
				],
			});
			const persisted = JSON.parse(await readFile(snapshotPath, "utf8"));
			expect(persisted.version).toBe(4);
			expect(persisted.confirmed).toEqual(read?.confirmed);
		});

		it("migrates a v3 snapshot pending review to v4 without a confirmed state", async () => {
			await writeV3Snapshot(true);

			const read = await readDomainTokens(testDir, "core");

			expect(read?.version).toBe(4);
			expect(read?.metadata.reviewRequired).toBe(true);
			expect(read?.confirmed).toBeNull();
		});

		it("stores an explicit confirmed state and reads it back normalized", async () => {
			await storeDomainTokens({
				projectRoot: testDir,
				systemName: "core",
				tokens: { "brand-500": "#654321" },
				tailwindBaselineVersion: "4.3.3",
				cssPath: "src/theme.css",
				baselineDiff: {
					added: [{ name: "brand-500", value: "#654321", domain: "color" }],
					overridden: [],
					removed: [],
				},
				reviewRequired: true,
				confirmed: {
					confirmedAt: "2026-06-02T16:33:49.228Z",
					tailwindBaselineVersion: "4.2.4",
					domains: {
						color: { tokens: { "brand-500": "#123456" }, removed: [] },
						spacing: { tokens: {}, removed: [] },
					},
					customProperties: {},
					customUtilities: [],
				},
			});

			const read = await readDomainTokens(testDir, "core");

			expect(read?.confirmed).toEqual({
				confirmedAt: "2026-06-02T16:33:49.228Z",
				tailwindBaselineVersion: "4.2.4",
				domains: {
					color: { tokens: { "brand-500": "#123456" }, removed: [] },
				},
				customProperties: {},
				customUtilities: [],
			});
		});

		it("rejects a v4 snapshot with a malformed confirmed state", async () => {
			const snapshotPath = resolveTokenSnapshotPath(testDir, "core");
			await mkdir(path.dirname(snapshotPath), { recursive: true });
			await writeFile(
				snapshotPath,
				JSON.stringify({
					version: 4,
					metadata: {
						cssPath: "src/theme.css",
						syncedAt: "2026-06-02T16:33:49.228Z",
						tailwindBaselineVersion: "4.3.3",
						reviewRequired: false,
					},
					customProperties: {},
					customUtilities: [],
					domains: {
						color: {
							tokens: {},
							overrides: [],
							baselineDiff: { added: [], overridden: [], removed: [] },
						},
					},
					confirmed: { confirmedAt: "2026-06-02T16:33:49.228Z" },
				}),
				"utf8",
			);

			await expect(readDomainTokens(testDir, "core")).resolves.toBeNull();
		});

		describe("project token definition", () => {
			const createStorage = ({
				tailwindBaselineVersion = "4.2.4",
				neutralDefault = "oklch(97% 0 0)",
				brandValue = "#123456",
				removed = ["neutral-100"],
				customProperties = {},
			}: {
				tailwindBaselineVersion?: string;
				neutralDefault?: string;
				brandValue?: string;
				removed?: string[];
				customProperties?: Record<string, string>;
			} = {}): TailwindTokenStorage =>
				({
					version: 4,
					metadata: {
						cssPath: "src/theme.css",
						syncedAt: "2026-06-02T16:33:49.228Z",
						tailwindBaselineVersion,
						reviewRequired: false,
					},
					domains: {
						color: {
							tokens: { "brand-500": brandValue },
							overrides: [],
							baselineDiff: {
								added: [
									{ name: "brand-500", value: brandValue, domain: "color" },
								],
								overridden: [],
								removed: removed.map((name) => ({
									name,
									defaultValue: neutralDefault,
									domain: "color",
								})),
							},
						},
					},
					customProperties,
					customUtilities: [],
					confirmed: null,
				}) as unknown as TailwindTokenStorage;

			const equivalent = (
				left: TailwindTokenStorage,
				right: TailwindTokenStorage,
			) =>
				areProjectTokenDefinitionsEquivalent(
					getProjectTokenDefinition(left),
					getProjectTokenDefinition(right),
				);

			it("ignores the Tailwind baseline version and default values", () => {
				expect(
					equivalent(
						createStorage(),
						createStorage({
							tailwindBaselineVersion: "4.3.3",
							neutralDefault: "oklch(97% 0 none)",
						}),
					),
				).toBe(true);
			});

			it("ignores whitespace and hex case in values", () => {
				expect(
					equivalent(
						createStorage({ brandValue: "#ABCDEF" }),
						createStorage({ brandValue: " #abcdef " }),
					),
				).toBe(true);
			});

			it("changes with a token value, the removed set or a custom property", () => {
				const base = createStorage();
				expect(equivalent(base, createStorage({ brandValue: "#654321" }))).toBe(
					false,
				);
				expect(
					equivalent(
						base,
						createStorage({ removed: ["neutral-100", "red-500"] }),
					),
				).toBe(false);
				expect(
					equivalent(
						base,
						createStorage({ customProperties: { "--db-x": "1rem" } }),
					),
				).toBe(false);
			});

			it("confirms the definition with the snapshot's baseline version", () => {
				expect(
					createConfirmedTokenState(
						createStorage({ tailwindBaselineVersion: "4.3.3" }),
						"2026-10-13T00:00:00.000Z",
					),
				).toEqual({
					confirmedAt: "2026-10-13T00:00:00.000Z",
					tailwindBaselineVersion: "4.3.3",
					domains: {
						color: {
							tokens: { "brand-500": "#123456" },
							removed: ["neutral-100"],
						},
					},
					customProperties: {},
					customUtilities: [],
				});
			});
		});
	});

	describe("canonical comparison helpers", () => {
		const createStorage = (
			overrides: string[],
			metadata: TailwindTokenStorage["metadata"],
		): TailwindTokenStorage =>
			({
				version: 4,
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
				customProperties: {},
				customUtilities: [],
				confirmed: null,
			}) as TailwindTokenStorage;

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
