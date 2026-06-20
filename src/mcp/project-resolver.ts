import path from "node:path";
import {
	type ProjectLocationRef,
	readProjectRegistry,
	upsertProjectLocation,
} from "../app-state/project-registry";
import {
	isMcpEnabled,
	readMcpEnabledProjectContext,
	readOrMigrateProjectConfig,
	TrickroomProjectConfigError,
	type TrickroomProjectContext,
} from "../project";

export type TrickroomMcpProjectContext = TrickroomProjectContext & {
	trickroomHome?: string;
	locationId: string;
};

export type TrickroomMcpProjectRef = {
	locationId?: string;
	projectId?: string;
};

export type TrickroomMcpProjectResolverErrorCode =
	| "MISSING_PROJECT_REF"
	| "UNKNOWN_PROJECT_LOCATION"
	| "UNKNOWN_PROJECT_ID"
	| "AMBIGUOUS_PROJECT_ID"
	| "PROJECT_REF_MISMATCH"
	| "STALE_PROJECT_LOCATION"
	| "MCP_DISABLED"
	| "INVALID_PROJECT";

export type TrickroomMcpProjectResolverErrorDetails = {
	code: TrickroomMcpProjectResolverErrorCode;
	message: string;
	locationId?: string;
	projectId?: string;
	requestedProjectId?: string;
	actualProjectId?: string;
	projectRoot?: string;
	candidates?: Array<{
		locationId: string;
		projectId: string;
		projectRoot: string;
		name: string;
	}>;
};

export class TrickroomMcpProjectResolverError extends Error {
	readonly code: TrickroomMcpProjectResolverErrorCode;
	readonly details: TrickroomMcpProjectResolverErrorDetails;

	constructor(details: TrickroomMcpProjectResolverErrorDetails) {
		super(details.message);
		this.name = "TrickroomMcpProjectResolverError";
		this.code = details.code;
		this.details = details;
	}
}

export type TrickroomMcpProjectResolver = {
	getDefaultContext: () => TrickroomMcpProjectContext | null;
	setDefaultContext: (context: TrickroomMcpProjectContext | null) => void;
	resolveProject: (
		ref?: TrickroomMcpProjectRef,
	) => Promise<TrickroomMcpProjectContext>;
};

export const listMcpEnabledProjectContexts = async ({
	trickroomHome,
	includeContext,
}: {
	trickroomHome?: string;
	includeContext?: TrickroomMcpProjectContext | null;
}): Promise<TrickroomMcpProjectContext[]> => {
	const registry = await readProjectRegistry(trickroomHome);
	const contexts: TrickroomMcpProjectContext[] = [];
	const seenLocationIds = new Set<string>();
	const seenRoots = new Set<string>();

	const appendContext = (context: TrickroomMcpProjectContext) => {
		const root = path.resolve(context.projectRoot);
		if (seenLocationIds.has(context.locationId) || seenRoots.has(root)) {
			return;
		}

		seenLocationIds.add(context.locationId);
		seenRoots.add(root);
		contexts.push(context);
	};

	if (includeContext) {
		appendContext(includeContext);
	}

	for (const location of registry.locations) {
		try {
			appendContext(
				await readLocationContext(location, trickroomHome, location.projectId),
			);
		} catch (error) {
			if (
				error instanceof TrickroomMcpProjectResolverError ||
				error instanceof TrickroomProjectConfigError
			) {
				continue;
			}

			throw error;
		}
	}

	return contexts;
};

const toCandidate = (location: ProjectLocationRef) => ({
	locationId: location.locationId,
	projectId: location.projectId,
	projectRoot: location.root,
	name: location.name,
});

