import { describe, expect, it } from "vitest";
import {
	complexComponentTemplateRoot,
	createFixturePublishedRecord,
	FIXTURE_COMPONENT_ID,
	FIXTURE_OTHER_COMPONENT_ID,
	minimalComponentTemplateRoot,
} from "./system-component-test-fixtures";
import {
	systemComponentDraftInputDiagnosticsFromZodError,
	systemComponentDraftPayloadSchema,
} from "./system-component-draft-schemas";
import {
	createEmptySystemComponentManifest,
	generateSystemComponentId,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	type SystemComponentManifest,
	type SystemComponentRecord,
} from "./system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
	validateSystemComponentManifest,
} from "./system-components-validation";

const COMPONENT_ID = FIXTURE_COMPONENT_ID;
const OTHER_COMPONENT_ID = FIXTURE_OTHER_COMPONENT_ID;

const minimalRoot = minimalComponentTemplateRoot;
const complexRoot = complexComponentTemplateRoot;

const createRecord = (
	overrides: Partial<SystemComponentRecord> = {},
): SystemComponentRecord => ({
	componentId: COMPONENT_ID,
	slug: "primary-button",
	name: "Primary Button",
	createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	draft: {
		root: minimalRoot(),
	},
	...overrides,
});

const withComponents = (
	components: Record<string, SystemComponentRecord>,
): SystemComponentManifest => ({
	...createEmptySystemComponentManifest(),
	components,
});

