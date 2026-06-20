import { describe, expect, it } from "vitest";
import {
	assertComponentIdKeyInvariant,
	createEmptySystemComponentManifest,
	generateSystemComponentId,
	isSystemComponentId,
	isSystemComponentSlug,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	SYSTEM_COMPONENT_MANIFEST_FILE_NAME,
	SYSTEM_COMPONENT_MANIFEST_VERSION,
	type SystemComponentRecord,
	SystemComponentManifestError,
} from "./system-components";

describe("system component manifest contract", () => {
	it("creates a deterministic empty manifest", () => {
		expect(createEmptySystemComponentManifest()).toEqual({
			version: SYSTEM_COMPONENT_MANIFEST_VERSION,
			metadata: {
				schemaVersion: SYSTEM_COMPONENT_MANIFEST_VERSION,
				createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
				updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
			},
			settings: {
				autoMigrateComponents: false,
			},
			migrationPolicy: {
				allowAutomaticMigration: false,
				maxAutomaticMigrationsPerRun: 100,
				requireExplicitReview: true,
				preserveDrafts: true,
			},
			components: {},
		});
		expect(createEmptySystemComponentManifest()).toEqual(
			createEmptySystemComponentManifest(),
		);
		expect(SYSTEM_COMPONENT_MANIFEST_FILE_NAME).toBe("components.json");
	});

	it("enforces componentId key invariants", () => {
		const componentId = generateSystemComponentId();
		const otherComponentId = generateSystemComponentId();

		const goodRecord: SystemComponentRecord = {
			componentId,
			slug: "primary-button",
			name: "Primary Button",
			createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
			updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
		};

		const records: Record<string, SystemComponentRecord> = {
			[componentId]: goodRecord,
		};

		expect(() => assertComponentIdKeyInvariant(records)).not.toThrow();

		expect(() =>
			assertComponentIdKeyInvariant({
				...records,
				[componentId]: {
					...goodRecord,
					componentId: otherComponentId,
				},
			}),
		).toThrow(SystemComponentManifestError);
		expect(() =>
			assertComponentIdKeyInvariant({
				...records,
				[componentId]: {
					...goodRecord,
					componentId: "",
				},
			}),
		).toThrow("missing componentId");
	});

	it("recognizes opaque component ids and slugs", () => {
		expect(isSystemComponentId(generateSystemComponentId())).toBe(true);
		expect(isSystemComponentId("core/button")).toBe(false);
		expect(isSystemComponentSlug("primary-button")).toBe(true);
		expect(isSystemComponentSlug("nested/invalid")).toBe(false);
	});
});
