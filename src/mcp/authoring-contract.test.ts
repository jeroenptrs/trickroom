import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAsset } from "../utils/asset-manifest-service";
import { writeDesignSystemManifest } from "../utils/design-system-store";
import { syncIconManifest } from "../utils/icon-manifest-service";
import { storeDomainTokens } from "../utils/tailwind-token-store";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesign,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

describe("getDesignAuthoringContract planning payload", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
	});

	const createSession = async (
		options: Parameters<typeof createTrickroomMcpProjectFixture>[0] = {},
	) => {
		const fixture = await createTrickroomMcpProjectFixture(options);
		fixtures.push(fixture);
		const session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
		sessions.push(session);
		return { fixture, session };
	};

	it("includes compact recipe summaries and stable catalog hashes", async () => {
		const { session } = await createSession();

		const first = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const second = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});

		const contract = first.structuredContent as {
			catalogHash: string;
			registryHash: string;
			recipeCatalogHash: string;
			registries: Array<{
				library: string;
				recipes: Array<{
					recipe: string;
					aliases: string[];
					slots: string[];
					controls: Array<{ name: string; valueType: string }>;
					markerGuidance: { inspectTool: string };
				}>;
			}>;
			authoringGuidance: { mutationStrategy: unknown[] };
			examples: unknown[];
		};

		expect(contract.registryHash).toBe(contract.catalogHash);
		expect(contract.recipeCatalogHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(second.structuredContent).toMatchObject({
			catalogHash: contract.catalogHash,
			registryHash: contract.registryHash,
			recipeCatalogHash: contract.recipeCatalogHash,
		});

		const baseUi = contract.registries.find(
			(registry) => registry.library === "base-ui",
		);
		expect(baseUi?.recipes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					recipe: "base-ui/avatar.default",
					aliases: expect.arrayContaining([
						"base-ui/avatar.default",
						"avatar.default",
					]),
					slots: expect.arrayContaining(["fallback"]),
					markerGuidance: expect.objectContaining({
						inspectTool: "describeRegistryRecipe",
					}),
				}),
			]),
		);
		expect(contract.authoringGuidance.mutationStrategy.length).toBeGreaterThan(
			0,
		);
		expect(contract.examples.length).toBeGreaterThan(0);
	});

	it("filters recipes when component policy blocks recipe templates", async () => {
		const { session } = await createSession({
			config: {
				mcp: {
					enabled: true,
					allowedComponents: ["trickroom/text"],
				},
			},
		});

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: {},
		});
		const contract = result.structuredContent as {
			registries: Array<{
				library: string;
				components: Array<{ component: string }>;
				recipes?: Array<{ recipe: string }>;
			}>;
		};

		const trickroom = contract.registries.find(
			(registry) => registry.library === "trickroom",
		);
		expect(trickroom?.components.map((component) => component.component)).toEqual(
			["text"],
		);
		expect(
			contract.registries.every(
				(registry) => (registry.recipes ?? []).length === 0,
			),
		).toBe(true);
	});

	it("summarizes linked-system resources and token domains", async () => {
		const { fixture, session } = await createSession({
			designs: {
				[trickroomMcpTestDesignUuid]: trickroomMcpTestDesign,
			},
		});

		const imagePath = path.join(fixture.projectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(
			imagePath,
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
				"base64",
			),
		);
		await registerAsset(fixture.projectRoot, "Core", {
			name: "Hero Shot",
			sourcePath: "src/assets/hero.png",
		});
		await mkdir(path.join(fixture.projectRoot, "src", "icons"), {
			recursive: true,
		});
		await writeFile(
			path.join(fixture.projectRoot, "src", "icons", "search.svg"),
			safeSvg,
		);
		await writeDesignSystemManifest(fixture.projectRoot, "Core", {
			iconFolderPaths: ["src/icons"],
		});
		await syncIconManifest(fixture.projectRoot, "Core");

		await storeDomainTokens({
			projectRoot: fixture.projectRoot,
			systemName: "Core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "test-baseline",
			tokens: { "brand-500": "#2563eb" },
			overrides: ["brand-500"],
			baselineDiff: {
				added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
				overridden: [],
				removed: [],
			},
			domains: {
				spacing: { "panel-gap": "1.5rem" },
			},
			domainOverrides: {
				spacing: ["panel-gap"],
			},
			domainBaselineDiffs: {
				spacing: {
					added: [{ name: "panel-gap", value: "1.5rem", domain: "spacing" }],
					overridden: [],
					removed: [],
				},
			},
			reviewRequired: true,
			syncedAt: "2026-05-15T00:00:00.000Z",
		});

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});

		expect(result.structuredContent).toMatchObject({
			resources: {
				assets: expect.objectContaining({
					available: true,
					count: 1,
					usageTool: "findAssetUsage",
				}),
				icons: expect.objectContaining({
					available: true,
					count: 1,
					usageTool: "findIconUsage",
				}),
				fonts: expect.objectContaining({
					available: false,
				}),
			},
			tokens: expect.objectContaining({
				storageStatus: "stored",
				reviewRequired: true,
				tokenSnapshotSyncedAt: "2026-05-15T00:00:00.000Z",
				changedDomains: expect.arrayContaining(["color", "spacing"]),
			}),
			resourceManifestUpdatedAt: expect.any(String),
		});
	});

	it("includes mutation examples with write-tool required fields", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});

		const examples = (
			result.structuredContent as {
				examples: Array<{
					tool: string;
					arguments: Record<string, unknown>;
				}>;
			}
		).examples;
		const writeToolsRequiringRevision = new Set([
			"addElement",
			"addRecipe",
			"addSubtree",
			"updateElementProps",
			"updateRecipeControl",
		]);

		for (const example of examples) {
			if (!writeToolsRequiringRevision.has(example.tool)) {
				continue;
			}

			expect(example.arguments).toMatchObject({
				designFileId: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
				),
				expectedRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
			});
		}
	});

	it("works without designFileId and omits design-specific context", async () => {
		const { session } = await createSession();

		const result = await session.client.callTool({
			name: "getDesignAuthoringContract",
			arguments: { includeRecipes: "none", includeExamples: false },
		});

		const contract = result.structuredContent as {
			designSystem: unknown;
			tokens?: unknown;
			resources?: unknown;
			examples?: unknown;
			recipeCatalogHash: string | null;
			registries: Array<{ recipes?: unknown; library: string }>;
		};
		expect(contract.designSystem).toBeNull();
		expect(contract.tokens).toBeUndefined();
		expect(contract.resources).toBeUndefined();
		expect(contract.examples).toBeUndefined();
		expect(contract.recipeCatalogHash).toBeNull();
		expect(contract.registries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					library: "trickroom",
					components: expect.any(Array),
				}),
			]),
		);
		expect(
			contract.registries.every((registry) => registry.recipes === undefined),
		).toBe(true);
	});
});
