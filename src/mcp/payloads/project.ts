import type { McpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";

// Full project block: only returned by project-orientation tools (selection,
// registration, resolution). Every other tool response carries the compact
// reference below so responses do not repeat paths and names on each call.
export const getProjectDetails = (context: TrickroomMcpServerContext) => ({
	projectId: context.config.projectId ?? null,
	locationId: context.locationId ?? null,
	projectRoot: context.projectRoot,
	name: context.config.name,
});

export const getProjectReference = (context: TrickroomMcpServerContext) => ({
	projectId: context.config.projectId ?? null,
	locationId: context.locationId ?? null,
});

export const getDesignResourceLocationId = (
	context: TrickroomMcpServerContext,
) => context.locationId ?? context.config.projectId ?? null;

export const getGovernanceSummary = (policy: McpPolicy) => ({
	mode: policy.mode,
	allowedDesignFileIds:
		policy.allowedDesignFileIds === null
			? null
			: [...policy.allowedDesignFileIds].sort(),
	allowedComponents:
		policy.allowedComponents === null
			? null
			: [...policy.allowedComponents].sort(),
	auditLog: policy.auditLog,
});
