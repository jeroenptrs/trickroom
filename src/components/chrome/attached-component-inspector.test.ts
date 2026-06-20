import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../../stores/design-store";
import { getSystemComponentMarkerProps } from "../../utils/system-component-markers";
import { hashSystemComponentVariantSchema } from "../../utils/system-components-validation";
import {
	attachedComponentVersionStatusLabel,
	canFreelyEditElementInDesignInspector,
	getAttachedComponentInspection,
	getAttachedComponentVersionStatus,
	getCurrentPublishedVersionForInstance,
	isAttachedComponentStaleStatus,
} from "./attached-component-inspector";

const entity = (
	id: string,
	props: DesignEntity["props"],
	parentId: string | null = null,
): DesignEntity => ({
	id,
	parentId,
	role: (props["data-trickroom-role"] as DesignEntity["role"]) ?? "branch",
	props,
	childIds: [],
});

const publishedVersion = {
	version: "1",
	publishedAt: "2026-05-26T14:00:00.000Z",
	templateHash: "sha256:new",
	variantSchemaHash: "sha256:new",
	root: {
		path: "root",
		library: "trickroom",
		component: "container",
	},
};

describe("attached-component-inspector", () => {
	const root = entity("root", {
		"data-trickroom-name": "Root",
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		...getSystemComponentMarkerProps({
			systemId: "sys-core",
			componentId: "cmp_11111111-1111-4111-8111-111111111111",
			instanceId: "instance-1",
			version: "1",
			path: "root",
			isRoot: true,
			variantValues: { tone: "brand" },
			templateHash: "sha256:old",
			variantSchemaHash: "sha256:old",
		}),
	});
	const label = entity(
		"label",
		{
			"data-trickroom-name": "Label",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "text",
			"data-trickroom-role": "text",
			...getSystemComponentMarkerProps({
				systemId: "sys-core",
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				instanceId: "instance-1",
				version: "1",
				path: "label",
			}),
		},
		"root",
	);
	const slotChild = entity(
		"slot-child",
		{
			"data-trickroom-name": "Slot Child",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "text",
			"data-trickroom-role": "text",
		},
		"slot-host",
	);
	const slotHost = entity(
		"slot-host",
		{
			"data-trickroom-name": "Slot",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			...getSystemComponentMarkerProps({
				systemId: "sys-core",
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				instanceId: "instance-1",
				version: "1",
				path: "slot",
				slotName: "default",
			}),
		},
		"root",
	);
	root.childIds = ["label", "slot-host"];
	slotHost.childIds = ["slot-child"];

	const entitiesById = {
		root,
		label,
		"slot-host": slotHost,
		"slot-child": slotChild,
	};

	it("detects attached roots and owned internals", () => {
		expect(getAttachedComponentInspection(entitiesById, root)).toEqual({
			kind: "root",
			instance: expect.objectContaining({
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				rootId: "root",
			}),
			rootElementId: "root",
		});
		expect(getAttachedComponentInspection(entitiesById, label)).toMatchObject({
			kind: "owned-internal",
			templatePath: "label",
		});
		expect(
			getAttachedComponentInspection(entitiesById, slotChild),
		).toMatchObject({
			kind: "slot-content",
			slot: expect.objectContaining({ slotName: "default" }),
		});
	});

	it("blocks free editing for component-owned structural nodes only", () => {
		expect(canFreelyEditElementInDesignInspector(entitiesById, root)).toBe(
			false,
		);
		expect(canFreelyEditElementInDesignInspector(entitiesById, label)).toBe(
			false,
		);
		expect(canFreelyEditElementInDesignInspector(entitiesById, slotHost)).toBe(
			false,
		);
		expect(canFreelyEditElementInDesignInspector(entitiesById, slotChild)).toBe(
			true,
		);
	});

	it("reports stale template and variant schema status", () => {
		expect(
			getAttachedComponentVersionStatus(root.props, {
				...publishedVersion,
				templateHash: "sha256:new",
				variantSchemaHash: "sha256:new",
			}),
		).toBe("stale-both");
	});

	it("treats pre-backfill variant hashes as current for migrated published schemas", () => {
		const oldVariants = {
			axes: {
				size: {
					label: "Size",
					values: {
						beta: { label: "Beta" },
						alpha: { label: "Alpha" },
					},
				},
			},
		};
		const migratedVariants = {
			...oldVariants,
			defaultValues: { size: "alpha" },
		};
		const legacyRoot = entity("legacy-root", {
			"data-trickroom-name": "Root",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			...getSystemComponentMarkerProps({
				systemId: "sys-core",
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				instanceId: "instance-1",
				version: "1",
				path: "root",
				isRoot: true,
				templateHash: "sha256:old",
				variantSchemaHash: hashSystemComponentVariantSchema(oldVariants),
			}),
		});

		expect(
			getAttachedComponentVersionStatus(legacyRoot.props, {
				...publishedVersion,
				templateHash: "sha256:old",
				variantSchemaHash: hashSystemComponentVariantSchema(migratedVariants),
				variants: migratedVariants,
			}),
		).toBe("current");
	});

	it("reports stale version status when the attached version is not current", () => {
		expect(
			getAttachedComponentVersionStatus(
				root.props,
				{
					...publishedVersion,
					version: "1",
					templateHash: "sha256:old",
					variantSchemaHash: "sha256:old",
				},
				"2",
			),
		).toBe("stale-version");
	});

	it("prefers hash review status over stale version when hashes are missing", () => {
		const propsWithoutHashes = entity("root-no-hash", {
			"data-trickroom-name": "Root",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			...getSystemComponentMarkerProps({
				systemId: "sys-core",
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				instanceId: "instance-1",
				version: "1",
				path: "root",
				isRoot: true,
			}),
		}).props;

		expect(
			getAttachedComponentVersionStatus(
				propsWithoutHashes,
				{
					...publishedVersion,
					version: "1",
					templateHash: "sha256:new",
					variantSchemaHash: "sha256:new",
				},
				"2",
			),
		).toBe("stale-both");
		expect(
			attachedComponentVersionStatusLabel(
				getAttachedComponentVersionStatus(
					propsWithoutHashes,
					{
						...publishedVersion,
						version: "1",
						templateHash: "sha256:new",
						variantSchemaHash: "sha256:new",
					},
					"2",
				),
			),
		).not.toBe("Update available");
	});

	it("detects stale statuses eligible for manual update", () => {
		expect(isAttachedComponentStaleStatus("stale-version")).toBe(true);
		expect(isAttachedComponentStaleStatus("stale-template")).toBe(true);
		expect(isAttachedComponentStaleStatus("current")).toBe(false);
		expect(isAttachedComponentStaleStatus("missing-component")).toBe(false);
	});

	it("labels missing component and version diagnostics for inspector display", () => {
		expect(attachedComponentVersionStatusLabel("missing-component")).toBe(
			"Component missing",
		);
		expect(attachedComponentVersionStatusLabel("missing-version")).toBe(
			"Published version missing",
		);
	});

	it("resolves the current published version for stale instance comparison", () => {
		expect(
			getCurrentPublishedVersionForInstance({
				componentId: "cmp_11111111-1111-4111-8111-111111111111",
				slug: "badge",
				name: "Badge",
				createdAt: "2026-05-26T14:00:00.000Z",
				updatedAt: "2026-05-26T14:00:00.000Z",
				published: {
					currentVersion: "2",
					versions: {
						"1": {
							...publishedVersion,
							version: "1",
							templateHash: "sha256:old",
							variantSchemaHash: "sha256:old",
						},
						"2": {
							...publishedVersion,
							version: "2",
							templateHash: "sha256:new",
							variantSchemaHash: "sha256:new",
						},
					},
				},
			})?.version,
		).toBe("2");
	});
});
