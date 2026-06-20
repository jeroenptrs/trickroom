import { describe, expect, it } from "vitest";
import {
	advanceCompoundDraftKeys,
	advanceVariantDraftSchemaKeys,
	type CompoundVariantDraft,
	evaluateComponentDraftServerConflict,
	resolveVariantDraftSeedSource,
	schemaToCompoundDrafts,
	type VariantAxisDraft,
	validateSystemComponentMetadataSlug,
	validateVariantDrafts,
	variantDraftsToSchema,
} from "./SystemEditorInspector";

const twoAxisDrafts = (): VariantAxisDraft[] => [
	{
		id: "axis-tone",
		key: "tone",
		label: "Tone",
		defaultValue: "",
		schemaDefaultValue: "",
		values: [{ id: "v-brand", key: "brand", label: "Brand" }],
	},
	{
		id: "axis-size",
		key: "size",
		label: "Size",
		defaultValue: "",
		schemaDefaultValue: "",
		values: [{ id: "v-lg", key: "lg", label: "Large" }],
	},
];

describe("variantDraftsToSchema", () => {
	it("preserves classesByPath when axis and value keys are renamed", () => {
		const drafts: VariantAxisDraft[] = [
			{
				id: "axis-1",
				key: "intent",
				originalKey: "tone",
				label: "Intent",
				defaultValue: "primary",
				schemaDefaultValue: "primary",
				values: [
					{
						id: "value-1",
						key: "primary",
						originalKey: "brand",
						label: "Primary",
					},
				],
			},
		];

		expect(
			variantDraftsToSchema(drafts, {
				axes: {
					tone: {
						label: "Tone",
						values: {
							brand: {
								label: "Brand",
								classesByPath: { root: "text-blue-600" },
							},
						},
					},
				},
			}),
		).toEqual({
			axes: {
				intent: {
					label: "Intent",
					defaultValue: "primary",
					values: {
						primary: {
							label: "Primary",
							classesByPath: { root: "text-blue-600" },
						},
					},
				},
			},
			defaultValues: { intent: "primary" },
		});
	});

	it("preserves classesByPath through repeated unsaved axis and value renames", () => {
		const firstDrafts: VariantAxisDraft[] = [
			{
				id: "axis-1",
				key: "intent",
				originalKey: "tone",
				label: "Intent",
				defaultValue: "primary",
				schemaDefaultValue: "primary",
				values: [
					{
						id: "value-1",
						key: "primary",
						originalKey: "brand",
						label: "Primary",
					},
				],
			},
		];
		const originalSchema = {
			axes: {
				tone: {
					label: "Tone",
					values: {
						brand: {
							label: "Brand",
							classesByPath: { root: "text-blue-600" },
						},
					},
				},
			},
		};

		const firstSchema = variantDraftsToSchema(firstDrafts, originalSchema);
		const advancedDrafts = advanceVariantDraftSchemaKeys(
			firstDrafts,
			firstSchema,
		);
		const secondDrafts: VariantAxisDraft[] = advancedDrafts.map((axis) => ({
			...axis,
			key: "appearance",
			label: "Appearance",
			defaultValue: "accent",
			schemaDefaultValue: "accent",
			values: axis.values.map((value) => ({
				...value,
				key: "accent",
				label: "Accent",
			})),
		}));

		expect(variantDraftsToSchema(secondDrafts, firstSchema)).toEqual({
			axes: {
				appearance: {
					label: "Appearance",
					defaultValue: "accent",
					values: {
						accent: {
							label: "Accent",
							classesByPath: { root: "text-blue-600" },
						},
					},
				},
			},
			defaultValues: { appearance: "accent" },
		});
	});

	it("keeps prior schema keys when draft keys are blank during editing", () => {
		const drafts: VariantAxisDraft[] = [
			{
				id: "axis-1",
				key: "",
				originalKey: "intent",
				label: "Intent",
				defaultValue: "",
				schemaDefaultValue: "",
				values: [
					{
						id: "value-1",
						key: "",
						originalKey: "primary",
						label: "Primary",
					},
				],
			},
		];

		expect(advanceVariantDraftSchemaKeys(drafts, null)).toEqual(drafts);
	});
});

