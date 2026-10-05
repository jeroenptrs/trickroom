import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomically } from "../server-file-utils";
import { asErrnoException, isRecord } from "../server-utils";
import { withDesignFileLock } from "../services/design-file-lock";
import { resolveTrickroomHome } from "./home";

export type ProjectLocationRef = {
	locationId: string;
	projectId: string;
	root: string;
	name: string;
	lastOpenedAt: string;
	/**
	 * When a registry write first found the root folder gone. Cleared when
	 * the folder is seen again; the location is removed once it has been
	 * missing for `PROJECT_LOCATION_MISSING_RETENTION_MS`.
	 */
	missingSince?: string;
};

export type ProjectRegistry = {
	schemaVersion: 1;
	locations: ProjectLocationRef[];
	lastActiveProjectId?: string;
	lastActiveLocationId?: string;
};

/** How long a location's root may stay missing before a write removes it. */
export const PROJECT_LOCATION_MISSING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A root that has not answered `stat` by then is treated as unknown. */
const rootProbeTimeoutMs = 1_000;

export class ProjectRegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProjectRegistryError";
	}
}

export const createEmptyProjectRegistry = (): ProjectRegistry => ({
	schemaVersion: 1,
	locations: [],
});

export const getProjectRegistryPath = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "projects.json");

const isProjectLocationRef = (value: unknown): value is ProjectLocationRef =>
	isRecord(value) &&
	typeof value.locationId === "string" &&
	value.locationId.trim().length > 0 &&
	typeof value.projectId === "string" &&
	value.projectId.trim().length > 0 &&
	typeof value.root === "string" &&
	value.root.trim().length > 0 &&
	typeof value.name === "string" &&
	value.name.trim().length > 0 &&
	typeof value.lastOpenedAt === "string" &&
	value.lastOpenedAt.trim().length > 0 &&
	(value.missingSince === undefined || typeof value.missingSince === "string");

export const isProjectRegistry = (value: unknown): value is ProjectRegistry =>
	isRecord(value) &&
	value.schemaVersion === 1 &&
	Array.isArray(value.locations) &&
	value.locations.every(isProjectLocationRef) &&
	(value.lastActiveProjectId === undefined ||
		typeof value.lastActiveProjectId === "string") &&
	(value.lastActiveLocationId === undefined ||
		typeof value.lastActiveLocationId === "string");

export const readProjectRegistry = async (
	trickroomHome = resolveTrickroomHome(),
): Promise<ProjectRegistry> => {
	const registryPath = getProjectRegistryPath(trickroomHome);

	try {
		const registry = await readJsonFile<unknown>(registryPath);
		if (!isProjectRegistry(registry)) {
			throw new ProjectRegistryError(
				`Trickroom project registry at ${registryPath} is invalid.`,
			);
		}

		return registry;
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return createEmptyProjectRegistry();
		}

		if (error instanceof SyntaxError) {
			throw new ProjectRegistryError(
				`Trickroom project registry at ${registryPath} is corrupt JSON.`,
			);
		}

		throw error;
	}
};

export const writeProjectRegistry = async (
	registry: ProjectRegistry,
	trickroomHome = resolveTrickroomHome(),
) => {
	const registryPath = getProjectRegistryPath(trickroomHome);
	await mkdir(path.dirname(registryPath), { recursive: true });
	await writeJsonFileAtomically(registryPath, registry);
	return registry;
};

/**
 * Runs a read-modify-write of the registry under a lock shared by every
 * process using this Trickroom home (the app server and each MCP server), so
 * concurrent registrations are not lost.
 */
const withProjectRegistryLock = <T>(
	trickroomHome: string,
	operation: () => Promise<T>,
) =>
	withDesignFileLock(getProjectRegistryPath(trickroomHome), operation, {
		lockDirectory: path.join(trickroomHome, "locks"),
		label: "project registry",
	});

/**
 * Sets or clears the last-active pointers, keeping every other field
 * (including ones this version does not know) in place.
 */
const withActivePointers = (
	registry: ProjectRegistry,
	pointers: { lastActiveProjectId?: string; lastActiveLocationId?: string },
): ProjectRegistry => {
	const next: ProjectRegistry = { ...registry, schemaVersion: 1 };
	delete next.lastActiveProjectId;
	delete next.lastActiveLocationId;
	if (pointers.lastActiveProjectId) {
		next.lastActiveProjectId = pointers.lastActiveProjectId;
	}
	if (pointers.lastActiveLocationId) {
		next.lastActiveLocationId = pointers.lastActiveLocationId;
	}
	return next;
};

