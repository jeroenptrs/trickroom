import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	convertDesignSubtreeToComponentDraftRoot,
	flattenDesignSubtree,
	validateComponentDraftTemplateRoot,
} from "../../utils/design-subtree-to-component-draft";
import { partialSystemComponentDraftPayloadSchema } from "../../utils/system-component-draft-schemas";
import { readSystemComponentManifest } from "../../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	publishSystemComponentDraft,
	SystemComponentOperationsError,
} from "../../utils/system-component-operations";
import { systemComponentSlugFromName } from "../../utils/system-components";
import type { MutationResponseDetail } from "../diagnostics";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	getMcpPolicy,
} from "../governance";
import { executeOperationPlan } from "../operation-plan";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	createDesignOperationDependencies,
	withMutationErrorHandling,
} from "../tools/mutation-support";
import {
	createJsonResult,
	createRevisionMismatchResult,
	createSystemComponentDraftInputErrorResult,
	createToolErrorResult,
	readJsonResultPayload,
} from "../tools/results";
import { isBoardCurrent } from "./design-revisions";
import {
	countElementNodes,
	getElementContextOrThrow,
	getNodeName,
	readDesignFileForTool,
} from "./design-tree";
import { applyDesignOperationsPayload } from "./design-validation";
import { assertCanUseSubtreeComponents } from "./references";
import { systemComponentMutationPayload } from "./system-components";

/**
 * component_draft_create with `from`: promote a designed subtree to a system
 * component. By default it only creates the draft (the design is not
 * changed). With `replace`, it also publishes the draft and replaces the
 * subtree with an instance of the published version, in three writes:
 *
 * 1. the component manifest: create the draft;
 * 2. the component manifest: publish it;
 * 3. the design, through the standard design_apply path: insert the instance
 *    where the subtree sits and delete the subtree.
 *
 * Everything that can be checked before writing is checked first (policy,
 * the source board's revision, the template, whether the subtree can be
 * replaced where it sits), so a failure after the first write is a race
 * (another writer between the checks and the writes). Such a failure leaves
 * the earlier writes in place and returns the error of the step that failed
 * with `partial` (what was written) and `next` (the call that finishes the
 * job). Nothing is rolled back: the draft or published component is valid on
 * its own.
 */
export type ComponentExtractionInput = {
	systemId: string;
	expectedRevision: string;
	slug?: string;
	name?: string;
	description?: string;
	group?: string;
	order?: number;
	from: {
		designFileId: string;
		elementId: string;
		replace?: boolean;
		expectedRevision?: string;
	};
	response?: MutationResponseDetail;
};

/** Steps that replace `elementId` with an instance of the component. */
const replacementOperations = (
	placement: { parentId: string | null; index: number; elementId: string },
	insert: Record<string, unknown>,
) => [
	{
		operation: "addSystemComponent" as const,
		parameters: {
			parentId: placement.parentId,
			index: placement.index,
			systemId: insert.systemId,
			componentId: insert.componentId,
		},
	},
	{
		operation: "deleteElement" as const,
		parameters: { elementId: placement.elementId },
	},
];