describe("system component manifest validation and hashing", () => {
	it("accepts a valid minimal manifest", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord(),
			}),
		);

		expect(result.valid).toBe(true);
		expect(result.diagnostics).toEqual([]);
	});

	it("accepts a valid complex manifest with published version hashes", () => {
		const root = complexRoot();
		const variants = {
			axes: {
				size: {
					label: "Size",
					values: {
						sm: { classesByPath: { root: "text-sm" } },
						lg: { classesByPath: { label: "text-lg" } },
					},
				},
			},
			compoundVariants: [
				{
					when: { size: "lg" },
					classesByPath: { icon: "size-6" },
				},
			],
		};
		const draft = {
			root,
			slots: {
				default: {
					name: "default",
					hostPath: "icon",
				},
			},
			variants,
			overrideTargets: {
				labelTarget: {
					targetId: "labelTarget",
					label: "Label",
					path: "label",
				},
			},
		};
		const publishedVersion = {
			...draft,
			version: "1",
			publishedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
			templateHash: hashSystemComponentTemplate(draft),
			variantSchemaHash: hashSystemComponentVariantSchema(variants),
		};

		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft,
					published: {
						currentVersion: "1",
						versions: {
							"1": publishedVersion,
						},
					},
				}),
			}),
			{ verifyPublishedHashes: true },
		);

		expect(result.valid).toBe(true);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "COMPOUND_INSUFFICIENT_CONDITIONS",
					severity: "warning",
				}),
			]),
		);
	});

	it("reports compound variant shape diagnostics", () => {
		const root = minimalRoot();
		const variants = {
			axes: {
				tone: {
					label: "Tone",
					values: { brand: { classesByPath: { root: "text-blue-600" } } },
				},
				size: {
					label: "Size",
					values: { lg: { classesByPath: { root: "h-6" } } },
				},
			},
			compoundVariants: [
				{ when: {}, classesByPath: { root: "always" } },
				{
					when: { tone: ["brand"], size: "lg" },
					classesByPath: {},
				},
				{
					when: { tone: "brand", size: "lg" },
					classesByPath: { root: "ring-2" },
				},
				{
					when: { size: "lg", tone: "brand" },
					classesByPath: { root: "ring-4" },
				},
				{
					when: { tone: "brand", missing: "x" },
					classesByPath: { root: "ring-8" },
				},
			],
		};

		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: { root, variants },
				}),
			}),
		);

		expect(result.valid).toBe(true);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(
			expect.arrayContaining([
				"COMPOUND_EMPTY_WHEN",
				"COMPOUND_ARRAY_VALUE",
				"COMPOUND_DUPLICATE_SIGNATURE",
				"COMPOUND_EMPTY_CLASSES_BY_PATH",
				"COMPOUND_UNKNOWN_AXIS",
			]),
		);
	});

	it("reports invalid variant default references", () => {
		const root = minimalRoot();
		const variants = {
			axes: {
				tone: {
					label: "Tone",
					defaultValue: "missing-axis-default",
					values: {
						brand: { classesByPath: { root: "text-blue-600" } },
					},
				},
				size: {
					label: "Size",
					values: {
						sm: { classesByPath: { root: "text-sm" } },
					},
				},
			},
			defaultValues: {
				tone: "missing-schema-default",
				missingAxis: "anything",
			},
		};

		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: { root, variants },
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_VARIANT_DEFAULT_VALUE",
					severity: "error",
					path: "tone",
					message: expect.stringContaining("defaultValue"),
				}),
				expect.objectContaining({
					code: "INVALID_VARIANT_DEFAULT_VALUE",
					severity: "error",
					path: "tone",
					message: expect.stringContaining("variants.defaultValues"),
				}),
				expect.objectContaining({
					code: "INVALID_VARIANT_DEFAULT_VALUE",
					severity: "error",
					path: "missingAxis",
					message: expect.stringContaining("unknown axis"),
				}),
			]),
		);
	});

	it("reports draft schema diagnostics for empty compound when values and class strings", () => {
		const parsed = systemComponentDraftPayloadSchema.safeParse({
			root: minimalRoot(),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: { classesByPath: { root: "" } },
						},
					},
				},
				compoundVariants: [
					{
						when: {
							tone: "",
							size: [],
							density: [""],
						},
						classesByPath: { root: "" },
					},
				],
			},
		});

		expect(parsed.success).toBe(false);
		if (parsed.success) {
			return;
		}
		const diagnostics = systemComponentDraftInputDiagnosticsFromZodError(
			parsed.error,
		);
		const paths = diagnostics.map((diagnostic) => diagnostic.path);

		expect(paths).toEqual(
			expect.arrayContaining([
				"variants.axes.tone.values.brand.classesByPath.root",
				"variants.compoundVariants[0].when.tone",
				"variants.compoundVariants[0].when.size",
				"variants.compoundVariants[0].when.density[0]",
				"variants.compoundVariants[0].classesByPath.root",
			]),
		);
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
					severity: "error",
				}),
			]),
		);
	});

	it("reports record key drift", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[OTHER_COMPONENT_ID]: createRecord(),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					message: expect.stringContaining("must match component.componentId"),
				}),
			]),
		);
	});

	it("reports duplicate slugs", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({ slug: "shared-slug" }),
				[OTHER_COMPONENT_ID]: createRecord({
					componentId: OTHER_COMPONENT_ID,
					slug: "shared-slug",
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "DUPLICATE_COMPONENT_SLUG",
					severity: "error",
				}),
			]),
		);
	});

	it("reports invalid template paths", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: {
						root: {
							...minimalRoot(),
							children: [
								{
									path: "nested/invalid",
									library: "trickroom",
									component: "text",
								},
							],
						},
					},
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_TEMPLATE_PATH",
					path: "nested/invalid",
				}),
			]),
		);
	});

	it("reports invalid slot host paths and unstable slot names", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: {
						root: minimalRoot(),
						slots: {
							content: {
								name: "renamed",
								hostPath: "missing",
							},
						},
					},
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_SLOT_DEFINITION",
				}),
				expect.objectContaining({
					code: "INVALID_SLOT_HOST_PATH",
					path: "missing",
				}),
			]),
		);
	});

	it("reports invalid override target ids and paths", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: {
						root: minimalRoot(),
						overrideTargets: {
							card: {
								targetId: "panel",
								label: "Panel",
								path: "missing",
							},
						},
					},
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_OVERRIDE_TARGET_ID",
					path: "missing",
				}),
				expect.objectContaining({
					code: "INVALID_OVERRIDE_TARGET_PATH",
					path: "missing",
				}),
			]),
		);
	});

	it("reports invalid root identity", () => {
		const root = minimalRoot();
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					draft: {
						root: {
							...root,
							children: [
								{
									path: root.path,
									library: "trickroom",
									component: "text",
								},
							],
						},
					},
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_TEMPLATE_ROOT",
				}),
				expect.objectContaining({
					code: "INVALID_TEMPLATE_PATH",
				}),
			]),
		);
	});

	it("reports invalid current version", () => {
		const draft = { root: minimalRoot() };
		const result = validateSystemComponentManifest(
			withComponents({
				[COMPONENT_ID]: createRecord({
					published: {
						currentVersion: "missing",
						versions: {
							"1": {
								...draft,
								version: "1",
								publishedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
								templateHash: hashSystemComponentTemplate(draft),
								variantSchemaHash: hashSystemComponentVariantSchema(),
							},
						},
					},
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "INVALID_CURRENT_VERSION",
				}),
			]),
		);
	});

	it("rejects opaque-id-looking slugs and display-name component ids", () => {
		const result = validateSystemComponentManifest(
			withComponents({
				"core/button": createRecord({
					componentId: "core/button",
					slug: "cmp_not-a-real-id",
				}),
			}),
		);

		expect(result.valid).toBe(false);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "INVALID_COMPONENT_ID" }),
				expect.objectContaining({ code: "INVALID_COMPONENT_SLUG" }),
			]),
		);
	});

	it("produces stable hashes across object key ordering", () => {
		const root = minimalRoot();
		const leftSlots = {
			b: { name: "b", hostPath: "root" },
			a: { name: "a", hostPath: "root" },
		};
		const rightSlots = {
			a: { name: "a", hostPath: "root" },
			b: { name: "b", hostPath: "root" },
		};

		const leftVariants = {
			axes: {
				z: {
					label: "Z",
					values: {
						one: { classesByPath: { b: "z-1", a: "z-2" } },
					},
				},
			},
		};
		const rightVariants = {
			axes: {
				z: {
					label: "Z",
					values: {
						one: { classesByPath: { a: "z-2", b: "z-1" } },
					},
				},
			},
		};

		expect(hashSystemComponentTemplate({ root, slots: leftSlots })).toBe(
			hashSystemComponentTemplate({ root, slots: rightSlots }),
		);
		expect(hashSystemComponentVariantSchema(leftVariants)).toBe(
			hashSystemComponentVariantSchema(rightVariants),
		);
	});

	it("generates opaque component ids", () => {
		expect(generateSystemComponentId()).toMatch(
			/^cmp_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
		);
	});

	it("accepts complex published fixture manifests", () => {
		const record = createFixturePublishedRecord();
		const result = validateSystemComponentManifest(
			withComponents({
				[record.componentId]: record,
			}),
		);

		expect(result.valid).toBe(true);
		expect(result.diagnostics).toEqual([]);
	});
});