describe("evaluateComponentDraftServerConflict", () => {
	it("does not report a conflict when server hashes match the saved baseline after dirty-skipped hydrate", () => {
		expect(
			evaluateComponentDraftServerConflict({
				dirtyDraftMatchesComponent: true,
				templateDirty: false,
				variantsDirty: true,
				serverDraftTemplateHash: "sha256:template-after-save",
				serverDraftVariantSchemaHash: "sha256:variants-after-save",
				loadedDraftTemplateHash: "sha256:template-after-save",
				loadedDraftVariantSchemaHash: "sha256:variants-after-save",
			}),
		).toEqual({
			serverDraftChanged: false,
			hasConflict: false,
			adoptTemplateBaseline: false,
			adoptVariantSchemaBaseline: false,
		});
	});

	it("reports a conflict when the server changed a dimension we are actively editing", () => {
		expect(
			evaluateComponentDraftServerConflict({
				dirtyDraftMatchesComponent: true,
				templateDirty: true,
				variantsDirty: false,
				serverDraftTemplateHash: "sha256:template-external",
				serverDraftVariantSchemaHash: "sha256:variants-baseline",
				loadedDraftTemplateHash: "sha256:template-baseline",
				loadedDraftVariantSchemaHash: "sha256:variants-baseline",
			}),
		).toEqual({
			serverDraftChanged: true,
			hasConflict: true,
			adoptTemplateBaseline: false,
			adoptVariantSchemaBaseline: false,
		});
	});

	it("adopts the new template baseline (no conflict) when a template-only save advances the server template hash while only variants are dirty", () => {
		expect(
			evaluateComponentDraftServerConflict({
				dirtyDraftMatchesComponent: true,
				templateDirty: false,
				variantsDirty: true,
				serverDraftTemplateHash: "sha256:template-after-template-save",
				serverDraftVariantSchemaHash: "sha256:variants-baseline",
				loadedDraftTemplateHash: "sha256:template-baseline",
				loadedDraftVariantSchemaHash: "sha256:variants-baseline",
			}),
		).toEqual({
			serverDraftChanged: true,
			hasConflict: false,
			adoptTemplateBaseline: true,
			adoptVariantSchemaBaseline: false,
		});
	});

	it("reports a conflict when the server variant schema changed while variant edits remain dirty", () => {
		expect(
			evaluateComponentDraftServerConflict({
				dirtyDraftMatchesComponent: true,
				templateDirty: false,
				variantsDirty: true,
				serverDraftTemplateHash: "sha256:template-baseline",
				serverDraftVariantSchemaHash: "sha256:variants-external",
				loadedDraftTemplateHash: "sha256:template-baseline",
				loadedDraftVariantSchemaHash: "sha256:variants-baseline",
			}),
		).toEqual({
			serverDraftChanged: true,
			hasConflict: true,
			adoptTemplateBaseline: false,
			adoptVariantSchemaBaseline: false,
		});
	});

	it("reports a conflict when the dirty draft belongs to another component", () => {
		expect(
			evaluateComponentDraftServerConflict({
				dirtyDraftMatchesComponent: false,
				templateDirty: false,
				variantsDirty: true,
				serverDraftTemplateHash: "sha256:template",
				serverDraftVariantSchemaHash: "sha256:variants",
				loadedDraftTemplateHash: "sha256:template",
				loadedDraftVariantSchemaHash: "sha256:variants",
			}),
		).toEqual({
			serverDraftChanged: false,
			hasConflict: true,
			adoptTemplateBaseline: false,
			adoptVariantSchemaBaseline: false,
		});
	});
});

describe("validateSystemComponentMetadataSlug", () => {
	it("trims valid component metadata slugs", () => {
		expect(validateSystemComponentMetadataSlug(" primary-button ")).toBe(
			"primary-button",
		);
	});

	it("rejects underscores before metadata save", () => {
		expect(() => validateSystemComponentMetadataSlug("primary_button")).toThrow(
			"Component slug must use lowercase alphanumeric segments separated by hyphens.",
		);
	});
});

const compoundDraft = (
	conditions: Array<[string, string]>,
): CompoundVariantDraft => ({
	id: "compound-1",
	conditions: conditions.map(([axisKey, valueKey], index) => ({
		id: `condition-${index}`,
		axisKey,
		valueKey,
	})),
});

describe("variantDraftsToSchema compound variants", () => {
	it("serializes compound conditions into a when map", () => {
		const schema = variantDraftsToSchema(twoAxisDrafts(), null, [
			compoundDraft([
				["tone", "brand"],
				["size", "lg"],
			]),
		]);
		expect(schema?.compoundVariants).toEqual([
			{ when: { tone: "brand", size: "lg" }, classesByPath: {} },
		]);
	});

	it("omits compoundVariants when no compound drafts are passed", () => {
		expect(
			variantDraftsToSchema(twoAxisDrafts())?.compoundVariants,
		).toBeUndefined();
	});

	it("preserves painted compound classes when a condition is removed", () => {
		const existing = {
			axes: {
				tone: { label: "Tone", values: { brand: { label: "Brand" } } },
				size: { label: "Size", values: { lg: { label: "Large" } } },
			},
			compoundVariants: [
				{
					when: { tone: "brand", size: "lg" },
					classesByPath: { root: "ring-2" },
				},
			],
		};
		const [draft] = schemaToCompoundDrafts(existing);
		const edited: CompoundVariantDraft = {
			...draft,
			conditions: draft.conditions.filter(
				(condition) => condition.axisKey !== "size",
			),
		};

		const schema = variantDraftsToSchema(twoAxisDrafts(), existing, [edited]);
		expect(schema?.compoundVariants).toEqual([
			{ when: { tone: "brand" }, classesByPath: { root: "ring-2" } },
		]);
	});
});

