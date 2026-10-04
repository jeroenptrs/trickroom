import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { DesignTransformError } from "../../services/design-transform-service";
import { listDesignSystems } from "../../utils/design-system-store";
import {
	readMemoryManifest,
	summarizeMemoryManifest,
} from "../../utils/memory-manifest-service";
import { systemComponentDraftInputDiagnosticsFromZodError } from "../../utils/system-component-draft-schemas";
import { getMcpPolicy, type McpPolicyError } from "../governance";
import {
	getGovernanceSummary,
	getProjectDetails,
	getProjectReference,
} from "../payloads/project";
import type { TrickroomMcpProjectResolverError } from "../project-resolver";
import type { TrickroomMcpServerContext } from "../server-types";

// One minified JSON text block. No tool declares an outputSchema, so the
// payload is not repeated in structuredContent.
export const createJsonResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(payload) }],
});

/** The JSON payload of a createJsonResult result, or {} for other results. */
export const readJsonResultPayload = (
	result: CallToolResult,
): Record<string, unknown> => {
	const block = result.content.find((entry) => entry.type === "text");
	if (block?.type !== "text") {
		return {};
	}
	try {
		const payload = JSON.parse(block.text) as unknown;
		return typeof payload === "object" &&
			payload !== null &&
			!Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

const createErrorResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	...createJsonResult(payload),
	isError: true,
});

export const createProjectInfoResult = async (
	context: TrickroomMcpServerContext,
) => {
	const systems = await listDesignSystems(context.projectRoot);
	const projectMemory = await readMemoryManifest(context.projectRoot, {
		kind: "project",
	});
	const memory = summarizeMemoryManifest(projectMemory.manifest);
	const payload = {
		project: getProjectDetails(context),
		governance: { mode: getMcpPolicy(context.config).mode },
		...(context.config.defaultSystemId
			? { defaultSystemId: context.config.defaultSystemId }
			: {}),
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			...(system.manifest.cssPath ? { cssPath: system.manifest.cssPath } : {}),
		})),
		...(memory.noteCount > 0
			? {
					memory,
					memoryHint:
						"Project memory captures why this project exists and how it should be steered. Call listMemoryNotes({ scope: { kind: 'project' } }) to read it before broad work.",
				}
			: {}),
	};

	return createJsonResult(payload);
};

export const createPolicyDeniedResult = (
	context: TrickroomMcpServerContext,
	error: McpPolicyError,
): CallToolResult => {
	const policy = getMcpPolicy(context.config);
	const payload = {
		status: "POLICY_DENIED",
		code: error.code,
		message: error.message,
		project: getProjectReference(context),
		governance: getGovernanceSummary(policy),
	};
	return createErrorResult(payload);
};

export const createToolErrorResult = (
	context: TrickroomMcpServerContext,
	code: string,
	message: string,
	details: Record<string, unknown> = {},
): CallToolResult => {
	const payload = {
		status: "INVALID_OPERATION",
		code,
		message,
		project: getProjectReference(context),
		...details,
	};
	return createErrorResult(payload);
};

export const createSystemComponentDraftInputErrorResult = (
	context: TrickroomMcpServerContext,
	error: z.ZodError,
): CallToolResult =>
	createToolErrorResult(
		context,
		"VALIDATION_FAILED",
		"System component draft input validation failed.",
		{
			diagnostics: systemComponentDraftInputDiagnosticsFromZodError(error),
		},
	);

export const createProjectResolverErrorResult = (
	error: TrickroomMcpProjectResolverError,
): CallToolResult => {
	const payload = {
		status: error.code,
		...error.details,
	};
	return createErrorResult(payload);
};

export const createRevisionMismatchResult = (
	context: TrickroomMcpServerContext,
	currentRevision: string,
	expectedRevision: string,
): CallToolResult => {
	const payload = {
		status: "REVISION_MISMATCH",
		project: getProjectReference(context),
		currentRevision,
		expectedRevision,
		message:
			"The design file changed since your last read. Re-read the area you are editing, then retry with currentRevision.",
		suggestedReads: ["readSubtree", "readElement"],
	};
	return createErrorResult(payload);
};

export const createInvalidOperationResult = (
	context: TrickroomMcpServerContext,
	error: DesignTransformError,
): CallToolResult => {
	const payload = {
		status: "INVALID_OPERATION",
		project: getProjectReference(context),
		code: error.code,
		message: error.message,
		...error.details,
	};
	return createErrorResult(payload);
};
