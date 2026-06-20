import { describe, expect, it } from "vitest";
import {
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node } from "../types";
import { expandResolvedSystemComponent } from "./system-component-expansion";
import {
	getSystemComponentMarkerProps,
	getSystemComponentStructuralMetadata,
	systemComponentOverridesProp,
} from "./system-component-markers";
import {
	classifySystemComponentMigration,
	migrateSystemComponentInstance,
	SystemComponentMigrationError,
} from "./system-component-migration";
import {
	FIXTURE_COMPONENT_ID,
	FIXTURE_OTHER_COMPONENT_ID,
} from "./system-component-test-fixtures";
import type { PublishedSystemComponentVersion } from "./system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "./system-components-validation";

const systemId = "sys-core";
const componentId = FIXTURE_COMPONENT_ID;
const instanceId = "instance-1";
const separatorBaseClassName =
	"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full";

const sourceVersionV1 = (): PublishedSystemComponentVersion => {
	const root = {
		path: "root",
		library: "trickroom",
		component: "container",
		className: "card",
		children: [
			{
				path: "legacy-body",
				library: "trickroom",
				component: "container",
				slot: "default",
				children: [],
			},
			{
				path: "label",
				library: "trickroom",
				component: "text",
				text: "Label",
			},
		],
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
	const draft = {
		root,
		slots: {
			default: {
				name: "default",
				hostPath: "legacy-body",
			},
		},
		variants,
		overrideTargets: {
			rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
		},
	};
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
		children: [
			{
				path: "body",
				library: "trickroom",
				component: "container",
				slot: "default",
				children: [],
			},
			{
				path: "label",
				library: "trickroom",
				component: "text",
				text: "Label",
			},
			{
				path: "badge",
				library: "trickroom",
				component: "text",
				text: "New",
			},
		],
	};
	const variants = {
		axes: {
			appearance: {
				label: "Appearance",
				defaultValue: "subtle",
				values: {
					emphasis: { classesByPath: { root: "appearance-emphasis" } },
					subtle: { classesByPath: { root: "appearance-subtle" } },
				},
			},
		},
		defaultValues: { appearance: "subtle" },
	};
	const draft = {
		root,
		slots: {
			default: {
				name: "default",
				hostPath: "body",
				history: [
					{
						fromVersion: "1",
						previousHostPath: "legacy-body",
					},
				],
			},
		},
		variants,
		overrideTargets: {
			surface: {
				targetId: "surface",
				label: "Surface",
				path: "root",
				history: [
					{
						fromVersion: "1",
						previousTargetId: "rootTarget",
					},
				],
			},
		},
		migrationHints: {
			variantAxes: [
				{
					fromAxis: "tone",
					toAxis: "appearance",
					valueMappings: [
						{ fromValue: "brand", toValue: "emphasis" },
						{ fromValue: "neutral", toValue: "subtle" },
					],
				},
			],
			slots: [{ fromName: "default", toName: "default" }],
		},
	};
	return {
		...draft,
		version: "2",
		publishedAt: "2026-05-26T13:00:00.000Z",
		templateHash: hashSystemComponentTemplate(draft),
		variantSchemaHash: hashSystemComponentVariantSchema(variants),
	};
};

const expandStaleInstance = (
	source: PublishedSystemComponentVersion,
	options?: {
		variantValues?: Record<string, string>;
		overrides?: Record<string, { className?: string }>;
		slotChild?: Node;
	},
) => {
	const expansion = expandResolvedSystemComponent(
		{
			systemId,
			componentId,
			record: {
				componentId,
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
			variantValues: options?.variantValues ?? { tone: "brand" },
			overrides: options?.overrides ?? {
				rootTarget: { className: "rounded-lg" },
			},
		},
	);

	if (options?.slotChild) {
		const body = (expansion.root.children as Node[]).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.slotName ===
				"default",
		);
		if (body) {
			body.children = [options.slotChild];
		}
	}

	return expansion.root;
};

