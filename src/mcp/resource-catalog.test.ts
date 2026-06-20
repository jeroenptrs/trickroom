import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertProjectLocation } from "../app-state/project-registry";
import { writeAssetManifest } from "../utils/asset-manifest-service";
import { assetIdProp, iconIdProp } from "../utils/design-resource-references";
import { writeDesignSystemManifest } from "../utils/design-system-store";
import { syncIconManifest } from "../utils/icon-manifest-service";
import { createTrickroomMcpServer } from "./server";
import {
	createTrickroomMcpProjectFixture,
	createTrickroomMcpTestClient,
	type TrickroomMcpClientSession,
	type TrickroomMcpProjectFixture,
	trickroomMcpTestDesignUuid,
} from "./test-support";

const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

describe("trickroom MCP asset and icon catalogs", () => {
	let fixture: TrickroomMcpProjectFixture;
	let session: TrickroomMcpClientSession;

	beforeEach(async () => {
		fixture = await createTrickroomMcpProjectFixture();
		await writeAssetManifest(fixture.projectRoot, "Core", {
			version: 1,
			metadata: {
				systemName: "Core",
				updatedAt: "2026-05-15T00:00:00.000Z",
			},
			assets: {
				ast_hero: {
					name: "Hero",
					kind: "image",
					sourcePath: "src/assets/hero.png",
					mimeType: "image/png",
					createdAt: "2026-05-15T00:00:00.000Z",
					updatedAt: "2026-05-15T00:00:00.000Z",
				},
			},
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
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);
	});

	afterEach(async () => {
		await session.close();
		await fixture.cleanup();
	});

	it("exposes asset and icon metadata without raw content", async () => {
		const assets = await session.client.callTool({
			name: "listSystemAssets",
			arguments: { systemName: "Core" },
		});
		expect(assets.structuredContent).toMatchObject({
			systemName: "Core",
			assets: [{ id: "ast_hero", sourcePath: "src/assets/hero.png" }],
		});

		const asset = await session.client.callTool({
			name: "describeAsset",
			arguments: { systemName: "Core", assetId: "ast_hero" },
		});
		expect(asset.structuredContent).toMatchObject({
			asset: { id: "ast_hero", mimeType: "image/png" },
		});

		const icons = await session.client.callTool({
			name: "listSystemIcons",
			arguments: { systemName: "Core" },
		});
		expect(icons.structuredContent).toMatchObject({
			systemName: "Core",
			icons: [{ id: "src/search", sourcePath: "src/icons/search.svg" }],
		});
		expect(JSON.stringify(icons.structuredContent)).not.toContain("<svg");

		const icon = await session.client.callTool({
			name: "describeIcon",
			arguments: { systemName: "Core", iconId: "src/search" },
		});
		expect(icon.structuredContent).toMatchObject({
			icon: { id: "src/search", paint: "stroke" },
		});
	});

	it("finds asset and icon usage in linked designs", async () => {
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Resource Design",
			systemName: "Core",
			boards: [
				{
					id: "asset",
					props: {
						"data-trickroom-name": "Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
					},
					children: [],
				},
				{
					id: "icon",
					props: {
						"data-trickroom-name": "Search",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "icon",
						"data-trickroom-role": "leaf",
						[iconIdProp]: "src/search",
					},
					children: [],
				},
				{
					id: "avatar-image",
					props: {
						"data-trickroom-name": "Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
						alt: "Hero avatar",
					},
					children: [],
				},
				{
					id: "blank-avatar-image",
					props: {
						"data-trickroom-name": "Blank Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "  ",
						alt: "",
					},
					children: [],
				},
			],
		});

		const assetUsage = await session.client.callTool({
			name: "findAssetUsage",
			arguments: { systemName: "Core", assetId: "ast_hero" },
		});
		expect(assetUsage.structuredContent).toMatchObject({
			usages: expect.arrayContaining([
				expect.objectContaining({
					elementId: "asset",
					resourceId: "ast_hero",
				}),
				expect.objectContaining({
					elementId: "avatar-image",
					resourceId: "ast_hero",
				}),
			]),
		});

		const iconUsage = await session.client.callTool({
			name: "findIconUsage",
			arguments: { systemName: "Core", iconId: "src/search" },
		});
		expect(iconUsage.structuredContent).toMatchObject({
			usages: [{ elementId: "icon", resourceId: "src/search" }],
		});

		const allAssetUsage = await session.client.callTool({
			name: "findAssetUsage",
			arguments: { systemName: "Core" },
		});
		expect(allAssetUsage.structuredContent).toMatchObject({
			usages: expect.arrayContaining([
				expect.objectContaining({
					elementId: "blank-avatar-image",
					resourceId: null,
				}),
			]),
		});
	});

	it("scopes resource usage discovery to policy-allowed design files", async () => {
		const hiddenDesignUuid = "00000000-0000-4000-8000-000000000002";
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Allowed Resource Design",
			systemName: "Core",
			boards: [
				{
					id: "allowed-asset",
					props: {
						"data-trickroom-name": "Allowed Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
					},
					children: [],
				},
			],
		});
		await fixture.writeDesign(hiddenDesignUuid, {
			name: "Hidden Resource Design",
			systemName: "Core",
			boards: [
				{
					id: "hidden-asset",
					props: {
						"data-trickroom-name": "Hidden Hero",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "asset",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_hero",
					},
					children: [],
				},
			],
		});
		await fixture.writeConfig({
			...fixture.config,
			mcp: {
				...fixture.config.mcp,
				enabled: true,
				allowedDesignFileIds: [trickroomMcpTestDesignUuid],
			},
		});
		await session.close();
		session = await createTrickroomMcpTestClient(
			await fixture.readMcpContext(),
		);

		const assetUsage = await session.client.callTool({
			name: "findAssetUsage",
			arguments: { systemName: "Core", assetId: "ast_hero" },
		});

		expect(assetUsage.structuredContent).toMatchObject({
			usages: [{ elementId: "allowed-asset" }],
		});
		expect(JSON.stringify(assetUsage.structuredContent)).not.toContain(
			"hidden-asset",
		);
	});

	it("allows blank Avatar Image asset ids in diagnostics while validating non-empty ids", async () => {
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Avatar Resource Diagnostics",
			systemName: "Core",
			boards: [
				{
					id: "blank-avatar-image",
					props: {
						"data-trickroom-name": "Blank Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "",
						alt: "",
					},
					children: [],
				},
				{
					id: "missing-avatar-image",
					props: {
						"data-trickroom-name": "Missing Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "ast_missing",
						alt: "",
					},
					children: [],
				},
			],
		});

		const validateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const issues = (
			validateResult.structuredContent as {
				issues: Array<{ code: string; elementId?: string }>;
			}
		).issues;

		expect(issues).not.toContainEqual(
			expect.objectContaining({ elementId: "blank-avatar-image" }),
		);
		expect(issues).toContainEqual(
			expect.objectContaining({
				code: "UNKNOWN_ASSET_ID",
				elementId: "missing-avatar-image",
			}),
		);

		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Unlinked Blank Avatar",
			systemName: null,
			boards: [
				{
					id: "blank-avatar-image",
					props: {
						"data-trickroom-name": "Blank Avatar Image",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "avatar.image",
						"data-trickroom-role": "leaf",
						[assetIdProp]: "",
						alt: "",
					},
					children: [],
				},
			],
		});
		const unlinkedValidateResult = await session.client.callTool({
			name: "validateDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		expect(unlinkedValidateResult.structuredContent).toMatchObject({
			valid: true,
			issues: [],
		});
	});

	it("allows MCP to add resources with existing ids and blank Avatar Image ids", async () => {
		const read = await session.client.callTool({
			name: "readDesignFile",
			arguments: { designFileId: trickroomMcpTestDesignUuid },
		});
		const revision = (
			read.structuredContent as { designFile: { revision: string } }
		).designFile.revision;

		const assetAdd = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: revision,
				parentId: null,
				index: 1,
				library: "trickroom",
				component: "asset",
				props: {
					[assetIdProp]: "ast_hero",
					alt: "Hero",
				},
			},
		});
		expect(assetAdd.structuredContent).toMatchObject({
			status: "success",
			changedElement: {
				component: "asset",
			},
		});

		const nextRevision = (assetAdd.structuredContent as { newRevision: string })
			.newRevision;
		const avatarImageAdd = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: nextRevision,
				parentId: null,
				index: 2,
				library: "base-ui",
				component: "avatar.image",
				props: {
					[assetIdProp]: "ast_hero",
					alt: "Hero avatar",
				},
			},
		});
		expect(avatarImageAdd.structuredContent).toMatchObject({
			status: "success",
			changedElement: {
				library: "base-ui",
				component: "avatar.image",
			},
		});

		const afterAvatarRevision = (
			avatarImageAdd.structuredContent as { newRevision: string }
		).newRevision;
		const blankAvatarImageAdd = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterAvatarRevision,
				parentId: null,
				index: 3,
				library: "base-ui",
				component: "avatar.image",
				props: {
					[assetIdProp]: "",
					alt: "",
				},
			},
		});
		expect(blankAvatarImageAdd.structuredContent).toMatchObject({
			status: "success",
			changedElement: {
				library: "base-ui",
				component: "avatar.image",
			},
		});

		const afterBlankAvatarRevision = (
			blankAvatarImageAdd.structuredContent as { newRevision: string }
		).newRevision;
		const iconAdd = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: afterBlankAvatarRevision,
				parentId: null,
				index: 4,
				library: "trickroom",
				component: "icon",
				props: {
					[iconIdProp]: "src/search",
				},
			},
		});
		expect(iconAdd.structuredContent).toMatchObject({
			status: "success",
			changedElement: {
				component: "icon",
			},
		});

		const nonCanonical = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: (iconAdd.structuredContent as { newRevision: string })
					.newRevision,
				parentId: null,
				index: 5,
				library: "trickroom",
				component: "asset",
				props: {
					[assetIdProp]: "AST_HERO",
				},
			},
		});
		expect(nonCanonical.isError).toBe(true);
		expect(nonCanonical.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_ASSET_ID",
		});

		const malformed = await session.client.callTool({
			name: "describeAsset",
			arguments: { systemName: "Core", assetId: "../secret" },
		});
		expect(malformed.isError).toBe(true);
		expect(malformed.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "INVALID_ASSET_ID",
		});

		const invalid = await session.client.callTool({
			name: "addElement",
			arguments: {
				designFileId: trickroomMcpTestDesignUuid,
				expectedRevision: (iconAdd.structuredContent as { newRevision: string })
					.newRevision,
				parentId: null,
				index: 5,
				library: "base-ui",
				component: "avatar.image",
				props: {
					[assetIdProp]: "ast_missing",
				},
			},
		});
		expect(invalid.isError).toBe(true);
		expect(invalid.structuredContent).toMatchObject({
			status: "INVALID_OPERATION",
			code: "UNKNOWN_ASSET_ID",
		});
	});
});

