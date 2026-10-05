import {
	type DesignSystemRecord,
	listDesignSystems,
} from "../../utils/design-system-store";
import { readSystemComponentManifest } from "../../utils/system-component-manifest-service";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import type { GuideTopic } from "./topics";

/**
 * The system component authoring contract: a core for drafting, publishing
 * and placing components, and one topic per draft part.
 */

export const SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES = [
	"template",
	"slots",
	"variants",
	"overrides",
	"examples",
] as const;

export type SystemComponentGuideTopicName =
	(typeof SYSTEM_COMPONENT_GUIDE_TOPIC_NAMES)[number];

export type SystemComponentGuideInput = {
	context: TrickroomMcpServerContext;
	systemName?: string;
};

const PLACEHOLDER_REVISION = "<manifest revision from your last read or write>";
const PLACEHOLDER_DESIGN_REVISION =
	"<design revision from your last read or write>";

const CORE_MODEL = [
	`A system component is a user-owned, reusable component in a design system's component manifest. It has one draft you edit and published versions that designs place as instances (the addSystemComponent operation of ${TOOL.designApply}).`,
	'Its template is a tree of registry elements, the same node shape as a recipe template, where every node has a stable path. The root\'s path is "root".',
	"Slots mark template nodes that accept instance content. Variant axes add classes per path for each value. Override targets name paths whose className, text, icon, asset or props an instance may override.",
];

const CORE_RULES = [
	`Writes take expectedRevision: the manifest revision from ${TOOL.componentRead}, or the revision your last write returned. ${TOOL.componentDraftUpdate} also accepts expectedDraftTemplateHash and expectedDraftVariantSchemaHash (draftTemplateHash and draftVariantSchemaHash from ${TOOL.componentRead} describe) to guard against concurrent draft edits.`,
	"Paths are unique, non-empty and slashless. slots, variants.classesByPath and overrideTargets refer to template paths, so keep them stable.",
	"Classes follow the design rules: Tailwind plus the system's tokens.",
	`Publishing makes the draft the current version. Instances already placed keep their version and show as stale until migrated: ${TOOL.componentRead}({ view: "stale" }) finds them, ${TOOL.componentMigrate} moves them.`,
];

const CORE_WORKFLOW = [
	`Read: ${TOOL.componentRead}({ systemName, query? }) for the manifest revision and a compact component index; ${TOOL.componentRead}({ componentId, source: "draft", include: ["template", "classes"] }) for a draft's template, variant classes and hashes before updating it.`,
	`Write: ${TOOL.componentDraftCreate}({ systemName, expectedRevision, slug, name, draft: { root, slots?, variants?, overrideTargets? } }), or ${TOOL.componentDraftUpdate} with only the parts to replace. Malformed input returns VALIDATION_FAILED with INVALID_SYSTEM_COMPONENT_DRAFT_INPUT diagnostics, each with a path and message.`,
	`Rename or regroup: ${TOOL.componentDraftUpdate}({ systemName, componentId, expectedRevision, name?, group?, description? }) with any of the three on their own; group is slash-separated folders like "organisms/sidebar" and null clears group or description. They are labels outside the template and its hashes, so they apply at once: no publish, no new version, no stale instances, and the draft is not touched or created. slug and componentId never change.`,
	`Check and publish: ${TOOL.designScreenshot}({ component }) renders a component, or a matrix of its variant values, without a design file. ${TOOL.componentPublish}({ systemName, componentId, expectedRevision }) makes the draft current; place it in a design with ${TOOL.designApply} (${TOOL.guide} topic "components").`,
	`Extract from a design: ${TOOL.componentDraftCreate}({ expectedRevision, from: { designFileId, elementId } }) turns a designed layer and its subtree into a draft (instances inside become plain elements; name defaults to the layer name, the system to the design's). The design is not changed, and a draft cannot be placed until it is published, so this is the default: review the draft, add variants, slots and override targets, then publish and place it. When the layer should become an instance right away, add replace: true and the design's expectedRevision: the same call publishes the draft and replaces the layer with an instance, as one ${TOOL.designApply} batch would. Policy, the layer's board revision, the template and whether the layer can be replaced where it sits are checked before anything is written. If a later write still fails (another writer got there first), the earlier writes stay, and the result says what was written (partial) and gives the call that finishes the job (next).`,
];

