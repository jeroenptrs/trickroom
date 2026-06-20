import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { TrickroomConfig } from "../types";
import type { TrickroomMcpServerContext } from "./server";

export type McpPolicyMode = "read-only" | "read-write";

export type McpPolicy = {
	mode: McpPolicyMode;
	allowedDesignFileIds: ReadonlySet<string> | null;
	allowedComponents: ReadonlySet<string> | null;
	auditLog: boolean;
};

export type McpPolicyErrorCode =
	| "MCP_READ_ONLY"
	| "MCP_DESIGN_FILE_NOT_ALLOWED"
	| "MCP_COMPONENT_NOT_ALLOWED";

export class McpPolicyError extends Error {
	readonly code: McpPolicyErrorCode;

	constructor(code: McpPolicyErrorCode, message: string) {
		super(message);
		this.name = "McpPolicyError";
		this.code = code;
	}
}

export type McpAuditEntry = {
	toolName: string;
	operation: string;
	projectId?: string | null;
	projectRoot: string;
	designFileId?: string | null;
	expectedRevision?: string | null;
	resultingRevision?: string | null;
	success: boolean;
	status: string;
	code?: string;
	message?: string;
	details?: Record<string, unknown>;
};

export const getMcpPolicy = (config: TrickroomConfig): McpPolicy => ({
	mode: config.mcp?.mode ?? "read-write",
	allowedDesignFileIds: config.mcp?.allowedDesignFileIds
		? new Set(config.mcp.allowedDesignFileIds)
		: null,
	allowedComponents: config.mcp?.allowedComponents
		? new Set(config.mcp.allowedComponents)
		: null,
	auditLog: config.mcp?.auditLog === true,
});

export const getComponentRef = (library: string, component: string) =>
	`${library}/${component}`;

export const assertCanReadDesignFile = (
	policy: McpPolicy,
	designFileId: string,
) => {
	if (
		policy.allowedDesignFileIds !== null &&
		!policy.allowedDesignFileIds.has(designFileId)
	) {
		throw new McpPolicyError(
			"MCP_DESIGN_FILE_NOT_ALLOWED",
			`MCP access to design file "${designFileId}" is not allowed by project policy.`,
		);
	}
};

export const assertCanWriteDesignFile = (
	policy: McpPolicy,
	designFileId: string,
) => {
	assertCanWriteProject(policy);
	assertCanReadDesignFile(policy, designFileId);
};

export const assertCanWriteProject = (policy: McpPolicy) => {
	if (policy.mode === "read-only") {
		throw new McpPolicyError(
			"MCP_READ_ONLY",
			"MCP is configured in read-only mode for this project.",
		);
	}
};

export const assertCanUseComponent = (
	policy: McpPolicy,
	library: string,
	component: string,
) => {
	if (policy.allowedComponents === null) {
		return;
	}

	const componentRef = getComponentRef(library, component);
	if (!policy.allowedComponents.has(componentRef)) {
		throw new McpPolicyError(
			"MCP_COMPONENT_NOT_ALLOWED",
			`MCP access to component "${componentRef}" is not allowed by project policy.`,
		);
	}
};

export const isComponentAllowed = (
	policy: McpPolicy,
	library: string,
	component: string,
) =>
	policy.allowedComponents === null ||
	policy.allowedComponents.has(getComponentRef(library, component));

export const appendMcpAuditLog = async (
	context: TrickroomMcpServerContext,
	entry: McpAuditEntry,
) => {
	if (!getMcpPolicy(context.config).auditLog) {
		return;
	}

	const auditLogPath = path.join(context.trickroomDir, "audit-log.jsonl");
	await mkdir(path.dirname(auditLogPath), { recursive: true });
	await appendFile(
		auditLogPath,
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			...entry,
			projectId: entry.projectId ?? context.config.projectId ?? null,
			projectRoot: entry.projectRoot,
		})}\n`,
		"utf8",
	);
};
