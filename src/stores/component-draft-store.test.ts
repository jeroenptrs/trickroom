import { beforeEach, describe, expect, it } from "vitest";
import { resolveRegistryComponent } from "../libraries/registry";
import type { RecipeTemplateNode } from "../types";
import { createClassLayers, flattenClassLayers } from "../utils/class-layers";
import { resolveClassLayers } from "../utils/class-resolution";
import { layerDropInsertionIndex } from "../utils/reorder-insertion-index";
import { systemComponentTemplateHashProp } from "../utils/system-component-markers";
import { hashComponentDraftSnapshot } from "../utils/system-component-template-hash";
import {
	complexComponentTemplateRoot,
	FIXTURE_COMPONENT_ID,
	FIXTURE_OTHER_COMPONENT_ID,
	minimalComponentTemplateRoot,
} from "../utils/system-component-test-fixtures";
import {
	addTemplateNode,
	addTemplateNodeOverrideTarget,
	clearComponentDraftDirty,
	clearComponentDraftTemplateDirty,
	componentDraftStore,
	deleteTemplateNode,
	getComponentDraftPreviewClassLayers,
	getComponentDraftPreviewClassName,
	getComponentDraftTemplateHash,
	getCompoundClassNameForPath,
	getEffectiveDraftNodeClassName,
	hydrateComponentDraft,
	isComponentDraftCleanAtRevision,
	markTemplateNodeAsSlotHost,
	moveTemplateNode,
	normalizeComponentDraft,
	removeTemplateNodeOverrideTarget,
	removeTemplateNodeSlotHost,
	replaceComponentDraftVariants,
	resetComponentDraftStore,
	selectTemplateNode,
	serializeComponentDraftState,
	setComponentDraftStyleClassName,
	setComponentDraftStyleTarget,
	updateTemplateNodeClassName,
	updateTemplateNodeName,
	updateTemplateNodeOverrideTarget,
	updateTemplateNodeProps,
	updateTemplateNodeSlotMetadata,
	updateTemplateNodeText,
	updateVariantClassesByPath,
} from "./component-draft-store";

const hydrateFixture = (root: RecipeTemplateNode) => {
	hydrateComponentDraft({
		componentId: FIXTURE_COMPONENT_ID,
		root,
		slots: {
			default: {
				name: "default",
				hostPath: "root",
			},
		},
	});
};

beforeEach(() => {
	resetComponentDraftStore();
	hydrateFixture(minimalComponentTemplateRoot());
});