export type ProjectLocationRootStatus = "present" | "missing" | "unknown";

/**
 * Whether a location's root folder still exists. Only a definite answer
 * (`ENOENT`, `ENOTDIR`, or not a directory) counts as missing; other errors
 * and a `stat` slower than `timeoutMs` (an unresponsive mount) are unknown.
 */
export const probeProjectLocationRoot = async (
	root: string,
	timeoutMs = rootProbeTimeoutMs,
): Promise<ProjectLocationRootStatus> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<ProjectLocationRootStatus>((resolve) => {
		timer = setTimeout(() => resolve("unknown"), timeoutMs);
		timer.unref?.();
	});
	const probe = stat(root).then(
		(rootStat): ProjectLocationRootStatus =>
			rootStat.isDirectory() ? "present" : "missing",
		(error): ProjectLocationRootStatus => {
			const code = asErrnoException(error).code;
			return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown";
		},
	);

	try {
		return await Promise.race([probe, timeout]);
	} finally {
		clearTimeout(timer);
	}
};

/** Probes every distinct root concurrently, keyed by resolved root. */
export const probeProjectLocationRoots = async (
	locations: readonly ProjectLocationRef[],
) => {
	const roots = [
		...new Set(locations.map((location) => path.resolve(location.root))),
	];
	const statuses = await Promise.all(
		roots.map((root) => probeProjectLocationRoot(root)),
	);
	return new Map(roots.map((root, index) => [root, statuses[index]]));
};

/**
 * The locations whose root folder has not been found missing, in registry
 * order. Reads only: missing locations stay in the file until a write
 * removes them.
 */
export const listPresentProjectLocations = async (
	locations: readonly ProjectLocationRef[],
) => {
	const statuses = await probeProjectLocationRoots(locations);
	return locations.filter(
		(location) => statuses.get(path.resolve(location.root)) !== "missing",
	);
};

/**
 * Applies probed root statuses to a registry about to be written: a missing
 * root gains `missingSince`, a present one loses it, and a location missing
 * for the retention period is removed along with last-active pointers that
 * no longer lead anywhere. Locations without a status are left alone.
 */
export const reconcileMissingProjectLocations = (
	registry: ProjectRegistry,
	statuses: ReadonlyMap<string, ProjectLocationRootStatus>,
	now: string,
): ProjectRegistry => {
	const nowMs = Date.parse(now);
	const locations: ProjectLocationRef[] = [];
	for (const location of registry.locations) {
		const status = statuses.get(path.resolve(location.root));
		if (status === "present") {
			const { missingSince: _cleared, ...present } = location;
			locations.push(location.missingSince === undefined ? location : present);
			continue;
		}
		if (status !== "missing") {
			locations.push(location);
			continue;
		}

		const recordedMs =
			location.missingSince === undefined
				? Number.NaN
				: Date.parse(location.missingSince);
		const missingSince = Number.isFinite(recordedMs)
			? (location.missingSince as string)
			: now;
		const missingSinceMs = Number.isFinite(recordedMs) ? recordedMs : nowMs;
		if (nowMs - missingSinceMs >= PROJECT_LOCATION_MISSING_RETENTION_MS) {
			continue;
		}
		locations.push(
			location.missingSince === missingSince
				? location
				: { ...location, missingSince },
		);
	}

	const keepsLocation = locations.some(
		(location) => location.locationId === registry.lastActiveLocationId,
	);
	const keepsProject = locations.some(
		(location) => location.projectId === registry.lastActiveProjectId,
	);
	return withActivePointers(
		{ ...registry, locations },
		{
			lastActiveProjectId: keepsProject
				? registry.lastActiveProjectId
				: undefined,
			lastActiveLocationId: keepsLocation
				? registry.lastActiveLocationId
				: undefined,
		},
	);
};