const buildTemplateTopic = () => ({
	type: "RecipeTemplateNode",
	required: ["path", "library", "component"],
	optional: ["name", "className", "props", "text", "slot", "children"],
	pathRules: [
		'Use "root" for the root node path.',
		"Every template path must be unique, non-empty, stable and slashless.",
		"slots, variants.classesByPath and overrideTargets.path reference these paths.",
	],
	children: "Recursive array of RecipeTemplateNode, for branch-role nodes.",
	props: "JSON-primitive registry control props only.",
	text: "Default text of a text-role node; make it an override target with the text capability so instances can change it.",
});

const buildSlotsTopic = () => ({
	type: "Record<string, SystemComponentSlotDefinition>",
	requiredPerSlot: ["name", "hostPath"],
	optionalPerSlot: ["label", "insertIndex", "defaultChildren", "history"],
	rules: [
		"Map key must match slot.name.",
		"hostPath must reference a template path.",
		"defaultChildren uses the RecipeTemplateNode shape.",
		"Slot content renders after the host's declared template children by default (declared children first, then slot children).",
		"insertIndex (non-negative integer) splices slot content into the host's declared children at that index, clamped to the declared-children length. Set it to 0 to place slot content before the declared children, for example an optional leading icon ahead of a fixed label.",
		"Changing insertIndex on publish changes render order and marks existing instances stale; migration re-splices preserved authored slot content at the new version's insertIndex.",
		'Legacy alternative to insertIndex: host the slot on a first-positioned wrapper node with className "contents" so appended slot content still renders ahead of sibling declared children.',
	],
});

const buildVariantsTopic = () => ({
	type: "SystemComponentVariantSchema",
	required: ["axes"],
	axisShape: {
		required: ["label", "values"],
		optional: ["defaultValue"],
	},
	valueShape: {
		optional: ["label", "classesByPath"],
	},
	classesByPath:
		"Record from template path to non-empty Tailwind class string. Paths must exist in root.",
	compoundVariants:
		"Array of { when: Record<axis, value | value[]>, classesByPath }. Normal authoring uses single string values for at least two valid axis/value conditions.",
	defaultValues:
		"Record from axis id to value id. Both schema defaultValues and axis.defaultValue must reference real value ids.",
	rules: [
		"Omit defaultValues and axis.defaultValue for optional axes. Omitted default-less axes are genuinely unset; Trickroom does not fabricate the first value.",
		"Compound variants are matched by their normalized when signature. Do not author duplicate signatures; validation reports duplicates and persisted order remains CSS precedence.",
		"Compounds with empty classesByPath are treated as empty and may be garbage-collected by authoring flows; omit them instead of persisting empty entries.",
		"Array-valued when entries remain accepted for compatibility and are preserved as advanced shapes, but normal UI authoring should not collapse or expand them silently.",
	],
	instanceUpdates:
		"Instances set axes with variantValues and clear them with unsetVariantAxes. Missing variantValues keys leave existing instance values unchanged. On the addSystemComponent operation, unsetVariantAxes clears matching initial variantValues before schema defaults resolve.",
});

const buildOverridesTopic = () => ({
	type: "Record<string, SystemComponentOverrideTarget>",
	requiredPerTarget: ["targetId", "label", "path"],
	optionalPerTarget: ["capabilities", "props", "history"],
	capabilities: ["className", "text", "icon", "asset"],
	props:
		"Visible registry control prop names on the target template node, for example placeholder or disabled.",
	rules: [
		"Map key must match target.targetId.",
		"path must reference a template path.",
		"capabilities defaults to className when omitted.",
		"props must reference visible, non-deprecated registry controls on the target node.",
		"Everything that is not an override target or slot is locked in instances, so expose what designs need to change.",
	],
});

