import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	asErrnoException,
	isRecord,
} from "../server-utils";
import { readJsonFile, writeJsonFileAtomically } from "../server-file-utils";
import { resolveTrickroomHome } from "./home";

export type ProjectLocationRef = {
	locationId: string;
	projectId: string;
	root: string;
	name: string;
	lastOpenedAt: string;
};

export type ProjectRegistry = {
	schemaVersion: 1;
	locations: ProjectLocationRef[];
	lastActiveProjectId?: string;
	lastActiveLocationId?: string;
};

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
	value.lastOpenedAt.trim().length > 0;

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
	const registry = await readProjectRegistry(trickroomHome);
	const normalizedRoot = path.resolve(root);
	const locations = [...registry.locations];
	const existingIndex = locations.findIndex(
		(location) => path.resolve(location.root) === normalizedRoot,
	);
	const existing = existingIndex === -1 ? null : locations[existingIndex];
	const location: ProjectLocationRef = {
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

	const nextRegistry: ProjectRegistry = {
		schemaVersion: 1,
		locations: locations.sort((a, b) =>
			b.lastOpenedAt.localeCompare(a.lastOpenedAt),
		),
		...(markActive
			? {
					lastActiveProjectId: projectId,
					lastActiveLocationId: location.locationId,
				}
			: {
					lastActiveProjectId: registry.lastActiveProjectId,
					lastActiveLocationId: registry.lastActiveLocationId,
				}),
	};

	await writeProjectRegistry(nextRegistry, trickroomHome);
	return { registry: nextRegistry, location };
};

export const deleteProjectLocation = async ({
	trickroomHome = resolveTrickroomHome(),
	locationId,
}: {
	trickroomHome?: string;
	locationId: string;
}) => {
	const registry = await readProjectRegistry(trickroomHome);
	const location = registry.locations.find(
		(location) => location.locationId === locationId,
	);
	if (!location) {
		return null;
	}

	const deletingActiveLocation = registry.lastActiveLocationId === locationId;
	const nextRegistry: ProjectRegistry = {
		schemaVersion: 1,
		locations: registry.locations.filter(
			(location) => location.locationId !== locationId,
		),
		lastActiveProjectId: deletingActiveLocation
			? undefined
			: registry.lastActiveProjectId,
		lastActiveLocationId: deletingActiveLocation
			? undefined
			: registry.lastActiveLocationId,
	};

	await writeProjectRegistry(nextRegistry, trickroomHome);
	return { registry: nextRegistry, location };
};

export const updateProjectLocationName = async ({
	trickroomHome = resolveTrickroomHome(),
	locationId,
	name,
}: {
	trickroomHome?: string;
	locationId: string;
	name: string;
}) => {
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
};

export const clearActiveProjectLocation = async (
	trickroomHome = resolveTrickroomHome(),
) => {
	const registry = await readProjectRegistry(trickroomHome);
	if (!registry.lastActiveProjectId && !registry.lastActiveLocationId) {
		return registry;
	}

	const nextRegistry: ProjectRegistry = {
		schemaVersion: 1,
		locations: registry.locations,
	};
	await writeProjectRegistry(nextRegistry, trickroomHome);
	return nextRegistry;
};

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

export const findProjectLocation = (
	registry: ProjectRegistry,
	projectId: string,
) => registry.locations.find((location) => location.projectId === projectId);
