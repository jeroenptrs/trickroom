import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesignSystemStorage } from "./design-system-store";
import {
	emptySystemComponentManifestRevision,
	readSystemComponentManifest,
	type SystemComponentManifestServiceError,
	writeSystemComponentManifest,
} from "./system-component-manifest-service";
import { resolveSystemComponentVariantValues } from "./system-component-resolution";
import {
	createEmptySystemComponentManifest,
	generateSystemComponentId,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	type SystemComponentRecord,
} from "./system-components";
import { hashSystemComponentVariantSchema } from "./system-components-validation";

const minimalRoot = () => ({
	path: "root",
	library: "trickroom",
	component: "container",
});

const draftRecord = (
	componentId: string,
	slug: string,
	now = "2026-05-26T12:00:00.000Z",
): SystemComponentRecord => ({
	componentId,
	slug,
	name: slug,
	createdAt: now,
	updatedAt: now,
	draft: {
		root: minimalRoot(),
	},
});

describe("system component manifest service", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-components-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("returns a normalized empty manifest when components.json is missing", async () => {
		await expect(
			readSystemComponentManifest(projectRoot, "Core"),
		).resolves.toEqual({
			manifest: createEmptySystemComponentManifest(),
			revision: emptySystemComponentManifestRevision,
			updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
			exists: false,
			path: path.join(
				projectRoot,
				".trickroom",
				"systems",
				"core",
				"components.json",
			),
			warnings: [],
			diagnostics: [],
		});
	});

	it("defaults missing component settings to manual migration", async () => {
		const manifestPath = path.join(
			projectRoot,
			".trickroom",
			"systems",
			"core",
			"components.json",
		);
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					schemaVersion: 1,
					createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
				},
				migrationPolicy: createEmptySystemComponentManifest().migrationPolicy,
				components: {},
			}),
			"utf8",
		);

		await expect(
			readSystemComponentManifest(projectRoot, "Core"),
		).resolves.toMatchObject({
			manifest: {
				settings: {
					autoMigrateComponents: false,
				},
			},
		});
	});

	it("migrates v1 manifests by backfilling optional variant defaults and published hashes", async () => {
		const componentId = generateSystemComponentId();
		const oldVariants = {
			axes: {
				size: {
					label: "Size",
					values: {
						beta: { label: "Beta" },
						alpha: { label: "Alpha" },
					},
				},
				tone: {
					label: "Tone",
					defaultValue: "brand",
					values: {
						brand: { label: "Brand" },
					},
				},
			},
		};
		const oldVariantHash = hashSystemComponentVariantSchema(oldVariants);
		const manifestPath = path.join(
			projectRoot,
			".trickroom",
			"systems",
			"core",
			"components.json",
		);
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					schemaVersion: 1,
					createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
				},
				migrationPolicy: createEmptySystemComponentManifest().migrationPolicy,
				components: {
					[componentId]: {
						...draftRecord(componentId, "primary-button"),
						draft: {
							root: minimalRoot(),
							variants: oldVariants,
						},
						published: {
							currentVersion: "1",
							versions: {
								"1": {
									version: "1",
									publishedAt: "2026-05-26T12:00:00.000Z",
									root: minimalRoot(),
									templateHash: "sha256:template",
									variantSchemaHash: oldVariantHash,
									variants: oldVariants,
								},
							},
						},
					},
				},
			}),
			"utf8",
		);

		const read = await readSystemComponentManifest(projectRoot, "Core");
		const record = read.manifest.components[componentId];
		const publishedVersion = record?.published?.versions["1"];
		const migratedVariants = {
			...oldVariants,
			defaultValues: { size: "alpha" },
		};

		expect(read.manifest.version).toBe(2);
		expect(read.manifest.metadata.schemaVersion).toBe(2);
		expect(record?.draft?.variants).toEqual(migratedVariants);
		expect(publishedVersion?.variants).toEqual(migratedVariants);
		expect(publishedVersion?.variantSchemaHash).toBe(
			hashSystemComponentVariantSchema(migratedVariants),
		);
		expect(publishedVersion?.variantSchemaHash).not.toBe(oldVariantHash);
		expect(
			resolveSystemComponentVariantValues(record?.draft?.variants, {}),
		).toEqual({ size: "alpha", tone: "brand" });
	});

	it("rejects malformed component manifests with deterministic diagnostics", async () => {
		const manifestPath = path.join(
			projectRoot,
			".trickroom",
			"systems",
			"core",
			"components.json",
		);
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(manifestPath, "{not-json", "utf8");

		await expect(
			readSystemComponentManifest(projectRoot, "Core"),
		).rejects.toMatchObject({
			code: "MALFORMED_MANIFEST",
			diagnostics: [
				{
					code: "INVALID_JSON",
					message: expect.stringContaining("Invalid JSON"),
				},
			],
		} satisfies Partial<SystemComponentManifestServiceError>);
	});

	it("rejects invalid manifests with structured diagnostics", async () => {
		const componentId = generateSystemComponentId();
		const manifestPath = path.join(
			projectRoot,
			".trickroom",
			"systems",
			"core",
			"components.json",
		);
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				metadata: {
					schemaVersion: 1,
					createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
				},
				migrationPolicy: createEmptySystemComponentManifest().migrationPolicy,
				components: {
					[componentId]: {
						...draftRecord(componentId, "primary-button"),
						componentId: generateSystemComponentId(),
					},
				},
			}),
			"utf8",
		);

		await expect(
			readSystemComponentManifest(projectRoot, "Core"),
		).rejects.toMatchObject({
			code: "INVALID_MANIFEST",
			diagnostics: [
				{
					code: "MISMATCHED_COMPONENT_ID_KEY",
					message: expect.any(String),
				},
			],
		} satisfies Partial<SystemComponentManifestServiceError>);
	});

	it("serializes concurrent expected-revision writes so only one succeeds", async () => {
		const initial = await readSystemComponentManifest(projectRoot, "Core");
		const firstId = generateSystemComponentId();
		const secondId = generateSystemComponentId();

		const [firstResult, secondResult] = await Promise.allSettled([
			writeSystemComponentManifest(
				projectRoot,
				"Core",
				{
					...initial.manifest,
					components: {
						[firstId]: draftRecord(firstId, "concurrent-a"),
					},
				},
				{
					expectedRevision: initial.revision,
					now: "2026-05-26T12:00:00.000Z",
				},
			),
			writeSystemComponentManifest(
				projectRoot,
				"Core",
				{
					...initial.manifest,
					components: {
						[secondId]: draftRecord(secondId, "concurrent-b"),
					},
				},
				{
					expectedRevision: initial.revision,
					now: "2026-05-26T12:00:00.000Z",
				},
			),
		]);

		const outcomes = [firstResult, secondResult];
		const fulfilled = outcomes.filter(
			(
				outcome,
			): outcome is PromiseFulfilledResult<
				Awaited<ReturnType<typeof writeSystemComponentManifest>>
			> => outcome.status === "fulfilled",
		);
		const rejected = outcomes.filter(
			(outcome): outcome is PromiseRejectedResult =>
				outcome.status === "rejected",
		);

		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toMatchObject({
			code: "STALE_WRITE",
		} satisfies Partial<SystemComponentManifestServiceError>);

		const persisted = await readSystemComponentManifest(projectRoot, "Core");
		const componentIds = Object.keys(persisted.manifest.components);
		expect(componentIds).toHaveLength(1);
		expect(
			[firstId, secondId].filter((id) => persisted.manifest.components[id]),
		).toHaveLength(1);
		expect(persisted.revision).toBe(fulfilled[0]?.value.revision);
	});

	it("fails stale writes when the expected revision is out of date", async () => {
		const componentId = generateSystemComponentId();
		const initial = await readSystemComponentManifest(projectRoot, "Core");
		const firstWrite = await writeSystemComponentManifest(
			projectRoot,
			"Core",
			{
				...initial.manifest,
				components: {
					[componentId]: draftRecord(componentId, "primary-button"),
				},
			},
			{ expectedRevision: initial.revision, now: "2026-05-26T12:00:00.000Z" },
		);

		const otherId = generateSystemComponentId();
		await expect(
			writeSystemComponentManifest(
				projectRoot,
				"Core",
				{
					...firstWrite.manifest,
					components: {
						[otherId]: draftRecord(
							otherId,
							"secondary-button",
							"2026-05-26T12:01:00.000Z",
						),
					},
				},
				{ expectedRevision: initial.revision },
			),
		).rejects.toMatchObject({
			code: "STALE_WRITE",
		} satisfies Partial<SystemComponentManifestServiceError>);
	});

	it("writes manifests atomically and preserves unrelated components", async () => {
		const buttonId = generateSystemComponentId();
		const cardId = generateSystemComponentId();
		const initial = await readSystemComponentManifest(projectRoot, "Core");
		const firstWrite = await writeSystemComponentManifest(
			projectRoot,
			"Core",
			{
				...initial.manifest,
				components: {
					[buttonId]: draftRecord(buttonId, "primary-button"),
					[cardId]: draftRecord(cardId, "card"),
				},
			},
			{ expectedRevision: initial.revision, now: "2026-05-26T12:00:00.000Z" },
		);

		const secondWrite = await writeSystemComponentManifest(
			projectRoot,
			"Core",
			{
				...firstWrite.manifest,
				components: {
					[buttonId]: {
						...draftRecord(
							buttonId,
							"primary-button",
							"2026-05-26T12:05:00.000Z",
						),
						group: "actions",
						order: 1,
						draft: {
							root: minimalRoot(),
							slots: {
								label: {
									name: "label",
									label: "Label",
									hostPath: "root",
								},
							},
						},
					},
				},
			},
			{
				expectedRevision: firstWrite.revision,
				now: "2026-05-26T12:05:00.000Z",
			},
		);

		expect(secondWrite.manifest.components[buttonId]?.group).toBe("actions");
		expect(secondWrite.manifest.components[buttonId]?.draft?.slots).toEqual({
			label: {
				name: "label",
				label: "Label",
				hostPath: "root",
			},
		});
		expect(secondWrite.manifest.components[cardId]).toEqual(
			firstWrite.manifest.components[cardId],
		);
		expect(secondWrite.updatedAt).toBe("2026-05-26T12:05:00.000Z");
		expect(secondWrite.revision).not.toBe(firstWrite.revision);

		const persisted = JSON.parse(
			await readFile(secondWrite.path, "utf8"),
		) as typeof secondWrite.manifest;
		expect(persisted.components[cardId]).toBeDefined();
		expect(persisted.components[buttonId]?.draft?.slots?.label).toEqual({
			name: "label",
			label: "Label",
			hostPath: "root",
		});
	});

	it("resolves components.json by system id handle", async () => {
		const manifest = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		const componentId = generateSystemComponentId();

		const initial = await readSystemComponentManifest(
			projectRoot,
			manifest.systemId,
		);
		const written = await writeSystemComponentManifest(
			projectRoot,
			manifest.systemId,
			{
				...initial.manifest,
				components: {
					[componentId]: draftRecord(componentId, "hero"),
				},
			},
			{ expectedRevision: initial.revision, now: "2026-05-26T12:00:00.000Z" },
		);

		expect(written.path).toBe(
			path.join(
				projectRoot,
				".trickroom",
				"systems",
				"core",
				"components.json",
			),
		);
		await expect(
			readSystemComponentManifest(projectRoot, manifest.systemId),
		).resolves.toMatchObject({
			exists: true,
			manifest: {
				components: {
					[componentId]: expect.objectContaining({
						componentId,
						slug: "hero",
					}),
				},
			},
		});
	});
});