describe("trickroom MCP design resource catalog", () => {
	const fixtures: TrickroomMcpProjectFixture[] = [];
	const sessions: TrickroomMcpClientSession[] = [];
	const tempRoots: string[] = [];

	const createFixture = async (
		options?: Parameters<typeof createTrickroomMcpProjectFixture>[0],
	) => {
		const fixture = await createTrickroomMcpProjectFixture(options);
		fixtures.push(fixture);
		return fixture;
	};

	const createSession = async (
		context: Parameters<typeof createTrickroomMcpTestClient>[0],
	) => {
		let isolatedContext = context;
		if (context && !context.trickroomHome) {
			const trickroomHome = await mkdtemp(
				path.join(process.cwd(), ".tmp-trickroom-mcp-catalog-home-"),
			);
			tempRoots.push(trickroomHome);
			isolatedContext = { ...context, trickroomHome };
		}
		const session = await createTrickroomMcpTestClient(isolatedContext);
		sessions.push(session);
		return session;
	};

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.close()));
		await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
		await Promise.all(
			tempRoots
				.splice(0)
				.map((root) => rm(root, { force: true, recursive: true })),
		);
	});

	it("returns design resources for the active project", async () => {
		const fixture = await createFixture({
			name: "Catalog Project",
			config: { projectId: "proj_catalog_active" },
		});
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Marketing Landing",
			systemName: "Core",
			boards: [],
		});
		const { client } = await createSession(await fixture.readMcpContext());

		const resources = await client.listResources();

		expect(resources.resources).toMatchObject([
			{
				uri: "trickroom://proj/proj_catalog_active/design/marketing-landing--00000000-0000-4000-8000-000000000001",
				name: "design:proj_catalog_active:marketing-landing--00000000-0000-4000-8000-000000000001",
				title: "Marketing Landing - Catalog Project (proj_catalog_active)",
				description: "Design file in Catalog Project (proj_catalog_active)",
				mimeType: "application/json",
			},
		]);
	});

	it("returns an empty resource list when no project is active", async () => {
		const client = new Client({ name: "trickroom-mcp-test", version: "0.1.0" });
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-catalog-home-"),
		);
		tempRoots.push(trickroomHome);
		const server = createTrickroomMcpServer(null, { trickroomHome });
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		try {
			await expect(client.listResources()).resolves.toEqual({ resources: [] });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("lists design resources from all registered MCP-enabled projects", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-catalog-home-"),
		);
		tempRoots.push(trickroomHome);
		const firstFixture = await createFixture({
			name: "First Catalog Project",
			config: { projectId: "proj_catalog_first" },
		});
		const secondFixture = await createFixture({
			name: "Second Catalog Project",
			config: { projectId: "proj_catalog_second" },
			designs: {
				"22222222-2222-4222-8222-222222222222": {
					name: "Second Workspace",
					systemName: "Core",
					boards: [],
				},
			},
		});
		await firstFixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "First Workspace",
			systemName: "Core",
			boards: [],
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: firstFixture.config.projectId,
			root: firstFixture.projectRoot,
			name: firstFixture.config.name,
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: secondFixture.config.projectId,
			root: secondFixture.projectRoot,
			name: secondFixture.config.name,
		});
		const { client } = await createSession({
			...(await firstFixture.readMcpContext()),
			trickroomHome,
		});

		const listed = await client.listResources();

		expect(listed.resources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					uri: expect.stringContaining(
						"trickroom://proj/proj_catalog_first/design/first-workspace--",
					),
					title: "First Workspace - First Catalog Project (proj_catalog_first)",
				}),
				expect.objectContaining({
					uri: expect.stringMatching(
						/^trickroom:\/\/proj\/loc_[^/]+\/design\/second-workspace--22222222-2222-4222-8222-222222222222$/,
					),
					title: expect.stringMatching(
						/^Second Workspace - Second Catalog Project \(loc_[^)]+\)$/,
					),
				}),
			]),
		);
	});

	it("reads slug-bearing and bare-id design resource URIs", async () => {
		const fixture = await createFixture({
			config: { projectId: "proj_catalog_read" },
		});
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Readable Design",
			systemName: "Core",
			boards: [
				{
					id: "pricing-board",
					props: {
						"data-trickroom-name": "Pricing",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [],
				},
			],
		});
		const { client } = await createSession(await fixture.readMcpContext());

		const resources = await client.listResources();
		const slugRead = await client.readResource({
			uri: resources.resources[0].uri,
		});
		const bareRead = await client.readResource({
			uri: `trickroom://proj/proj_catalog_read/design/${trickroomMcpTestDesignUuid}`,
		});

		expect(JSON.parse(slugRead.contents[0].text as string)).toMatchObject({
			payloadKind: "design-summary",
			designFile: {
				name: "Readable Design",
			},
			boards: [
				{
					id: "pricing-board",
					name: "Pricing",
					childCount: 0,
					descendantCount: 0,
				},
			],
		});
		expect(JSON.parse(bareRead.contents[0].text as string)).toMatchObject({
			payloadKind: "design-summary",
			designFile: {
				name: "Readable Design",
			},
			boards: [
				{
					id: "pricing-board",
					name: "Pricing",
				},
			],
		});
	});

	it("reads a listed resource from another registered project", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-catalog-read-home-"),
		);
		tempRoots.push(trickroomHome);
		const firstFixture = await createFixture({
			config: { projectId: "proj_catalog_selected" },
		});
		const secondFixture = await createFixture({
			config: { projectId: "proj_catalog_read_other" },
			designs: {
				"22222222-2222-4222-8222-222222222222": {
					name: "Readable Other Project Design",
					systemName: "Core",
					boards: [],
				},
			},
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: firstFixture.config.projectId,
			root: firstFixture.projectRoot,
			name: firstFixture.config.name,
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: secondFixture.config.projectId,
			root: secondFixture.projectRoot,
			name: secondFixture.config.name,
		});
		const { client } = await createSession({
			...(await firstFixture.readMcpContext()),
			trickroomHome,
		});

		const listed = await client.listResources();
		const otherResource = listed.resources.find((resource) =>
			resource.title?.startsWith(
				"Readable Other Project Design - Harness Project (loc_",
			),
		);

		expect(otherResource).toBeDefined();
		if (!otherResource) {
			throw new Error("Expected other project design resource to be listed.");
		}
		const read = await client.readResource({ uri: otherResource.uri });
		expect(JSON.parse(read.contents[0].text as string)).toMatchObject({
			payloadKind: "design-summary",
			designFile: {
				name: "Readable Other Project Design",
			},
		});
	});

	it("skips disabled registered projects when listing resources", async () => {
		const trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-catalog-disabled-home-"),
		);
		tempRoots.push(trickroomHome);
		const enabledFixture = await createFixture({
			config: { projectId: "proj_catalog_enabled" },
		});
		const disabledFixture = await createFixture({
			config: { projectId: "proj_catalog_disabled" },
			mcpEnabled: false,
			designs: {
				"22222222-2222-4222-8222-222222222222": {
					name: "Disabled Workspace",
					systemName: "Core",
					boards: [],
				},
			},
		});
		await enabledFixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Enabled Workspace",
			systemName: "Core",
			boards: [],
		});
		for (const fixture of [enabledFixture, disabledFixture]) {
			await upsertProjectLocation({
				trickroomHome,
				projectId: fixture.config.projectId,
				root: fixture.projectRoot,
				name: fixture.config.name,
			});
		}
		const { client } = await createSession({
			...(await enabledFixture.readMcpContext()),
			trickroomHome,
		});

		const listed = await client.listResources();

		expect(listed.resources).toHaveLength(1);
		expect(listed.resources[0]?.uri).toContain("proj_catalog_enabled");
		expect(JSON.stringify(listed.resources)).not.toContain(
			"proj_catalog_disabled",
		);
	});

	it("continues to read by id after the design slug changes", async () => {
		const fixture = await createFixture({
			config: { projectId: "proj_catalog_rename" },
		});
		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Original Title",
			systemName: "Core",
			boards: [],
		});
		const { client } = await createSession(await fixture.readMcpContext());
		const initialResources = await client.listResources();
		const originalUri = initialResources.resources[0].uri;

		await fixture.writeDesign(trickroomMcpTestDesignUuid, {
			name: "Renamed Title",
			systemName: "Core",
			boards: [],
		});

		const renamedResources = await client.listResources();
		expect(renamedResources.resources[0]?.uri).toContain(
			"renamed-title--00000000-0000-4000-8000-000000000001",
		);

		const readOriginalSlug = await client.readResource({ uri: originalUri });
		const readBareId = await client.readResource({
			uri: `trickroom://proj/proj_catalog_rename/design/${trickroomMcpTestDesignUuid}`,
		});
		expect(
			JSON.parse(readOriginalSlug.contents[0].text as string),
		).toMatchObject({
			payloadKind: "design-summary",
			designFile: {
				name: "Renamed Title",
			},
		});
		expect(JSON.parse(readBareId.contents[0].text as string)).toMatchObject({
			payloadKind: "design-summary",
			designFile: {
				name: "Renamed Title",
			},
		});
	});
});