const buildExamplesTopic = () => [
	{
		tool: TOOL.componentDraftCreate,
		description: "Create a component draft with a root template and variants.",
		arguments: {
			systemName: "Core",
			expectedRevision: PLACEHOLDER_REVISION,
			slug: "status-pill",
			name: "Status Pill",
			draft: {
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "inline-flex items-center gap-2 rounded-full px-3 py-1",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Status",
						},
					],
				},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								neutral: {
									label: "Neutral",
									classesByPath: { root: "bg-zinc-100 text-zinc-800" },
								},
								success: {
									label: "Success",
									classesByPath: { root: "bg-emerald-100 text-emerald-800" },
								},
							},
						},
					},
					defaultValues: { tone: "neutral" },
				},
				overrideTargets: {
					label: {
						targetId: "label",
						label: "Label",
						path: "label",
						capabilities: ["text", "className"],
					},
				},
			},
		},
	},
	{
		tool: TOOL.componentDraftUpdate,
		description: "Replace the draft's override targets, guarded by its hash.",
		arguments: {
			systemName: "Core",
			componentId: "cmp_…",
			expectedRevision: PLACEHOLDER_REVISION,
			expectedDraftTemplateHash: `<draftTemplateHash from ${TOOL.componentRead}>`,
			overrideTargets: {
				root: {
					targetId: "root",
					label: "Root",
					path: "root",
					capabilities: ["className"],
				},
			},
		},
	},
	{
		tool: TOOL.componentPublish,
		description: "Publish the draft as the component's current version.",
		arguments: {
			systemName: "Core",
			componentId: "cmp_…",
			expectedRevision: PLACEHOLDER_REVISION,
		},
	},
	{
		tool: TOOL.componentDraftCreate,
		description:
			"Promote a designed layer to a component in one call: extract it as the template, publish it and replace the layer with an instance.",
		arguments: {
			systemName: "Core",
			expectedRevision: PLACEHOLDER_REVISION,
			name: "Plan Card",
			from: {
				designFileId: "<design id>",
				elementId: "<layer id>",
				replace: true,
				expectedRevision: PLACEHOLDER_DESIGN_REVISION,
			},
		},
	},
	{
		tool: TOOL.componentDraftUpdate,
		description:
			"Rename and regroup a component. Applies at once; nothing to publish.",
		arguments: {
			systemName: "Core",
			componentId: "cmp_…",
			expectedRevision: PLACEHOLDER_REVISION,
			name: "Nav Item",
			group: "organisms/sidebar",
			description: null,
		},
	},
];

export const SYSTEM_COMPONENT_GUIDE_TOPICS: readonly GuideTopic<
	SystemComponentGuideTopicName,
	SystemComponentGuideInput
>[] = [
	{
		name: "template",
		when: "When writing draft.root: the template node shape and path rules.",
		build: buildTemplateTopic,
	},
	{
		name: "slots",
		when: "When a component should accept instance content: slot shape, insertIndex and render order.",
		build: buildSlotsTopic,
	},
	{
		name: "variants",
		when: "When adding variant axes, defaults or compound variants.",
		build: buildVariantsTopic,
	},
	{
		name: "overrides",
		when: "When instances should change text, classes, icons, assets or props of a template node.",
		build: buildOverridesTopic,
	},
	{
		name: "examples",
		when: "Worked create, update, publish and extract-from-a-design calls.",
		build: buildExamplesTopic,
	},
];

const findSystem = (systems: readonly DesignSystemRecord[], handle: string) =>
	systems.find(
		(system) =>
			system.manifest.systemName === handle ||
			system.manifest.systemId === handle,
	) ?? null;

const summarizeComponents = async (
	context: TrickroomMcpServerContext,
	system: DesignSystemRecord,
) => {
	try {
		const read = await readSystemComponentManifest(
			context.projectRoot,
			system.manifest.systemId,
		);
		const components = Object.values(read.manifest.components);
		return {
			revision: read.revision,
			componentCount: components.length,
			publishedCount: components.filter(
				(component) => component.published !== undefined,
			).length,
			draftCount: components.filter(
				(component) => component.draft !== undefined,
			).length,
		};
	} catch {
		return null;
	}
};

export const buildSystemComponentGuideCore = async (
	input: SystemComponentGuideInput,
) => {
	const systems = await listDesignSystems(input.context.projectRoot);
	const selected =
		input.systemName === undefined
			? null
			: findSystem(systems, input.systemName);

	return {
		model: CORE_MODEL,
		rules: CORE_RULES,
		workflow: CORE_WORKFLOW,
		system:
			input.systemName === undefined
				? null
				: {
						requested: input.systemName,
						configured: selected !== null,
						systemId: selected?.manifest.systemId ?? null,
						systemName: selected?.manifest.systemName ?? null,
						...(selected
							? {
									components: await summarizeComponents(
										input.context,
										selected,
									),
								}
							: {}),
					},
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
		})),
		topics: Object.fromEntries(
			SYSTEM_COMPONENT_GUIDE_TOPICS.map((topic) => [
				`component-${topic.name}`,
				topic.when,
			]),
		),
		topicUsage: `Fetch with ${TOOL.guide}({ topic: "component-variants" }) or several at once: topic: ["component-template", "component-slots"].`,
	};
};
