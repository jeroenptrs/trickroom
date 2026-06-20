import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesignSystemStorage } from "./design-system-store";
import {
	readSystemComponentManifest,
	type SystemComponentManifestRevision,
} from "./system-component-manifest-service";
import {
	copyPublishedSystemComponentToDraft,
	createSystemComponentDraft,
	describeSystemComponent,
	discardSystemComponentDraft,
	listSystemComponentSummaries,
	publishSystemComponentDraft,
	type SystemComponentOperationsError,
	updateSystemComponentDraft,
	updateSystemComponentDraftMetadata,
	updateSystemComponentDraftOverrideTargets,
	updateSystemComponentDraftSlots,
	updateSystemComponentDraftTemplate,
	updateSystemComponentDraftVariants,
} from "./system-component-operations";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "./system-components-validation";

const minimalRoot = () => ({
	path: "root",
	library: "trickroom",
	component: "container",
});

describe("system component operations", () => {
	let projectRoot: string;
	let systemHandle: string;
	let revision: SystemComponentManifestRevision;
	const now = "2026-05-26T14:00:00.000Z";

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-component-ops-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemHandle = storage.systemId;
		const initial = await readSystemComponentManifest(
			projectRoot,
			systemHandle,
		);
		revision = initial.revision;
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("creates, lists, and describes a component draft", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{
				slug: "primary-button",
				name: "Primary Button",
				group: "actions",
				order: 2,
			},
			{ expectedRevision: revision, now },
		);

		expect(created.manifest.components[created.componentId]).toMatchObject({
			componentId: created.componentId,
			slug: "primary-button",
			name: "Primary Button",
			group: "actions",
			order: 2,
			draft: {
				root: minimalRoot(),
			},
		});
		expect(created.componentId).toBe(
			created.manifest.components[created.componentId]?.componentId,
		);

		const listed = await listSystemComponentSummaries(
			projectRoot,
			systemHandle,
		);
		expect(listed.components).toEqual([
			expect.objectContaining({
				componentId: created.componentId,
				slug: "primary-button",
				hasDraft: true,
				hasPublished: false,
				group: "actions",
				order: 2,
			}),
		]);

		const described = await describeSystemComponent(
			projectRoot,
			systemHandle,
			created.componentId,
		);
		expect(described.valid).toBe(true);
		expect(described.record.draft?.root).toEqual(minimalRoot());
		expect(described.revision).toBe(created.revision);
	});

	it("updates draft metadata, template, slots, variants, and override targets", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "card", name: "Card" },
			{ expectedRevision: revision, now },
		);

		const templateRoot = {
			...minimalRoot(),
			children: [
				{
					path: "label",
					library: "trickroom",
					component: "text",
					text: "Label",
				},
			],
		};
		const afterTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemHandle,
			created.componentId,
			templateRoot,
			{ expectedRevision: created.revision, now: "2026-05-26T14:01:00.000Z" },
		);

		const slots = {
			default: {
				name: "default",
				hostPath: "label",
			},
		};
		const afterSlots = await updateSystemComponentDraftSlots(
			projectRoot,
			systemHandle,
			created.componentId,
			slots,
			{
				expectedRevision: afterTemplate.revision,
				now: "2026-05-26T14:02:00.000Z",
			},
		);

		const variants = {
			axes: {
				size: {
					label: "Size",
					values: {
						sm: { classesByPath: { root: "text-sm" } },
					},
				},
			},
		};
		const afterVariants = await updateSystemComponentDraftVariants(
			projectRoot,
			systemHandle,
			created.componentId,
			variants,
			{
				expectedRevision: afterSlots.revision,
				now: "2026-05-26T14:03:00.000Z",
			},
		);

		const overrideTargets = {
			labelTarget: {
				targetId: "labelTarget",
				label: "Label",
				path: "label",
			},
		};
		const afterTargets = await updateSystemComponentDraftOverrideTargets(
			projectRoot,
			systemHandle,
			created.componentId,
			overrideTargets,
			{
				expectedRevision: afterVariants.revision,
				now: "2026-05-26T14:04:00.000Z",
			},
		);

		const afterMetadata = await updateSystemComponentDraftMetadata(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				name: "Marketing Card",
				group: "content",
				order: 5,
				description: "Hero card",
			},
			{
				expectedRevision: afterTargets.revision,
				now: "2026-05-26T14:05:00.000Z",
			},
		);

		const record = afterMetadata.manifest.components[created.componentId];
		expect(record).toMatchObject({
			name: "Marketing Card",
			group: "content",
			order: 5,
			description: "Hero card",
			draft: {
				root: templateRoot,
				slots,
				variants,
				overrideTargets,
			},
		});
	});

	it("publishes a draft without mutating prior published versions", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "badge", name: "Badge", group: "content", order: 1 },
			{ expectedRevision: revision, now },
		);

		const published = await publishSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{ expectedRevision: created.revision, now: "2026-05-26T14:10:00.000Z" },
		);

		const record = published.manifest.components[created.componentId];
		if (!record?.draft) {
			throw new Error("Expected published component to keep a draft.");
		}
		const version = record?.published?.versions["1"];
		expect(published.publishedVersion).toBe("1");
		expect(version).toMatchObject({
			version: "1",
			publishedAt: "2026-05-26T14:10:00.000Z",
			templateHash: hashSystemComponentTemplate(record.draft),
			variantSchemaHash: hashSystemComponentVariantSchema(),
			root: minimalRoot(),
		});
		expect(record?.group).toBe("content");
		expect(record?.order).toBe(1);

		const mutated = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				...minimalRoot(),
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Changed",
					},
				],
			},
			{ expectedRevision: published.revision, now: "2026-05-26T14:11:00.000Z" },
		);

		const afterEdit = mutated.manifest.components[created.componentId];
		expect(afterEdit?.published?.versions["1"]).toEqual(version);
		expect(afterEdit?.draft?.root.children?.[0]).toMatchObject({
			path: "label",
			text: "Changed",
		});

		const republished = await publishSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{ expectedRevision: mutated.revision, now: "2026-05-26T14:12:00.000Z" },
		);
		expect(republished.publishedVersion).toBe("2");
		expect(
			republished.manifest.components[created.componentId]?.published?.versions[
				"1"
			],
		).toEqual(version);
	});

	it("copies a published version into a new draft and discards safely", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{
				slug: "chip",
				name: "Chip",
				draft: {
					slots: {
						default: {
							name: "default",
							hostPath: "root",
						},
					},
					migrationHints: {
						slots: [{ fromName: "default", toName: "default" }],
					},
				},
			},
			{ expectedRevision: revision, now },
		);
		const published = await publishSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{ expectedRevision: created.revision, now: "2026-05-26T14:20:00.000Z" },
		);

		const discardedDraftOnly = await discardSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{ expectedRevision: published.revision, now: "2026-05-26T14:21:00.000Z" },
		);
		expect(discardedDraftOnly.removedComponent).toBe(false);
		expect(
			discardedDraftOnly.manifest.components[created.componentId]?.draft,
		).toBeUndefined();
		expect(
			discardedDraftOnly.manifest.components[created.componentId]?.published
				?.currentVersion,
		).toBe("1");

		const copied = await copyPublishedSystemComponentToDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			"1",
			{
				expectedRevision: discardedDraftOnly.revision,
				now: "2026-05-26T14:22:00.000Z",
			},
		);
		expect(
			copied.manifest.components[created.componentId]?.draft,
		).toMatchObject({
			baseVersion: "1",
			root: minimalRoot(),
			slots: {
				default: {
					name: "default",
					hostPath: "root",
				},
			},
			migrationHints: {
				slots: [{ fromName: "default", toName: "default" }],
			},
		});

		await expect(
			copyPublishedSystemComponentToDraft(
				projectRoot,
				systemHandle,
				created.componentId,
				"1",
				{ expectedRevision: copied.revision },
			),
		).rejects.toMatchObject({
			code: "DRAFT_ALREADY_EXISTS",
		} satisfies Partial<SystemComponentOperationsError>);
	});

	it("updates draft template and metadata atomically before validation", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "panel", name: "Panel" },
			{ expectedRevision: revision, now },
		);
		const rootWithChild = {
			...minimalRoot(),
			children: [
				{
					path: "label",
					library: "trickroom",
					component: "text",
					text: "Label",
				},
			],
		};
		const seeded = await updateSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				root: rootWithChild,
				slots: {
					labelSlot: {
						name: "labelSlot",
						hostPath: "label",
					},
				},
				overrideTargets: {
					labelTarget: {
						targetId: "labelTarget",
						label: "Label",
						path: "label",
					},
				},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							values: {
								primary: { classesByPath: { label: "text-blue-700" } },
							},
						},
					},
				},
			},
			{ expectedRevision: created.revision, now: "2026-05-26T14:06:00.000Z" },
		);

		await expect(
			updateSystemComponentDraftTemplate(
				projectRoot,
				systemHandle,
				created.componentId,
				minimalRoot(),
				{ expectedRevision: seeded.revision },
			),
		).rejects.toMatchObject({
			code: "VALIDATION_FAILED",
		} satisfies Partial<SystemComponentOperationsError>);

		const updated = await updateSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				root: minimalRoot(),
				slots: null,
				overrideTargets: null,
				variants: {
					axes: {
						tone: {
							label: "Tone",
							values: {
								primary: { classesByPath: { root: "text-blue-700" } },
							},
						},
					},
				},
			},
			{ expectedRevision: seeded.revision, now: "2026-05-26T14:07:00.000Z" },
		);

		expect(
			updated.manifest.components[created.componentId]?.draft,
		).toMatchObject({
			root: minimalRoot(),
			variants: {
				axes: {
					tone: {
						values: {
							primary: { classesByPath: { root: "text-blue-700" } },
						},
					},
				},
			},
		});
		expect(
			updated.manifest.components[created.componentId]?.draft?.slots,
		).toBeUndefined();
		expect(
			updated.manifest.components[created.componentId]?.draft?.overrideTargets,
		).toBeUndefined();
	});

	it("removes draft-only components when discarding the only state", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "temp", name: "Temp" },
			{ expectedRevision: revision, now },
		);

		const discarded = await discardSystemComponentDraft(
			projectRoot,
			systemHandle,
			created.componentId,
			{ expectedRevision: created.revision, now: "2026-05-26T14:30:00.000Z" },
		);
		expect(discarded.removedComponent).toBe(true);
		expect(discarded.manifest.components[created.componentId]).toBeUndefined();
	});

	it("rejects stale manifest revisions", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "stale", name: "Stale" },
			{ expectedRevision: revision, now },
		);

		await expect(
			updateSystemComponentDraftMetadata(
				projectRoot,
				systemHandle,
				created.componentId,
				{ name: "Stale Updated" },
				{ expectedRevision: revision },
			),
		).rejects.toMatchObject({
			code: "STALE_WRITE",
		} satisfies Partial<SystemComponentOperationsError>);
	});

	it("rejects stale draft template hashes", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{ slug: "hash-guard", name: "Hash Guard" },
			{ expectedRevision: revision, now },
		);
		const draft = created.manifest.components[created.componentId]?.draft;
		if (!draft) {
			throw new Error("Expected created component to include a draft.");
		}
		const expectedDraftTemplateHash = hashSystemComponentTemplate(draft);

		const firstEdit = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				...minimalRoot(),
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "First",
					},
				],
			},
			{ expectedRevision: created.revision },
		);

		await expect(
			updateSystemComponentDraftTemplate(
				projectRoot,
				systemHandle,
				created.componentId,
				{
					...minimalRoot(),
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Second",
						},
					],
				},
				{
					expectedRevision: firstEdit.revision,
					expectedDraftTemplateHash,
				},
			),
		).rejects.toMatchObject({
			code: "DRAFT_HASH_MISMATCH",
		} satisfies Partial<SystemComponentOperationsError>);
	});

	it("rejects stale draft variant schema hashes on combined draft updates", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemHandle,
			{
				slug: "variant-hash-guard",
				name: "Variant Hash Guard",
				draft: {
					variants: {
						axes: {
							tone: {
								label: "Tone",
								values: {
									brand: { label: "Brand" },
								},
							},
						},
					},
				},
			},
			{ expectedRevision: revision, now },
		);
		const draft = created.manifest.components[created.componentId]?.draft;
		if (!draft) {
			throw new Error("Expected created component to include a draft.");
		}
		const expectedDraftVariantSchemaHash = hashSystemComponentVariantSchema(
			draft.variants,
		);

		const firstEdit = await updateSystemComponentDraftVariants(
			projectRoot,
			systemHandle,
			created.componentId,
			{
				axes: {
					tone: {
						label: "Tone",
						values: {
							neutral: { label: "Neutral" },
						},
					},
				},
			},
			{ expectedRevision: created.revision },
		);

		await expect(
			updateSystemComponentDraft(
				projectRoot,
				systemHandle,
				created.componentId,
				{
					variants: {
						axes: {
							tone: {
								label: "Tone",
								values: {
									brand: { label: "Brand" },
									neutral: { label: "Neutral" },
								},
							},
						},
					},
				},
				{
					expectedRevision: firstEdit.revision,
					expectedDraftVariantSchemaHash,
				},
			),
		).rejects.toMatchObject({
			code: "DRAFT_HASH_MISMATCH",
		} satisfies Partial<SystemComponentOperationsError>);
	});
});
