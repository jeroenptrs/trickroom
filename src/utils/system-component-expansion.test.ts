import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node } from "../types";
import { createDesignSystemStorage } from "./design-system-store";
import {
	expandPublishedSystemComponentVersion,
	expandResolvedSystemComponent,
	resolvePublishedSystemComponentVersion,
	resolveSystemComponentClassName,
	resolveSystemComponentVariantValues,
} from "./system-component-expansion";
import { readSystemComponentManifest } from "./system-component-manifest-service";
import type { SystemComponentManifestRevision } from "./system-component-manifest-service";
import {
	createSystemComponentDraft,
	publishSystemComponentDraft,
	updateSystemComponentDraftOverrideTargets,
	updateSystemComponentDraftSlots,
	updateSystemComponentDraftTemplate,
	updateSystemComponentDraftVariants,
} from "./system-component-operations";
import {
	getSystemComponentStructuralMetadata,
	systemComponentInstanceProp,
} from "./system-component-markers";
import {
	getElementSystemComponentMetadata,
	getSystemComponentOwnedStructuralIds,
	isSystemComponentRoot,
	isSystemComponentSlotContent,
	isSystemComponentSlotHost,
} from "./system-component-ownership";

const componentId = "cmp_11111111-1111-4111-8111-111111111111";

describe("system component expansion", () => {
	it("resolves variant defaults and deterministic class stacks", () => {
		const version = {
			version: "1",
			publishedAt: "2026-05-26T14:00:00.000Z",
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				className: "base",
			},
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "text-blue-600" } },
							neutral: { classesByPath: { root: "text-zinc-700" } },
						},
					},
					size: {
						label: "Size",
						defaultValue: "sm",
						values: {
							lg: { classesByPath: { root: "text-lg" } },
							sm: { classesByPath: { root: "text-sm" } },
						},
					},
				},
				defaultValues: { tone: "brand" },
				compoundVariants: [
					{
						when: { tone: "brand", size: "sm" },
						classesByPath: { root: "font-semibold" },
					},
				],
			},
			overrideTargets: {
				rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
			},
		};

		const variantValues = resolveSystemComponentVariantValues(
			version.variants,
			{},
		);
		expect(variantValues).toEqual({ size: "sm", tone: "brand" });
		expect(
			resolveSystemComponentClassName(
				version,
				"root",
				version.root.className,
				variantValues,
				{ rootTarget: { className: "tracking-wide" } },
			),
		).toBe("base text-sm text-blue-600 font-semibold tracking-wide");
	});

	it("expands a resolved published component into marked nodes", () => {
		const version = {
			version: "1",
			publishedAt: "2026-05-26T14:00:00.000Z",
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Label",
					},
					{
						path: "body",
						library: "trickroom",
						component: "container",
					},
				],
			},
			slots: {
				default: {
					name: "default",
					hostPath: "body",
					defaultChildren: [
						{
							path: "fallback",
							library: "trickroom",
							component: "text",
							text: "Fallback",
						},
					],
				},
			},
		};

		let nextId = 0;
		const result = expandResolvedSystemComponent(
			{
				systemId: "sys-core",
				componentId,
				record: {
					componentId,
					slug: "badge",
					name: "Badge",
					createdAt: "",
					updatedAt: "",
					published: { currentVersion: "1", versions: { "1": version } },
				},
				version,
			},
			{
				createInstanceId: () => "instance-1",
				createElementId: () => `node-${++nextId}`,
			},
		);

		expect(result.elementIdsByPath).toEqual({
			root: "node-1",
			label: "node-2",
			body: "node-3",
		});
		const rootMetadata = getSystemComponentStructuralMetadata(
			result.root.props,
		);
		expect(rootMetadata).toMatchObject({
			systemId: "sys-core",
			componentId,
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
			templateHash: "sha256:template",
			variantSchemaHash: "sha256:variants",
		});
		const body = (result.root.children as Node[])[1];
		expect(getElementSystemComponentMetadata(body)).toMatchObject({
			path: "body",
			slotName: "default",
		});
		const fallback = (body.children as Node[])[0];
		expect(getElementSystemComponentMetadata(fallback)).toBeNull();
	});

	it("rejects invalid instance state", () => {
		expect(() =>
			resolveSystemComponentVariantValues(
				{
					axes: {
						size: {
							label: "Size",
							values: { sm: {} },
						},
					},
				},
				{ tone: "brand" },
			),
		).toThrow(
			expect.objectContaining({
				code: "INVALID_INSTANCE_STATE",
			}),
		);
	});
});