export const upsertProjectLocation = async ({
	trickroomHome = resolveTrickroomHome(),
	projectId,
	root,
	name,
	now = new Date().toISOString(),
	markActive = true,
}: {
	trickroomHome?: string;
	projectId: string;
	root: string;
	name: string;
	now?: string;
	markActive?: boolean;
}) => {
	const normalizedRoot = path.resolve(root);
	// Probe the other roots before taking the lock so a slow mount does not
	// hold up other processes; locations registered meanwhile are left alone.
	const knownLocations = (await readProjectRegistry(trickroomHome)).locations;
	const statuses = await probeProjectLocationRoots(
		knownLocations.filter(
			(location) => path.resolve(location.root) !== normalizedRoot,
		),
	);

	return withProjectRegistryLock(trickroomHome, async () => {
		const registry = await readProjectRegistry(trickroomHome);
		const locations = [...registry.locations];
		const existingIndex = locations.findIndex(
			(location) => path.resolve(location.root) === normalizedRoot,
		);
		const existing = existingIndex === -1 ? null : locations[existingIndex];
		const { missingSince: _seenAgain, ...kept } = existing ?? {};
		const location: ProjectLocationRef = {
			...kept,
			locationId: existing?.locationId ?? `loc_${randomUUID()}`,
			projectId,
			root: normalizedRoot,
			name,
			lastOpenedAt: now,
		};

		if (existingIndex === -1) {
			locations.push(location);
		} else {
			locations[existingIndex] = location;
		}

		const nextRegistry = reconcileMissingProjectLocations(
			withActivePointers(
				{
					...registry,
					locations: locations.sort((a, b) =>
						b.lastOpenedAt.localeCompare(a.lastOpenedAt),
					),
				},
				markActive
					? {
							lastActiveProjectId: projectId,
							lastActiveLocationId: location.locationId,
						}
					: registry,
			),
			statuses,
			now,
		);

		await writeProjectRegistry(nextRegistry, trickroomHome);
		return { registry: nextRegistry, location };
	});
};

export const deleteProjectLocation = async ({
	trickroomHome = resolveTrickroomHome(),
	locationId,
}: {
	trickroomHome?: string;
	locationId: string;
}) =>
	withProjectRegistryLock(trickroomHome, async () => {
		const registry = await readProjectRegistry(trickroomHome);
		const location = registry.locations.find(
			(location) => location.locationId === locationId,
		);
		if (!location) {
			return null;
		}

		const deletingActiveLocation = registry.lastActiveLocationId === locationId;
		const nextRegistry = withActivePointers(
			{
				...registry,
				locations: registry.locations.filter(
					(location) => location.locationId !== locationId,
				),
			},
			deletingActiveLocation ? {} : registry,
		);

		await writeProjectRegistry(nextRegistry, trickroomHome);
		return { registry: nextRegistry, location };
	});

export const updateProjectLocationName = async ({
	trickroomHome = resolveTrickroomHome(),
	locationId,
	name,
}: {
	trickroomHome?: string;
	locationId: string;
	name: string;
}) =>
	withProjectRegistryLock(trickroomHome, async () => {
		const registry = await readProjectRegistry(trickroomHome);
		const location = registry.locations.find(
			(location) => location.locationId === locationId,
		);
		if (!location) {
			return null;
		}

		const nextLocation: ProjectLocationRef = {
			...location,
			name,
		};
		const nextRegistry: ProjectRegistry = {
			...registry,
			locations: registry.locations.map((location) =>
				location.locationId === locationId ? nextLocation : location,
			),
		};

		await writeProjectRegistry(nextRegistry, trickroomHome);
		return { registry: nextRegistry, location: nextLocation };
	});

export const clearActiveProjectLocation = async (
	trickroomHome = resolveTrickroomHome(),
) =>
	withProjectRegistryLock(trickroomHome, async () => {
		const registry = await readProjectRegistry(trickroomHome);
		if (!registry.lastActiveProjectId && !registry.lastActiveLocationId) {
			return registry;
		}

		const nextRegistry = withActivePointers(registry, {});
		await writeProjectRegistry(nextRegistry, trickroomHome);
		return nextRegistry;
	});

export const getActiveProjectLocation = (
	registry: ProjectRegistry,
): ProjectLocationRef | null => {
	if (!registry.lastActiveLocationId) {
		return null;
	}

	return (
		registry.locations.find(
			(location) => location.locationId === registry.lastActiveLocationId,
		) ?? null
	);
};
