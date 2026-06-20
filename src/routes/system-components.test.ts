import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesign } from "../types";
import { getSystemComponentMarkerProps } from "../utils/system-component-markers";
import {
	createFixtureManifest,
	createFixturePublishedRecord,
	FIXTURE_COMPONENT_ID,
} from "../utils/system-component-test-fixtures";
import { emptySystemComponentManifestRevision } from "../utils/system-component-manifest-service";
import { SYSTEM_COMPONENT_MANIFEST_FILE_NAME } from "../utils/system-components";

describe("system component routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-system-component-routes-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
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

	const importTestServer = async () => {
		const { default: app } = await import("../server");
		return app;
	};

	const resolveCoreSystemId = async (
		app: Awaited<ReturnType<typeof importTestServer>>,
	) => {
		const listResponse = await app.request("/api/trickroom/systems");
		const listBody = (await listResponse.json()) as {
			systems: Array<{ systemId: string; systemName: string }>;
		};
		const core = listBody.systems.find(
			(system) => system.systemName === "Core",
		);
		if (!core) {
			throw new Error("Expected Core system in test project.");
		}
		return core.systemId;
	};

	const minimalRoot = () => ({
		path: "root",
		library: "trickroom",
		component: "container",
	});

	it("lists and describes components using a system-id handle", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "primary-button",
					name: "Primary Button",
				}),
			},
		);
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const listResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
		);
		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toMatchObject({
			systemId,
			revision: created.revision,
			components: [
				expect.objectContaining({
					componentId: created.componentId,
					slug: "primary-button",
					hasDraft: true,
				}),
			],
		});

		const describeResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}`,
		);
		expect(describeResponse.status).toBe(200);
		await expect(describeResponse.json()).resolves.toMatchObject({
			systemId,
			componentId: created.componentId,
			valid: true,
			record: {
				slug: "primary-button",
				draft: { root: minimalRoot() },
			},
		});
	});

	it("updates system component auto-migration settings explicitly", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const settingsResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/settings`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					autoMigrateComponents: true,
				}),
			},
		);

		expect(settingsResponse.status).toBe(200);
		await expect(settingsResponse.json()).resolves.toMatchObject({
			systemId,
			settings: {
				autoMigrateComponents: true,
			},
			revision: expect.stringMatching(/^sha256:/u),
		});

		const listResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
		);
		await expect(listResponse.json()).resolves.toMatchObject({
			revision: expect.stringMatching(/^sha256:/u),
			settings: {
				autoMigrateComponents: true,
			},
		});
	});

	it("updates draft sections and publishes with revision metadata", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "card",
					name: "Card",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const templateResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: created.revision,
					root: {
						...minimalRoot(),
						children: [
							{
								path: "label",
								library: "trickroom",
								component: "text",
								text: "Label",
							},
						],
					},
				}),
			},
		);
		expect(templateResponse.status).toBe(200);
		const afterTemplate = (await templateResponse.json()) as {
			revision: string;
		};

		const metadataResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/metadata`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: afterTemplate.revision,
					name: "Marketing Card",
					group: "content",
				}),
			},
		);
		expect(metadataResponse.status).toBe(200);
		const afterMetadata = (await metadataResponse.json()) as {
			revision: string;
		};

		const publishResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/publish`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: afterMetadata.revision }),
			},
		);
		expect(publishResponse.status).toBe(200);
		await expect(publishResponse.json()).resolves.toMatchObject({
			componentId: created.componentId,
			publishedVersion: "1",
			revision: expect.stringMatching(/^sha256:/),
		});
	});

	it("copies the current published version into a draft without overwriting an existing draft", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "chip",
					name: "Chip",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const publishResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/publish`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: created.revision }),
			},
		);
		const published = (await publishResponse.json()) as { revision: string };

		const overwriteResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/draft-from-published`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: published.revision }),
			},
		);
		expect(overwriteResponse.status).toBe(409);
	});

	it("returns 404 for unknown systems and components", async () => {
		const app = await importTestServer();

		const missingSystemResponse = await app.request(
			"/api/trickroom/systems/sys_missing/components",
		);
		expect(missingSystemResponse.status).toBe(404);

		const listResponse = await app.request(
			"/api/trickroom/systems/Core/components",
		);
		const listBody = (await listResponse.json()) as { revision: string };
		const createResponse = await app.request(
			"/api/trickroom/systems/Core/components",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: listBody.revision,
					slug: "chip",
					name: "Chip",
				}),
			},
		);
		const created = (await createResponse.json()) as { componentId: string };

		const missingComponentResponse = await app.request(
			`/api/trickroom/systems/Core/components/cmp_missing`,
		);
		expect(missingComponentResponse.status).toBe(404);

		const missingPublishResponse = await app.request(
			`/api/trickroom/systems/Core/components/cmp_missing/publish`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: listBody.revision }),
			},
		);
		expect(missingPublishResponse.status).toBe(404);

		const describeCreatedResponse = await app.request(
			`/api/trickroom/systems/Core/components/${encodeURIComponent(created.componentId)}`,
		);
		expect(describeCreatedResponse.status).toBe(200);
	});

	it("deletes a system component", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "delete-me",
					name: "Delete Me",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const deleteResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}`,
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: created.revision }),
			},
		);

		expect(deleteResponse.status).toBe(200);
		await expect(deleteResponse.json()).resolves.toMatchObject({
			componentId: created.componentId,
			revision: expect.stringMatching(/^sha256:/),
		});

		const describeResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}`,
		);
		expect(describeResponse.status).toBe(404);
	});

	it("returns 400 for malformed create and update requests", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const malformedCreate = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ slug: "only-slug" }),
			},
		);
		expect(malformedCreate.status).toBe(400);

		const invalidSlugCreate = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "Invalid Slug",
					name: "Invalid",
				}),
			},
		);
		expect(invalidSlugCreate.status).toBe(400);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "badge",
					name: "Badge",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const malformedTemplate = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/template`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: created.revision }),
			},
		);
		expect(malformedTemplate.status).toBe(400);
	});

	it("returns 409 for stale expectedRevision writes", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "stale",
					name: "Stale",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const staleResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/metadata`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					name: "Stale Updated",
				}),
			},
		);
		expect(staleResponse.status).toBe(409);
	});

	it("rejects omitted section payload keys instead of clearing existing data", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);

		const createResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: emptySystemComponentManifestRevision,
					slug: "slotted-card",
					name: "Slotted Card",
				}),
			},
		);
		const created = (await createResponse.json()) as {
			componentId: string;
			revision: string;
		};

		const draftResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/draft`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: created.revision,
					root: minimalRoot(),
					slots: {
						default: {
							name: "default",
							hostPath: "root",
						},
					},
				}),
			},
		);
		expect(draftResponse.status).toBe(200);
		const afterDraft = (await draftResponse.json()) as { revision: string };

		const omittedSlotsResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}/slots`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedRevision: afterDraft.revision }),
			},
		);
		expect(omittedSlotsResponse.status).toBe(400);

		const describeResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(created.componentId)}`,
		);
		await expect(describeResponse.json()).resolves.toMatchObject({
			record: {
				draft: {
					slots: {
						default: {
							name: "default",
							hostPath: "root",
						},
					},
				},
			},
		});
	});

	it("reports attached component usage counts and scan details", async () => {
		const app = await importTestServer();
		const systemId = await resolveCoreSystemId(app);
		const publishedRecord = createFixturePublishedRecord();
		const publishedVersion = publishedRecord.published!.versions["1"];
		await mkdir(path.join(tempProjectRoot, ".trickroom", "systems", "core"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"core",
				SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
			),
			JSON.stringify(
				createFixtureManifest({
					[FIXTURE_COMPONENT_ID]: publishedRecord,
				}),
			),
			"utf8",
		);

		const design = {
			name: "Uses Component",
			systemName: "Core",
			boards: [
				{
					id: "attached-root",
					props: {
						"data-trickroom-name": "Primary Button",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						...getSystemComponentMarkerProps({
							systemId,
							componentId: FIXTURE_COMPONENT_ID,
							instanceId: "instance-1",
							version: "1",
							path: "root",
							isRoot: true,
							templateHash: publishedVersion.templateHash,
							variantSchemaHash: publishedVersion.variantSchemaHash,
						}),
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign;

		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"designs",
				"00000000-0000-4000-8000-000000000001.json",
			),
			JSON.stringify(design),
			"utf8",
		);

		const usedByResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(FIXTURE_COMPONENT_ID)}/used-by`,
		);
		expect(usedByResponse.status).toBe(200);
		await expect(usedByResponse.json()).resolves.toMatchObject({
			componentId: FIXTURE_COMPONENT_ID,
			usedByCount: 1,
		});

		const usageResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/${encodeURIComponent(FIXTURE_COMPONENT_ID)}/usage`,
		);
		expect(usageResponse.status).toBe(200);
		await expect(usageResponse.json()).resolves.toMatchObject({
			componentId: FIXTURE_COMPONENT_ID,
			usedByCount: 1,
			statusCounts: {
				current: 1,
				stale: 0,
				"missing-component": 0,
				"missing-version": 0,
				"hash-mismatch": 0,
			},
			instances: [
				{
					componentId: FIXTURE_COMPONENT_ID,
					designFileId: "00000000-0000-4000-8000-000000000001",
					elementId: "attached-root",
					path: "boards[0]",
					instanceId: "instance-1",
					version: "1",
					versionStatus: {
						status: "current",
					},
				},
			],
		});

		const systemUsageResponse = await app.request(
			`/api/trickroom/systems/${encodeURIComponent(systemId)}/components/usage?componentId=${encodeURIComponent(FIXTURE_COMPONENT_ID)}`,
		);
		expect(systemUsageResponse.status).toBe(200);
		await expect(systemUsageResponse.json()).resolves.toMatchObject({
			componentId: FIXTURE_COMPONENT_ID,
			usedByCount: 1,
			statusCounts: {
				current: 1,
				stale: 0,
				"missing-component": 0,
				"missing-version": 0,
				"hash-mismatch": 0,
			},
			instances: [
				{
					componentId: FIXTURE_COMPONENT_ID,
					instanceId: "instance-1",
					versionStatus: {
						status: "current",
					},
				},
			],
		});
	});

	it("supports system-name handles for list and create", async () => {
		const app = await importTestServer();

		const listResponse = await app.request(
			"/api/trickroom/systems/Core/components",
		);
		expect(listResponse.status).toBe(200);
		const listBody = (await listResponse.json()) as { revision: string };

		const createResponse = await app.request(
			"/api/trickroom/systems/Core/components",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision: listBody.revision,
					slug: "by-name",
					name: "By Name",
				}),
			},
		);
		expect(createResponse.status).toBe(201);
	});
});