export const extractComponentDraftPayload = async (
	context: TrickroomMcpServerContext,
	input: ComponentExtractionInput,
): Promise<CallToolResult> => {
	const policy = getMcpPolicy(context.config);
	const { designFileId, elementId } = input.from;
	const replace = input.from.replace === true;
	assertCanReadDesignFile(policy, designFileId);

	const read = await readDesignFileForTool(context, designFileId);
	const source = getElementContextOrThrow(read.design, elementId);
	const placement = {
		parentId: source.parent?.id ?? null,
		index: source.parent ? (source.index ?? 0) : (source.rootIndex ?? 0),
		elementId,
	};

	if (replace) {
		const designRevision = input.from.expectedRevision;
		if (designRevision === undefined) {
			throw new DesignTransformError(
				"INVALID_OPERATION_PARAMETERS",
				"from.replace needs from.expectedRevision: the design revision from your last read or write.",
			);
		}
		assertCanWriteDesignFile(policy, designFileId);
		assertCanUseSubtreeComponents(policy, source.element);
		if (!isBoardCurrent(designRevision, read, source.board.id)) {
			return createRevisionMismatchResult(context, {
				designFileId,
				currentRevision: read.revision,
				expectedRevision: designRevision,
				staleBoardIds: [source.board.id],
				design: read.design,
			});
		}
	}

	const converted = convertDesignSubtreeToComponentDraftRoot(
		elementId,
		flattenDesignSubtree(source.element, placement.parentId),
	);
	const validation = validateComponentDraftTemplateRoot(converted.root);
	if (!validation.valid) {
		return createToolErrorResult(
			context,
			"VALIDATION_FAILED",
			"The subtree cannot become a component template.",
			{ errors: validation.errors },
		);
	}
	const draft = partialSystemComponentDraftPayloadSchema.safeParse({
		root: converted.root,
	});
	if (!draft.success) {
		return createSystemComponentDraftInputErrorResult(context, draft.error);
	}

	if (replace) {
		// Dry-run a replacement by an element of the template root's kind at the
		// same place: a subtree locked inside a recipe or component instance
		// fails here, before anything is written.
		const dryRun = await executeOperationPlan(
			createDesignOperationDependencies(context),
			{
				designFileId,
				operations: [
					{
						operation: "addElement",
						parameters: {
							parentId: placement.parentId,
							index: placement.index,
							library: converted.root.library,
							component: converted.root.component,
						},
					},
					{ operation: "deleteElement", parameters: { elementId } },
				],
			},
			read.design,
		);
		if (dryRun.status === "failed") {
			return createToolErrorResult(
				context,
				dryRun.error.code,
				`The layer cannot be replaced where it sits: ${dryRun.error.message} Extract without replace to create the draft only.`,
				dryRun.error.details,
			);
		}
	}

	const name =
		input.name?.trim() || getNodeName(source.element)?.trim() || "Component";
	const slug =
		input.slug?.trim() || systemComponentSlugFromName(name) || "component";
	const created = await createSystemComponentDraft(
		context.projectRoot,
		input.systemId,
		{
			slug,
			name,
			description: input.description,
			group: input.group,
			order: input.order,
			draft: draft.data,
		},
		{ expectedRevision: input.expectedRevision },
	);
	const { componentId } = created;
	const extracted = {
		designFileId,
		elementId,
		nodeCount: countElementNodes(source.element),
		...(converted.markers.recipeInstanceIds.length > 0 ||
		converted.markers.componentInstanceIds.length > 0
			? {
					// Instances inside the subtree become plain elements in the
					// template.
					strippedInstances: {
						recipes: converted.markers.recipeInstanceIds.length,
						components: converted.markers.componentInstanceIds.length,
					},
				}
			: {}),
	};

	if (!replace) {
		return createJsonResult({
			...(await systemComponentMutationPayload(
				context,
				input.systemId,
				componentId,
				{ kind: "created" },
			)),
			extracted,
			hint: `The design is unchanged. Check the draft with ${TOOL.designScreenshot}({ component: { componentId, source: "draft" } }), publish it with ${TOOL.componentPublish}, then place it with ${TOOL.designApply} addSystemComponent.`,
		});
	}

	const partial = {
		componentId,
		slug,
		created: true,
		published: false,
		replaced: false,
	};
	let published: Awaited<ReturnType<typeof publishSystemComponentDraft>>;
	try {
		published = await publishSystemComponentDraft(
			context.projectRoot,
			input.systemId,
			componentId,
			{ expectedRevision: created.revision },
		);
	} catch (error) {
		if (!(error instanceof SystemComponentOperationsError)) {
			throw error;
		}
		const manifest = await readSystemComponentManifest(
			context.projectRoot,
			input.systemId,
		);
		return createToolErrorResult(
			context,
			error.code,
			`The draft was created but publishing it failed: ${error.message} The design is unchanged.`,
			{
				partial,
				next: {
					tool: TOOL.componentPublish,
					args: { componentId, expectedRevision: manifest.revision },
				},
			},
		);
	}

	const operations = replacementOperations(placement, {
		systemId: input.systemId,
		componentId,
	});
	const applied = await withMutationErrorHandling(
		context,
		{
			toolName: TOOL.componentDraftCreate,
			operation: "extract",
			projectId: context.config.projectId ?? null,
			designFileId,
			expectedRevision: input.from.expectedRevision ?? null,
			details: { elementId, componentId, replace: true },
		},
		() =>
			applyDesignOperationsPayload(context, {
				designFileId,
				expectedRevision: input.from.expectedRevision as string,
				operations,
				response: input.response,
			}),
	);
	const write = readJsonResultPayload(applied);
	if (applied.isError) {
		return createJsonResultWithError({
			...write,
			message: `The component was created and published (version ${published.publishedVersion}), but replacing the layer failed: ${String(write.message ?? write.code ?? write.status)}`,
			partial: {
				...partial,
				published: true,
				publishedVersion: published.publishedVersion,
				manifestRevision: published.revision,
			},
			next: {
				tool: TOOL.designApply,
				args: {
					designFileId,
					expectedRevision:
						typeof write.currentRevision === "string"
							? write.currentRevision
							: input.from.expectedRevision,
					operations,
				},
			},
		});
	}

	const {
		status: _status,
		valid: _valid,
		project: _project,
		designFileId: _designFileId,
		operationCount: _operationCount,
		created: createdSteps,
		...diagnostics
	} = write;
	const instanceRootId = (
		createdSteps as Array<{ id?: string }> | undefined
	)?.[0]?.id;
	return createJsonResult({
		...(await systemComponentMutationPayload(
			context,
			input.systemId,
			componentId,
			{ kind: "published" },
		)),
		publishedVersion: published.publishedVersion,
		extracted,
		replaced: {
			...(instanceRootId ? { instanceRootId } : {}),
			...diagnostics,
		},
	});
};

const createJsonResultWithError = (
	payload: Record<string, unknown>,
): CallToolResult => ({ ...createJsonResult(payload), isError: true });
