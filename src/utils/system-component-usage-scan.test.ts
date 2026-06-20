import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as designFileServiceModule from "../services/design-file-service";
import type { TrickroomDesign } from "../types";
import { createDesignSystemStorage } from "./design-system-store";
import { getSystemComponentMarkerProps } from "./system-component-markers";
import {
	createFixtureManifest,
	createFixturePublishedRecord,
	FIXTURE_COMPONENT_ID,
	FIXTURE_OTHER_COMPONENT_ID,
} from "./system-component-test-fixtures";
import {
	collectDesignAttachedSystemComponentUsages,
	scanDesignFileSystemComponentUsage,
	scanProjectSystemComponentUsage,
} from "./system-component-usage-scan";
import {
	SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	type SystemComponentRecord,
} from "./system-components";

const designWithAttachedComponent = (
	systemId: string,
	componentId: string,
	version: string,
	instanceId: string,
	hashes: { templateHash?: string; variantSchemaHash?: string } = {},
): TrickroomDesign => ({
	name: "Attached Usage Design",
	systemId,
	systemName: "Core",
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
			},
			children: [
				{
					id: "attached-root",
					props: {
						"data-trickroom-name": "Primary Button",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						...getSystemComponentMarkerProps({
							systemId,
							componentId,
							instanceId,
							version,
							path: "root",
							isRoot: true,
							...hashes,
						}),
					},
					children: [],
				},
			],
		},
	],
});

