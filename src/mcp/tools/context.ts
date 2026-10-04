import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { upsertProjectLocation } from "../../app-state/project-registry";
import {
	readMcpEnabledProjectContext,
	TrickroomProjectConfigError,
} from "../../project";
import { CaptureHostManager } from "../../screenshot/capture-host";
import type {
	ScreenshotRequest,
	ScreenshotResult,
} from "../../screenshot/types";
import { DesignTransformError } from "../../services/design-transform-service";
import { AssetManifestError } from "../../utils/asset-manifest-service";
import { IconManifestError } from "../../utils/icon-manifest-service";
import { MemoryManifestError } from "../../utils/memory-manifest-service";
import { SystemComponentOperationsError } from "../../utils/system-component-operations";
import { McpPolicyError } from "../governance";
import { getProjectDetails } from "../payloads/project";
import {
	createTrickroomMcpProjectResolver,
	type TrickroomMcpProjectRef,
	TrickroomMcpProjectResolverError,
} from "../project-resolver";
import type {
	TrickroomMcpServer,
	TrickroomMcpServerContext,
	TrickroomMcpServerOptions,
} from "../server-types";
import {
	createJsonResult,
	createPolicyDeniedResult,
	createProjectResolverErrorResult,
	createToolErrorResult,
} from "./results";

export const createMcpToolContext = (
	server: TrickroomMcpServer,
	initialContext: TrickroomMcpServerContext | null,
	options: TrickroomMcpServerOptions = {},
) => {
	let selectedContext = initialContext;
	const trickroomHome = initialContext?.trickroomHome ?? options.trickroomHome;
	const projectResolver =
		options.projectResolver ??
		createTrickroomMcpProjectResolver({
			trickroomHome,
			defaultContext: initialContext?.locationId
				? {
						...initialContext,
						locationId: initialContext.locationId,
					}
				: null,
		});
	const captureHosts = new CaptureHostManager();
	const screenshotCapture =
		options.screenshotCapture ??
		(async (
			context: TrickroomMcpServerContext,
			request: ScreenshotRequest,
		): Promise<ScreenshotResult> => {
			const host = await captureHosts.get(context.projectRoot);
			const response = await fetch(
				new URL("api/trickroom/screenshot", host.url),
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(request),
				},
			);
			const payload = (await response.json().catch(() => null)) as
				| (ScreenshotResult & { error?: never; code?: never })
				| { error?: string; code?: string }
				| null;
			if (!response.ok || !payload || "error" in payload) {
				const error = new Error(
					payload && "error" in payload && payload.error
						? payload.error
						: `Screenshot request failed with HTTP ${response.status}.`,
				) as Error & { code?: string };
				if (payload && "code" in payload && payload.code)
					error.code = payload.code;
				throw error;
			}
			return payload as ScreenshotResult;
		});

	const notifyResourceListChanged = async () => {
		try {
			await server.sendResourceListChanged();
		} catch {
			// Notification delivery is best-effort in-band behavior and must not block mutations.
		}
	};

	const getActiveContext = async (project?: TrickroomMcpProjectRef) => {
		if (project?.locationId || project?.projectId) {
			return projectResolver.resolveProject(project);
		}

		const context = selectedContext;
		if (!context) {
			throw new TrickroomProjectConfigError(
				"CONFIG_NOT_FOUND",
				"No Trickroom MCP project is selected. Call selectProject with a projectId or locationId, or start MCP from a folder with a direct .trickroom/config.json.",
			);
		}

		return context;
	};

	const registerProjectFromPath = async (projectPath: string) => {
		const opened = await readMcpEnabledProjectContext(projectPath);
		const projectId = opened.config.projectId;
		if (!projectId) {
			throw new Error("Project configuration is missing a projectId.");
		}

		const { location, registry } = await upsertProjectLocation({
			trickroomHome,
			projectId,
			root: opened.projectRoot,
			name: opened.config.name,
			markActive: false,
		});
		const context: TrickroomMcpServerContext = {
			...opened,
			trickroomHome,
			locationId: location.locationId,
		};
		const isRegistryActive =
			registry.lastActiveLocationId === location.locationId;

		return { context, isRegistryActive };
	};

	const selectProjectFromRef = async (ref: {
		locationId?: string;
		projectId?: string;
	}) => {
		const context = await projectResolver.resolveProject({
			...(ref.locationId ? { locationId: ref.locationId } : {}),
			...(ref.projectId ? { projectId: ref.projectId } : {}),
		});
		selectedContext = context;
		projectResolver.setDefaultContext(context);
		await notifyResourceListChanged();
		return createJsonResult({
			project: getProjectDetails(context),
			selected: true,
		});
	};

	const createGetSelectedProjectResult = () =>
		createJsonResult({
			project: selectedContext ? getProjectDetails(selectedContext) : null,
		});

	const withProjectContext = async (
		project: TrickroomMcpProjectRef | undefined,
		fn: (context: TrickroomMcpServerContext) => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		try {
			return await fn(await getActiveContext(project));
		} catch (error) {
			if (error instanceof TrickroomMcpProjectResolverError) {
				return createProjectResolverErrorResult(error);
			}
			throw error;
		}
	};

	const withPolicyErrorHandling = async (
		projectOrFn:
			| TrickroomMcpProjectRef
			| undefined
			| ((context: TrickroomMcpServerContext) => Promise<CallToolResult>),
		maybeFn?: (context: TrickroomMcpServerContext) => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		const project = typeof projectOrFn === "function" ? undefined : projectOrFn;
		const fn = typeof projectOrFn === "function" ? projectOrFn : maybeFn;
		if (!fn) {
			throw new Error("Missing project-scoped tool handler.");
		}

		let context: TrickroomMcpServerContext;
		try {
			context = await getActiveContext(project);
		} catch (error) {
			if (error instanceof TrickroomMcpProjectResolverError) {
				return createProjectResolverErrorResult(error);
			}
			throw error;
		}

		try {
			return await fn(context);
		} catch (error) {
			if (error instanceof McpPolicyError) {
				return createPolicyDeniedResult(context, error);
			}
			if (error instanceof DesignTransformError) {
				return createToolErrorResult(
					context,
					error.code,
					error.message,
					error.details,
				);
			}
			if (
				error instanceof AssetManifestError ||
				error instanceof IconManifestError
			) {
				return createToolErrorResult(context, error.code, error.message);
			}
			if (error instanceof SystemComponentOperationsError) {
				return createToolErrorResult(context, error.code, error.message);
			}
			if (error instanceof MemoryManifestError) {
				return createToolErrorResult(context, error.code, error.message);
			}
			throw error;
		}
	};

	return {
		server,
		trickroomHome,
		projectResolver,
		captureHosts,
		screenshotCapture,
		getSelectedContext: () => selectedContext,
		notifyResourceListChanged,
		getActiveContext,
		registerProjectFromPath,
		selectProjectFromRef,
		createGetSelectedProjectResult,
		withProjectContext,
		withPolicyErrorHandling,
	};
};

export type McpToolContext = ReturnType<typeof createMcpToolContext>;
