import { describe, expect, it } from "vitest";
import type { Node } from "../types";
import { expandResolvedSystemComponent } from "./system-component-expansion";
import { getSystemComponentMarkerProps } from "./system-component-markers";
import { FIXTURE_COMPONENT_ID } from "./system-component-test-fixtures";
import {
	isSystemComponentInstanceMigrationUpdateBlocked,
	previewSystemComponentInstanceMigration,
	SystemComponentInstanceMigrationError,
	updateStaleSystemComponentInstance,
} from "./system-component-instance-migration";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "./system-components-validation";
import type { PublishedSystemComponentVersion, SystemComponentRecord } from "./system-components";

const systemId = "sys-core";
const componentId = FIXTURE_COMPONENT_ID;

const sourceVersionV1 = (): PublishedSystemComponentVersion => {
	const root = {
		path: "root",
		library: "trickroom",
		component: "container",
		children: [],
	};
	const variants = {
		axes: {
			tone: {
				label: "Tone",
				defaultValue: "neutral",
				values: {
					brand: { classesByPath: { root: "tone-brand" } },
					neutral: { classesByPath: { root: "tone-neutral" } },
				},
			},
		},
	};
	const draft = { root, variants };
	return {
		...draft,
		version: "1",
		publishedAt: "2026-05-26T12:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema(variants),
	};
};

const targetVersionV2 = (): PublishedSystemComponentVersion => {
	const root = {
		path: "root",
		library: "trickroom",
		component: "container",
		className: "card-v2",
		children: [],
	};
	const variants = {
		axes: {
			tone: {
				label: "Tone",
				defaultValue: "neutral",
				values: {
					brand: { classesByPath: { root: "tone-brand" } },
					neutral: { classesByPath: { root: "tone-neutral" } },
				},
			},
		},
	};
	const draft = { root, variants };
	return {
		...draft,
		version: "2",
		previousVersion: "1",
		publishedAt: "2026-05-26T13:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema(variants),
	};
};

const createRecord = (
	source: PublishedSystemComponentVersion,
	target: PublishedSystemComponentVersion,
): SystemComponentRecord => ({
	componentId,
	slug: "fixture",
	name: "Fixture",
	createdAt: "2026-05-26T12:00:00.000Z",
	updatedAt: "2026-05-26T13:00:00.000Z",
	published: {
		currentVersion: target.version,
		versions: {
			[source.version]: source,
			[target.version]: target,
		},
	},
});

const expandStaleRoot = (
	source: PublishedSystemComponentVersion,
	overrides: Partial<Parameters<typeof expandResolvedSystemComponent>[1]> = {},
) => {
	const expanded = expandResolvedSystemComponent(
		{
			systemId,
			componentId,
			record: createRecord(source, targetVersionV2()),
			version: source,
		},
		{
			variantValues: { tone: "brand" },
			...overrides,
		},
	);
	return expanded.root;
};