describe("system-component-usage-scan", () => {
	let tempProjectRoot: string;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-component-usage-scan-"),
		);
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
		await mkdir(path.join(tempProjectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(tempProjectRoot, "src", "index.css"),
			"@import 'tailwindcss';\n",
			"utf8",
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const writeDesign = async (uuid: string, design: TrickroomDesign) => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "designs", `${uuid}.json`),
			JSON.stringify(design),
			"utf8",
		);
	};

	const setupCoreSystem = async (
		components: Record<string, SystemComponentRecord> = {
			[FIXTURE_COMPONENT_ID]: createFixturePublishedRecord(),
		},
	) => {
		const storage = await createDesignSystemStorage(tempProjectRoot, {
			systemName: "Core",
			cssPath: "src/index.css",
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"core",
				SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
			),
			JSON.stringify(createFixtureManifest(components)),
			"utf8",
		);
		return storage.systemId;
	};

	it("collects attached component root markers with design location metadata", () => {
		const design = designWithAttachedComponent(
			"sys_core",
			FIXTURE_COMPONENT_ID,
			"1",
			"instance-1",
		);
		const result = collectDesignAttachedSystemComponentUsages(design, {
			designFileId: "00000000-0000-4000-8000-000000000001",
			designFile: "00000000-0000-4000-8000-000000000001.json",
			designName: design.name,
		});

		expect(result.instances).toEqual([
			{
				systemId: "sys_core",
				componentId: FIXTURE_COMPONENT_ID,
				version: "1",
				instanceId: "instance-1",
				designFileId: "00000000-0000-4000-8000-000000000001",
				designFile: "00000000-0000-4000-8000-000000000001.json",
				designName: "Attached Usage Design",
				elementId: "attached-root",
				path: "boards[0].children[0]",
				systemName: "Core",
				templateHash: null,
				variantSchemaHash: null,
			},
		]);
		expect(result.diagnostics).toEqual([]);
	});

	it("classifies current, stale, missing, and hash-mismatched attached instances", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		const versionTwo = {
			...versionOne,
			version: "2",
			previousVersion: "1",
			templateHash: "sha256:template-v2",
			variantSchemaHash: "sha256:variant-v2",
		};
		publishedRecord.published = {
			currentVersion: "2",
			versions: {
				"1": versionOne,
				"2": versionTwo,
			},
		};
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});

		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"2",
				"current",
				{
					templateHash: "sha256:template-v2",
					variantSchemaHash: "sha256:variant-v2",
				},
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000002",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"stale",
				{
					templateHash: versionOne.templateHash,
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000003",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"2",
				"hash-mismatch",
				{
					templateHash: "sha256:wrong-template",
					variantSchemaHash: "sha256:variant-v2",
				},
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000004",
			designWithAttachedComponent(
				systemId,
				"cmp_missing",
				"1",
				"missing-component",
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000005",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"99",
				"missing-version",
			),
		);

		const result = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
		});

		expect(result.statusCounts).toEqual({
			current: 1,
			stale: 1,
			"missing-component": 1,
			"missing-version": 1,
			"hash-mismatch": 1,
		});
		expect(
			Object.fromEntries(
				result.instances.map((instance) => [
					instance.instanceId,
					instance.versionStatus?.status,
				]),
			),
		).toMatchObject({
			current: "current",
			stale: "stale",
			"hash-mismatch": "hash-mismatch",
			"missing-component": "missing-component",
			"missing-version": "missing-version",
		});
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "STALE_VERSION",
					instanceId: "stale",
				}),
				expect.objectContaining({
					code: "HASH_MISMATCH",
					instanceId: "hash-mismatch",
				}),
				expect.objectContaining({
					code: "UNKNOWN_COMPONENT",
					instanceId: "missing-component",
				}),
				expect.objectContaining({
					code: "UNKNOWN_VERSION",
					instanceId: "missing-version",
				}),
			]),
		);
	});

	it("classifies current-version instances with missing hash metadata as hash-mismatch", async () => {
		const systemId = await setupCoreSystem();
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"missing-hashes",
			),
		);

		const result = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
		});

		expect(result.statusCounts).toMatchObject({
			current: 0,
			"hash-mismatch": 1,
		});
		expect(result.instances[0]?.versionStatus?.status).toBe("hash-mismatch");
	});

	it("does not emit scoped-manifest diagnostics after SYSTEM_MISMATCH", async () => {
		const systemId = await setupCoreSystem();
		const otherSystemId = "sys_00000000-0000-4000-8000-000000000099";
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				otherSystemId,
				"cmp_missing",
				"99",
				"foreign-instance",
			),
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.diagnostics.map((entry) => entry.code)).toEqual([
			"SYSTEM_MISMATCH",
		]);
	});

	it("emits SYSTEM_MISMATCH diagnostics for cross-system attachments without counting them", async () => {
		const systemId = await setupCoreSystem();
		const otherSystemId = "sys_00000000-0000-4000-8000-000000000099";
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				otherSystemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"foreign-instance",
			),
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.usedByCount).toBe(0);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "SYSTEM_MISMATCH",
					instanceId: "foreign-instance",
					systemId: otherSystemId,
				}),
			]),
		);
	});

	it("resolves path-like design file references for per-design scans", async () => {
		const systemId = await setupCoreSystem();
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"instance-1",
			),
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			path.join(".trickroom", "designs", "00000000-0000-4000-8000-000000000001.json"),
			{ systemHandle: systemId },
		);

		expect(result.usedByCount).toBe(1);
		expect(result.instances[0]).toMatchObject({
			instanceId: "instance-1",
			designFile: "00000000-0000-4000-8000-000000000001.json",
		});
	});

	it("treats hash mismatches as review-only for migration policy metadata", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"hash-mismatch",
				{
					templateHash: "sha256:wrong-template",
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.migrationPolicyPrompt).toMatchObject({
			reviewOnlyCount: 1,
			staleCount: 0,
			promptRequired: false,
			safeAutomaticMigrationEnabled: false,
		});
	});

	it("reports a first-run migration policy prompt for a stale single-design scan", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		publishedRecord.published = {
			currentVersion: "2",
			versions: {
				"1": versionOne,
				"2": {
					...versionOne,
					version: "2",
					previousVersion: "1",
					templateHash: "sha256:template-v2",
					variantSchemaHash: "sha256:variant-v2",
				},
			},
		};
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"stale",
				{
					templateHash: versionOne.templateHash,
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.migrationPolicyPrompt).toMatchObject({
			designPolicy: "inherit",
			systemAutoMigrateComponents: false,
			effectivePolicy: "manual",
			promptRequired: true,
			safeAutomaticMigrationEnabled: false,
			staleCount: 1,
			reviewOnlyCount: 0,
		});
	});

	it("treats design auto policy as manual when system auto migration is off", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		publishedRecord.published = {
			currentVersion: "2",
			versions: {
				"1": versionOne,
				"2": {
					...versionOne,
					version: "2",
					previousVersion: "1",
					templateHash: "sha256:template-v2",
					variantSchemaHash: "sha256:variant-v2",
				},
			},
		};
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});
		await writeDesign("00000000-0000-4000-8000-000000000001", {
			...designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"stale",
				{
					templateHash: versionOne.templateHash,
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
			componentMigrationPolicy: "auto",
		});

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.migrationPolicyPrompt).toMatchObject({
			designPolicy: "auto",
			systemAutoMigrateComponents: false,
			effectivePolicy: "manual",
			safeAutomaticMigrationEnabled: false,
			staleCount: 1,
		});
	});

	it("enables safe automatic migration only when system auto migration is on", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		publishedRecord.published = {
			currentVersion: "2",
			versions: {
				"1": versionOne,
				"2": {
					...versionOne,
					version: "2",
					previousVersion: "1",
					templateHash: "sha256:template-v2",
					variantSchemaHash: "sha256:variant-v2",
				},
			},
		};
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});
		const manifest = createFixtureManifest({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
		});
		manifest.settings.autoMigrateComponents = true;
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"core",
				SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
			),
			JSON.stringify(manifest),
			"utf8",
		);
		await writeDesign("00000000-0000-4000-8000-000000000001", {
			...designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"stale",
				{
					templateHash: versionOne.templateHash,
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
			componentMigrationPolicy: "auto",
		});

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000001.json",
			{ systemHandle: systemId },
		);

		expect(result.migrationPolicyPrompt).toMatchObject({
			designPolicy: "auto",
			systemAutoMigrateComponents: true,
			effectivePolicy: "auto",
			promptRequired: false,
			safeAutomaticMigrationEnabled: true,
			staleCount: 1,
		});
	});

	it("scopes manifest diagnostics to the requested component filter", async () => {
		const publishedRecord = createFixturePublishedRecord();
		const versionOne = publishedRecord.published?.versions["1"];
		if (!publishedRecord.published || !versionOne) {
			throw new Error("Fixture published record is missing version 1.");
		}
		publishedRecord.published = {
			currentVersion: "2",
			versions: {
				"1": versionOne,
				"2": {
					...versionOne,
					version: "2",
					previousVersion: "1",
					templateHash: "sha256:template-v2",
					variantSchemaHash: "sha256:variant-v2",
				},
			},
		};
		const otherPublishedRecord = createFixturePublishedRecord({
			componentId: FIXTURE_OTHER_COMPONENT_ID,
			slug: "other-button",
			name: "Other Button",
		});
		const systemId = await setupCoreSystem({
			[FIXTURE_COMPONENT_ID]: publishedRecord,
			[FIXTURE_OTHER_COMPONENT_ID]: otherPublishedRecord,
		});
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"stale-target",
				{
					templateHash: versionOne.templateHash,
					variantSchemaHash: versionOne.variantSchemaHash,
				},
			),
		);
		const otherVersionOne =
			otherPublishedRecord.published?.versions["1"] ?? versionOne;
		await writeDesign(
			"00000000-0000-4000-8000-000000000002",
			designWithAttachedComponent(
				systemId,
				FIXTURE_OTHER_COMPONENT_ID,
				"1",
				"other-current",
				{
					templateHash: otherVersionOne.templateHash,
					variantSchemaHash: otherVersionOne.variantSchemaHash,
				},
			),
		);

		const result = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
			componentId: FIXTURE_OTHER_COMPONENT_ID,
		});

		expect(result.usedByCount).toBe(1);
		expect(result.instances[0]?.componentId).toBe(FIXTURE_OTHER_COMPONENT_ID);
		expect(result.diagnostics).toEqual([]);
		expect(result.statusCounts.stale).toBe(0);
	});

	it("reports malformed root markers and missing component/version references", async () => {
		const systemId = await setupCoreSystem();
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"instance-1",
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000002",
			designWithAttachedComponent(systemId, "cmp_missing", "99", "instance-2"),
		);
		await writeDesign("00000000-0000-4000-8000-000000000003", {
			name: "Malformed",
			systemName: "Core",
			boards: [
				{
					id: "broken-root",
					props: {
						"data-trickroom-name": "Broken",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-system-component-root": "true",
					},
					children: [],
				},
			],
		});

		const filtered = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
			componentId: FIXTURE_COMPONENT_ID,
		});
		expect(filtered.usedByCount).toBe(1);
		expect(filtered.instances[0]).toMatchObject({
			componentId: FIXTURE_COMPONENT_ID,
			elementId: "attached-root",
		});

		const full = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
		});
		expect(full.usedByCount).toBe(2);
		expect(full.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "UNKNOWN_COMPONENT",
					componentId: "cmp_missing",
				}),
				expect.objectContaining({
					code: "MALFORMED_INSTANCE_MARKER",
					elementId: "broken-root",
				}),
			]),
		);
	});

	it("returns a design read diagnostic for invalid design file references", async () => {
		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			".trickroom/designs/not-a-design.txt",
		);

		expect(result.instances).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DESIGN_READ_FAILED",
				designFile: "not-a-design.txt",
			}),
		]);
	});

	it("supports per-design scans and invalid design diagnostics", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"designs",
				"00000000-0000-4000-8000-000000000099.json",
			),
			"{ not-a-design",
			"utf8",
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000099.json",
		);

		expect(result.instances).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DESIGN_READ_FAILED",
				designFile: "00000000-0000-4000-8000-000000000099.json",
				designFileId: "00000000-0000-4000-8000-000000000099",
			}),
		]);
		expect(
			result.diagnostics.some((entry) =>
				entry.message.includes("Design file not found"),
			),
		).toBe(false);
	});

	it("classifies invalid existing design payloads without reporting not found", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"designs",
				"00000000-0000-4000-8000-000000000010.json",
			),
			JSON.stringify({ name: "Broken" }),
			"utf8",
		);

		const result = await scanDesignFileSystemComponentUsage(
			tempProjectRoot,
			"00000000-0000-4000-8000-000000000010.json",
		);

		expect(result.instances).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "INVALID_DESIGN_PAYLOAD",
				designFile: "00000000-0000-4000-8000-000000000010.json",
			}),
		]);
	});

	it("reads only the targeted design file without listing every design", async () => {
		const systemId = await setupCoreSystem();
		const allowedUuid = "00000000-0000-4000-8000-000000000001";
		const disallowedUuid = "00000000-0000-4000-8000-000000000099";

		await writeDesign(
			allowedUuid,
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"allowed-instance",
			),
		);
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"designs",
				`${disallowedUuid}.json`,
			),
			"{ this is not valid trickroom design json",
			"utf8",
		);

		const service = designFileServiceModule.createDesignFileService(
			tempProjectRoot,
		);
		const listSpy = vi.spyOn(service, "listDesignSummaries");
		vi.spyOn(designFileServiceModule, "createDesignFileService").mockReturnValue(
			service,
		);

		const result = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
			designFileId: allowedUuid,
		});

		expect(listSpy).not.toHaveBeenCalled();
		expect(result.scannedDesignCount).toBe(1);
		expect(result.usedByCount).toBe(1);
		expect(result.instances[0]?.designFileId).toBe(allowedUuid);
		expect(
			result.diagnostics.some(
				(entry) => entry.designFileId === disallowedUuid,
			),
		).toBe(false);
	});

	it("scopes project scans to one component id", async () => {
		const systemId = await setupCoreSystem();
		await writeDesign(
			"00000000-0000-4000-8000-000000000001",
			designWithAttachedComponent(
				systemId,
				FIXTURE_COMPONENT_ID,
				"1",
				"instance-1",
			),
		);
		await writeDesign(
			"00000000-0000-4000-8000-000000000002",
			designWithAttachedComponent(systemId, "cmp_other", "1", "instance-2"),
		);

		const result = await scanProjectSystemComponentUsage(tempProjectRoot, {
			systemHandle: systemId,
			componentId: FIXTURE_COMPONENT_ID,
		});

		expect(result.usedByCount).toBe(1);
		expect(
			result.instances.every(
				(entry) => entry.componentId === FIXTURE_COMPONENT_ID,
			),
		).toBe(true);
	});
});