describe("system-component-migration", () => {
	it("migrates a stale instance to the current published version", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleInstance(source, {
			slotChild: {
				id: "slot-text",
				props: {
					"data-trickroom-name": "Slot Text",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
				},
				children: "Custom slot copy",
			},
		});

		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});

		const migratedRoot = result.roots[0];
		const body = (migratedRoot.children as Node[]).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path === "body",
		);
		const label = (migratedRoot.children as Node[]).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path === "label",
		);

		expect(migratedRoot.props.className).toContain("appearance-emphasis");
		expect(migratedRoot.props.className).toContain("rounded-lg");
		expect(
			getSystemComponentStructuralMetadata(migratedRoot.props),
		).toMatchObject({
			version: "2",
			templateHash: target.templateHash,
			variantSchemaHash: target.variantSchemaHash,
			variantValues: { appearance: "emphasis" },
		});
		expect(body?.children).toEqual([
			expect.objectContaining({
				id: "slot-text",
				children: "Custom slot copy",
			}),
		]);
		expect(label?.id).toBeTruthy();
		expect(result.metadata).toMatchObject({
			fromVersion: "1",
			toVersion: "2",
			preservedSlots: [
				expect.objectContaining({
					slotName: "default",
					fromHostPath: "legacy-body",
					toHostPath: "body",
					preservedChildIds: ["slot-text"],
					mappingSource: "name",
				}),
			],
			remappedPaths: [
				expect.objectContaining({
					fromPath: "legacy-body",
					toPath: "body",
				}),
			],
			preservedPaths: [
				expect.objectContaining({
					fromPath: "root",
					toPath: "root",
				}),
				expect.objectContaining({
					fromPath: "label",
					toPath: "label",
				}),
			],
			addedPaths: [
				expect.objectContaining({
					toPath: "badge",
				}),
			],
			variantMappings: expect.arrayContaining([
				expect.objectContaining({
					axisKey: "appearance",
					fromValue: "brand",
					toValue: "emphasis",
					mappingSource: "hint",
				}),
			]),
			overrideMappings: [
				expect.objectContaining({
					fromTargetId: "rootTarget",
					toTargetId: "surface",
					mappingSource: "history",
				}),
			],
		});
		expect(result.metadata.diagnostics).toEqual([]);
	});

	it("leaves new default-less target variant axes unset during migration", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		target.variants = {
			...target.variants,
			axes: {
				...(target.variants?.axes ?? {}),
				density: {
					label: "Density",
					values: {
						compact: { classesByPath: { root: "density-compact" } },
					},
				},
			},
		};
		target.variantSchemaHash = hashSystemComponentVariantSchema(
			target.variants,
		);
		const staleRoot = expandStaleInstance(source);

		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});
		const migratedRoot = result.roots[0];

		expect(
			getSystemComponentStructuralMetadata(migratedRoot.props),
		).toMatchObject({
			variantValues: { appearance: "emphasis" },
		});
		expect(migratedRoot.props.className).not.toContain("density-compact");
	});

	it("preserves nested attached component markers inside migrated slot content", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleInstance(source, {
			slotChild: {
				id: "nested-root",
				props: {
					"data-trickroom-name": "Nested",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					...getSystemComponentMarkerProps({
						systemId,
						componentId: FIXTURE_OTHER_COMPONENT_ID,
						instanceId: "nested-instance",
						version: "1",
						path: "root",
						isRoot: true,
					}),
				},
				children: [],
			},
		});

		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});
		const body = ((result.roots[0].children as Node[]) ?? []).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path === "body",
		);
		const nested = Array.isArray(body?.children) ? body.children[0] : null;

		expect(getSystemComponentStructuralMetadata(nested?.props))?.toMatchObject({
			componentId: FIXTURE_OTHER_COMPONENT_ID,
			instanceId: "nested-instance",
		});
	});

	it("materializes legacy seeded separator template classes without duplicating base classes", () => {
		const root = {
			path: "root",
			library: "trickroom",
			component: "container",
			children: [
				{
					path: "separator",
					library: "base-ui",
					component: "separator",
					className: `${separatorBaseClassName} bg-slate-200`,
				},
				{
					path: "menuSeparator",
					library: "base-ui",
					component: "menu.separator",
					props: {
						className: `${separatorBaseClassName} opacity-70`,
					},
				},
			],
		};
		const sourceDraft = { root };
		const targetDraft = { root };
		const source: PublishedSystemComponentVersion = {
			...sourceDraft,
			version: "1",
			publishedAt: "2026-05-30T12:00:00.000Z",
			templateHash: hashSystemComponentTemplate(sourceDraft),
			variantSchemaHash: hashSystemComponentVariantSchema(),
		};
		const target: PublishedSystemComponentVersion = {
			...targetDraft,
			version: "2",
			publishedAt: "2026-05-31T12:00:00.000Z",
			templateHash: hashSystemComponentTemplate(targetDraft),
			variantSchemaHash: hashSystemComponentVariantSchema(),
			previousVersion: "1",
		};
		const staleRoot = expandResolvedSystemComponent(
			{
				systemId,
				componentId,
				record: {
					componentId,
					slug: "separators",
					name: "Separators",
					createdAt: "",
					updatedAt: "",
					published: {
						currentVersion: "1",
						versions: { "1": source },
					},
				},
				version: source,
			},
			{
				createInstanceId: () => instanceId,
				createElementId: () => crypto.randomUUID(),
			},
		).root;

		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});
		const migratedChildren = result.roots[0].children as Node[];
		const separator = migratedChildren.find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path === "separator",
		);
		const menuSeparator = migratedChildren.find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path ===
				"menuSeparator",
		);
		const separatorDefinition = resolveRegistryComponent(
			"base-ui",
			"separator",
		);
		const menuSeparatorDefinition = resolveRegistryComponent(
			"base-ui",
			"menu.separator",
		);
		expect(separatorDefinition.status).toBe("known");
		expect(menuSeparatorDefinition.status).toBe("known");
		if (
			separatorDefinition.status !== "known" ||
			menuSeparatorDefinition.status !== "known"
		) {
			return;
		}

		expect(separator?.props.className).toBe(
			`${separatorBaseClassName} bg-slate-200`,
		);
		expect(separator?.props[MATERIALIZED_BASE_CLASS_PROP]).toBe("true");
		expect(menuSeparator?.props.className).toBe(
			`${separatorBaseClassName} opacity-70`,
		);
		expect(menuSeparator?.props[MATERIALIZED_BASE_CLASS_PROP]).toBe("true");
		expect(
			getRenderableProps(separator?.props ?? {}, separatorDefinition.definition)
				.className,
		).toBe(`${separatorBaseClassName} bg-slate-200`);
		expect(
			getRenderableProps(
				menuSeparator?.props ?? {},
				menuSeparatorDefinition.definition,
			).className,
		).toBe(`${separatorBaseClassName} opacity-70`);
	});

	it("reports dropped overrides and refuses unsafe slot content loss", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleInstance(source);
		staleRoot.props = {
			...staleRoot.props,
			[systemComponentOverridesProp]: JSON.stringify({
				rootTarget: { className: "rounded-lg" },
				missingTarget: { className: "drop-me" },
			}),
		};

		const droppedTargetResult = migrateSystemComponentInstance(
			[staleRoot],
			staleRoot.id,
			{
				systemId,
				componentId,
				sourceVersion: source,
				targetVersion: target,
			},
		);
		expect(droppedTargetResult.metadata.overrideMappings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fromTargetId: "missingTarget",
					mappingSource: "dropped",
				}),
			]),
		);
		expect(droppedTargetResult.metadata.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "OVERRIDE_DROPPED",
					overrideTargetId: "missingTarget",
					targetId: "missingTarget",
				}),
			]),
		);
		expect(
			getSystemComponentStructuralMetadata(droppedTargetResult.roots[0].props)
				?.overrides,
		).toEqual({
			surface: { className: "rounded-lg" },
		});

		const targetWithoutSlot = {
			...targetVersionV2(),
			slots: {},
			root: {
				...targetVersionV2().root,
				children: targetVersionV2().root.children?.filter(
					(child) => child.path !== "body",
				),
			},
		};
		const staleWithSlotContent = expandStaleInstance(source, {
			slotChild: {
				id: "slot-text",
				props: {
					"data-trickroom-name": "Slot Text",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
				},
				children: "Keep me",
			},
		});

		expect(() =>
			migrateSystemComponentInstance(
				[staleWithSlotContent],
				staleWithSlotContent.id,
				{
					systemId,
					componentId,
					sourceVersion: source,
					targetVersion: targetWithoutSlot,
				},
			),
		).toThrow(
			expect.objectContaining({
				code: "MIGRATION_UNSAFE",
				message: expect.stringContaining("authored content"),
			}),
		);
	});

	it("rejects elements outside the requested component instance", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleInstance(source);

		expect(() =>
			migrateSystemComponentInstance([staleRoot], staleRoot.id, {
				systemId,
				componentId: FIXTURE_OTHER_COMPONENT_ID,
				sourceVersion: source,
				targetVersion: target,
			}),
		).toThrow(
			expect.objectContaining({
				code: "INSTANCE_MISMATCH",
			}),
		);

		expect(() =>
			migrateSystemComponentInstance([staleRoot], "missing-id", {
				systemId,
				componentId,
				sourceVersion: source,
				targetVersion: target,
			}),
		).toThrow(SystemComponentMigrationError);
	});

	it("classifies compatible migrations as safe for automatic policy", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			templateHash: source.templateHash,
			variantSchemaHash: source.variantSchemaHash,
			variantValues: { tone: "brand" },
			overrides: { rootTarget: { className: "rounded-lg" } },
		});

		expect(result).toEqual({
			safety: "safe",
			automatic: true,
			diagnostics: [],
		});
	});

	it("requires review for dropped slots without history", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			slots: {},
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
		});

		expect(result.safety).toBe("requires-review");
		expect(result.automatic).toBe(false);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DROPPED_SLOT",
				severity: "review",
				slotName: "default",
			}),
		]);
	});

	it("requires review for dropped variant values without a mapping", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			migrationHints: {},
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			variantValues: { tone: "brand" },
		});

		expect(result.safety).toBe("requires-review");
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DROPPED_VARIANT_VALUE",
				variantAxis: "tone",
				variantValue: "brand",
			}),
		]);
	});

	it("requires review for dropped authored override targets", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			overrideTargets: {},
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			overrides: { rootTarget: { className: "rounded-lg" } },
		});

		expect(result.safety).toBe("requires-review");
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DROPPED_OVERRIDE_TARGET",
				overrideTargetId: "rootTarget",
			}),
		]);
	});

	it("remaps overrides using path-based history and hint pathMappings", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			overrideTargets: {
				surface: {
					targetId: "surface",
					label: "Surface",
					path: "root",
					history: [
						{
							fromVersion: "1",
							previousPath: "root",
						},
					],
				},
			},
			migrationHints: {
				...targetVersionV2().migrationHints,
				overrideTargets: [
					{
						fromTargetId: "legacyTarget",
						pathMappings: [{ fromPath: "label", toPath: "label" }],
					},
				],
			},
		};
		const targetWithHintOnly = {
			...target,
			overrideTargets: {
				labelSurface: {
					targetId: "labelSurface",
					label: "Label surface",
					path: "label",
				},
			},
		};
		const staleRoot = expandStaleInstance(source, {
			overrides: { rootTarget: { className: "rounded-lg" } },
		});

		const pathHistoryResult = migrateSystemComponentInstance(
			[staleRoot],
			staleRoot.id,
			{
				systemId,
				componentId,
				sourceVersion: source,
				targetVersion: target,
			},
		);
		expect(
			getSystemComponentStructuralMetadata(pathHistoryResult.roots[0].props)
				?.overrides,
		).toEqual({
			surface: { className: "rounded-lg" },
		});
		expect(pathHistoryResult.metadata.overrideMappings).toEqual([
			expect.objectContaining({
				fromTargetId: "rootTarget",
				toTargetId: "surface",
				mappingSource: "history",
			}),
		]);

		const sourceWithLegacyTarget = {
			...source,
			overrideTargets: {
				legacyTarget: {
					targetId: "legacyTarget",
					label: "Legacy",
					path: "label",
				},
			},
		};
		const staleWithLegacy = expandStaleInstance(sourceWithLegacyTarget, {
			overrides: { legacyTarget: { className: "label-override" } },
		});
		const hintPathResult = migrateSystemComponentInstance(
			[staleWithLegacy],
			staleWithLegacy.id,
			{
				systemId,
				componentId,
				sourceVersion: sourceWithLegacyTarget,
				targetVersion: targetWithHintOnly,
			},
		);
		expect(
			getSystemComponentStructuralMetadata(hintPathResult.roots[0].props)
				?.overrides,
		).toEqual({
			labelSurface: { className: "label-override" },
		});
		expect(hintPathResult.metadata.overrideMappings).toEqual([
			expect.objectContaining({
				fromTargetId: "legacyTarget",
				toTargetId: "labelSurface",
				mappingSource: "hint",
			}),
		]);
	});

	it("classifies invalid variant hint mappings as requires-review", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			migrationHints: {
				variantAxes: [
					{
						fromAxis: "tone",
						toAxis: "appearance",
						valueMappings: [{ fromValue: "brand", toValue: "missing-value" }],
					},
				],
			},
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			variantValues: { tone: "brand" },
		});

		expect(result.safety).toBe("requires-review");
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "DROPPED_VARIANT_VALUE",
				variantAxis: "tone",
				variantValue: "brand",
			}),
		]);
	});

	it("requires review for many-to-one slot mappings and refuses authored content loss", () => {
		const source = {
			...sourceVersionV1(),
			slots: {
				primary: {
					name: "primary",
					hostPath: "legacy-body",
				},
				secondary: {
					name: "secondary",
					hostPath: "label",
				},
			},
		};
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			slots: {
				default: {
					name: "default",
					hostPath: "body",
				},
			},
			migrationHints: {
				slots: [
					{ fromName: "primary", toName: "default" },
					{
						fromName: "secondary",
						hostPathMappings: [{ fromPath: "label", toPath: "body" }],
					},
				],
			},
		};

		const classification = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
		});
		expect(classification.safety).toBe("requires-review");
		expect(classification.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "SLOT_MAPPING_CONFLICT",
					slotName: "primary",
				}),
			]),
		);

		const staleRoot = expandStaleInstance(source, {
			slotChild: {
				id: "primary-slot-text",
				props: {
					"data-trickroom-name": "Primary",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
				},
				children: "Primary copy",
			},
		});
		const body = (staleRoot.children as Node[]).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path ===
				"legacy-body",
		);
		const label = (staleRoot.children as Node[]).find(
			(child) =>
				getSystemComponentStructuralMetadata(child.props)?.path === "label",
		);
		if (body && label) {
			label.children = [
				{
					id: "secondary-slot-text",
					props: {
						"data-trickroom-name": "Secondary",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Secondary copy",
				},
			];
		}

		expect(() =>
			migrateSystemComponentInstance([staleRoot], staleRoot.id, {
				systemId,
				componentId,
				sourceVersion: source,
				targetVersion: target,
			}),
		).toThrow(
			expect.objectContaining({
				code: "MIGRATION_UNSAFE",
				message: expect.stringContaining("authored content conflicts"),
			}),
		);
	});

	it("treats hinted slot renames as safe instead of dropped slots", () => {
		const source = {
			...sourceVersionV1(),
			slots: {
				body: {
					name: "body",
					hostPath: "legacy-body",
				},
			},
		};
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			slots: {
				content: {
					name: "content",
					hostPath: "body",
				},
			},
			migrationHints: {
				slots: [{ fromName: "body", toName: "content" }],
			},
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
		});

		expect(result).toEqual({
			safety: "safe",
			automatic: true,
			diagnostics: [],
		});
	});

	it("requires review for unknown instance override keys", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
		};

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			overrides: {
				rootTarget: { className: "rounded-lg" },
				unknownTarget: { className: "unexpected" },
			},
		});

		expect(result.safety).toBe("requires-review");
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "DROPPED_OVERRIDE_TARGET",
					overrideTargetId: "unknownTarget",
					targetId: "unknownTarget",
				}),
			]),
		);
	});

	it("emits consistent override diagnostic fields for dropped overrides", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();
		const staleRoot = expandStaleInstance(source);
		staleRoot.props = {
			...staleRoot.props,
			[systemComponentOverridesProp]: JSON.stringify({
				rootTarget: { className: "rounded-lg" },
				missingTarget: { className: "drop-me" },
			}),
		};

		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});

		expect(result.metadata.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "OVERRIDE_DROPPED",
					overrideTargetId: "missingTarget",
					targetId: "missingTarget",
				}),
			]),
		);
	});

	it("preserves variant values on renamed axes when the target axis defines the same value", () => {
		const source = sourceVersionV1();
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			variants: {
				axes: {
					appearance: {
						label: "Appearance",
						defaultValue: "subtle",
						values: {
							brand: { classesByPath: { root: "appearance-brand" } },
							subtle: { classesByPath: { root: "appearance-subtle" } },
						},
					},
				},
				defaultValues: { appearance: "subtle" },
			},
			migrationHints: {
				variantAxes: [{ fromAxis: "tone", toAxis: "appearance" }],
			},
		};
		target.variantSchemaHash = hashSystemComponentVariantSchema(
			target.variants,
		);

		const classification = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			variantValues: { tone: "brand" },
		});
		expect(classification).toEqual({
			safety: "safe",
			automatic: true,
			diagnostics: [],
		});

		const staleRoot = expandStaleInstance(source, {
			variantValues: { tone: "brand" },
		});
		const result = migrateSystemComponentInstance([staleRoot], staleRoot.id, {
			systemId,
			componentId,
			sourceVersion: source,
			targetVersion: target,
		});

		expect(
			getSystemComponentStructuralMetadata(result.roots[0].props),
		)?.toMatchObject({
			variantValues: { appearance: "brand" },
		});
		expect(result.roots[0].props.className).toContain("appearance-brand");
		expect(result.metadata.variantMappings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					axisKey: "appearance",
					fromValue: "brand",
					toValue: "brand",
					mappingSource: "hint",
				}),
			]),
		);
	});

	it("requires review for many-to-one override remaps and refuses silent authored override loss", () => {
		const source = {
			...sourceVersionV1(),
			overrideTargets: {
				rootTarget: {
					targetId: "rootTarget",
					label: "Root",
					path: "root",
				},
				labelTarget: {
					targetId: "labelTarget",
					label: "Label",
					path: "label",
				},
			},
		};
		const target = {
			...targetVersionV2(),
			previousVersion: source.version,
			overrideTargets: {
				surface: {
					targetId: "surface",
					label: "Surface",
					path: "root",
				},
			},
			migrationHints: {
				overrideTargets: [
					{ fromTargetId: "rootTarget", toTargetId: "surface" },
					{ fromTargetId: "labelTarget", toTargetId: "surface" },
				],
			},
		};

		const classification = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			overrides: {
				rootTarget: { className: "rounded-lg" },
				labelTarget: { className: "text-lg" },
			},
		});
		expect(classification.safety).toBe("requires-review");
		expect(classification.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "OVERRIDE_MAPPING_CONFLICT",
					targetId: "surface",
					overrideTargetId: "rootTarget",
				}),
			]),
		);

		const staleRoot = expandStaleInstance(source, {
			overrides: {
				rootTarget: { className: "rounded-lg" },
				labelTarget: { className: "text-lg" },
			},
		});
		expect(() =>
			migrateSystemComponentInstance([staleRoot], staleRoot.id, {
				systemId,
				componentId,
				sourceVersion: source,
				targetVersion: target,
			}),
		).toThrow(
			expect.objectContaining({
				code: "MIGRATION_UNSAFE",
				message: expect.stringContaining("override targets"),
			}),
		);
	});

	it("requires review for missing history and hash mismatches", () => {
		const source = sourceVersionV1();
		const target = targetVersionV2();

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			templateHash: "sha256:unexpected",
			variantSchemaHash: source.variantSchemaHash,
		});

		expect(result.safety).toBe("requires-review");
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "HASH_MISMATCH",
					hashKind: "template",
					expectedHash: source.templateHash,
					actualHash: "sha256:unexpected",
				}),
				expect.objectContaining({
					code: "MISSING_HISTORY",
					fromVersion: "1",
					toVersion: "2",
				}),
			]),
		);
	});

	it("does not require review for missing history when stamping same-version hash markers", () => {
		const source = sourceVersionV1();
		const target = source;

		const result = classifySystemComponentMigration({
			componentId,
			instanceId,
			fromVersion: source,
			toVersion: target,
			templateHash: "sha256:missing",
			variantSchemaHash: "sha256:missing",
		});

		expect(
			result.diagnostics.some(
				(diagnostic) => diagnostic.code === "MISSING_HISTORY",
			),
		).toBe(false);
	});
});