describe("schemaToCompoundDrafts", () => {
	it("maps when entries to conditions and records the original signature", () => {
		const [draft] = schemaToCompoundDrafts({
			axes: { tone: { label: "Tone", values: { brand: {} } } },
			compoundVariants: [
				{ when: { tone: "brand", size: "lg" }, classesByPath: {} },
			],
		});
		expect(
			draft.conditions.map((condition) => [
				condition.axisKey,
				condition.valueKey,
			]),
		).toEqual([
			["tone", "brand"],
			["size", "lg"],
		]);
		expect(draft.originalWhenSignature).toBeDefined();
	});
});

describe("advanceCompoundDraftKeys", () => {
	it("rebaselines the signature to match the serialized schema", () => {
		const drafts = [
			compoundDraft([
				["tone", "brand"],
				["size", "lg"],
			]),
		];
		const schema = variantDraftsToSchema(twoAxisDrafts(), null, drafts);
		const [advanced] = advanceCompoundDraftKeys(drafts, schema);
		expect(advanced.originalWhenSignature).toBe(
			schemaToCompoundDrafts(schema ?? undefined)[0]?.originalWhenSignature,
		);
	});
});

describe("validateVariantDrafts compound rules", () => {
	it("allows variant value keys that start with a number", () => {
		const drafts = twoAxisDrafts();
		drafts[1] = {
			...drafts[1],
			values: [{ id: "v-2xs", key: "2xs", label: "2xs" }],
		};

		expect(validateVariantDrafts(drafts)).toEqual([]);
	});

	it("keeps variant axis keys identifier-like", () => {
		const drafts = twoAxisDrafts();
		drafts[1] = { ...drafts[1], key: "2size" };

		expect(
			validateVariantDrafts(drafts).some((message) =>
				message.includes('Variant axis "2size" must start with a letter'),
			),
		).toBe(true);
	});

	it("accepts a compound that combines two valid conditions", () => {
		expect(
			validateVariantDrafts(twoAxisDrafts(), [
				compoundDraft([
					["tone", "brand"],
					["size", "lg"],
				]),
			]),
		).toEqual([]);
	});

	it("requires at least two resolved conditions", () => {
		const diagnostics = validateVariantDrafts(twoAxisDrafts(), [
			compoundDraft([["tone", "brand"]]),
		]);
		expect(
			diagnostics.some((message) => message.includes("at least 2 axes")),
		).toBe(true);
	});

	it("flags an unknown axis", () => {
		const diagnostics = validateVariantDrafts(twoAxisDrafts(), [
			compoundDraft([
				["tone", "brand"],
				["color", "red"],
			]),
		]);
		expect(
			diagnostics.some((message) => message.includes('unknown axis "color"')),
		).toBe(true);
	});

	it("flags a value that does not exist on the chosen axis", () => {
		const diagnostics = validateVariantDrafts(twoAxisDrafts(), [
			compoundDraft([
				["tone", "brand"],
				["size", "xl"],
			]),
		]);
		expect(diagnostics.some((message) => message.includes('value "xl"'))).toBe(
			true,
		);
	});

	it("flags a duplicate axis within one compound", () => {
		const diagnostics = validateVariantDrafts(twoAxisDrafts(), [
			compoundDraft([
				["tone", "brand"],
				["tone", "brand"],
			]),
		]);
		expect(
			diagnostics.some((message) =>
				message.includes('uses axis "tone" more than once'),
			),
		).toBe(true);
	});
});

describe("resolveVariantDraftSeedSource", () => {
	const storeVariants = {
		axes: { tone: { label: "Tone", values: { brand: { label: "Brand" } } } },
	};
	const serverVariants = { axes: {} };

	it("seeds from the store when this component has unsaved variant edits", () => {
		// Reproduces selecting a layer and returning: the inspector remounts with
		// dirty variants in the store that the server record does not yet have.
		expect(
			resolveVariantDraftSeedSource({
				variantsDirty: true,
				draftMatchesComponent: true,
				storeVariants,
				serverVariants,
			}),
		).toBe(storeVariants);
	});

	it("seeds from the server record when nothing is dirty", () => {
		expect(
			resolveVariantDraftSeedSource({
				variantsDirty: false,
				draftMatchesComponent: true,
				storeVariants,
				serverVariants,
			}),
		).toBe(serverVariants);
	});

	it("seeds from the server record when the dirty draft belongs to another component", () => {
		expect(
			resolveVariantDraftSeedSource({
				variantsDirty: true,
				draftMatchesComponent: false,
				storeVariants,
				serverVariants,
			}),
		).toBe(serverVariants);
	});

	it("returns undefined instead of null when seeding from an empty store", () => {
		expect(
			resolveVariantDraftSeedSource({
				variantsDirty: true,
				draftMatchesComponent: true,
				storeVariants: null,
				serverVariants: undefined,
			}),
		).toBeUndefined();
	});
});