describe("system-component-instance-migration", () => {
	it("previews review diagnostics before applying a risky migration", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			slots: {},
		};
		const staleRoot = expandStaleRoot(source, {
			variantValues: { tone: "brand" },
		});
		staleRoot.props = {
			...staleRoot.props,
			...getSystemComponentMarkerProps({
				systemId,
				componentId,
				instanceId: "instance-1",
				version: source.version,
				path: "root",
				isRoot: true,
				templateHash: "sha256:stale",
				variantSchemaHash: "sha256:stale",
				variantValues: { tone: "brand" },
			}),
		};

		const preview = previewSystemComponentInstanceMigration(
			[staleRoot],
			staleRoot.id,
			{
				systemId,
				componentId,
				record: createRecord(source, target),
				sourceVersion: source,
				targetVersion: target,
			},
		);

		expect(preview.classification.safety).toBe("requires-review");
		expect(preview.classification.diagnostics.length).toBeGreaterThan(0);
		expect(preview.blocked).toBe(false);
	});

	it("updates a stale instance to the current published version", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleRoot(source);
		staleRoot.props = {
			...staleRoot.props,
			...getSystemComponentMarkerProps({
				systemId,
				componentId,
				instanceId: "instance-1",
				version: source.version,
				path: "root",
				isRoot: true,
				templateHash: "sha256:stale",
				variantSchemaHash: "sha256:stale",
			}),
		};

		const result = updateStaleSystemComponentInstance(
			[staleRoot],
			staleRoot.id,
			{
				systemId,
				componentId,
				record: createRecord(source, target),
				sourceVersion: source,
				targetVersion: target,
			},
		);

		expect(result.metadata.toVersion).toBe("2");
		expect(result.metadata.fromVersion).toBe("1");
		const migratedRoot = result.roots[0] as Node;
		expect(
			migratedRoot.props?.["data-trickroom-system-component-version"],
		).toBe("2");
		expect(
			migratedRoot.props?.["data-trickroom-system-component-template-hash"],
		).toBe(target.templateHash);
		expect(
			migratedRoot.props?.[
				"data-trickroom-system-component-variant-schema-hash"
			],
		).toBe(target.variantSchemaHash);
	});

	it("stamps hash markers for a current-version instance with missing hashes", () => {
		const source = sourceVersionV1();
		const target = source;
		const currentRoot = expandStaleRoot(source);
		const {
			"data-trickroom-system-component-template-hash": _templateHash,
			"data-trickroom-system-component-variant-schema-hash": _variantSchemaHash,
			...propsWithoutHashes
		} = currentRoot.props ?? {};
		currentRoot.props = {
			...propsWithoutHashes,
			...getSystemComponentMarkerProps({
				systemId,
				componentId,
				instanceId: "instance-1",
				version: source.version,
				path: "root",
				isRoot: true,
				variantValues: { tone: "brand" },
			}),
		};

		const migrationInput = {
			systemId,
			componentId,
			record: createRecord(source, target),
			sourceVersion: source,
			targetVersion: target,
		};
		const preview = previewSystemComponentInstanceMigration(
			[currentRoot],
			currentRoot.id,
			migrationInput,
		);

		expect(
			preview.classification.diagnostics.some(
				(diagnostic) => diagnostic.code === "MISSING_HISTORY",
			),
		).toBe(false);

		const result = updateStaleSystemComponentInstance(
			[currentRoot],
			currentRoot.id,
			migrationInput,
		);

		const migratedRoot = result.roots[0] as Node;
		expect(
			migratedRoot.props?.["data-trickroom-system-component-template-hash"],
		).toBe(source.templateHash);
		expect(
			migratedRoot.props?.[
				"data-trickroom-system-component-variant-schema-hash"
			],
		).toBe(source.variantSchemaHash);
	});

	it("refuses to update an already current instance", () => {
		const source = sourceVersionV1();
		const target = source;
		const currentRoot = expandStaleRoot(source);
		currentRoot.props = {
			...currentRoot.props,
			...getSystemComponentMarkerProps({
				systemId,
				componentId,
				instanceId: "instance-1",
				version: source.version,
				path: "root",
				isRoot: true,
				templateHash: source.templateHash,
				variantSchemaHash: source.variantSchemaHash,
			}),
		};

		expect(() =>
			updateStaleSystemComponentInstance([currentRoot], currentRoot.id, {
				systemId,
				componentId,
				record: createRecord(source, target),
				sourceVersion: source,
				targetVersion: target,
			}),
		).toThrowError(
			expect.objectContaining<SystemComponentInstanceMigrationError>({
				code: "INSTANCE_NOT_STALE",
			}),
		);
	});

	it("blocks manual update when migration preview is unavailable or not applicable", () => {
		expect(isSystemComponentInstanceMigrationUpdateBlocked(null)).toBe(true);
		expect(
			isSystemComponentInstanceMigrationUpdateBlocked({
				classification: {
					safety: "safe",
					automatic: true,
					diagnostics: [],
				},
				migrationDiagnostics: [],
				blocked: false,
				blockMessage: "Element not found.",
			}),
		).toBe(true);
		expect(
			isSystemComponentInstanceMigrationUpdateBlocked({
				classification: {
					safety: "safe",
					automatic: true,
					diagnostics: [],
				},
				migrationDiagnostics: [],
				blocked: true,
				blockMessage: "Unsafe migration.",
			}),
		).toBe(true);
		expect(
			isSystemComponentInstanceMigrationUpdateBlocked({
				classification: {
					safety: "requires-review",
					automatic: false,
					diagnostics: [],
				},
				migrationDiagnostics: [],
				blocked: false,
			}),
		).toBe(false);
	});
});