const readLocationContext = async (
	location: ProjectLocationRef,
	trickroomHome: string | undefined,
	requestedProjectId?: string,
): Promise<TrickroomMcpProjectContext> => {
	try {
		const context = await readMcpEnabledProjectContext(location.root);
		if (
			requestedProjectId &&
			context.config.projectId &&
			context.config.projectId !== requestedProjectId
		) {
			throw new TrickroomMcpProjectResolverError({
				code: "STALE_PROJECT_LOCATION",
				message: `The registered project location "${location.locationId}" is stale. Registry expects projectId "${requestedProjectId}" but current config resolves to "${context.config.projectId}".`,
				locationId: location.locationId,
				projectId: location.projectId,
				requestedProjectId,
				actualProjectId: context.config.projectId,
				projectRoot: location.root,
			});
		}
		return {
			...context,
			trickroomHome,
			locationId: location.locationId,
		};
	} catch (error) {
		if (error instanceof TrickroomProjectConfigError) {
			throw new TrickroomMcpProjectResolverError({
				code:
					error.code === "MCP_DISABLED"
						? "MCP_DISABLED"
						: error.code === "CONFIG_NOT_FOUND"
							? "STALE_PROJECT_LOCATION"
							: "INVALID_PROJECT",
				message: error.message,
				locationId: location.locationId,
				projectId: location.projectId,
				projectRoot: location.root,
			});
		}

		throw error;
	}
};

export const createTrickroomMcpProjectResolver = ({
	trickroomHome,
	defaultContext = null,
}: {
	trickroomHome?: string;
	defaultContext?: TrickroomMcpProjectContext | null;
}): TrickroomMcpProjectResolver => {
	let selectedDefaultContext = defaultContext;

	const resolveProject = async (ref: TrickroomMcpProjectRef = {}) => {
		if (!ref.locationId && !ref.projectId) {
			if (selectedDefaultContext) {
				return selectedDefaultContext;
			}

			throw new TrickroomMcpProjectResolverError({
				code: "MISSING_PROJECT_REF",
				message:
					"No MCP project reference was supplied. Call resolveProject with projectId or locationId, or start MCP from a folder with a valid .trickroom config.",
			});
		}

		const registry = await readProjectRegistry(trickroomHome);
		let location: ProjectLocationRef | undefined;

		if (ref.locationId) {
			location = registry.locations.find(
				(candidate) => candidate.locationId === ref.locationId,
			);
			if (!location) {
				throw new TrickroomMcpProjectResolverError({
					code: "UNKNOWN_PROJECT_LOCATION",
					message: `Unknown registered project location "${ref.locationId}".`,
					locationId: ref.locationId,
					projectId: ref.projectId,
				});
			}
		}

		if (ref.projectId) {
			const matches = registry.locations.filter(
				(candidate) => candidate.projectId === ref.projectId,
			);
			if (location) {
				if (location.projectId !== ref.projectId) {
					throw new TrickroomMcpProjectResolverError({
						code: "PROJECT_REF_MISMATCH",
						message:
							"The supplied locationId and projectId refer to different registered projects.",
						locationId: ref.locationId,
						projectId: ref.projectId,
						candidates: matches.map(toCandidate),
					});
				}
			} else if (matches.length === 0) {
				throw new TrickroomMcpProjectResolverError({
					code: "UNKNOWN_PROJECT_ID",
					message: `Unknown registered project "${ref.projectId}".`,
					projectId: ref.projectId,
				});
			} else if (matches.length > 1) {
				throw new TrickroomMcpProjectResolverError({
					code: "AMBIGUOUS_PROJECT_ID",
					message: `ProjectId "${ref.projectId}" matches multiple registered locations. Resolve by locationId instead.`,
					projectId: ref.projectId,
					candidates: matches.map(toCandidate),
				});
			} else {
				location = matches[0];
			}
		}

		if (!location) {
			throw new TrickroomMcpProjectResolverError({
				code: "MISSING_PROJECT_REF",
				message:
					"No MCP project reference was supplied and no default project is selected.",
			});
		}

		return readLocationContext(
			location,
			trickroomHome,
			ref.projectId ?? location.projectId,
		);
	};

	return {
		getDefaultContext: () => selectedDefaultContext,
		setDefaultContext: (context) => {
			selectedDefaultContext = context;
		},
		resolveProject,
	};
};

export const inferMcpProjectContextFromCwd = async ({
	cwd = process.cwd(),
	trickroomHome,
}: {
	cwd?: string;
	trickroomHome?: string;
}): Promise<TrickroomMcpProjectContext | null> => {
	const projectRoot = path.resolve(cwd);
	try {
		const project = await readOrMigrateProjectConfig(projectRoot);

		if (!isMcpEnabled(project.config)) {
			return null;
		}

		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: project.config.projectId,
			root: projectRoot,
			name: project.config.name,
			markActive: false,
		});
		return {
			...project,
			trickroomHome,
			locationId: location.locationId,
		};
	} catch (error) {
		return null;
	}
};
