import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { createDesignSystemStorage } from "../utils/design-system-store";
import { expandResolvedSystemComponent } from "../utils/system-component-expansion";
import { getSystemComponentStructuralMetadata } from "../utils/system-component-markers";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	publishSystemComponentDraft,
	updateSystemComponentDraftTemplate,
} from "../utils/system-component-operations";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "../utils/system-components-validation";
import type { PublishedSystemComponentVersion } from "../utils/system-components";
import { applyMigrateSystemComponentInstance } from "./design-transform-service";

const instanceId = "instance-1";

const sourceVersionWithRootPath = (): PublishedSystemComponentVersion => {
	const root = {
		path: "root",
		library: "trickroom",
		component: "container",
		children: [],
	};
	const draft = { root, slots: {} };
	return {
		...draft,
		version: "1",
		publishedAt: "2026-05-26T12:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema({ axes: {} }),
	};
};

const targetVersionWithRenamedRootPath = (): PublishedSystemComponentVersion => {
	const root = {
		path: "card",
		library: "trickroom",
		component: "container",
		children: [],
	};
	const draft = { root, slots: {} };
	return {
		...draft,
		version: "2",
		publishedAt: "2026-05-26T13:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema({ axes: {} }),
	};
};

const expandStaleInstance = (
	resolvedSystemId: string,
	resolvedComponentId: string,
	source: PublishedSystemComponentVersion,
) => {
	const expansion = expandResolvedSystemComponent(
		{
			systemId: resolvedSystemId,
			componentId: resolvedComponentId,
			record: {
				componentId: resolvedComponentId,
				slug: "card",
				name: "Card",
				createdAt: "",
				updatedAt: "",
				published: {
					currentVersion: source.version,
					versions: { [source.version]: source },
				},
			},
			version: source,
		},
		{
			createInstanceId: () => instanceId,
			createElementId: () => crypto.randomUUID(),
		},
	);
	return expansion.root;
};

const findNode = (boards: readonly Node[], id: string): Node | null => {
	for (const board of boards) {
		const stack: Node[] = [board];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) {
				continue;
			}
			if (node.id === id) {
				return node;
			}
			if (Array.isArray(node.children)) {
				for (const child of node.children) {
					stack.push(child);
				}
			}
		}
	}
	return null;
};

describe("applyMigrateSystemComponentInstance", () => {
	let projectRoot: string;
	let manifestSystemId: string;
	let publishedComponentId: string;
	let staleRootId: string;
	let design: TrickroomDesign;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-migrate-instance-"),
		);
		const storage = await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/core.css",
		});
		manifestSystemId = storage.systemId;

		const source = sourceVersionWithRootPath();
		const target = targetVersionWithRenamedRootPath();
		const initial = await readSystemComponentManifest(projectRoot, manifestSystemId);
		const created = await createSystemComponentDraft(
			projectRoot,
			manifestSystemId,
			{ slug: "card", name: "Card" },
			{ expectedRevision: initial.revision, now: "2026-05-26T12:00:00.000Z" },
		);
		publishedComponentId = created.componentId;
		let manifestRevision = created.revision;
		const afterTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			manifestSystemId,
			created.componentId,
			source.root,
			{ expectedRevision: manifestRevision, now: "2026-05-26T12:00:00.000Z" },
		);
		manifestRevision = afterTemplate.revision;
		const publishedV1 = await publishSystemComponentDraft(
			projectRoot,
			manifestSystemId,
			created.componentId,
			{ expectedRevision: manifestRevision, now: "2026-05-26T12:00:00.000Z" },
		);
		manifestRevision = publishedV1.revision;

		const afterTargetTemplate = await updateSystemComponentDraftTemplate(
			projectRoot,
			manifestSystemId,
			created.componentId,
			target.root,
			{
				expectedRevision: manifestRevision,
				now: "2026-05-26T13:00:00.000Z",
			},
		);
		manifestRevision = afterTargetTemplate.revision;
		await publishSystemComponentDraft(
			projectRoot,
			manifestSystemId,
			created.componentId,
			{
				expectedRevision: manifestRevision,
				now: "2026-05-26T13:00:00.000Z",
			},
		);

		const staleRoot = expandStaleInstance(
			manifestSystemId,
			publishedComponentId,
			source,
		);
		staleRootId = staleRoot.id;
		design = {
			name: "Migrate Instance",
			systemId: manifestSystemId,
			boards: [staleRoot],
		};
	});

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true });
	});

	it("returns prospective migrated design and migrated root id for dry runs", async () => {
		const result = await applyMigrateSystemComponentInstance(design, {
			projectRoot,
			rootElementId: staleRootId,
			dryRun: true,
			onlySafe: false,
		});

		expect(result.applied).toBe(false);
		expect(result.outcome).toBe("dry-run-preview");
		expect(result.prospectiveDesign).toBeDefined();
		expect(result.rootElementId).not.toBe(staleRootId);
		expect(
			getSystemComponentStructuralMetadata(
				findNode(result.prospectiveDesign!.boards, result.rootElementId)!.props,
			)?.path,
		).toBe("card");

		const migratedRoot = findNode(
			result.prospectiveDesign!.boards,
			result.rootElementId,
		);
		expect(migratedRoot).not.toBeNull();
		expect(
			getSystemComponentStructuralMetadata(migratedRoot!.props),
		).toMatchObject({
			version: "2",
			path: "card",
			isRoot: true,
		});
		expect(findNode(result.design.boards, staleRootId)).not.toBeNull();
		expect(
			getSystemComponentStructuralMetadata(
				findNode(result.design.boards, staleRootId)!.props,
			)?.version,
		).toBe("1");
	});
});
