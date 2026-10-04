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
import { getGovernanceSummary, getProjectReference } from "../payloads/project";
import type { TrickroomMcpProjectResolverError } from "../project-resolver";
import type { TrickroomMcpServerContext } from "../server-types";

export const createJsonResult = (
	payload: Record<string, unknown>,
	options: { text?: string } = {},
): CallToolResult => ({
	content: [
		{
			type: "text",
			text: options.text ?? JSON.stringify(payload),
		},
	],
	structuredContent: payload,
});

const createSummaryTextResult = (
	payload: Record<string, unknown>,
	text: string,
): CallToolResult => createJsonResult(payload, { text });

type McpReadResponseFormat = "json" | "summary";

export const createReadToolResult = (
	payload: Record<string, unknown>,
	responseFormat: McpReadResponseFormat,
	summarize: (payload: Record<string, unknown>) => string,
): CallToolResult => {
	if (responseFormat === "summary") {
		return createSummaryTextResult(payload, summarize(payload));
	}

	return createJsonResult(payload);
};

export const createProjectInfoResult = async (
	context: TrickroomMcpServerContext,
) => {
	const systems = await listDesignSystems(context.projectRoot);
	const projectMemory = await readMemoryManifest(context.projectRoot, {
		kind: "project",
	});
	const payload = {
		projectName: context.config.name,
		projectId: context.config.projectId ?? null,
		locationId: context.locationId ?? null,
		projectRoot: context.projectRoot,
		configPath: context.configPath,
		mcpEnabled: true,
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			...(system.manifest.cssPath ? { cssPath: system.manifest.cssPath } : {}),
		})),
		memory: summarizeMemoryManifest(projectMemory.manifest),
		memoryHint:
			"Project memory captures why this project exists and how it should be steered. Call listMemoryNotes({ scope: { kind: 'project' } }) to read it before broad work.",
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
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
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
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
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
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
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
			"The design file was modified since your last read. Re-read the design file to get the current revision, then retry.",
		suggestedReads: ["readDesignFile", "readElement"],
	};
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
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
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true,
	};
};