describe("system component resolver", () => {
	let projectRoot: string;
	let systemId: string;
	let revision: SystemComponentManifestRevision;
	const now = "2026-05-26T14:00:00.000Z";

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-component-expansion-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		systemId = storage.systemId;
		const initial = await readSystemComponentManifest(projectRoot, systemId);
		revision = initial.revision;
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("resolves and expands a published version without static recipe lookup", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "card", name: "Card" },
			{ expectedRevision: revision, now },
		);
		const afterTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			systemId,
			created.componentId,
			{
				path: "root",
				library: "trickroom",
				component: "container",
				className: "card",
				children: [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						text: "Card",
						className: "label",
					},
				],
			},
			{ expectedRevision: created.revision, now },
		);
		const afterSlots = await updateSystemComponentDraftSlots(
			projectRoot,
			systemId,
			created.componentId,
			{
				default: {
					name: "default",
					hostPath: "root",
					defaultChildren: [
						{
							path: "fallback",
							library: "trickroom",
							component: "text",
							text: "Fallback",
						},
					],
				},
			},
			{ expectedRevision: afterTemplate.revision, now },
		);
		const afterVariants = await updateSystemComponentDraftVariants(
			projectRoot,
			systemId,
			created.componentId,
			{
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "neutral",
						values: {
							brand: { classesByPath: { root: "brand", label: "label-brand" } },
							neutral: { classesByPath: { root: "neutral" } },
						},
					},
				},
			},
			{ expectedRevision: afterSlots.revision, now },
		);
		const afterTargets = await updateSystemComponentDraftOverrideTargets(
			projectRoot,
			systemId,
			created.componentId,
			{
				rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
			},
			{ expectedRevision: afterVariants.revision, now },
		);
		const published = await publishSystemComponentDraft(
			projectRoot,
			systemId,
			created.componentId,
			{ expectedRevision: afterTargets.revision, now },
		);

		const resolved = await resolvePublishedSystemComponentVersion(
			projectRoot,
			systemId,
			created.componentId,
			published.publishedVersion,
		);
		expect(resolved.version.version).toBe("1");

		const expansion = await expandPublishedSystemComponentVersion(
			projectRoot,
			systemId,
			created.componentId,
			"1",
			{
				createInstanceId: () => "instance-1",
				createElementId: () => crypto.randomUUID(),
				variantValues: { tone: "brand" },
				overrides: { rootTarget: { className: "rounded-md" } },
			},
		);
		expect(expansion.variantValues).toEqual({ tone: "brand" });
		expect(expansion.root.props.className).toBe("card brand rounded-md");
		expect(expansion.root.props[systemComponentInstanceProp]).toBe(
			"instance-1",
		);
	});

	it("resolves the current published version when version is omitted", async () => {
		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "badge", name: "Badge" },
			{ expectedRevision: revision, now },
		);
		const published = await publishSystemComponentDraft(
			projectRoot,
			systemId,
			created.componentId,
			{ expectedRevision: created.revision, now },
		);

		const resolved = await resolvePublishedSystemComponentVersion(
			projectRoot,
			systemId,
			created.componentId,
		);
		expect(resolved.version.version).toBe(published.publishedVersion);
	});

	it("reports explicit unknown system, component, and version errors", async () => {
		await expect(
			resolvePublishedSystemComponentVersion(
				projectRoot,
				"missing-system",
				componentId,
				"1",
			),
		).rejects.toThrow(expect.objectContaining({ code: "UNKNOWN_SYSTEM" }));

		await expect(
			resolvePublishedSystemComponentVersion(
				projectRoot,
				systemId,
				componentId,
				"1",
			),
		).rejects.toThrow(expect.objectContaining({ code: "UNKNOWN_COMPONENT" }));

		const created = await createSystemComponentDraft(
			projectRoot,
			systemId,
			{ slug: "badge", name: "Badge" },
			{ expectedRevision: revision, now },
		);
		await expect(
			resolvePublishedSystemComponentVersion(
				projectRoot,
				systemId,
				created.componentId,
				"1",
			),
		).rejects.toThrow(expect.objectContaining({ code: "UNKNOWN_VERSION" }));
	});

	it("identifies roots, owned internals, structural ids, and slot content", () => {
		const entities = {
			root: {
				id: "root",
				parentId: null,
				props: {
					"data-trickroom-name": "Root",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					...{
						"data-trickroom-system-component-system-id": "sys",
						"data-trickroom-system-component-id": componentId,
						"data-trickroom-system-component-instance": "instance-1",
						"data-trickroom-system-component-version": "1",
						"data-trickroom-system-component-path": "root",
						"data-trickroom-system-component-root": "true",
					},
				},
				childIds: ["slot"],
			},
			slot: {
				id: "slot",
				parentId: "root",
				props: {
					"data-trickroom-name": "Slot",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					...{
						"data-trickroom-system-component-system-id": "sys",
						"data-trickroom-system-component-id": componentId,
						"data-trickroom-system-component-instance": "instance-1",
						"data-trickroom-system-component-version": "1",
						"data-trickroom-system-component-path": "slot",
						"data-trickroom-system-component-slot": "default",
					},
				},
				childIds: ["child"],
			},
			child: {
				id: "child",
				parentId: "slot",
				props: {
					"data-trickroom-name": "Child",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
				},
			},
		};

		expect(isSystemComponentRoot(entities.root)).toBe(true);
		expect(isSystemComponentSlotHost(entities.slot)).toBe(true);
		expect(isSystemComponentSlotContent(entities, "child")).toBe(true);
		expect(
			getSystemComponentOwnedStructuralIds(entities, "instance-1"),
		).toEqual(["root", "slot"]);
	});
});
