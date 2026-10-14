import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	type AnnotationAddress,
	type RecordChangeResult,
	validateAddresses,
} from "../../services/annotation-service";
import type { AnnotationContainer } from "../../services/annotations.types";
import {
	type AnnotationProject,
	appendToResult,
	type McpAnnotationSession,
} from "../annotation-session";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import { createToolErrorResult } from "./results";

/**
 * `addresses` on the write tools (design_apply; component_draft_update and
 * component_publish): the annotations a write answers, each with the
 * agent's reply. One flow for every write:
 *
 * 1. `prepareAddresses` before the write: refuses duplicates, a project
 *    without an id, and unknown, other-container, closed or other-branch
 *    annotations (nothing is written), and notes which entries this
 *    session had seen of each.
 * 2. The write records the change under its lock, after it lands, with
 *    `prepared.addresses` (they carry what was seen: a designer remark
 *    sent while the agent worked keeps the annotation open work).
 * 3. `finishAddresses` after it: marks what the session has now seen and
 *    adds `addressed` to the result.
 */

/** Annotations one write can address. */
export const MAX_ADDRESSES = 20;

export const addressesInputSchema = (description: string) =>
	z
		.array(
			z
				.object({
					annotationId: z.string().min(1).describe("Annotation id."),
					reply: z
						.string()
						.min(1)
						.describe("What you changed, for the designer."),
				})
				.strict(),
		)
		.min(1)
		.max(MAX_ADDRESSES)
		.optional()
		.describe(description);

export type PreparedAddresses = {
	project: AnnotationProject;
	/** The addresses with the entries this session had seen of each. */
	addresses: AnnotationAddress[];
	/** Per annotation, the entries this session had seen before the write. */
	known: ReadonlyMap<string, readonly string[] | undefined>;
};

const listCallOf = (container: AnnotationContainer, branch?: "all") => {
	const where =
		container.kind === "design"
			? `designFileId: "${container.designId}"`
			: `systemId: "${container.systemId}", componentId: "${container.componentId}"`;
	return `${TOOL.annotationList}({ ${where}${branch ? `, branch: "${branch}"` : ""} })`;
};

/**
 * Checks `addresses` before a write. Returns an error result (nothing may
 * be written), or what the write and `finishAddresses` need.
 */
export const prepareAddresses = async (
	annotations: McpAnnotationSession,
	context: TrickroomMcpServerContext,
	container: AnnotationContainer,
	addresses: readonly { annotationId: string; reply: string }[],
): Promise<CallToolResult | PreparedAddresses> => {
	const ids = addresses.map((address) => address.annotationId);
	const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
	if (duplicate !== undefined) {
		return createToolErrorResult(
			context,
			"INVALID_OPERATION_PARAMETERS",
			`addresses names annotation ${duplicate} twice; pass each annotation once with one reply.`,
		);
	}
	const project = await annotations.openProject(context);
	if (!project) {
		return createToolErrorResult(
			context,
			"PROJECT_ID_REQUIRED",
			"This project has no projectId in .trickroom/config.json, so it has no annotations to address.",
		);
	}
	const problems = await validateAddresses(project.service, {
		container,
		addresses,
		branch: project.scope.branch,
	});
	if (problems.length > 0) {
		const what = container.kind === "design" ? "design" : "component";
		return createToolErrorResult(
			context,
			problems[0]?.code ?? "ANNOTATION_NOT_FOUND",
			`${problems.map((problem) => problem.message).join(" ")} Nothing was written. ${listCallOf(container)} lists this checkout's live annotations of this ${what}${problems.some((problem) => problem.code === "WRONG_BRANCH") ? `; ${listCallOf(container, "all")} every branch's` : ""}.`,
			{
				valid: false,
				...(container.kind === "design"
					? { designFileId: container.designId }
					: {
							systemId: container.systemId,
							componentId: container.componentId,
						}),
				addressProblems: problems,
			},
		);
	}
	// What this session has seen of each: a designer remark that arrives
	// while it works is not answered by this write.
	const known = new Map(
		ids.map((annotationId) => [
			annotationId,
			annotations.seenEntryIds(project, annotationId),
		]),
	);
	return {
		project,
		known,
		addresses: addresses.map((address) => {
			const entryIds = known.get(address.annotationId);
			return entryIds ? { ...address, knownEntryIds: entryIds } : address;
		}),
	};
};

export const isPreparedAddresses = (
	value: CallToolResult | PreparedAddresses,
): value is PreparedAddresses => "project" in value && "known" in value;

/** What the result says per addressed annotation. */
export const describeRecorded = (result: RecordChangeResult) =>
	result.status === "recorded"
		? {
				annotationId: result.annotationId,
				status: result.annotation.status,
				entryId: result.entryId,
				...(result.unseenRemarkIds
					? {
							unseenRemarkIds: result.unseenRemarkIds,
							message:
								"The designer added to this annotation while you worked. Your change is recorded, but the annotation stays open work: their new remark is in annotations.new.",
						}
					: {}),
			}
		: {
				annotationId: result.annotationId,
				status: "failed" as const,
				code: result.code,
				message: result.message,
			};

/**
 * After a write that landed: this session has now seen what it had seen of
 * each annotation plus its own change entry (not a remark that landed
 * meanwhile), and the result lists `addressed`. `recorded` is null when
 * the recording step did not run to the end.
 */
export const finishAddresses = (
	annotations: McpAnnotationSession,
	prepared: PreparedAddresses,
	recorded: readonly RecordChangeResult[] | null,
	result: CallToolResult,
	what: "design" | "component",
): CallToolResult => {
	const outcomes = recorded ?? [];
	for (const outcome of outcomes) {
		if (outcome.status !== "recorded") continue;
		const entryIds = prepared.known.get(outcome.annotationId);
		if (entryIds) {
			annotations.markSeen(prepared.project, outcome.annotation, [
				...entryIds.filter((id) =>
					outcome.annotation.entries.some((entry) => entry.id === id),
				),
				outcome.entryId,
			]);
		}
	}
	if (outcomes.length > 0) annotations.startClock(prepared.project);
	return appendToResult(
		result,
		"addressed",
		outcomes.length > 0
			? outcomes.map(describeRecorded)
			: // The write landed but the recording step did not run to the end.
				prepared.addresses.map(({ annotationId }) => ({
					annotationId,
					status: "failed",
					code: "ANNOTATION_WRITE_FAILED",
					message: `The ${what} was written, but the change could not be recorded on this annotation.`,
				})),
	);
};