describe("component draft store", () => {
	it("hydrates a minimal template into editable store state", () => {
		const state = componentDraftStore.get();

		expect(state.componentId).toBe(FIXTURE_COMPONENT_ID);
		expect(state.rootPath).toBe("root");
		expect(state.entitiesByPath.root).toMatchObject({
			path: "root",
			library: "trickroom",
			component: "container",
			parentPath: null,
			role: "branch",
			childPaths: [],
		});
		expect(state.selectedPath).toBeNull();
		expect(state.dirtyPaths).toEqual({});
		expect(state.revision).toBe(1);
	});

	it("serializes store state back to RecipeTemplateNode without losing structure", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		const serialized = serializeComponentDraftState(componentDraftStore.get());

		expect(serialized).toEqual(complexComponentTemplateRoot());
		expect(collectPaths(serialized).sort()).toEqual(["icon", "label", "root"]);
	});

	it("roundtrips normalize and serialize for a complex template", () => {
		const root = complexComponentTemplateRoot();
		const normalized = normalizeComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root,
		});

		expect(serializeComponentDraftState(normalized)).toEqual(root);
	});

	it("preserves stable template paths across class and text edits", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		updateTemplateNodeClassName("label", "text-sm font-medium");
		updateTemplateNodeText("label", "Updated label");

		const serialized = serializeComponentDraftState(componentDraftStore.get());
		expect(serialized.children?.[0]).toMatchObject({
			path: "label",
			className: "text-sm font-medium",
			text: "Updated label",
		});
		expect(serialized.children?.[1]?.path).toBe("icon");
	});

	it("ignores system-owned marker props when updating template node props", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());
		const previousRevision = componentDraftStore.get().revision;

		updateTemplateNodeProps("label", {
			orientation: "vertical",
			[systemComponentTemplateHashProp]: "sha256:blocked",
			"data-trickroom-library": "blocked",
		});

		expect(componentDraftStore.get().revision).toBe(previousRevision + 1);
		expect(componentDraftStore.get().entitiesByPath.label?.props).toEqual({
			orientation: "vertical",
		});
	});

	it("tracks selection, dirty paths, revision, and template hash for save", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());
		const initialHash = getComponentDraftTemplateHash();

		selectTemplateNode("label");
		expect(componentDraftStore.get().selectedPath).toBe("label");

		updateTemplateNodeName("label", "Caption");
		const revision = componentDraftStore.get().revision;
		expect(componentDraftStore.get().dirtyPaths).toEqual({ label: true });
		expect(getComponentDraftTemplateHash()).not.toBe(initialHash);

		clearComponentDraftDirty(revision);
		expect(isComponentDraftCleanAtRevision(revision)).toBe(true);
		expect(getComponentDraftTemplateHash()).toMatch(/^client-fnv:/u);
	});

	it("marks a template node as a slot host and edits slot metadata", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		markTemplateNodeAsSlotHost("label");
		expect(componentDraftStore.get().entitiesByPath.label?.slot).toBe("text");
		expect(componentDraftStore.get().slots.text).toMatchObject({
			name: "text",
			label: "text",
			hostPath: "label",
		});

		updateTemplateNodeSlotMetadata("label", {
			name: "headline",
			label: "Headline",
		});

		const state = componentDraftStore.get();
		expect(state.entitiesByPath.label?.slot).toBe("headline");
		expect(state.slots).not.toHaveProperty("label");
		expect(state.slots.headline).toMatchObject({
			name: "headline",
			label: "Headline",
			hostPath: "label",
		});
		expect(serializeComponentDraftState(state).children?.[0]).toMatchObject({
			path: "label",
			slot: "headline",
		});
		expect(state.templateDirty).toBe(true);
	});

	it("removes a slot host role from a template node", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		markTemplateNodeAsSlotHost("label");
		removeTemplateNodeSlotHost("label");

		const state = componentDraftStore.get();
		expect(state.entitiesByPath.label?.slot).toBeUndefined();
		expect(state.slots).not.toHaveProperty("label");
		expect(
			serializeComponentDraftState(state).children?.[0]?.slot,
		).toBeUndefined();
	});

	it("does not hydrate over unsaved local edits", () => {
		updateTemplateNodeClassName("root", "p-4");
		const previousState = componentDraftStore.get();

		const result = hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
		});

		expect(result).toBe("dirty-skipped");
		expect(componentDraftStore.get()).toEqual(previousState);
	});

	it("keeps a dirty draft scoped to its component when another component hydrates", () => {
		selectTemplateNode("root");
		updateTemplateNodeClassName("root", "p-4");
		const previousState = componentDraftStore.get();

		const result = hydrateComponentDraft({
			componentId: FIXTURE_OTHER_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
		});

		expect(result).toBe("dirty-skipped");
		expect(componentDraftStore.get()).toEqual(previousState);
		expect(componentDraftStore.get().componentId).toBe(FIXTURE_COMPONENT_ID);
		expect(componentDraftStore.get().selectedPath).toBe("root");
	});

	it("refreshes clean store identity when the component id changes with the same root", () => {
		const previousRevision = componentDraftStore.get().revision;

		const result = hydrateComponentDraft({
			componentId: FIXTURE_OTHER_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			slots: {
				default: {
					name: "default",
					hostPath: "root",
				},
			},
		});

		expect(result).toBe("hydrated");
		expect(componentDraftStore.get().componentId).toBe(
			FIXTURE_OTHER_COMPONENT_ID,
		);
		expect(componentDraftStore.get().revision).toBe(previousRevision + 1);
		expect(componentDraftStore.get().selectedPath).toBeNull();
	});

	it("refreshes clean store state when base version or slots change", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			baseVersion: "1",
			root: minimalComponentTemplateRoot(),
			slots: {
				default: {
					name: "default",
					hostPath: "root",
				},
			},
		});
		const previousRevision = componentDraftStore.get().revision;

		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			baseVersion: "2",
			root: minimalComponentTemplateRoot(),
			slots: {
				default: {
					name: "default",
					label: "Main content",
					hostPath: "root",
				},
			},
		});

		expect(componentDraftStore.get()).toMatchObject({
			baseVersion: "2",
			slots: {
				default: {
					label: "Main content",
					hostPath: "root",
				},
			},
			dirtyPaths: {},
			templateDirty: false,
			revision: previousRevision + 1,
		});
	});

	it("adds, moves, and deletes nodes while keeping existing paths stable", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		addTemplateNode(
			{ library: "trickroom", component: "text" },
			"root",
			1,
			"helper",
		);
		expect(componentDraftStore.get().entitiesByPath.helper).toBeDefined();
		expect(componentDraftStore.get().entitiesByPath.root?.childPaths).toEqual([
			"label",
			"helper",
			"icon",
		]);

		moveTemplateNode("helper", "root", 2);
		expect(componentDraftStore.get().entitiesByPath.root?.childPaths).toEqual([
			"label",
			"icon",
			"helper",
		]);

		deleteTemplateNode("helper");
		expect(componentDraftStore.get().entitiesByPath.helper).toBeUndefined();
		expect(componentDraftStore.get().entitiesByPath.label?.path).toBe("label");
		expect(componentDraftStore.get().entitiesByPath.icon?.path).toBe("icon");
	});

	it("deletes the root template and allows adding a replacement root", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: complexComponentTemplateRoot(),
			slots: {
				default: {
					name: "default",
					hostPath: "root",
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
							brand: {
								classesByPath: {
									root: "bg-blue-600",
									label: "text-white",
								},
							},
						},
					},
				},
				compoundVariants: [
					{
						when: { tone: "brand" },
						classesByPath: { icon: "size-4" },
					},
				],
			},
		});
		selectTemplateNode("root");

		deleteTemplateNode("root");

		let state = componentDraftStore.get();
		expect(state.rootPath).toBeNull();
		expect(state.entitiesByPath).toEqual({});
		expect(state.selectedPath).toBeNull();
		expect(state.slots).toEqual({});
		expect(state.overrideTargets).toEqual({});
		expect(state.templateDirty).toBe(true);
		expect(state.variantsDirty).toBe(true);
		expect(
			state.variants?.axes.tone.values.brand.classesByPath,
		).toBeUndefined();
		expect(state.variants?.compoundVariants?.[0]?.classesByPath).toEqual({});
		expect(() => serializeComponentDraftState(state)).toThrow(
			"Cannot serialize component draft without a root template.",
		);

		addTemplateNode({ library: "trickroom", component: "text" }, null, 0);

		state = componentDraftStore.get();
		expect(state.rootPath).toBe("root");
		expect(state.entitiesByPath.root).toMatchObject({
			path: "root",
			component: "text",
			parentPath: null,
		});
		expect(serializeComponentDraftState(state)).toMatchObject({
			path: "root",
			component: "text",
		});
	});

	it("reorders the first sibling after a later sibling using layer-drop indices", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		addTemplateNode(
			{ library: "trickroom", component: "text" },
			"root",
			1,
			"middle",
		);

		const siblings =
			componentDraftStore.get().entitiesByPath.root?.childPaths ?? [];
		expect(siblings).toEqual(["label", "middle", "icon"]);

		const index = layerDropInsertionIndex(siblings, "label", "after", "middle");
		expect(index).toBe(1);

		moveTemplateNode("label", "root", index);

		expect(componentDraftStore.get().entitiesByPath.root?.childPaths).toEqual([
			"middle",
			"label",
			"icon",
		]);
	});

	it("shows the pre-adjustment after index would land at the end instead of between siblings", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		addTemplateNode(
			{ library: "trickroom", component: "text" },
			"root",
			1,
			"middle",
		);

		const siblings =
			componentDraftStore.get().entitiesByPath.root?.childPaths ?? [];
		const buggyIndex = siblings.indexOf("middle") + 1;

		moveTemplateNode("label", "root", buggyIndex);

		expect(componentDraftStore.get().entitiesByPath.root?.childPaths).toEqual([
			"middle",
			"icon",
			"label",
		]);
	});

	it("does not orphan a non-root node when moved to a null parent target", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());
		const previousState = componentDraftStore.get();

		moveTemplateNode("label", null, 0);

		expect(componentDraftStore.get()).toEqual(previousState);
		expect(componentDraftStore.get().rootPath).toBe("root");
		expect(componentDraftStore.get().entitiesByPath.label?.parentPath).toBe(
			"root",
		);
		expect(componentDraftStore.get().entitiesByPath.root?.childPaths).toContain(
			"label",
		);
	});

	it("preserves explicit empty text through serialization and hydration", () => {
		resetComponentDraftStore();
		hydrateFixture(complexComponentTemplateRoot());

		updateTemplateNodeText("label", "");
		const serialized = serializeComponentDraftState(componentDraftStore.get());

		expect(serialized.children?.[0]).toMatchObject({
			path: "label",
			text: "",
		});

		clearComponentDraftDirty(componentDraftStore.get().revision);
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: serialized,
			slots: componentDraftStore.get().slots,
		});

		expect(componentDraftStore.get().entitiesByPath.label?.text).toBe("");
	});

	it("clones hydrated slots so external objects cannot mutate draft state", () => {
		const slots = {
			default: {
				name: "default",
				hostPath: "root",
				defaultChildren: [
					{
						path: "slot-label",
						library: "trickroom",
						component: "text",
						text: "Slot label",
					},
				],
			},
		};

		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			slots,
		});

		slots.default.hostPath = "external";
		slots.default.defaultChildren[0].text = "Mutated externally";

		expect(componentDraftStore.get().slots.default).toMatchObject({
			hostPath: "root",
			defaultChildren: [
				{
					text: "Slot label",
				},
			],
		});
	});

	it("creates, edits, and removes override targets by template path", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: complexComponentTemplateRoot(),
			overrideTargets: {
				labelTarget: {
					targetId: "labelTarget",
					label: "Label",
					path: "label",
				},
			},
		});

		addTemplateNodeOverrideTarget("icon");
		expect(componentDraftStore.get().overrideTargets.icon).toEqual({
			targetId: "icon",
			label: "icon",
			path: "icon",
			capabilities: ["className", "icon"],
		});

		updateTemplateNodeOverrideTarget("icon", {
			targetId: "leadingIcon",
			label: "Leading icon",
		});
		expect(componentDraftStore.get().overrideTargets.leadingIcon).toEqual({
			targetId: "leadingIcon",
			label: "Leading icon",
			path: "icon",
			capabilities: ["className", "icon"],
		});
		expect(componentDraftStore.get().overrideTargets.icon).toBeUndefined();
		expect(componentDraftStore.get().templateDirty).toBe(true);

		removeTemplateNodeOverrideTarget("labelTarget");
		expect(
			componentDraftStore.get().overrideTargets.labelTarget,
		).toBeUndefined();
	});

	it("removes override targets when their template path is deleted", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: complexComponentTemplateRoot(),
			overrideTargets: {
				labelTarget: {
					targetId: "labelTarget",
					label: "Label",
					path: "label",
				},
			},
		});

		deleteTemplateNode("label");

		expect(componentDraftStore.get().overrideTargets).toEqual({});
	});

	it("removes slot metadata when a slot host subtree is deleted", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: complexComponentTemplateRoot(),
			slots: {
				labelSlot: {
					name: "labelSlot",
					label: "Label",
					hostPath: "label",
				},
			},
		});
		const label = componentDraftStore.get().entitiesByPath.label;
		if (!label) {
			throw new Error("Expected label entity.");
		}
		componentDraftStore.setState((state) => ({
			...state,
			entitiesByPath: {
				...state.entitiesByPath,
				label: {
					...label,
					slot: "labelSlot",
				},
			},
		}));

		deleteTemplateNode("label");

		const state = componentDraftStore.get();
		expect(state.entitiesByPath.label).toBeUndefined();
		expect(state.slots).toEqual({});
	});

	it("routes variant style edits to classesByPath without mutating base className", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "brand",
						values: {
							brand: { label: "Brand" },
							neutral: { label: "Neutral" },
						},
					},
				},
			},
		});
		updateTemplateNodeClassName("root", "text-base");
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "tone",
			valueKey: "brand",
		});
		updateVariantClassesByPath("tone", "brand", "root", "text-blue-600");

		const state = componentDraftStore.get();
		expect(state.entitiesByPath.root?.className).toBe("text-base");
		expect(state.variants?.axes.tone.values.brand.classesByPath?.root).toBe(
			"text-blue-600",
		);
		expect(state.variantsDirty).toBe(true);
	});

	it("preserves authored class strings in draft base and variant storage", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			variants: {
				axes: {
					size: {
						label: "Size",
						defaultValue: "lg",
						values: {
							lg: { label: "Large" },
						},
					},
				},
			},
		});
		const baseClassName = "h-4 unknown-template-token h-6";
		const variantClassName = "h-8 unknown-variant-token h-10";

		updateTemplateNodeClassName("root", baseClassName);
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "size",
			valueKey: "lg",
		});
		setComponentDraftStyleClassName("root", variantClassName);

		const state = componentDraftStore.get();
		const layers = getComponentDraftPreviewClassLayers(state, "root");

		expect(state.entitiesByPath.root?.className).toBe(baseClassName);
		expect(state.variants?.axes.size.values.lg.classesByPath?.root).toBe(
			variantClassName,
		);
		expect(serializeComponentDraftState(state).className).toBe(baseClassName);
		expect(getComponentDraftPreviewClassName(state, "root")).toBe(
			`${baseClassName} ${variantClassName}`,
		);
		expect(
			resolveClassLayers(layers, { colorTokens: new Set<string>() })
				.tokens.filter((token) => token.classToken.startsWith("h-"))
				.map((token) => ({
					classToken: token.classToken,
					status: token.status,
					shadowedBy: token.shadowedBy,
				})),
		).toEqual([
			{ classToken: "h-4", status: "shadowed", shadowedBy: 2 },
			{ classToken: "h-6", status: "shadowed", shadowedBy: 3 },
			{ classToken: "h-8", status: "shadowed", shadowedBy: 5 },
			{ classToken: "h-10", status: "active", shadowedBy: undefined },
		]);
	});

	it("builds draft preview layers from the selected variant edit without changing the rendered class string", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: {
				path: "root",
				library: "base-ui",
				component: "separator",
				className: "h-4 unknown-template-token",
			},
			variants: {
				axes: {
					size: {
						label: "Size",
						values: {
							lg: {
								label: "Large",
								classesByPath: { root: "h-6 unknown-variant-token" },
							},
						},
					},
				},
			},
		});
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "size",
			valueKey: "lg",
		});

		const state = componentDraftStore.get();
		const layers = getComponentDraftPreviewClassLayers(state, "root");

		expect(layers).toEqual([
			{
				source: "system-template",
				className: "h-4 unknown-template-token",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
				},
			},
			{
				source: "system-variant",
				className: "h-6 unknown-variant-token",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					axis: "size",
					value: "lg",
				},
			},
		]);
		expect(flattenClassLayers(layers)).toBe(
			getComponentDraftPreviewClassName(state, "root"),
		);
		expect(getComponentDraftPreviewClassName(state, "root")).toBe(
			"h-4 unknown-template-token h-6 unknown-variant-token",
		);
		expect(
			resolveClassLayers(layers, { colorTokens: new Set<string>() }).tokens.map(
				(token) => ({
					classToken: token.classToken,
					source: token.layer.source,
					status: token.status,
					shadowedBy: token.shadowedBy,
				}),
			),
		).toEqual([
			{
				classToken: "h-4",
				source: "system-template",
				status: "shadowed",
				shadowedBy: 2,
			},
			{
				classToken: "unknown-template-token",
				source: "system-template",
				status: "unknown",
				shadowedBy: undefined,
			},
			{
				classToken: "h-6",
				source: "system-variant",
				status: "active",
				shadowedBy: undefined,
			},
			{
				classToken: "unknown-variant-token",
				source: "system-variant",
				status: "unknown",
				shadowedBy: undefined,
			},
		]);
	});

	it("resolves component draft preview-like base, template, compound, and selection layers with statuses", () => {
		const separatorResolution = resolveRegistryComponent(
			"base-ui",
			"separator",
		);
		expect(separatorResolution.status).toBe("known");
		if (separatorResolution.status !== "known") return;

		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: {
				path: "root",
				library: "base-ui",
				component: "separator",
				className: "h-4 unknown-template-token",
			},
			variants: {
				axes: {},
				compoundVariants: [
					{
						when: {},
						classesByPath: {
							root: "h-8 data-[orientation=vertical]:w-2",
						},
					},
				],
			},
		});
		setComponentDraftStyleTarget({ mode: "compound", compoundIndex: 0 });

		const draftLayers = getComponentDraftPreviewClassLayers(
			componentDraftStore.get(),
			"root",
		);
		const layers = createClassLayers([
			{
				source: "registry-base",
				className: separatorResolution.definition.baseClassName,
				metadata: {
					library: "base-ui",
					component: "separator",
					path: "root",
				},
			},
			...draftLayers,
			{
				source: "authored",
				className: "outline outline-2 unknown-selection-token",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					prop: "currentPreviewSelection",
				},
			},
		]);
		const resolution = resolveClassLayers(layers, {
			colorTokens: new Set<string>(),
		});

		expect(
			resolution.tokens.map((token) => ({
				classToken: token.classToken,
				source: token.layer.source,
				status: token.status,
				metadata: token.layer.metadata,
				shadowedBy: token.shadowedBy,
			})),
		).toEqual([
			{
				classToken: "data-[orientation=vertical]:w-px",
				source: "registry-base",
				status: "shadowed",
				metadata: {
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: 7,
			},
			{
				classToken: "data-[orientation=vertical]:self-stretch",
				source: "registry-base",
				status: "active",
				metadata: {
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:h-px",
				source: "registry-base",
				status: "active",
				metadata: {
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=horizontal]:w-full",
				source: "registry-base",
				status: "active",
				metadata: {
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "h-4",
				source: "system-template",
				status: "shadowed",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: 6,
			},
			{
				classToken: "unknown-template-token",
				source: "system-template",
				status: "unknown",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "h-8",
				source: "system-compound-variant",
				status: "active",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					compoundIndex: 0,
				},
				shadowedBy: undefined,
			},
			{
				classToken: "data-[orientation=vertical]:w-2",
				source: "system-compound-variant",
				status: "active",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					compoundIndex: 0,
				},
				shadowedBy: undefined,
			},
			{
				classToken: "outline",
				source: "authored",
				status: "shadowed",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					prop: "currentPreviewSelection",
				},
				shadowedBy: 9,
			},
			{
				classToken: "outline-2",
				source: "authored",
				status: "active",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					prop: "currentPreviewSelection",
				},
				shadowedBy: undefined,
			},
			{
				classToken: "unknown-selection-token",
				source: "authored",
				status: "unknown",
				metadata: {
					componentId: FIXTURE_COMPONENT_ID,
					library: "base-ui",
					component: "separator",
					path: "root",
					prop: "currentPreviewSelection",
				},
				shadowedBy: undefined,
			},
		]);
	});

	const hydrateCompoundFixture = () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: { brand: { label: "Brand" } },
					},
					size: {
						label: "Size",
						values: { lg: { label: "Large" } },
					},
				},
				compoundVariants: [
					{ when: { tone: "brand", size: "lg" }, classesByPath: {} },
				],
			},
		});
	};

	it("routes compound style edits to the compound classesByPath", () => {
		hydrateCompoundFixture();
		updateTemplateNodeClassName("root", "text-base");
		setComponentDraftStyleTarget({ mode: "compound", compoundIndex: 0 });
		setComponentDraftStyleClassName("root", "ring-2");

		const state = componentDraftStore.get();
		expect(state.entitiesByPath.root?.className).toBe("text-base");
		expect(state.variants?.compoundVariants?.[0]?.classesByPath.root).toBe(
			"ring-2",
		);
		expect(state.variantsDirty).toBe(true);
		expect(getEffectiveDraftNodeClassName(state, "root")).toBe("ring-2");
		expect(getCompoundClassNameForPath(state, 0, "root")).toBe("ring-2");
	});

	it("ignores a compound style target whose index does not exist", () => {
		hydrateCompoundFixture();
		setComponentDraftStyleTarget({ mode: "compound", compoundIndex: 5 });
		expect(componentDraftStore.get().styleTarget).toEqual({ mode: "base" });
	});

	it("resets a compound style target when the compound list size changes", () => {
		hydrateCompoundFixture();
		setComponentDraftStyleTarget({ mode: "compound", compoundIndex: 0 });
		expect(componentDraftStore.get().styleTarget).toEqual({
			mode: "compound",
			compoundIndex: 0,
		});

		// Removing the compound shifts indices, so the target falls back to base.
		replaceComponentDraftVariants({
			axes: {
				tone: { label: "Tone", values: { brand: { label: "Brand" } } },
				size: { label: "Size", values: { lg: { label: "Large" } } },
			},
		});
		expect(componentDraftStore.get().styleTarget).toEqual({ mode: "base" });
	});

	it("keeps a compound style target when only its conditions change", () => {
		hydrateCompoundFixture();
		setComponentDraftStyleTarget({ mode: "compound", compoundIndex: 0 });
		setComponentDraftStyleClassName("root", "ring-2");

		// Editing the compound's `when` keeps the count, so index 0 stays valid.
		replaceComponentDraftVariants({
			axes: {
				tone: { label: "Tone", values: { brand: { label: "Brand" } } },
				size: { label: "Size", values: { lg: { label: "Large" } } },
			},
			compoundVariants: [
				{ when: { tone: "brand" }, classesByPath: { root: "ring-2" } },
			],
		});
		expect(componentDraftStore.get().styleTarget).toEqual({
			mode: "compound",
			compoundIndex: 0,
		});
	});

	it("clears template dirty without discarding unsaved variant edits", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						defaultValue: "brand",
						values: {
							brand: { label: "Brand" },
						},
					},
				},
			},
		});

		updateTemplateNodeClassName("root", "text-base");
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "tone",
			valueKey: "brand",
		});
		updateVariantClassesByPath("tone", "brand", "root", "text-blue-600");

		const revision = componentDraftStore.get().revision;
		expect(componentDraftStore.get().dirtyPaths).toEqual({ root: true });
		expect(componentDraftStore.get().variantsDirty).toBe(true);

		clearComponentDraftTemplateDirty(revision);

		const state = componentDraftStore.get();
		expect(state.templateDirty).toBe(false);
		expect(state.dirtyPaths).toEqual({});
		// The template-only save must not mark variant edits as saved.
		expect(state.variantsDirty).toBe(true);
		expect(state.variants?.axes.tone.values.brand.classesByPath?.root).toBe(
			"text-blue-600",
		);
	});

	it("resets stale variant style target on clean hydration", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
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
		});
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "tone",
			valueKey: "brand",
		});

		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: {
							neutral: { label: "Neutral" },
						},
					},
				},
			},
		});

		expect(componentDraftStore.get().styleTarget).toEqual({ mode: "base" });
	});

	it("blocks base className writes while variant style target is active", () => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: minimalComponentTemplateRoot(),
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
		});
		updateTemplateNodeClassName("root", "text-base");
		setComponentDraftStyleTarget({
			mode: "variant",
			axisKey: "tone",
			valueKey: "brand",
		});

		updateTemplateNodeClassName("root", "text-red-500");

		expect(componentDraftStore.get().entitiesByPath.root?.className).toBe(
			"text-base",
		);
	});

	it("scopes editing to a single component root and ignores published-only inputs", () => {
		const publishedRoot = complexComponentTemplateRoot();
		const publishedSnapshot = structuredClone(publishedRoot);

		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: FIXTURE_COMPONENT_ID,
			root: publishedRoot,
		});

		updateTemplateNodeClassName("root", "border");
		const serialized = serializeComponentDraftState(componentDraftStore.get());

		expect(componentDraftStore.get().rootPath).toBe("root");
		expect(
			Object.keys(componentDraftStore.get().entitiesByPath).sort(),
		).toEqual(["icon", "label", "root"]);
		expect(publishedSnapshot).toEqual(complexComponentTemplateRoot());
		expect(serialized.path).toBe("root");
		expect(
			hashComponentDraftSnapshot({
				root: serialized,
				slots: componentDraftStore.get().slots,
				overrideTargets: componentDraftStore.get().overrideTargets,
			}),
		).toBe(getComponentDraftTemplateHash());
	});
});

function collectPaths(root: RecipeTemplateNode): string[] {
	const paths = [root.path];
	for (const child of root.children ?? []) {
		paths.push(...collectPaths(child));
	}
	return paths;
}
