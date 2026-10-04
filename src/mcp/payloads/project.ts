import { listDesignSystems } from "../../utils/design-system-store";
import {
	readMemoryManifest,
	summarizeMemoryManifest,
} from "../../utils/memory-manifest-service";
import { getMcpPolicy, type McpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";

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

/**
 * What a session needs to know about a project before working in it: the
 * governance mode, design systems, and whether project memory exists.
 */
export const getProjectInfo = async (context: TrickroomMcpServerContext) => {
	const systems = await listDesignSystems(context.projectRoot);
	const projectMemory = await readMemoryManifest(context.projectRoot, {
		kind: "project",
	});
	const memory = summarizeMemoryManifest(projectMemory.manifest);
	return {
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
					memoryHint: `Project memory records why this project exists and how to steer it. Read it with ${TOOL.memoryRead}() before broad work.`,
				}
			: {}),
	};
};
